/**
 * Remote catalogue hydration (M7-Q).
 *
 * The app's read paths are synchronous repository calls (`products.list()`,
 * `stores.getById()`, …) spread across many screens. Rather than re-plumb every
 * call site to async in M7, remote mode uses a read-through mirror: the API is the
 * datastore, and its catalogue snapshot is written into the local database at boot
 * so the existing read paths keep working unchanged.
 *
 * What the mirror is, and is not:
 *
 *   - It holds *catalogue* data only — categories, products, stores, and the
 *     public identity of the sellers behind those stores. Those are shared,
 *     read-mostly and safe to cache on device.
 *   - It is a cache, not a source of truth. Each boot replaces the collections
 *     wholesale, so a delisted product disappears instead of lingering.
 *   - It NEVER holds per-user authoritative state: no sessions, no cart, no
 *     orders, no payments, no wishlist. Those are read from the API on demand, so
 *     a shared or stale device cannot show another account's data.
 *   - Seller records ARE mirrored, but only the public projection the catalogue
 *     already exposes on each store (`id`, `fullName`, `status`, `sellerType`).
 *     That is what the shared `customerVisibility` rule needs: a product is only
 *     visible to a customer when its store AND its seller are active, and the
 *     rule resolves the seller from the local mirror. Without the stub every
 *     remote product resolved to `seller_missing` and the storefront rendered
 *     empty. National id, bank and pickup details are never mirrored — they are
 *     only available to the owner via `/seller/profile`, and the owner's full
 *     record is upserted over its stub by `hydrateSellerWorkspace` on session
 *     restore.
 *
 * Writes are never mirrored.
 */
import type { Category, Product, SellerProfile, Store } from '@/domain/types';
import { vantaApi, type StoreSummary } from './vanta-api';
import { ApiError } from './api-client';
import { getContainer } from '@/infrastructure/container';

export interface HydrationReport {
  categories: number;
  products: number;
  stores: number;
  sellers: number;
}

/**
 * Largest page the API accepts. `backend/src/http/middleware/validate.ts` caps
 * `pageSize` at 60 — asking for more returns a 422 `validation_failed`, which is
 * exactly the shape that used to leave remote mode stuck on a blank screen.
 */
const PAGE_SIZE = 60;

/** The API refuses pages past `maxPages`, so stop before the loop looks stuck. */
const MAX_PAGES = 60;

/**
 * Fetches every catalogue product. The API paginates, so walk the pages.
 *
 * The server may cap the catalogue below `MAX_PAGES * PAGE_SIZE`; a short page
 * means the walk is finished, so truncation is bounded and visible rather than
 * silent.
 */
async function fetchAllProducts(): Promise<Product[]> {
  const collected: Product[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await vantaApi.products({ page, pageSize: PAGE_SIZE });
    collected.push(...result.items);
    if (result.items.length < PAGE_SIZE || collected.length >= result.total) break;
  }
  return collected;
}

/**
 * The public seller stub the mirror stores for a storefront.
 *
 * Only the fields the catalogue already exposes are filled; everything a public
 * read must never see (national id, bank, pickup address) is left blank. The
 * shared `customerVisibility` rule reads `status` and nothing else, so this is
 * exactly enough for the storefront to render without inventing private data.
 */
function publicSellerStub(seller: StoreSummary['seller'], store: Store): SellerProfile {
  return {
    id: seller.id,
    userId: '',
    storeId: store.id,
    fullName: seller.fullName,
    phone: '',
    email: '',
    nationalId: '',
    sellerType: seller.sellerType,
    pickupDivision: '',
    pickupDistrict: '',
    pickupArea: '',
    pickupAddressLine: '',
    returnDivision: '',
    returnDistrict: '',
    returnArea: '',
    returnAddressLine: '',
    bank: { bankName: '', accountName: '', accountNumber: '' },
    agreement: {
      marketplaceTerms: false,
      sellerPolicies: false,
      productAuthenticity: false,
      fulfillmentResponsibility: false,
    },
    status: seller.status,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

/**
 * Fetches the full store record for every store referenced by the catalogue,
 * plus the public seller stub behind each store.
 *
 * `getStore` returns the store plus a compact seller summary and a server-computed
 * active product count. The seller summary becomes the public stub described
 * above (de-duplicated by seller id); the server's product count is kept because
 * it is authoritative.
 */
async function fetchStores(products: Product[]): Promise<{ stores: Store[]; sellers: SellerProfile[] }> {
  const storeIds = Array.from(new Set(products.map((product) => product.storeId).filter((id): id is string => Boolean(id))));
  const summaries: StoreSummary[] = [];
  for (const storeId of storeIds) {
    summaries.push(await vantaApi.store(storeId));
  }

  const stores: Store[] = [];
  const sellersById = new Map<string, SellerProfile>();
  for (const summary of summaries) {
    const { seller, ...store } = summary;
    stores.push(store);
    if (seller && !sellersById.has(seller.id)) {
      sellersById.set(seller.id, publicSellerStub(seller, store));
    }
  }
  return { stores, sellers: Array.from(sellersById.values()) };
}

/** Turns any API failure into a boot error that says what to do about it. */
function describeHydrationFailure(error: unknown): Error {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error : new Error('Could not load the catalogue from the Vanta API.');
  }
  if (error.code === 'network_error') {
    return new Error(
      `Could not reach the Vanta API at the configured base URL. Remote mode has no local fallback, so check the server is running. (${error.message})`,
    );
  }
  if (error.code === 'timeout') {
    return new Error(`The Vanta API did not respond in time. Remote mode has no local fallback. (${error.message})`);
  }
  return new Error(`Could not load the catalogue from the Vanta API: ${error.message}`);
}

/**
 * Replaces the local catalogue snapshot with the server's.
 *
 * Rejects on any API failure: a remote-mode app that boots with an empty
 * catalogue looks like a legitimately empty marketplace, which is worse than a
 * visible error. Nothing here falls back to a cached or seeded copy.
 */
export async function hydrateRemoteCatalog(): Promise<HydrationReport> {
  const { db } = getContainer();

  let categories: Category[];
  let products: Product[];
  try {
    [categories, products] = await Promise.all([vantaApi.categories().then((r) => r.categories), fetchAllProducts()]);
  } catch (error) {
    throw describeHydrationFailure(error);
  }

  let stores: Store[];
  let sellers: SellerProfile[];
  try {
    ({ stores, sellers } = await fetchStores(products));
  } catch (error) {
    throw describeHydrationFailure(error);
  }

  // Wholesale replacement, not a merge: a product withdrawn on the server must
  // disappear from the mirror rather than remain visible on the device. The
  // seller stubs are replaced with the same rule, then the signed-in seller's own
  // full profile (if any) is upserted over its stub by `hydrateSellerWorkspace`
  // once the session restores.
  db.replaceCollection('categories', categories);
  db.replaceCollection('products', products);
  db.replaceCollection('stores', stores);
  db.replaceCollection('sellers', sellers);
  await db.persistAll();

  return {
    categories: categories.length,
    products: products.length,
    stores: stores.length,
    sellers: sellers.length,
  };
}
