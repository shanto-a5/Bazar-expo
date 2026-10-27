import { getContainer } from '@/infrastructure/container';
import type { Cart, CartItem, Product, Store } from '@/domain/types';
import { effectivePrice, productIsVisibleToCustomer } from './catalog-service';
import { computeTotals, type CartLineView, type CartTotals, type SellerGroupView } from './pricing-service';
import { newId } from '@/utils/id';
import { formatMoney, roundMoney } from '@/utils/money';
import { vantaApi, type PricedCart, type PricedCartLine } from '@/api/vanta-api';

export const GUEST_CART_OWNER_ID = 'guest';

export interface CartMergeLine {
  productId: string;
  productName: string;
  quantity: number;
  combined: boolean;
}

export interface CartMergeAdjustment {
  productName: string;
  requested: number;
  kept: number;
}

export interface CartMergeResult {
  merged: boolean;
  lines: CartMergeLine[];
  adjusted: CartMergeAdjustment[];
  unavailable: { productName: string; reason: string }[];
}

const EMPTY_MERGE: CartMergeResult = { merged: false, lines: [], adjusted: [], unavailable: [] };

export interface CartIssue {
  itemId: string;
  productId: string;
  productName: string;
  kind: 'unavailable' | 'out_of_stock' | 'reduced' | 'price_changed' | 'seller_paused';
  message: string;
  fix: 'remove' | 'reduce' | 'review';
  suggestedQuantity?: number;
  previousPrice?: number;
  currentPrice?: number;
}

export interface CartIntegrity {
  issues: CartIssue[];
  blocking: CartIssue[];
  advisory: CartIssue[];
  clean: boolean;
  checkedAt: string;
}

// ------------------------------------------------------------------ remote
// M15-A: in remote mode the server owns the cart record. CartService keeps one
// in-memory copy per signed-in user and makes the server answer authoritative.
// Reads are synchronous (the screen contract is synchronous); mutations are
// serialised per user so a fast tap of the stepper never lets an older response
// overwrite a newer one. When a server response lands it replaces the copy and
// notifies subscribers (the session context turns that into a re-render).
const REMOTE_CART_TTL_MS = 5_000;

/**
 * Account-scoped persistence for the last server cart view, so a cold start can
 * paint the cart before the first request lands (SWR). Rows live in the device
 * mirror under this collection and are removed on sign-out.
 */
const CART_CACHE_COLLECTION = 'cartCache' as const;

interface CartCacheRecord {
  id: string;
  cart: Cart | null;
  items: CartItem[];
  itemCount: number;
  totals: CartTotals;
  integrity: CartIntegrity;
  voucherCode?: string;
  updatedAt: number;
}

interface RemoteCartState {
  /** Tail of the per-user operation chain; every server call is appended here. */
  op: Promise<void>;
  /** True while a GET has been issued and has not settled, so lazy reads don't stack. */
  inflight: boolean;
  loaded: boolean;
  updatedAt: number;
  /** The voucher code the server last priced this cart with (undefined = none). */
  voucherCode: string | undefined;
  cart: Cart | null;
  items: CartItem[];
  itemCount: number;
  totals: CartTotals;
  integrity: CartIntegrity;
}

const EMPTY_TOTALS: CartTotals = {
  groups: [],
  subtotal: 0,
  shippingTotal: 0,
  voucherDiscount: 0,
  grandTotal: 0,
  itemCount: 0,
  voucher: null,
};

const EMPTY_INTEGRITY: CartIntegrity = {
  issues: [],
  blocking: [],
  advisory: [],
  clean: true,
  checkedAt: new Date(0).toISOString(),
};

export interface RemoteCartLookups {
  getProduct: (productId: string) => Product | undefined;
  getStore: (storeId: string) => Store | undefined;
  getStoreBySellerId: (sellerId: string) => Store | undefined;
}

export interface RemoteCartView {
  cart: Cart | null;
  items: CartItem[];
  itemCount: number;
  totals: CartTotals;
  integrity: CartIntegrity;
}

/**
 * Pure mapping from the server's priced cart view into the device's
 * `CartTotals`/`CartIntegrity`/`CartItem` shapes without ever mutating the
 * server's money. Prices, availability, selection and totals are taken verbatim
 * from the server DTO; the device Product/Store records are attached purely as
 * display context (name/image/variants/location) and are replaced by minimal
 * stand-ins if a mirror record is missing.
 */
export function buildRemoteCartView(
  view: PricedCart,
  lookups: RemoteCartLookups,
  now = new Date().toISOString(),
): RemoteCartView {
  const cartItems: CartItem[] = (view.cart?.items ?? []).map((dto) => ({
    id: dto.id,
    productId: dto.productId,
    sellerId: dto.sellerId,
    ...(dto.variantId ? { variantId: dto.variantId } : {}),
    ...(dto.variantAttributes ? { variantAttributes: dto.variantAttributes } : {}),
    quantity: dto.quantity,
    selected: dto.selected,
    priceSnapshot: dto.priceSnapshot,
    addedAt: dto.addedAt,
    ...(dto.updatedAt ? { updatedAt: dto.updatedAt } : {}),
  }));
  const cartItemById = new Map(cartItems.map((item) => [item.id, item]));

  const fallbackStore = (
    id: string,
    name: string,
    shippingFee: number,
    freeShippingThreshold: number,
  ): Store => ({
    id,
    sellerId: '',
    name,
    description: '',
    logo: '',
    banner: '',
    status: 'active',
    ratingAvg: 0,
    ratingCount: 0,
    responseRate: 0,
    responseTimeMinutes: 0,
    productCount: 0,
    followerCount: 0,
    shippingFee,
    freeShippingThreshold,
    deliveryEstimateDays: { min: 0, max: 0 },
    location: '',
    verified: false,
    createdAt: now,
    updatedAt: now,
  });

  const fallbackProduct = (line: PricedCartLine): Product => ({
    id: line.productId,
    sellerId: line.sellerId,
    storeId: line.storeId,
    name: line.name,
    brand: line.brand,
    categoryId: '',
    subcategoryId: null,
    description: '',
    highlights: [],
    images: line.image ? [line.image] : [],
    regularPrice: line.unitPrice,
    sku: '',
    stock: line.available ? line.quantity : 0,
    lowStockThreshold: 0,
    variants: [],
    hasVariants: false,
    status: 'active',
    ratingAvg: 0,
    ratingCount: 0,
    soldCount: 0,
    viewCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  const groups: SellerGroupView[] = (view.groups ?? []).map((group) => {
    const store =
      lookups.getStore(group.storeId) ??
      lookups.getStoreBySellerId(group.sellerId) ??
      fallbackStore(group.storeId, group.storeName, group.shippingFee, detectFreeShippingThreshold(group));
    const items: CartLineView[] = group.items.map((line) => {
      const product = lookups.getProduct(line.productId) ?? fallbackProduct(line);
      const variant = line.variantId
        ? product.variants.find((entry) => entry.id === line.variantId)
        : undefined;
      return {
        id: line.id,
        cart:
          cartItemById.get(line.id) ??
          ({
            id: line.id,
            productId: line.productId,
            sellerId: line.sellerId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            ...(line.variantAttributes ? { variantAttributes: line.variantAttributes } : {}),
            quantity: line.quantity,
            selected: line.selected,
            priceSnapshot: line.unitPrice,
            addedAt: now,
          } satisfies CartItem),
        product,
        variant,
        store,
        quantity: line.quantity,
        selected: line.selected,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        available: line.available,
        unavailableReason: line.unavailableReason,
      };
    });
    return {
      sellerId: group.sellerId,
      store,
      items,
      subtotal: group.subtotal,
      shippingFee: group.shippingFee,
      freeShipping: group.freeShipping,
    };
  });

  const issues: CartIssue[] = (view.issues ?? []).map((issue) => ({
    itemId: issue.itemId,
    productId: issue.productId,
    productName: issue.productName,
    kind: issue.kind,
    message: issue.message,
    fix: issue.fix,
    ...(issue.suggestedQuantity !== undefined ? { suggestedQuantity: issue.suggestedQuantity } : {}),
    ...(issue.previousPrice !== undefined ? { previousPrice: issue.previousPrice } : {}),
    ...(issue.currentPrice !== undefined ? { currentPrice: issue.currentPrice } : {}),
  }));

  const totals: CartTotals = {
    groups,
    subtotal: view.totals?.subtotal ?? view.subtotal,
    shippingTotal: view.totals?.shippingTotal ?? view.shippingTotal,
    voucherDiscount: view.totals?.voucherDiscount ?? view.voucherDiscount,
    // The cart screen's "order total" is subtotal + base shipping minus voucher:
    // on the server that is `totals.cartTotal` (grandTotal adds the delivery
    // method premium, which only matters at checkout).
    grandTotal: view.totals?.cartTotal ?? view.grandTotal ?? view.subtotal,
    itemCount: view.itemCount,
    voucher: (view.vouchers ?? []).find((entry) => entry.valid)?.voucher ?? null,
  };

  const cart: Cart | null = view.cart
    ? {
        id: view.cart.id ?? `cart_${view.userId}`,
        userId: view.userId,
        items: cartItems,
        createdAt: now,
        updatedAt: now,
      }
    : null;

  return {
    cart,
    items: cartItems,
    itemCount: view.itemCount,
    totals,
    integrity: {
      issues,
      blocking: issues.filter((issue) => issue.fix === 'remove' || issue.fix === 'reduce'),
      advisory: issues.filter((issue) => issue.fix === 'review'),
      clean: issues.length === 0,
      checkedAt: now,
    },
  };
}

function detectFreeShippingThreshold(group: PricedCart['groups'][number]): number {
  return group.freeShipping ? group.subtotal + group.shippingFee : 0;
}

export class CartService {
  private remote = new Map<string, RemoteCartState>();
  private listeners = new Set<() => void>();

  private isRemoteUser(userId: string): boolean {
    return userId !== GUEST_CART_OWNER_ID;
  }

  private state(userId: string): RemoteCartState {
    let state = this.remote.get(userId);
    if (!state) {
      // Seed from the persisted copy so the cart paints immediately on a cold
      // start; the next server read replaces it and re-persists.
      const cached = this.readCache(userId);
      state = {
        op: Promise.resolve(),
        inflight: false,
        loaded: !!cached,
        updatedAt: cached?.updatedAt ?? 0,
        voucherCode: cached?.voucherCode,
        cart: cached?.cart ?? null,
        items: cached?.items ?? [],
        itemCount: cached?.itemCount ?? 0,
        totals: cached?.totals ?? EMPTY_TOTALS,
        integrity: cached?.integrity ?? EMPTY_INTEGRITY,
      };
      this.remote.set(userId, state);
    }
    return state;
  }

  private readCache(userId: string): CartCacheRecord | null {
    try {
      return getContainer().db.getById<CartCacheRecord>(CART_CACHE_COLLECTION, userId) ?? null;
    } catch {
      return null;
    }
  }

  private persistCache(userId: string): void {
    const state = this.remote.get(userId);
    if (!state) return;
    try {
      getContainer().db.upsert(CART_CACHE_COLLECTION, {
        id: userId,
        cart: state.cart,
        items: state.items,
        itemCount: state.itemCount,
        totals: state.totals,
        integrity: state.integrity,
        voucherCode: state.voucherCode,
        updatedAt: state.updatedAt,
      });
    } catch {
      /* the in-memory copy still serves the session */
    }
  }

  /**
   * Drops one account's in-memory cart and its persisted copy. Called on
   * sign-out (via the listing cache) so a later account on the same device can
   * never read the previous cart.
   */
  resetUser(userId: string): void {
    this.remote.delete(userId);
    try {
      getContainer().db.remove(CART_CACHE_COLLECTION, userId);
    } catch {
      /* database not loaded: nothing persisted to remove */
    }
  }

  /** Re-render hook: the session context subscribes and bumps a revision. */
  subscribeCart(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Fire-and-forget serialisation for callers whose screen is already driven by
   * a subscription (steppers, selection, voucher pricing).
   */
  private enqueue(userId: string, task: () => Promise<PricedCart>): void {
    void this.enqueueAsync(userId, task).catch(() => undefined);
  }

  /**
   * Serialises one server round trip per user and returns a promise that rejects
   * when the request fails. The per-user chain's own tail is kept non-rejecting,
   * so one failed call never poisons the next. Callers that must tell the truth
   * (the Add-to-cart button) await this; callers that only render use `enqueue`.
   */
  private enqueueAsync(userId: string, task: () => Promise<PricedCart>): Promise<void> {
    const state = this.state(userId);
    const run = state.op.then(() => this.runCartOp(userId, task));
    state.op = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runCartOp(userId: string, task: () => Promise<PricedCart>): Promise<void> {
    try {
      const view = await task();
      this.applyRemoteView(userId, view);
    } catch (error) {
      // A rejected call keeps the last known good view. A 401 already cleared
      // the session through the api-client usedBearer gate; the cart simply does
      // not move until the next successful round trip. The rejection is still
      // surfaced to an awaiting caller (e.g. the Add-to-cart button).
      if (error instanceof Error) console.warn(`[vanta] cart ${userId.slice(0, 8)}: ${error.message}`);
      throw error;
    }
  }

  private applyRemoteView(userId: string, view: PricedCart): void {
    const state = this.state(userId);
    const { repositories } = getContainer();
    const built = buildRemoteCartView(view, {
      getProduct: (id) => repositories.products.getById(id),
      getStore: (id) => repositories.stores.getById(id),
      getStoreBySellerId: (id) => repositories.stores.getBySellerId(id),
    });
    state.cart = built.cart;
    state.items = built.items;
    state.itemCount = built.itemCount;
    state.totals = built.totals;
    state.integrity = built.integrity;
    // Follow the server's own record of the applied code: when it refuses a code
    // the response carries none, so a stale code is cleared here rather than
    // lingering in the next fetch.
    state.voucherCode = view.selectedVoucherCode ?? undefined;
    state.loaded = true;
    state.updatedAt = Date.now();
    this.persistCache(userId);
    this.notify();
  }

  /**
   * Force a fresh server read and resolve once it has been applied (rejecting on
   * failure). The listing cache's pull-to-refresh owns the cooldown/dedup, so
   * this is the raw, always-attempts read.
   */
  async refresh(userId: string): Promise<void> {
    if (!this.isRemoteUser(userId)) return;
    const state = this.state(userId);
    state.inflight = true;
    try {
      await this.enqueueAsync(userId, () => vantaApi.cart(undefined, state.voucherCode));
    } finally {
      const current = this.remote.get(userId);
      if (current) current.inflight = false;
    }
  }

  /**
   * Force a fresh server read. Called by the session context when a signed-in
   * user appears (or is replaced) so the cart reflects that account, not the
   * previous one's cache. `force` bypasses the in-flight guard so a
   * post-checkout refresh always re-reads the cart the server just emptied.
   */
  syncCart(userId: string, force = false): void {
    if (!this.isRemoteUser(userId)) return;
    const state = this.state(userId);
    if (state.inflight && !force) return;
    state.inflight = true;
    this.enqueue(userId, () => vantaApi.cart(undefined, state.voucherCode));
    const { op } = state;
    void op.finally(() => {
      const current = this.remote.get(userId);
      if (current) current.inflight = false;
    });
  }

  /**
   * Remote-mode: ask the server to price the cart with (or without) one voucher
   * code. The response is authoritative — it carries the discount and, on a
   * refusal, no voucher — so the cart screen never computes a discount itself.
   * A no-op when the code has not changed, which keeps the
   * fetch-notify-re-render cycle bounded.
   */
  setVoucher(userId: string, code: string | undefined): void {
    if (!this.isRemoteUser(userId)) return;
    const state = this.state(userId);
    const next = code || undefined;
    if (state.voucherCode === next) return;
    state.voucherCode = next;
    state.inflight = true;
    this.enqueue(userId, () => vantaApi.cart(undefined, next));
    const { op } = state;
    void op.finally(() => {
      const current = this.remote.get(userId);
      if (current) current.inflight = false;
    });
  }

  /**
   * Lazy read path behind every synchronous remote read: a cart that has never
   * been fetched (or whose copy is older than the TTL) starts one GET and the
   * read returns the current copy. The applied response notifies subscribers,
   * so the consuming screen re-renders with the server's answer. Reads within
   * the TTL are pure cache hits that never notify, which keeps the
   * fetch-notify-re-render-fetch cycle bounded.
   */
  private ensureLoaded(userId: string): void {
    const state = this.state(userId);
    if (state.inflight) return;
    const stale = !state.loaded || Date.now() - state.updatedAt > REMOTE_CART_TTL_MS;
    if (!stale) return;
    state.inflight = true;
    this.enqueue(userId, () => vantaApi.cart(undefined, state.voucherCode));
    const { op } = state;
    void op.finally(() => {
      const current = this.remote.get(userId);
      if (current) current.inflight = false;
    });
  }

  getCart(userId: string): Cart | null {
    if (this.isRemoteUser(userId)) {
      this.ensureLoaded(userId);
      return this.state(userId).cart;
    }
    return getContainer().repositories.carts.getByUserId(userId) ?? null;
  }

  items(userId: string): CartItem[] {
    if (this.isRemoteUser(userId)) {
      this.ensureLoaded(userId);
      return this.state(userId).items;
    }
    return this.getCart(userId)?.items ?? [];
  }

  itemCount(userId: string): number {
    if (this.isRemoteUser(userId)) {
      this.ensureLoaded(userId);
      return this.state(userId).itemCount;
    }
    const cart = this.getCart(userId);
    if (!cart) return 0;
    return cart.items.filter((i) => i.selected).reduce((sum, i) => sum + i.quantity, 0);
  }

  totals(userId: string, voucherCode?: string): CartTotals {
    if (this.isRemoteUser(userId)) {
      // Remote voucher offers come from the local repo (empty in remote mode,
      // M15-A scope), so `voucherCode` is null here; cached totals already
      // reflect whatever voucher the server applied to the account cart.
      void voucherCode;
      this.ensureLoaded(userId);
      return this.state(userId).totals;
    }
    const { repositories } = getContainer();
    const items = this.items(userId);
    const voucher = voucherCode ? repositories.vouchers.getByCode(voucherCode) ?? null : null;
    return computeTotals(items, voucher);
  }

  /**
   * Reconcile the saved cart against live catalog data (M6-K). Nothing is
   * changed here: the cart can sit for days, so a screen needs to know which
   * lines are now blocked and which only need a decision. In remote mode the
   * server audits the cart it owns (dead product/store lines, sold-out options,
   * stock and price drift) and returns the same issue shape.
   */
  audit(userId: string): CartIntegrity {
    if (this.isRemoteUser(userId)) {
      this.ensureLoaded(userId);
      return this.state(userId).integrity;
    }
    const { repositories } = getContainer();
    const issues: CartIssue[] = [];

    for (const item of this.items(userId)) {
      const product = repositories.products.getById(item.productId);
      const name = product?.name ?? 'This item';
      if (!product || !productIsVisibleToCustomer(product)) {
        issues.push({
          itemId: item.id,
          productId: item.productId,
          productName: name,
          kind: 'unavailable',
          message: `${name} is no longer available and will block checkout.`,
          fix: 'remove',
        });
        continue;
      }
      const store = repositories.stores.getById(product.storeId);
      if (store && store.status !== 'active') {
        issues.push({
          itemId: item.id,
          productId: item.productId,
          productName: name,
          kind: 'seller_paused',
          message: `${store.name} is paused right now, so ${name} cannot ship yet.`,
          fix: 'review',
        });
      }
      // A cart line that points at a deleted option must not be repriced to the
      // base listing or checked against aggregate stock. It is simply gone.
      if (item.variantId && !product.variants.some((v) => v.id === item.variantId)) {
        issues.push({
          itemId: item.id,
          productId: item.productId,
          productName: name,
          kind: 'unavailable',
          message: `An option of ${name} is no longer available and will block checkout.`,
          fix: 'remove',
        });
        continue;
      }
      const available = item.variantId ? stockForVariant(item.productId, item.variantId) : product.stock;
      if (available <= 0) {
        issues.push({
          itemId: item.id,
          productId: item.productId,
          productName: name,
          kind: 'out_of_stock',
          message: `${name} just sold out.`,
          fix: 'remove',
        });
      } else if (available < item.quantity) {
        issues.push({
          itemId: item.id,
          productId: item.productId,
          productName: name,
          kind: 'reduced',
          message: `Only ${available} left of ${name}.`,
          fix: 'reduce',
          suggestedQuantity: available,
        });
      }
      const current = item.variantId
        ? product.variants.find((v) => v.id === item.variantId)?.price ?? effectivePrice(product)
        : effectivePrice(product);
      if (roundMoney(current) !== roundMoney(item.priceSnapshot)) {
        issues.push({
          itemId: item.id,
          productId: item.productId,
          productName: name,
          kind: 'price_changed',
          message: `${name} is now ${formatMoney(current)} (was ${formatMoney(item.priceSnapshot)}).`,
          fix: 'review',
          previousPrice: item.priceSnapshot,
          currentPrice: current,
        });
      }
    }

    return {
      issues,
      blocking: issues.filter((issue) => issue.fix === 'remove' || issue.fix === 'reduce'),
      advisory: issues.filter((issue) => issue.fix === 'review'),
      clean: issues.length === 0,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Apply the fixes a seller-of-truth allows without asking the customer:
   * drop dead lines and clamp quantities to what is in stock. Price changes and
   * paused stores stay advisory because only the customer can accept them.
   */
  repair(userId: string): { removed: number; reduced: number; stillBlocked: CartIssue[] } {
    if (this.isRemoteUser(userId)) {
      const state = this.state(userId);
      const fixes = state.integrity.blocking;
      const removes = fixes.filter((issue) => issue.fix === 'remove');
      const reduces = fixes.filter((issue) => issue.fix === 'reduce');
      if (fixes.length === 0) return { removed: 0, reduced: 0, stillBlocked: [] };
      this.enqueue(userId, async () => {
        for (const issue of removes) await vantaApi.removeCartItem(issue.itemId);
        for (const issue of reduces) {
          await vantaApi.patchCartItem(issue.itemId, { quantity: issue.suggestedQuantity ?? 1 });
        }
        return vantaApi.cart(undefined, state.voucherCode);
      });
      return { removed: removes.length, reduced: reduces.length, stillBlocked: [] };
    }
    const { repositories } = getContainer();
    const cart = this.getCart(userId);
    if (!cart) return { removed: 0, reduced: 0, stillBlocked: [] };

    let removed = 0;
    let reduced = 0;
    for (const item of [...cart.items]) {
      const product = repositories.products.getById(item.productId);
      const available = product
        ? item.variantId
          ? stockForVariant(item.productId, item.variantId)
          : product.stock
        : 0;
      if (!product || !productIsVisibleToCustomer(product) || available <= 0) {
        cart.items = cart.items.filter((entry) => entry.id !== item.id);
        removed += 1;
        continue;
      }
      if (available < item.quantity) {
        item.quantity = available;
        item.updatedAt = new Date().toISOString();
        reduced += 1;
      }
    }
    cart.updatedAt = new Date().toISOString();
    repositories.carts.upsert(cart);
    const integrity = this.audit(userId);
    return { removed, reduced, stillBlocked: integrity.blocking };
  }

  private ensureCart(userId: string): Cart {
    const { repositories } = getContainer();
    let cart = repositories.carts.getByUserId(userId);
    if (!cart) {
      const now = new Date().toISOString();
      cart = { id: newId('crt'), userId, items: [], createdAt: now, updatedAt: now };
      repositories.carts.create(cart);
    }
    return cart;
  }

  addItem(userId: string, productId: string, quantity = 1, variantId?: string): void {
    if (this.isRemoteUser(userId)) {
      // The server is the seller of truth: it resolves the live product/variant,
      // clamps to stock, de-dupes same SKU lines and applies the selection. The
      // screen shows an optimistic confirmation; a failure (unknown product,
      // listing not visible, revoked session) surfaces as an ApiError and is
      // logged here without crashing the UI.
      this.enqueue(userId, () => vantaApi.addCartItem({ productId, quantity, variantId }));
      return;
    }
    const { repositories } = getContainer();
    const product = repositories.products.getById(productId);
    if (!product) throw new Error('Product not found.');
    if (!productIsVisibleToCustomer(product)) {
      throw new Error('This item is not available for ordering right now.');
    }

    const cart = this.ensureCart(userId);
    const existing = cart.items.find(
      (i) => i.productId === productId && (i.variantId ?? undefined) === (variantId ?? undefined),
    );
    const now = new Date().toISOString();
    if (existing) {
      // Cap at the live stock like the new-line path below. The old `|| 99` made a
      // sold-out SKU cap the merged quantity at 99 instead of 1, so the same line
      // behaved differently depending on whether it already existed.
      const available = existing.variantId
        ? stockForVariant(existing.productId, existing.variantId)
        : repositories.products.getById(existing.productId)?.stock ?? 0;
      existing.quantity = Math.min(existing.quantity + quantity, Math.max(available, 1));
      existing.selected = true;
      existing.updatedAt = now;
    } else {
      const available = variantId ? stockForVariant(productId, variantId) : product.stock;
      cart.items.push({
        id: newId('cit'),
        productId,
        sellerId: product.sellerId,
        variantId,
        variantAttributes: variantId
          ? repositories.products.getById(productId)?.variants.find((v) => v.id === variantId)?.attributes
          : undefined,
        quantity: Math.min(quantity, Math.max(available, 1)),
        selected: true,
        priceSnapshot: variantId
          ? repositories.products.getById(productId)?.variants.find((v) => v.id === variantId)?.price ?? effectivePrice(product)
          : effectivePrice(product),
        addedAt: now,
      });
    }
    cart.updatedAt = now;
    repositories.carts.upsert({ ...cart });
  }

  /**
   * Observable add-to-cart. Remote: enqueues the request and resolves only once
   * the server has accepted it (rejecting otherwise), so a screen can keep its
   * button in a loading state and only reveal "View cart" after a real success.
   * Local: the synchronous write either succeeds or throws.
   */
  addItemAsync(userId: string, productId: string, quantity = 1, variantId?: string): Promise<void> {
    if (this.isRemoteUser(userId)) {
      return this.enqueueAsync(userId, () => vantaApi.addCartItem({ productId, quantity, variantId }));
    }
    try {
      this.addItem(userId, productId, quantity, variantId);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  updateQuantity(userId: string, itemId: string, quantity: number): void {
    if (this.isRemoteUser(userId)) {
      this.enqueue(userId, () => vantaApi.patchCartItem(itemId, { quantity }));
      return;
    }
    const { repositories } = getContainer();
    const cart = this.ensureCart(userId);
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) return;
    const max = item.variantId ? stockForVariant(item.productId, item.variantId) : repositories.products.getById(item.productId)?.stock ?? 0;
    item.quantity = Math.max(1, Math.min(quantity, Math.max(max, 1)));
    // Do not silently re-select: a customer who deliberately deselected a line to
    // compare prices should not have it re-enter the order (and the badge count)
    // just because they nudged its quantity.
    cart.updatedAt = new Date().toISOString();
    repositories.carts.upsert({ ...cart });
  }

  removeItem(userId: string, itemId: string): void {
    if (this.isRemoteUser(userId)) {
      this.enqueue(userId, () => vantaApi.removeCartItem(itemId));
      return;
    }
    const { repositories } = getContainer();
    const cart = this.ensureCart(userId);
    cart.items = cart.items.filter((i) => i.id !== itemId);
    cart.updatedAt = new Date().toISOString();
    repositories.carts.upsert({ ...cart });
  }

  setSelected(userId: string, itemId: string, selected: boolean): void {
    if (this.isRemoteUser(userId)) {
      this.enqueue(userId, () => vantaApi.patchCartItem(itemId, { selected }));
      return;
    }
    const { repositories } = getContainer();
    const cart = this.ensureCart(userId);
    const item = cart.items.find((i) => i.id === itemId);
    if (item) item.selected = selected;
    cart.updatedAt = new Date().toISOString();
    repositories.carts.upsert({ ...cart });
  }

  setSellerSelected(userId: string, sellerId: string, selected: boolean): void {
    if (this.isRemoteUser(userId)) {
      this.enqueue(userId, () => vantaApi.selectCartLines({ selected, sellerId }));
      return;
    }
    const { repositories } = getContainer();
    const cart = this.ensureCart(userId);
    for (const item of cart.items) {
      if (item.sellerId === sellerId) item.selected = selected;
    }
    cart.updatedAt = new Date().toISOString();
    repositories.carts.upsert({ ...cart });
  }

  selectAll(userId: string, selected: boolean): void {
    if (this.isRemoteUser(userId)) {
      this.enqueue(userId, () => vantaApi.selectCartLines({ selected }));
      return;
    }
    const { repositories } = getContainer();
    const cart = this.ensureCart(userId);
    for (const item of cart.items) item.selected = selected;
    cart.updatedAt = new Date().toISOString();
    repositories.carts.upsert({ ...cart });
  }

  clear(userId: string): void {
    if (this.isRemoteUser(userId)) {
      this.enqueue(userId, () => vantaApi.clearCart());
      return;
    }
    const { repositories } = getContainer();
    const cart = this.getCart(userId);
    if (cart) {
      cart.items = [];
      cart.updatedAt = new Date().toISOString();
      repositories.carts.upsert({ ...cart });
    }
  }

  clearSelected(userId: string): void {
    if (this.isRemoteUser(userId)) {
      const state = this.state(userId);
      const unselected = state.items.filter((item) => !item.selected).map((item) => item.id);
      if (unselected.length === 0) return;
      this.enqueue(userId, async () => {
        for (const itemId of unselected) await vantaApi.removeCartItem(itemId);
        return vantaApi.cart(undefined, state.voucherCode);
      });
      return;
    }
    const { repositories } = getContainer();
    const cart = this.getCart(userId);
    if (cart) {
      cart.items = cart.items.filter((i) => !i.selected);
      cart.updatedAt = new Date().toISOString();
      repositories.carts.upsert({ ...cart });
    }
  }

  mergeGuestCart(userId: string): CartMergeResult {
    if (this.isRemoteUser(userId)) {
      // The API has no anonymous-cart or merge endpoint (M15-A scope), so a
      // device guest basket cannot be folded into the account cart. The server
      // cart is untouched and the merge reports "nothing folded in".
      return { ...EMPTY_MERGE };
    }
    if (!userId || userId === GUEST_CART_OWNER_ID) return { ...EMPTY_MERGE };
    const { repositories } = getContainer();
    const guestCart = repositories.carts.getByUserId(GUEST_CART_OWNER_ID);
    if (!guestCart || guestCart.items.length === 0) return { ...EMPTY_MERGE };

    const now = new Date().toISOString();
    const target = this.ensureCart(userId);
    const result: CartMergeResult = { merged: false, lines: [], adjusted: [], unavailable: [] };

    for (const guestItem of guestCart.items) {
      const product = repositories.products.getById(guestItem.productId);
      if (!product) {
        result.unavailable.push({ productName: 'Unavailable product', reason: 'no longer in the catalogue' });
        continue;
      }
      const available = Math.max(0, guestItem.variantId ? stockForVariant(guestItem.productId, guestItem.variantId) : product.stock);
      if (available === 0) {
        result.unavailable.push({ productName: product.name, reason: 'out of stock' });
        continue;
      }
      const existing = target.items.find(
        (i) => i.productId === guestItem.productId && (i.variantId ?? undefined) === (guestItem.variantId ?? undefined),
      );
      if (existing) {
        const requested = existing.quantity + guestItem.quantity;
        const kept = Math.min(requested, available);
        existing.quantity = kept;
        existing.selected = existing.selected || guestItem.selected;
        existing.updatedAt = now;
        if (kept < requested) result.adjusted.push({ productName: product.name, requested, kept });
        result.lines.push({ productId: product.id, productName: product.name, quantity: guestItem.quantity, combined: true });
      } else {
        const kept = Math.min(guestItem.quantity, available);
        if (kept < guestItem.quantity) result.adjusted.push({ productName: product.name, requested: guestItem.quantity, kept });
        target.items.push({ ...guestItem, quantity: kept });
        result.lines.push({ productId: product.id, productName: product.name, quantity: guestItem.quantity, combined: false });
      }
    }

    target.updatedAt = now;
    repositories.carts.upsert({ ...target });
    guestCart.items = [];
    guestCart.updatedAt = now;
    repositories.carts.upsert({ ...guestCart });

    result.merged = result.lines.length > 0;
    return result;
  }

  /**
   * Remote-mode handoff for a basket the same device built while signed out.
   *
   * `mergeGuestCart` cannot help here: the API has no anonymous-cart or merge
   * endpoint, so a guest basket lives only in the device repository. Without this
   * the account cart would start empty the moment a quick account is created and
   * everything the customer just tapped "add" on would vanish.
   *
   * Each guest line is replayed through the normal add-to-cart endpoint, so the
   * server stays the seller of truth (it resolves the live product/variant,
   * clamps to stock and de-dupes) and the device never invents a line. The device
   * bucket is emptied only once at least one line was accepted, so a total
   * network failure leaves the basket intact to retry on the next sign-in, while
   * a single unsellable line cannot hold the whole basket hostage to a permanent
   * retry. The final read is folded into the same per-user chain so it can never
   * race an earlier cart write.
   */
  async foldGuestCartIntoAccount(userId: string): Promise<void> {
    if (!this.isRemoteUser(userId)) return;
    const { repositories } = getContainer();
    const guestCart = repositories.carts.getByUserId(GUEST_CART_OWNER_ID);
    if (!guestCart || guestCart.items.length === 0) return;

    const lines = guestCart.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      variantId: item.variantId,
    }));
    const voucherCode = this.state(userId).voucherCode;
    let folded = false;

    try {
      await this.enqueueAsync(userId, async () => {
        for (const line of lines) {
          try {
            await vantaApi.addCartItem(line);
            folded = true;
          } catch (error) {
            if (error instanceof Error) console.warn(`[vanta] guest cart line not folded: ${error.message}`);
          }
        }
        return vantaApi.cart(undefined, voucherCode);
      });
    } catch (error) {
      // The final re-read failed; any line that did land is still on the server
      // and the next normal cart sync will pick it up.
      if (error instanceof Error) console.warn(`[vanta] guest cart fold could not refresh: ${error.message}`);
    }

    if (!folded) return;
    guestCart.items = [];
    guestCart.updatedAt = new Date().toISOString();
    repositories.carts.upsert({ ...guestCart });
  }
}

function stockForVariant(productId: string, variantId: string): number {
  const { repositories } = getContainer();
  const product = repositories.products.getById(productId);
  return product?.variants.find((v) => v.id === variantId)?.stock ?? 0;
}

export const cartService = new CartService();