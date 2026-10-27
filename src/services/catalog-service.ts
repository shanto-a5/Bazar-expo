import { getContainer } from '@/infrastructure/container';
import type {
  Category,
  InventoryAdjustment,
  Product,
  ProductStatus,
  ProductVariant,
  Promotion,
  SellerProfile,
  Store,
} from '@/domain/types';
import {
  VISIBILITY_MESSAGES,
  customerVisibility as sharedCustomerVisibility,
  effectivePrice as sharedEffectivePrice,
  productIsAvailable as sharedProductIsAvailable,
  productIsVisibleToCustomer as sharedProductIsVisibleToCustomer,
  productStock as sharedProductStock,
  stockLevelOf as sharedStockLevelOf,
  type CustomerVisibility,
  type CustomerVisibilityBlocker,
} from '@shared/catalog-rules';
import type { CatalogLookups } from '@shared/types';
import { newId } from '@/utils/id';
import { vantaApi } from '@/api/vanta-api';
import { ApiError } from '@/api/api-client';
import { refreshSellerInventory, upsertProduct } from '@/api/remote-seller';

export interface ProductQuery {
  categoryId?: string;
  subcategoryId?: string;
  sellerId?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  onlyDiscounted?: boolean;
  inStockOnly?: boolean;
  statuses?: Product['status'][];
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'newest' | 'popularity';
  limit?: number;
  offset?: number;
  excludeIds?: string[];
  search?: string;
  customerVisibleOnly?: boolean;
}

export interface ProductDraftInput {
  name: string;
  brand: string;
  categoryId: string;
  subcategoryId: string | null;
  description: string;
  highlights: string[];
  images: string[];
  video?: { placeholder?: string; uri?: string } | null;
  regularPrice: number;
  salePrice?: number;
  costPrice?: number;
  sku: string;
  stock: number;
  lowStockThreshold: number;
  variants: Omit<ProductVariant, 'id' | 'createdAt' | 'updatedAt' | 'productId'>[];
  hasVariants: boolean;
  saveAsDraft?: boolean;
}

/**
 * Catalog rules (M7-E).
 *
 * The availability, visibility and stock maths now lives in `shared/` so the API
 * server authorises orders with byte-identical rules. These wrappers keep the
 * original container-bound signatures, which is why no caller had to change.
 */
function catalogLookups(): CatalogLookups {
  const { repositories } = getContainer();
  return {
    getStoreById: (id) => repositories.stores.getById(id),
    getStoreBySellerId: (sellerId) => repositories.stores.getBySellerId(sellerId),
    getSellerById: (id) => repositories.sellers.getById(id),
  };
}

export function effectivePrice(product: Product): number {
  return sharedEffectivePrice(product);
}

export function productIsAvailable(product: Product): boolean {
  return sharedProductIsAvailable(product);
}

export type { CustomerVisibility, CustomerVisibilityBlocker };

export function customerVisibility(product: Product): CustomerVisibility {
  return sharedCustomerVisibility(product, catalogLookups());
}

export function productIsVisibleToCustomer(product: Product): boolean {
  return sharedProductIsVisibleToCustomer(product, catalogLookups());
}

export { VISIBILITY_MESSAGES };

export type ProductFieldErrors = Partial<
  Record<
    | 'name'
    | 'brand'
    | 'categoryId'
    | 'subcategoryId'
    | 'description'
    | 'regularPrice'
    | 'salePrice'
    | 'costPrice'
    | 'sku'
    | 'stock'
    | 'lowStockThreshold'
    | 'variants',
    string
  >
>;

export class ProductValidationError extends Error {
  readonly errors: ProductFieldErrors;
  constructor(errors: ProductFieldErrors) {
    super(Object.values(errors)[0] ?? 'Some fields need attention.');
    this.name = 'ProductValidationError';
    this.errors = errors;
  }
}

export function productStock(product: Product): number {
  return sharedProductStock(product);
}

export function stockLevelOf(product: Product): 'out' | 'low' | 'healthy' {
  return sharedStockLevelOf(product);
}

function bulkSummary(succeeded: BulkOutcome[], failed: BulkOutcome[], verb: string): string {
  const ok = succeeded.length;
  const skipped = failed.length;
  if (ok === 0 && skipped === 0) return 'Nothing selected.';
  if (skipped === 0) return `${ok} listing(s) ${verb}.`;
  return `${ok} listing(s) ${verb}, ${skipped} skipped.`;
}

/** Why a single product cannot take a bulk status change, or null when it can. */
function bulkStatusBlock(product: Product, status: Product['status']): string | null {
  if (product.status === status) return 'Already in that state.';
  if (status === 'active') {
    if (product.status === 'archived') return 'Restore the listing to a draft first.';
    if (productStock(product) <= 0) return 'Restock before publishing.';
    if (!product.name.trim() || product.images.length === 0) return 'Add a name and a photo first.';
  }
  if (status === 'paused' && !['active', 'out_of_stock'].includes(product.status)) {
    return 'Only a live listing can be paused.';
  }
  if (status === 'draft' && product.status !== 'archived') return 'Only an archived listing can be restored.';
  return null;
}

function draftFrom(product: Product): ProductDraftInput {
  return {
    name: product.name,
    brand: product.brand,
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    description: product.description,
    highlights: [...product.highlights],
    images: [...product.images],
    video: product.video ?? null,
    regularPrice: product.regularPrice,
    salePrice: product.salePrice,
    costPrice: product.costPrice,
    sku: product.sku,
    stock: product.stock,
    lowStockThreshold: product.lowStockThreshold,
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      attributes: { ...variant.attributes },
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      stock: variant.stock,
      image: variant.image,
    })),
    hasVariants: product.hasVariants,
  };
}

/**
 * Remote-mode field mapping. The API validates with the same rules and the same
 * sentences as `validateDraft`, so a `422` is turned back into the
 * `ProductValidationError` the seller forms already render.
 */
const PRODUCT_ERROR_FIELDS: (keyof ProductFieldErrors)[] = [
  'name',
  'brand',
  'categoryId',
  'subcategoryId',
  'description',
  'regularPrice',
  'salePrice',
  'costPrice',
  'sku',
  'stock',
  'lowStockThreshold',
  'variants',
];

function productErrorFrom(error: unknown): Error {
  if (error instanceof ApiError && error.code === 'validation_failed' && error.fields.length > 0) {
    const errors: ProductFieldErrors = {};
    for (const { field, message } of error.fields) {
      const key = (PRODUCT_ERROR_FIELDS as readonly string[]).includes(field)
        ? (field as keyof ProductFieldErrors)
        : field.startsWith('variants')
          ? 'variants'
          : null;
      if (key && !errors[key]) errors[key] = message;
    }
    if (Object.keys(errors).length > 0) return new ProductValidationError(errors);
    return new Error(error.message);
  }
  return error instanceof Error ? error : new Error('Could not save the listing.');
}

function serverVariant(variant: ProductDraftInput['variants'][number]): Record<string, unknown> {
  return {
    sku: variant.sku,
    attributes: variant.attributes,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice ?? null,
    stock: variant.stock,
    image: variant.image ?? '',
  };
}

/** Body for `POST /seller/products`. */
function serverProductInput(draft: ProductDraftInput): Record<string, unknown> {
  return {
    name: draft.name,
    brand: draft.brand,
    categoryId: draft.categoryId,
    subcategoryId: draft.subcategoryId,
    description: draft.description,
    highlights: draft.highlights,
    images: draft.images,
    video: draft.video ?? null,
    regularPrice: draft.regularPrice,
    salePrice: draft.salePrice ?? null,
    costPrice: draft.costPrice ?? null,
    sku: draft.sku,
    stock: draft.stock,
    lowStockThreshold: draft.lowStockThreshold,
    hasVariants: draft.hasVariants,
    variants: draft.variants.map(serverVariant),
    saveAsDraft: draft.saveAsDraft === true,
  };
}

/**
 * Body for `PATCH /seller/products/:id`. `stock` and `saveAsDraft` are omitted:
 * stock moves only through the stock endpoint and the server rejects both keys.
 */
function serverProductPatch(input: Partial<ProductDraftInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const keys: (keyof ProductDraftInput)[] = [
    'name',
    'brand',
    'categoryId',
    'subcategoryId',
    'description',
    'highlights',
    'images',
    'video',
    'regularPrice',
    'salePrice',
    'costPrice',
    'sku',
    'lowStockThreshold',
    'hasVariants',
    'variants',
  ];
  for (const key of keys) {
    if (input[key] === undefined) continue;
    if (key === 'variants') body.variants = (input.variants ?? []).map(serverVariant);
    else if (key === 'video') body.video = input.video ?? null;
    else if (key === 'salePrice' || key === 'costPrice') body[key] = input[key] ?? null;
    else body[key] = input[key];
  }
  return body;
}

/**
 * The stock endpoint accepts `restock | manual | cancellation | return`; the
 * device reason union also has `sale`, which is server-recorded and never sent
 * by a seller, so it maps to `manual` rather than being rejected.
 */
function serverStockReason(reason: InventoryAdjustment['reason']): string {
  return reason === 'sale' ? 'manual' : reason;
}

function variantLabel(variant: ProductVariant): string {
  const values = Object.values(variant.attributes).filter(Boolean);
  return values.length ? values.join(' / ') : variant.sku;
}

export interface SellerProductListOptions {
  search?: string;
  status?: ProductStatus | 'all' | 'low' | 'out';
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'updated' | 'name' | 'price_asc' | 'price_desc' | 'stock';
}

export interface BulkOutcome {
  id: string;
  name: string;
  ok: boolean;
  reason?: string;
}

export interface BulkResult {
  succeeded: BulkOutcome[];
  failed: BulkOutcome[];
  /** Human-readable summary, e.g. "3 updated, 1 skipped". */
  summary: string;
}

export interface InventoryVariantRow {
  id: string;
  label: string;
  sku: string;
  price: number;
  stock: number;
}

export interface InventoryRow {
  product: Product;
  stock: number;
  threshold: number;
  level: 'out' | 'low' | 'healthy';
  variants: InventoryVariantRow[];
}

export interface SellerAdjustmentEntry {
  adjustment: InventoryAdjustment;
  productName: string;
}

export interface CatalogSummary {
  total: number;
  active: number;
  draft: number;
  paused: number;
  outOfStock: number;
  lowStock: number;
  archived: number;
  unitsInStock: number;
}

/** Customer-facing trust signals, all derived from real local records (M6-G). */
export interface StoreTrustProfile {
  storeId: string;
  sellerId: string;
  name: string;
  status: Store['status'];
  sellerStatus: SellerProfile['status'];
  location: string;
  verified: boolean;
  ratingAvg: number;
  ratingCount: number;
  verifiedReviewCount: number;
  productCount: number;
  inStockProductCount: number;
  lowStockProductCount: number;
  followerCount: number;
  responseRate: number;
  responseTimeMinutes: number;
  shippingFee: number;
  freeShippingThreshold: number;
  deliveryEstimate: { min: number; max: number };
  joinedAt: string;
}

export interface ProductTrustProfile {
  productId: string;
  storeId: string;
  ratingAvg: number;
  ratingCount: number;
  verifiedReviewCount: number;
  distribution: { rating: number; count: number }[];
  unitsSold: number;
  viewCount: number;
  isNewArrival: boolean;
  discounted: boolean;
  stockState: 'in_stock' | 'low' | 'out';
  returnEligible: boolean;
  returnReason: string;
  store: StoreTrustProfile | null;
}

export interface DiscoveryRail {
  key: 'flash' | 'new' | 'top_rated' | 'trending' | 'under_thousand' | 'verified_stores';
  title: string;
  subtitle: string;
  products: Product[];
  stores: Store[];
}

export class CatalogService {
  getCategory(id: string): Category | undefined {
    return getContainer().repositories.categories.getById(id);
  }

  allCategories(): Category[] {
    return getContainer().repositories.categories.list();
  }

  getTree(): Category[] {
    const categories = getContainer().repositories.categories.list();
    return categories.filter((c) => c.parentId === null);
  }

  childrenOf(parentId: string): Category[] {
    return getContainer().repositories.categories
      .list()
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  }

  getProduct(id: string): Product | undefined {
    return getContainer().repositories.products.getById(id);
  }

  getProductWithPreview(id: string): (Product & { discountedPrice?: number }) | undefined {
    return getContainer().repositories.products.getById(id);
  }

  productsForSeller(sellerId: string, statuses?: Product['status'][]): Product[] {
    return getContainer().repositories.products.list({ sellerId, statuses });
  }

  getStore(sellerId?: string, storeId?: string): Store | undefined {
    const { repositories } = getContainer();
    if (storeId) return repositories.stores.getById(storeId);
    if (sellerId) return repositories.stores.getBySellerId(sellerId);
    return undefined;
  }

  query(query: ProductQuery): Product[] {
    const { repositories } = getContainer();
    let products = repositories.products.list();

    if (query.statuses) {
      products = products.filter((p) => query.statuses!.includes(p.status));
    } else {
      products = products.filter((p) => p.status === 'active');
    }

    if (query.excludeIds?.length) products = products.filter((p) => !query.excludeIds!.includes(p.id));
    if (query.customerVisibleOnly) products = products.filter(productIsVisibleToCustomer);
    if (query.search) {
      const q = query.search.toLowerCase();
      products = products.filter((p) => {
        const haystack = `${p.name} ${p.brand} ${p.description} ${p.sku}`.toLowerCase();
        return haystack.includes(q);
      });
    }
    if (query.categoryId) {
      const ids = this.categoryAndChildrenIds(query.categoryId);
      products = products.filter((p) => ids.includes(p.categoryId) || ids.includes(p.subcategoryId ?? ''));
    }
    if (query.subcategoryId) products = products.filter((p) => p.subcategoryId === query.subcategoryId);
    if (query.sellerId) products = products.filter((p) => p.sellerId === query.sellerId);
    if (query.brand) products = products.filter((p) => p.brand.toLowerCase() === query.brand!.toLowerCase());
    if (query.minPrice !== undefined) products = products.filter((p) => effectivePrice(p) >= query.minPrice!);
    if (query.maxPrice !== undefined) products = products.filter((p) => effectivePrice(p) <= query.maxPrice!);
    if (query.minRating !== undefined) products = products.filter((p) => p.ratingAvg >= query.minRating!);
    if (query.onlyDiscounted) products = products.filter((p) => !!p.salePrice && p.salePrice < p.regularPrice);
    if (query.inStockOnly) products = products.filter(productIsAvailable);

    const sort = query.sort ?? 'relevance';
    const normalized = [...products];
    switch (sort) {
      case 'price_asc':
        normalized.sort((a, b) => effectivePrice(a) - effectivePrice(b));
        break;
      case 'price_desc':
        normalized.sort((a, b) => effectivePrice(b) - effectivePrice(a));
        break;
      case 'rating':
        normalized.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
        break;
      case 'newest':
        normalized.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'popularity':
        normalized.sort(
          (a, b) =>
            Number(productIsAvailable(b)) - Number(productIsAvailable(a)) ||
            b.soldCount - a.soldCount ||
            b.viewCount - a.viewCount,
        );
        break;
      default:
        break;
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? normalized.length - offset;
    return normalized.slice(offset, offset + limit);
  }

  categoryAndChildrenIds(categoryId: string): string[] {
    const ids = [categoryId];
    ids.push(...this.childrenOf(categoryId).map((c) => c.id));
    return ids;
  }

  brands(): string[] {
    const visible = getContainer().repositories.products
      .list({ statuses: ['active'] })
      .filter(productIsVisibleToCustomer);
    const brands = new Set(visible.map((p) => p.brand.trim()));
    return [...brands].filter(Boolean).sort();
  }

  visibleStores(): Store[] {
    const { repositories } = getContainer();
    return repositories.stores
      .list()
      .filter((store) => store.status === 'active')
      .filter((store) => {
        const seller = repositories.sellers.getById(store.sellerId);
        return seller ? seller.status === 'active' : false;
      })
      .sort((a, b) => b.ratingAvg - a.ratingAvg || b.productCount - a.productCount);
  }

  recordView(productId: string, userId?: string): void {
    // Mirror the view locally (so the home rail and view count update this
    // render) and persist it on the server, which owns `viewCount` and the
    // per-user history. A signed-out view stays device-only.
    this.localRecordView(productId, userId);
    if (userId) void vantaApi.recordView(productId).catch(() => undefined);
  }

  private localRecordView(productId: string, userId?: string): void {
    const { repositories } = getContainer();
    const product = repositories.products.getById(productId);
    if (product) {
      repositories.products.update(productId, { viewCount: (product.viewCount ?? 0) + 1 });
    }
    if (userId) {
      const existing = repositories.recentlyViewed.listForUser(userId).find((e) => e.productId === productId);
      if (existing) {
        repositories.recentlyViewed.remove(existing.id);
      }
      repositories.recentlyViewed.create({
        id: newId('rvw'),
        userId,
        productId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  recentlyViewed(userId: string, limit = 12): Product[] {
    const { repositories } = getContainer();
    return repositories.recentlyViewed
      .listForUser(userId)
      .map((e) => repositories.products.getById(e.productId))
      .filter((p): p is Product => !!p)
      .filter(productIsVisibleToCustomer)
      .slice(0, limit);
  }

  recommendations(userId: string | undefined, limit = 12): Product[] {
    const { repositories } = getContainer();
    const seen = new Set<string>();
    const result: Product[] = [];
    const push = (p?: Product) => {
      if (p && !seen.has(p.id) && productIsAvailable(p) && productIsVisibleToCustomer(p)) {
        seen.add(p.id);
        result.push(p);
      }
    };

    if (userId) {
      const viewed = repositories.recentlyViewed.listForUser(userId).slice(0, 8);
      for (const v of viewed) {
        const product = repositories.products.getById(v.productId);
        if (!product) continue;
        const sameCategory = this.query({
          categoryId: product.categoryId,
          customerVisibleOnly: true,
          sort: 'popularity',
          limit: 4,
          excludeIds: [product.id],
        });
        const sameSeller = this.query({
          sellerId: product.sellerId,
          customerVisibleOnly: true,
          sort: 'popularity',
          limit: 3,
          excludeIds: [product.id],
        });
        sameCategory.forEach(push);
        sameSeller.forEach(push);
      }
    }

    if (result.length < limit) {
      this.query({ sort: 'popularity', inStockOnly: true, customerVisibleOnly: true, limit: limit * 2 }).forEach(push);
    }
    if (result.length < limit) {
      this.query({ sort: 'rating', inStockOnly: true, customerVisibleOnly: true, limit: limit * 2 }).forEach(push);
    }
    if (result.length < limit) {
      this.query({
        onlyDiscounted: true,
        inStockOnly: true,
        customerVisibleOnly: true,
        sort: 'popularity',
        limit: limit * 2,
      }).forEach(push);
    }
    if (result.length < limit) {
      this.query({ sort: 'newest', inStockOnly: true, customerVisibleOnly: true, limit: limit * 2 }).forEach(push);
    }

    return result.slice(0, limit);
  }

  /**
   * Deterministic home rails for discovery (M6-I). Every rail is sorted by real
   * catalog data with a stable tiebreaker, so the same seed always produces the
   * same order and a rail never shows an item the customer cannot buy.
   */
  discovery(userId?: string, perRail = 10): DiscoveryRail[] {
    const { repositories } = getContainer();
    const byId = (a: Product, b: Product) => a.id.localeCompare(b.id);
    const live = this.query({ customerVisibleOnly: true, limit: 500 });
    const buyable = live.filter((p) => p.status === 'active' && productStock(p) > 0);
    const now = Date.now();

    const flashProducts = this.activeFlashSalePromotions()
      .flatMap((promo) => promo.productIds.map((id) => repositories.products.getById(id)))
      .filter((product): product is Product => Boolean(product))
      .filter((product) => product.status === 'active' && productStock(product) > 0)
      .sort((a, b) => effectivePrice(a) - effectivePrice(b) || byId(a, b));

    const newArrivals = [...buyable]
      .sort(
        (a, b) =>
          new Date(b.publishedAt ?? b.createdAt).getTime() - new Date(a.publishedAt ?? a.createdAt).getTime() ||
          byId(a, b),
      )
      .slice(0, perRail);

    const topRated = [...buyable]
      .map((product) => {
        const reviews = repositories.reviews.listForProduct(product.id);
        const avg = reviews.length
          ? reviews.reduce((sum, entry) => sum + entry.rating, 0) / reviews.length
          : product.ratingAvg;
        return { product, avg, count: reviews.length };
      })
      .filter((entry) => entry.count > 0 && entry.avg >= 4)
      .sort((a, b) => b.avg - a.avg || b.count - a.count || byId(a.product, b.product))
      .slice(0, perRail)
      .map((entry) => entry.product);

    const trending = [...buyable]
      .map((product) => {
        const days = Math.max(1, Math.round((now - new Date(product.createdAt).getTime()) / 86_400_000));
        return { product, velocity: product.viewCount / days };
      })
      .sort((a, b) => b.velocity - a.velocity || b.product.viewCount - a.product.viewCount || byId(a.product, b.product))
      .slice(0, perRail)
      .map((entry) => entry.product);

    const underThousand = [...buyable]
      .filter((product) => effectivePrice(product) < 1000)
      .sort((a, b) => effectivePrice(a) - effectivePrice(b) || byId(a, b))
      .slice(0, perRail);

    const seenStores = new Set<string>();
    const rails: DiscoveryRail[] = [
      {
        key: 'flash',
        title: 'Flash sale',
        subtitle: 'Limited-time prices from verified sellers',
        products: flashProducts.slice(0, perRail),
        stores: [],
      },
      {
        key: 'new',
        title: 'New arrivals',
        subtitle: 'Freshly listed this week',
        products: newArrivals,
        stores: [],
      },
      {
        key: 'top_rated',
        title: 'Top rated',
        subtitle: '4★ and above from verified buyers',
        products: topRated,
        stores: [],
      },
      {
        key: 'trending',
        title: 'Trending now',
        subtitle: 'Most viewed in the last days',
        products: trending,
        stores: [],
      },
      {
        key: 'under_thousand',
        title: 'Under ৳1,000',
        subtitle: 'Everyday prices, ready to ship',
        products: underThousand,
        stores: [],
      },
    ];

    for (const rail of rails) {
      for (const product of rail.products) seenStores.add(product.storeId);
    }
    const followed = userId
      ? new Set(repositories.storeFollowers.listForUser(userId).map((follow) => follow.storeId))
      : new Set<string>();
    const verifiedStores = this.visibleStores()
      .filter((store) => store.verified)
      .filter((store) => !seenStores.has(store.id) || followed.has(store.id))
      .sort((a, b) => b.followerCount - a.followerCount || a.name.localeCompare(b.name))
      .slice(0, 6);
    if (verifiedStores.length) {
      rails.push({
        key: 'verified_stores',
        title: 'Verified stores',
        subtitle: 'Checked sellers with fast replies',
        products: [],
        stores: verifiedStores,
      });
    }

    return rails;
  }

  related(product: Product, limit = 6): Product[] {
    return this.query({
      categoryId: product.categoryId,
      customerVisibleOnly: true,
      inStockOnly: true,
      excludeIds: [product.id],
      sort: 'popularity',
      limit,
    });
  }

  forSellerCrud(sellerId: string) {
    const products = this.productsForSeller(sellerId);
    return {
      all: products.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      active: products.filter((p) => p.status === 'active'),
      draft: products.filter((p) => p.status === 'draft'),
      paused: products.filter((p) => p.status === 'paused'),
      outOfStock: products.filter((p) => p.status === 'out_of_stock'),
      lowStock: products.filter((p) => {
        const stock = productStock(p);
        return stock > 0 && stock <= p.lowStockThreshold;
      }),
      archived: products.filter((p) => p.status === 'archived'),
    };
  }

  async createProduct(sellerId: string, _storeId: string, input: ProductDraftInput): Promise<Product> {
    try {
      const { product } = await vantaApi.createSellerProduct(serverProductInput(input));
      const mapped = upsertProduct(product);
      this.recomputeStoreCounters(sellerId);
      return mapped;
    } catch (error) {
      throw productErrorFrom(error);
    }
  }

  async updateProduct(sellerId: string, productId: string, input: Partial<ProductDraftInput>): Promise<Product> {
    const existing = getContainer().repositories.products.getById(productId);
    if (!existing || existing.sellerId !== sellerId) throw new Error('Product not found.');
    try {
      const { product } = await vantaApi.updateSellerProduct(productId, serverProductPatch(input));
      const mapped = upsertProduct(product);
      this.recomputeStoreCounters(sellerId);
      return mapped;
    } catch (error) {
      throw productErrorFrom(error);
    }
  }

  async setStatus(sellerId: string, productId: string, status: Product['status']): Promise<Product> {
    const existing = getContainer().repositories.products.getById(productId);
    if (!existing || existing.sellerId !== sellerId) throw new Error('Product not found.');
    try {
      const dto = await vantaApi.setProductStatus(productId, status);
      const mapped = upsertProduct(dto);
      this.recomputeStoreCounters(sellerId);
      return mapped;
    } catch (error) {
      throw productErrorFrom(error);
    }
  }

  async archiveProduct(sellerId: string, productId: string): Promise<void> {
    await this.setStatus(sellerId, productId, 'archived');
  }

  async duplicateProduct(sellerId: string, productId: string): Promise<Product> {
    const source = getContainer().repositories.products.getById(productId);
    if (!source || source.sellerId !== sellerId) throw new Error('Product not found.');
    return this.createProduct(sellerId, source.storeId, {
      ...draftFrom(source),
      name: `${source.name} (Copy)`,
      sku: `${source.sku}-CP${Math.floor(Math.random() * 9000 + 1000)}`,
      saveAsDraft: true,
    });
  }

  async adjustStock(
    sellerId: string,
    productId: string,
    delta: number,
    reason: InventoryAdjustment['reason'],
    variantId?: string | null,
  ): Promise<{ product: Product; adjustment: InventoryAdjustment; applied: number }> {
    const product = getContainer().repositories.products.getById(productId);
    if (!product || product.sellerId !== sellerId) throw new Error('Product not found.');
    if (!Number.isInteger(delta) || delta === 0) throw new Error('Enter a whole number of units to add or remove.');
    const before = productStock(product);
    try {
      const dto = await vantaApi.adjustStock(productId, {
        quantity: delta,
        variantId: variantId ?? undefined,
        reason: serverStockReason(reason),
      });
      const mapped = upsertProduct(dto);
      this.recomputeStoreCounters(sellerId);
      // The stock reply carries no ledger row, so pull the ledger the server
      // just wrote rather than persisting a synthetic row that a later
      // hydration would duplicate.
      await refreshSellerInventory().catch(() => undefined);
      const now = new Date().toISOString();
      const applied = productStock(mapped) - before;
      const adjustment: InventoryAdjustment = {
        id: newId('inv'),
        productId,
        variantId: variantId ?? null,
        quantity: applied,
        reason,
        createdAt: now,
        updatedAt: now,
      };
      return { product: mapped, adjustment, applied };
    } catch (error) {
      if (error instanceof ApiError) throw new Error(error.message);
      throw error instanceof Error ? error : new Error('Could not update stock.');
    }
  }

  sellerProduct(sellerId: string, productId: string): Product | null {
    const product = getContainer().repositories.products.getById(productId);
    if (!product || product.sellerId !== sellerId) return null;
    return product;
  }

  sellerProductList(sellerId: string, options: SellerProductListOptions = {}): Product[] {
    let products = this.productsForSeller(sellerId);
    if (options.status && options.status !== 'all') {
      if (options.status === 'low') products = products.filter((product) => stockLevelOf(product) === 'low');
      else if (options.status === 'out') products = products.filter((product) => stockLevelOf(product) === 'out');
      else products = products.filter((product) => product.status === options.status);
    }
    const search = options.search?.trim().toLowerCase();
    if (search) {
      products = products.filter((product) =>
        `${product.name} ${product.brand} ${product.sku}`.toLowerCase().includes(search),
      );
    }
    if (options.categoryId) {
      products = products.filter(
        (product) =>
          product.categoryId === options.categoryId || product.subcategoryId === options.categoryId,
      );
    }
    if (options.minPrice !== undefined || options.maxPrice !== undefined) {
      const min = options.minPrice ?? 0;
      const max = options.maxPrice ?? Number.POSITIVE_INFINITY;
      products = products.filter((product) => {
        const price = effectivePrice(product);
        return price >= min && price <= max;
      });
    }
    const sorted = [...products];
    switch (options.sort) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'price_asc':
        sorted.sort((a, b) => effectivePrice(a) - effectivePrice(b) || a.name.localeCompare(b.name));
        break;
      case 'price_desc':
        sorted.sort((a, b) => effectivePrice(b) - effectivePrice(a) || a.name.localeCompare(b.name));
        break;
      case 'stock':
        sorted.sort((a, b) => productStock(a) - productStock(b) || a.name.localeCompare(b.name));
        break;
      default:
        sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return sorted;
  }

  // ---------- Bulk catalog operations (M6-C) ----------
  // Every product is validated and ownership-checked individually so one bad row
  // never blocks the rest, and every skip is reported back to the seller.

  async bulkSetStatus(sellerId: string, productIds: string[], status: Product['status']): Promise<BulkResult> {
    const { repositories } = getContainer();
    const succeeded: BulkOutcome[] = [];
    const failed: BulkOutcome[] = [];

    for (const id of productIds) {
      const product = repositories.products.getById(id);
      if (!product || product.sellerId !== sellerId) {
        failed.push({ id, name: product?.name ?? 'Unknown listing', ok: false, reason: 'Not one of your listings.' });
        continue;
      }
      const block = bulkStatusBlock(product, status);
      if (block) {
        failed.push({ id, name: product.name, ok: false, reason: block });
        continue;
      }
      try {
        await this.setStatus(sellerId, id, status);
        succeeded.push({ id, name: product.name, ok: true });
      } catch (cause) {
        failed.push({
          id,
          name: product.name,
          ok: false,
          reason: cause instanceof Error ? cause.message : 'Could not update this listing.',
        });
      }
    }

    return { succeeded, failed, summary: bulkSummary(succeeded, failed, 'updated') };
  }

  async bulkAdjustStock(
    sellerId: string,
    productIds: string[],
    delta: number,
    reason: InventoryAdjustment['reason'] = 'restock',
  ): Promise<BulkResult> {
    const { repositories } = getContainer();
    const succeeded: BulkOutcome[] = [];
    const failed: BulkOutcome[] = [];

    if (!Number.isInteger(delta) || delta === 0) {
      const reason0 = 'Enter a whole number of units to add or remove.';
      return {
        succeeded,
        failed: productIds.map((id) => ({
          id,
          name: repositories.products.getById(id)?.name ?? 'Unknown listing',
          ok: false,
          reason: reason0,
        })),
        summary: `0 updated, ${productIds.length} skipped`,
      };
    }

    for (const id of productIds) {
      const product = repositories.products.getById(id);
      if (!product || product.sellerId !== sellerId) {
        failed.push({ id, name: product?.name ?? 'Unknown listing', ok: false, reason: 'Not one of your listings.' });
        continue;
      }
      if (product.status === 'archived') {
        failed.push({ id, name: product.name, ok: false, reason: 'Restore the listing before changing stock.' });
        continue;
      }
      if (product.hasVariants && product.variants.length > 0) {
        failed.push({ id, name: product.name, ok: false, reason: 'Open the listing to adjust a variant.' });
        continue;
      }
      try {
        await this.adjustStock(sellerId, id, delta, reason);
        succeeded.push({ id, name: product.name, ok: true });
      } catch (cause) {
        failed.push({
          id,
          name: product.name,
          ok: false,
          reason: cause instanceof Error ? cause.message : 'Could not update stock.',
        });
      }
    }

    return { succeeded, failed, summary: bulkSummary(succeeded, failed, 'updated') };
  }

  /** Archived listings come back as a draft; publishing stays a manual step. */
  restoreProduct(sellerId: string, productId: string): Promise<Product> {
    return this.setStatus(sellerId, productId, 'draft');
  }

  categoryOptionsForSeller(sellerId: string): { id: string; label: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const product of this.productsForSeller(sellerId)) {
      for (const id of [product.categoryId, product.subcategoryId].filter(Boolean) as string[]) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const categories = getContainer().repositories.categories.list();
    return categories
      .filter((category) => counts.has(category.id))
      .map((category) => ({
        id: category.id,
        label: category.parentId ? `— ${category.name}` : category.name,
        count: counts.get(category.id) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  inventoryForSeller(sellerId: string, scope: 'all' | 'low' | 'out' = 'all'): InventoryRow[] {
    const rows = this.productsForSeller(sellerId)
      .filter((product) => product.status !== 'archived')
      .map<InventoryRow>((product) => ({
        product,
        stock: productStock(product),
        threshold: product.lowStockThreshold,
        level: stockLevelOf(product),
        variants: product.variants.map((variant) => ({
          id: variant.id,
          label: variantLabel(variant),
          sku: variant.sku,
          price: variant.price,
          stock: variant.stock,
        })),
      }));
    const filtered = scope === 'all' ? rows : rows.filter((row) => row.level === scope);
    const rank: Record<InventoryRow['level'], number> = { out: 0, low: 1, healthy: 2 };
    return filtered.sort((a, b) => rank[a.level] - rank[b.level] || a.product.name.localeCompare(b.product.name));
  }

  adjustmentHistory(sellerId: string, productId: string, limit = 20): InventoryAdjustment[] {
    if (!this.sellerProduct(sellerId, productId)) throw new Error('Product not found.');
    return getContainer()
      .repositories.inventoryAdjustments.listForProduct(productId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  recentAdjustments(sellerId: string, limit = 20): SellerAdjustmentEntry[] {
    const { repositories } = getContainer();
    return repositories.inventoryAdjustments
      .listForSeller(sellerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
      .map((adjustment) => ({
        adjustment,
        productName: repositories.products.getById(adjustment.productId)?.name ?? 'Removed product',
      }));
  }

  catalogSummary(sellerId: string): CatalogSummary {
    const products = this.productsForSeller(sellerId);
    return {
      total: products.length,
      active: products.filter((product) => product.status === 'active').length,
      draft: products.filter((product) => product.status === 'draft').length,
      paused: products.filter((product) => product.status === 'paused').length,
      outOfStock: products.filter((product) => product.status === 'out_of_stock').length,
      lowStock: products.filter((product) => stockLevelOf(product) === 'low').length,
      archived: products.filter((product) => product.status === 'archived').length,
      unitsInStock: products
        .filter((product) => product.status !== 'archived' && product.status !== 'draft')
        .reduce((sum, product) => sum + productStock(product), 0),
    };
  }

  recomputeStoreCounters(sellerId: string): void {
    const { repositories } = getContainer();
    const store = repositories.stores.getBySellerId(sellerId);
    if (!store) return;
    const products = this.productsForSeller(sellerId, ['active', 'out_of_stock', 'paused']);
    const reviews = repositories.reviews.listForSeller(sellerId);
    const ratingAvg = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
    repositories.stores.update(store.id, {
      productCount: products.length,
      ratingAvg,
      ratingCount: reviews.length,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Store trust profile for the storefront header. Every field is read from the
   * local model; nothing is invented (M6-G).
   */
  storeTrust(storeId: string): StoreTrustProfile | null {
    const { repositories } = getContainer();
    const store = repositories.stores.getById(storeId);
    if (!store) return null;
    const seller = repositories.sellers.getById(store.sellerId);
    const reviews = repositories.reviews.listForSeller(store.sellerId);
    const products = this.productsForSeller(store.sellerId, ['active', 'out_of_stock', 'paused']);
    return {
      storeId: store.id,
      sellerId: store.sellerId,
      name: store.name,
      status: store.status,
      sellerStatus: seller?.status ?? 'pending',
      location: store.location,
      verified: store.verified,
      ratingAvg: reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0,
      ratingCount: reviews.length,
      verifiedReviewCount: reviews.filter((r) => r.verifiedPurchase).length,
      productCount: products.length,
      inStockProductCount: products.filter((p) => productStock(p) > 0).length,
      lowStockProductCount: products.filter((p) => stockLevelOf(p) === 'low').length,
      followerCount: store.followerCount,
      responseRate: store.responseRate,
      responseTimeMinutes: store.responseTimeMinutes,
      shippingFee: store.shippingFee,
      freeShippingThreshold: store.freeShippingThreshold,
      deliveryEstimate: { ...store.deliveryEstimateDays },
      joinedAt: store.createdAt,
    };
  }

  /**
   * Product trust profile for the product page: rating distribution, stock
   * state, return eligibility and the owning store's trust (M6-G).
   */
  productTrust(productId: string): ProductTrustProfile | null {
    const { repositories } = getContainer();
    const product = repositories.products.getById(productId);
    if (!product) return null;
    const reviews = repositories.reviews.listForProduct(productId);
    const level = stockLevelOf(product);
    const sellerOrderIds = repositories.sellerOrders.listForSeller(product.sellerId).map((so) => so.id);
    const soldFromSeller = repositories.sellerOrders
      .list()
      .filter((so) => sellerOrderIds.includes(so.id) && so.status === 'delivered')
      .flatMap((so) => so.items)
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0);

    return {
      productId: product.id,
      storeId: product.storeId,
      ratingAvg: reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : product.ratingAvg,
      ratingCount: reviews.length,
      verifiedReviewCount: reviews.filter((r) => r.verifiedPurchase).length,
      distribution: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: reviews.filter((entry) => entry.rating === rating).length,
      })),
      unitsSold: soldFromSeller,
      viewCount: product.viewCount,
      isNewArrival: Boolean(product.isNewArrival),
      discounted: Boolean(product.salePrice && product.salePrice < product.regularPrice),
      stockState: level === 'healthy' ? 'in_stock' : level,
      returnEligible: product.status === 'active' && level !== 'out',
      returnReason:
        level === 'out'
          ? 'This listing is out of stock, so it cannot be returned or reordered.'
          : product.status !== 'active'
            ? 'Only live listings can be returned.'
            : 'Delivered items can be returned within 7 days of delivery.',
      store: this.storeTrust(product.storeId),
    };
  }

  activeFlashSalePromotions(): Promotion[] {
    const now = new Date().toISOString();
    return getContainer()
      .repositories.promotions.list()
      .filter((p) => p.active && p.type === 'flash_sale' && p.startAt <= now && p.endAt >= now);
  }

  activePromotions(): Promotion[] {
    const now = new Date().toISOString();
    return getContainer()
      .repositories.promotions.list()
      .filter((p) => p.active && p.startAt <= now);
  }
}

export const catalogService = new CatalogService();
