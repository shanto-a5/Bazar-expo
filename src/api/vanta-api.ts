/**
 * Typed API surface (M7-Q).
 *
 * The one place in the app that knows endpoint paths and payload shapes. Screens
 * and services depend on these methods, never on URLs, so an endpoint rename is a
 * change to this file alone. Every method returns the server's `data` payload and
 * throws `ApiError` on failure.
 *
 * Response types are declared as the domain entities where the server returns one
 * verbatim, so no mapping layer is needed for catalogue reads. Where the server
 * intentionally returns less than the device entity (a user without password
 * material) the difference is stated in the type.
 */
import { getApiClient } from './api-client';
import type {
  Product,
  Role,
  Store,
  SellerProfile,
  Category,
  Voucher,
  ReturnRequest,
} from '@/domain/types';
import type {
  ProductDto,
  ReturnDto,
  ReviewDto,
  SellerOrderViewDto,
  SellerProfileDto,
  StoreDto,
  VoucherDto,
} from './remote-seller';
import type { AddressDto } from './remote-address';
import type { OrderReceiptDto, OrderDetailDto, OrderDto } from './remote-orders';
import type { NotificationDto } from './remote-notifications';
import type { WishlistItemDto, FollowStateDto } from './remote-social';

/**
 * One order line in a `POST /orders/:id/returns` body. `lineId` is the seller
 * order's line id (the simulator's `orderItemId`); the server accepts
 * `orderItemId` as an alias. Absent/`null` quantity means "every remaining unit".
 */
export interface ReturnItemInput {
  lineId: string;
  reason: string;
  quantity?: number | null;
  description?: string;
  images?: string[];
  preferredResolution?: 'refund' | 'replacement';
}

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  /**
   * False only for a quick account whose owner has not chosen a password yet.
   * The app uses it to offer the one-time "set a password" path instead of the
   * current-password form.
   */
  hasPassword: boolean;
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthResult {
  user: ApiUser;
  /** Opaque bearer token. The server holds the session; the client only stores this. */
  token: string;
  expiresAt: string;
}

export interface ProductPage {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CatalogSummary {
  productCount: number;
  activeCount: number;
  storeCount: number;
  sellerCount: number;
  categoryCount: number;
}

export interface StoreSummary extends Store {
  seller: Pick<SellerProfile, 'id' | 'fullName' | 'status' | 'sellerType'>;
  productCount: number;
}

export interface PricedCartLine {
  id: string;
  productId: string;
  variantId?: string;
  sellerId: string;
  storeId: string;
  name: string;
  image: string;
  quantity: number;
  selected: boolean;
  unitPrice: number;
  subtotal: number;
  available: boolean;
  unavailableReason: string | null;
  /** Extras the server sends on every priced line; the cart screen renders them. */
  brand: string;
  priceChanged: boolean;
  variantAttributes?: Record<string, string> | null;
}

/**
 * One stored line in the `cart` extra the API returns alongside `PricedCart`.
 * This is the server's `CartItem` DTO (a `priceSnapshot` plus selection state),
 * which is what the existing device `CartItem` is built from.
 */
export interface PricedCartItem {
  id: string;
  productId: string;
  sellerId: string;
  variantId: string | null;
  variantAttributes: Record<string, string> | null;
  quantity: number;
  selected: boolean;
  priceSnapshot: number;
  addedAt: string;
  updatedAt?: string | null;
}

export interface PricedCartTotals {
  subtotal: number;
  shippingTotal: number;
  voucherDiscount: number;
  cartTotal: number;
  deliveryFee: number;
  grandTotal: number;
  itemCount: number;
  quote: {
    methodId: string;
    label: string;
    caption: string;
    baseFee: number;
    premiumPerSeller: number;
    fee: number;
    daysMin: number;
    daysMax: number;
    window: string;
    sellerCount: number;
  };
}

export type PricedCartIssueKind = 'unavailable' | 'out_of_stock' | 'reduced' | 'price_changed' | 'seller_paused';

/** Server cart audit issue; same fields as the device `CartIssue`. */
export interface PricedCartIssue {
  itemId: string;
  productId: string;
  productName: string;
  kind: PricedCartIssueKind;
  message: string;
  fix: 'remove' | 'reduce' | 'review';
  suggestedQuantity?: number;
  previousPrice?: number;
  currentPrice?: number;
}

export interface PricedSellerGroup {
  sellerId: string;
  storeId: string;
  storeName: string;
  items: PricedCartLine[];
  subtotal: number;
  shippingFee: number;
  freeShipping: boolean;
}

export interface PricedCart {
  cartId: string;
  userId: string;
  items: PricedCartLine[];
  groups: PricedSellerGroup[];
  subtotal: number;
  shippingTotal: number;
  voucherDiscount: number;
  grandTotal: number;
  itemCount: number;
  delivery: { methodId: string; label: string; caption: string; baseFee: number; premiumPerSeller: number; fee: number; sellerCount: number; daysMin: number; daysMax: number; window: string };
  checkout: { subtotal: number; voucherDiscount: number; deliveryFee: number; grandTotal: number };
  vouchers: { voucher: Voucher; valid: boolean; discount: number; reason: string | null }[];
  selectedVoucherCode: string | null;
  // --- extras the server returns for the existing simulator screens ---
  cart: { id: string | null; items: PricedCartItem[] };
  totals: PricedCartTotals;
  issues: PricedCartIssue[];
}

/**
 * One quote from `GET /vouchers/eligible`: the server's verdict on a voucher for
 * the signed-in customer's current cart. `discount` is the amount the server
 * would take off (0 when invalid); `valid`/`reason` explain the refusal.
 */
export interface EligibleVoucherQuoteDto {
  id: string;
  code: string;
  title: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  discountValue: number;
  scope: 'platform' | 'seller';
  sellerId: string | null;
  categoryId: string | null;
  productIds: string[];
  description: string;
  minimumOrder: number;
  maximumDiscount: number | null;
  expiry: string;
  valid: boolean;
  reason: string | null;
  discount: number;
}

export interface CheckoutInput {
  address: {
    label?: string;
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    area?: string;
    addressLine: string;
    postalCode?: string;
    instructions?: string;
    isDefault?: boolean;
  };
  paymentMethod: 'cod' | 'bkash' | 'nagad' | 'card';
  deliveryMethod?: 'standard' | 'express';
  voucherCode?: string;
  idempotencyKey?: string;
}

export interface AddressPayload {
  label?: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area?: string;
  addressLine: string;
  postalCode?: string;
  instructions?: string;
  isDefault?: boolean;
}

/**
 * Server-authoritative pre-flight for the checkout screen (`POST /checkout/preview`).
 * Mirrors the resolved cart groups plus the priced totals/quote so the client can
 * show the exact figures the server will charge, including stock availability.
 */
export interface CheckoutPreview {
  groups: {
    sellerId: string;
    subtotal: number;
    shippingFee: number;
    hasSelectedLines: boolean;
    items: {
      id: string;
      productName: string;
      quantity: number;
      selected: boolean;
      unitPrice: number;
      subtotal: number;
      available: boolean;
      unavailableReason?: string;
      priceChanged: boolean;
    }[];
  }[];
  totals: {
    subtotal: number;
    shippingTotal: number;
    voucherDiscount: number;
    cartTotal: number;
    deliveryFee: number;
    grandTotal: number;
    itemCount: number;
  };
  quote: { methodId: string; label: string; fee: number; daysMin: number; daysMax: number };
  voucher: { code: string; title: string; amount: number } | null;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  apiVersion: string;
  database: { ok: boolean; driver: string; detail?: string };
  config: Record<string, unknown>;
  uptimeSeconds: number;
}

export class VantaApi {
  private get client() {
    return getApiClient();
  }

  // ------------------------------------------------------------- capability
  health(): Promise<HealthReport> {
    return this.client.get<HealthReport>('/health');
  }

  ready(): Promise<{ ready: boolean; database: { ok: boolean; driver: string } }> {
    return this.client.get('/health/ready');
  }

  paymentMethods(): Promise<{ methods: { id: string; label: string }[]; note: string }> {
    return this.client.get('/meta/payment-methods');
  }

  deliveryMethods(): Promise<{ methods: { id: string; label: string; caption: string }[] }> {
    return this.client.get('/meta/delivery-methods');
  }

  mediaProviders(): Promise<{ providers: { id: string; label: string; configured: boolean }[] }> {
    return this.client.get('/meta/media-providers');
  }

  // -------------------------------------------------------------------- auth
  register(input: { name: string; email: string; phone: string; password: string }): Promise<AuthResult> {
    return this.client.post<AuthResult>('/auth/register', input, { authenticated: false });
  }

  /**
   * Frictionless onboarding: a phone number is the whole input. The session is
   * left authenticated-by-default on purpose — when the device already holds a
   * token the server resolves to that account instead of creating a duplicate,
   * and when there is none the header is simply omitted.
   */
  quickAccount(input: { phone: string }): Promise<AuthResult> {
    return this.client.post<AuthResult>('/auth/quick-account', input);
  }

  login(input: { email: string; password: string }): Promise<AuthResult> {
    return this.client.post<AuthResult>('/auth/login', input, { authenticated: false });
  }

  me(): Promise<{ user: ApiUser }> {
    return this.client.get('/auth/me');
  }

  updateProfile(patch: { name?: string; email?: string; phone?: string; avatar?: string }): Promise<{ user: ApiUser }> {
    return this.client.patch('/auth/me', patch);
  }

  changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ changed: boolean; otherSessionsRevoked: boolean }> {
    return this.client.post('/auth/me/password', input);
  }

  /**
   * One-time first password for a quick account. No `currentPassword`: the
   * account never had one its owner knew. The server refuses (409) once the
   * account already has a password, so this cannot be replayed.
   */
  setInitialPassword(input: { newPassword: string }): Promise<{ changed: boolean; otherSessionsRevoked: boolean }> {
    return this.client.post('/auth/me/password/initial', input);
  }

  logout(): Promise<{ loggedOut: boolean }> {
    return this.client.post('/auth/logout');
  }

  logoutEverywhere(): Promise<{ loggedOutEverywhere: boolean }> {
    return this.client.post('/auth/logout-all');
  }

  /**
   * M8 password recovery.
   *
   * Both calls are unauthenticated — the person asking has lost their password,
   * which is the entire point. The request deliberately reports the same answer
   * for a known and an unknown address, so the UI must not branch on it either.
   */
  requestPasswordReset(input: { email: string }): Promise<{ accepted: boolean; expiresInMinutes: number }> {
    return this.client.post('/auth/password-reset/request', input, { authenticated: false });
  }

  confirmPasswordReset(input: { token: string; newPassword: string }): Promise<{ reset: boolean; sessionsRevoked: number }> {
    return this.client.post('/auth/password-reset/confirm', input, { authenticated: false });
  }

  // ----------------------------------------------------------------- catalog
  categories(): Promise<{ categories: Category[] }> {
    return this.client.get('/catalog/categories');
  }

  products(query: { page?: number; pageSize?: number; sellerId?: string; categoryId?: string; search?: string } = {}): Promise<ProductPage> {
    return this.client.get<ProductPage>('/catalog/products', { query });
  }

  product(id: string): Promise<{ product: Product; store: Store | null; seller: SellerProfile | null; effectivePrice: number; availableStock: number; visible: boolean }> {
    return this.client.get(`/catalog/products/${encodeURIComponent(id)}`);
  }

  store(sellerOrStoreId: string): Promise<StoreSummary> {
    return this.client.get(`/catalog/stores/${encodeURIComponent(sellerOrStoreId)}`);
  }

  summary(): Promise<CatalogSummary> {
    return this.client.get('/catalog/summary');
  }

  // -------------------------------------------------------------------- cart
  cart(deliveryMethod?: 'standard' | 'express', voucher?: string): Promise<PricedCart> {
    return this.client.get('/cart', { query: { deliveryMethod, voucher } });
  }

  addCartItem(input: { productId: string; quantity?: number; variantId?: string }): Promise<PricedCart> {
    return this.client.post('/cart/items', { quantity: 1, ...input });
  }

  patchCartItem(itemId: string, patch: { quantity?: number; selected?: boolean }): Promise<PricedCart> {
    return this.client.patch(`/cart/items/${encodeURIComponent(itemId)}`, patch);
  }

  removeCartItem(itemId: string): Promise<PricedCart> {
    return this.client.delete(`/cart/items/${encodeURIComponent(itemId)}`);
  }

  clearCart(): Promise<PricedCart> {
    return this.client.delete('/cart/items');
  }

  /** Select/deselect every line, or only one seller's lines (`PATCH /cart/select`). */
  selectCartLines(input: { selected: boolean; sellerId?: string }): Promise<PricedCart> {
    return this.client.patch('/cart/select', input);
  }

  // ----------------------------------------------------------------- vouchers
  /**
   * Every voucher the server quotes against the signed-in customer's current
   * cart, best discount first (`GET /vouchers/eligible`). This is the authority
   * for which codes can be applied and what they are worth.
   */
  eligibleVouchers(): Promise<{ quotes: EligibleVoucherQuoteDto[] }> {
    return this.client.get('/vouchers/eligible');
  }

  // ----------------------------------------------------------- notifications
  /** Newest-first page of the caller's inbox plus that caller's total unread. */
  notifications(options: { limit?: number; unread?: boolean } = {}): Promise<{ notifications: NotificationDto[]; unreadCount: number }> {
    const { limit, unread } = options;
    return this.client.get('/notifications', { query: { limit, unread: unread ? 'true' : undefined } });
  }

  unreadNotificationCount(): Promise<{ unreadCount: number }> {
    return this.client.get('/notifications/unread-count');
  }

  markNotificationRead(id: string): Promise<{ notification: NotificationDto }> {
    return this.client.patch(`/notifications/${encodeURIComponent(id)}/read`, {});
  }

  markAllNotificationsRead(): Promise<{ updated: number }> {
    return this.client.post('/notifications/read-all', {});
  }

  deleteNotification(id: string): Promise<{ deleted: true }> {
    return this.client.delete(`/notifications/${encodeURIComponent(id)}`);
  }

  // --------------------------------------------------------------- wishlist
  /** The caller's saved items, newest-first, each with its public product. */
  wishlist(): Promise<{ items: WishlistItemDto[] }> {
    return this.client.get('/wishlist');
  }

  addWishlistItem(productId: string): Promise<{ items: WishlistItemDto[] }> {
    return this.client.post('/wishlist/items', { productId });
  }

  removeWishlistItem(productId: string): Promise<{ items: WishlistItemDto[] }> {
    return this.client.delete(`/wishlist/items/${encodeURIComponent(productId)}`);
  }

  clearWishlist(): Promise<{ items: WishlistItemDto[] }> {
    return this.client.delete('/wishlist');
  }

  // ----------------------------------------------------------- store follows
  /** The caller's followed stores in follow-creation order, as public stores. */
  followedStores(): Promise<{ stores: StoreDto[] }> {
    return this.client.get('/me/follows');
  }

  followStore(storeId: string): Promise<FollowStateDto> {
    return this.client.post(`/stores/${encodeURIComponent(storeId)}/follow`, {});
  }

  unfollowStore(storeId: string): Promise<FollowStateDto> {
    return this.client.delete(`/stores/${encodeURIComponent(storeId)}/follow`);
  }

  followState(storeId: string): Promise<FollowStateDto> {
    return this.client.get(`/stores/${encodeURIComponent(storeId)}/follow`);
  }

  // ------------------------------------------------------------- reviews
  /** The caller's own reviews, newest first. */
  myReviews(): Promise<{ reviews: ReviewDto[] }> {
    return this.client.get('/reviews/mine');
  }

  /** Public product page: a page plus the totals/aggregates it renders. */
  productReviews(productId: string, options: { limit?: number; offset?: number } = {}): Promise<{
    reviews: ReviewDto[];
    total: number;
    ratingAvg: number;
    ratingCount: number;
  }> {
    const { limit, offset } = options;
    return this.client.get(`/catalog/products/${encodeURIComponent(productId)}/reviews`, {
      query: { limit, offset },
    });
  }

  updateReview(
    id: string,
    patch: { rating?: number; title?: string; text?: string; images?: string[] },
  ): Promise<{ review: ReviewDto }> {
    return this.client.patch(`/reviews/${encodeURIComponent(id)}`, patch);
  }

  deleteReview(id: string): Promise<{ deleted: true }> {
    return this.client.delete(`/reviews/${encodeURIComponent(id)}`);
  }

  // -------------------------------------------------------- recently viewed
  /** The caller's recently-viewed products, newest-first, with public products. */
  recentlyViewed(limit?: number): Promise<{ items: WishlistItemDto[] }> {
    return this.client.get('/recently-viewed', { query: { limit } });
  }

  recordView(productId: string): Promise<{ entry: { productId: string; addedAt: string } }> {
    return this.client.post('/recently-viewed', { productId });
  }

  // ------------------------------------------------------------------ orders
  createOrder(input: CheckoutInput): Promise<OrderReceiptDto> {
    return this.client.post<OrderReceiptDto>('/orders', input);
  }

  orders(): Promise<{ orders: OrderDto[] }> {
    return this.client.get('/orders');
  }

  order(id: string): Promise<OrderDetailDto> {
    return this.client.get(`/orders/${encodeURIComponent(id)}`);
  }

  cancelOrder(id: string, reason: string): Promise<OrderDto> {
    return this.client.post(`/orders/${encodeURIComponent(id)}/cancel`, { reason });
  }

  // -------------------------------------------------------- customer returns
  requestOrderReturn(orderId: string, input: { items: ReturnItemInput[] }): Promise<{ returns: ReturnDto[] }> {
    return this.client.post(`/orders/${encodeURIComponent(orderId)}/returns`, input);
  }

  orderReturns(orderId: string): Promise<{ returns: ReturnDto[] }> {
    return this.client.get(`/orders/${encodeURIComponent(orderId)}/returns`);
  }

  myReturns(): Promise<{ returns: ReturnDto[] }> {
    return this.client.get('/returns');
  }

  /** Server-authoritative checkout totals/availability for the current cart. */
  checkoutPreview(input: { deliveryMethod?: 'standard' | 'express'; voucherCode?: string }): Promise<CheckoutPreview> {
    return this.client.post('/checkout/preview', input);
  }

  // ---------------------------------------------------------------- addresses
  addresses(): Promise<{ addresses: AddressDto[] }> {
    return this.client.get('/addresses');
  }

  address(id: string): Promise<{ address: AddressDto }> {
    return this.client.get(`/addresses/${encodeURIComponent(id)}`);
  }

  createAddress(input: AddressPayload): Promise<{ address: AddressDto }> {
    return this.client.post('/addresses', input);
  }

  updateAddress(id: string, patch: Partial<AddressPayload>): Promise<{ address: AddressDto }> {
    return this.client.patch(`/addresses/${encodeURIComponent(id)}`, patch);
  }

  deleteAddress(id: string): Promise<{ deleted: true; addresses: AddressDto[] }> {
    return this.client.delete(`/addresses/${encodeURIComponent(id)}`);
  }

  setDefaultAddress(id: string): Promise<{ address: AddressDto }> {
    return this.client.post(`/addresses/${encodeURIComponent(id)}/default`);
  }

  // ------------------------------------------------------------------ seller
  /**
   * Seller onboarding. The `seller` role is granted server-side: a client that set
   * it locally would only edit its own record, and every `/seller/*` route
   * authorises from the token's user.
   */
  registerSeller(input: {
    fullName: string;
    phone: string;
    email: string;
    nationalId: string;
    sellerType: 'individual' | 'business';
    entityName?: string;
    storeName: string;
    storeDescription: string;
    storeLogo?: string;
    storeBanner?: string;
    pickupDivision: string;
    pickupDistrict: string;
    pickupArea?: string;
    pickupAddressLine: string;
    returnDivision: string;
    returnDistrict: string;
    returnArea?: string;
    returnAddressLine: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
    branch?: string;
    /**
     * Typed as `boolean` because the *server* is the authority on whether each
     * term was actually accepted: it rejects `false` with a field-level message.
     * Claiming `true` here would only move that check somewhere it cannot fail.
     */
    agreement: { marketplaceTerms: boolean; sellerPolicies: boolean; productAuthenticity: boolean; fulfillmentResponsibility: boolean };
  }): Promise<{ profile: SellerProfile; store: Store }> {
    return this.client.post('/seller/register', input);
  }

  /**
   * The caller's own seller profile and store. `profile` is null when there is
   * no application yet, and `store` is null for a rejected application, so both
   * are nullable — this route works without the seller role.
   */
  sellerProfile(): Promise<{ profile: SellerProfileDto | null; store: StoreDto | null }> {
    return this.client.get('/seller/profile');
  }

  /**
   * M8: where an applicant stands.
   *
   * `profile` is null until the application is submitted, and `store` is null for
   * the whole of a rejection, so both are nullable rather than assumed. A rejected
   * applicant can apply again, which is why the status is the server's to report.
   */
  sellerApplication(): Promise<{
    profile: SellerProfile | null;
    store: Store | null;
    canUseSellerArea: boolean;
  }> {
    return this.client.get('/seller/application');
  }

  sellerDashboard(): Promise<{ seller: SellerProfile; store: Store; productCount: number; orderCount: number; pendingFulfilment: number; revenue: number }> {
    return this.client.get('/seller/dashboard');
  }

  sellerProducts(): Promise<{ products: ProductDto[] }> {
    return this.client.get('/seller/products');
  }

  sellerProduct(id: string): Promise<{ product: ProductDto }> {
    return this.client.get(`/seller/products/${encodeURIComponent(id)}`);
  }

  createSellerProduct(input: Record<string, unknown>): Promise<{ product: ProductDto }> {
    return this.client.post('/seller/products', input);
  }

  updateSellerProduct(id: string, input: Record<string, unknown>): Promise<{ product: ProductDto }> {
    return this.client.patch(`/seller/products/${encodeURIComponent(id)}`, input);
  }

  setProductStatus(productId: string, status: Product['status']): Promise<ProductDto> {
    return this.client.patch(`/seller/products/${encodeURIComponent(productId)}/status`, { status });
  }

  adjustStock(productId: string, input: Record<string, unknown>): Promise<ProductDto> {
    return this.client.post(`/seller/products/${encodeURIComponent(productId)}/stock`, input);
  }

  inventorySummary(): Promise<{
    sellerId: string;
    totalProducts: number;
    activeProducts: number;
    totalUnits: number;
    outOfStock: number;
    lowStock: number;
    healthy: number;
    rows: { productId: string; name: string; status: string; stock: number; lowStockThreshold: number; level: 'out' | 'low' | 'healthy' }[];
  }> {
    return this.client.get('/seller/inventory/summary');
  }

  inventoryAdjustments(): Promise<{
    adjustments: { id: string; productId: string; variantId: string | null; quantity: number; reason: string; referenceId: string | null; createdAt: string; updatedAt: string }[];
  }> {
    return this.client.get('/seller/inventory/adjustments');
  }

  // ------------------------------------------------------------- seller store
  sellerStore(): Promise<{ store: StoreDto }> {
    return this.client.get('/seller/store');
  }

  patchSellerStore(patch: Record<string, unknown>): Promise<{ store: StoreDto }> {
    return this.client.patch('/seller/store', patch);
  }

  toggleSellerStoreStatus(status: 'active' | 'paused'): Promise<{ store: StoreDto }> {
    return this.client.post('/seller/store/status', { status });
  }

  // ------------------------------------------------------- seller returns
  sellerReturns(status?: ReturnRequest['status']): Promise<{ returns: ReturnDto[] }> {
    return this.client.get('/seller/returns', { query: { status } });
  }

  sellerReturn(id: string): Promise<ReturnDto> {
    return this.client.get(`/seller/returns/${encodeURIComponent(id)}`);
  }

  approveSellerReturn(id: string): Promise<ReturnDto> {
    return this.client.post(`/seller/returns/${encodeURIComponent(id)}/approve`);
  }

  rejectSellerReturn(id: string): Promise<ReturnDto> {
    return this.client.post(`/seller/returns/${encodeURIComponent(id)}/reject`);
  }

  markSellerReturnReturned(id: string): Promise<ReturnDto> {
    return this.client.post(`/seller/returns/${encodeURIComponent(id)}/returned`);
  }

  // ------------------------------------------------------ customer reviews
  createReview(input: {
    orderItemId: string;
    rating: number;
    title: string;
    text: string;
    images?: string[];
    orderId?: string;
    sellerOrderId?: string;
    productId?: string;
    sellerId?: string;
  }): Promise<{ review: ReviewDto }> {
    return this.client.post('/reviews', input);
  }

  // -------------------------------------------------------- seller reviews
  sellerReviews(query: {
    productId?: string;
    rating?: number | 'all';
    reply?: 'all' | 'replied' | 'awaiting';
    verified?: 'all' | 'verified' | 'unverified';
    search?: string;
  } = {}): Promise<{ reviews: ReviewDto[] }> {
    return this.client.get('/seller/reviews', { query });
  }

  sellerReview(id: string): Promise<{ review: ReviewDto }> {
    return this.client.get(`/seller/reviews/${encodeURIComponent(id)}`);
  }

  replySellerReview(id: string, reply: string): Promise<{ review: ReviewDto }> {
    return this.client.post(`/seller/reviews/${encodeURIComponent(id)}/reply`, { reply });
  }

  // -------------------------------------------------------- seller vouchers
  sellerVouchers(): Promise<{ vouchers: VoucherDto[] }> {
    return this.client.get('/seller/vouchers');
  }

  sellerVoucher(id: string): Promise<{ voucher: VoucherDto }> {
    return this.client.get(`/seller/vouchers/${encodeURIComponent(id)}`);
  }

  createSellerVoucher(input: Record<string, unknown>): Promise<{ voucher: VoucherDto }> {
    return this.client.post('/seller/vouchers', input);
  }

  updateSellerVoucher(id: string, input: Record<string, unknown>): Promise<{ voucher: VoucherDto }> {
    return this.client.patch(`/seller/vouchers/${encodeURIComponent(id)}`, input);
  }

  deleteSellerVoucher(id: string): Promise<{ voucher: VoucherDto } | { deleted: true }> {
    return this.client.delete(`/seller/vouchers/${encodeURIComponent(id)}`);
  }

  sellerOrders(): Promise<{ orders: SellerOrderViewDto[] }> {
    return this.client.get('/seller/orders');
  }

  sellerOrder(id: string): Promise<SellerOrderViewDto> {
    return this.client.get(`/seller/orders/${encodeURIComponent(id)}`);
  }

  advanceSellerOrder(id: string): Promise<SellerOrderViewDto> {
    return this.client.post(`/seller/orders/${encodeURIComponent(id)}/advance`);
  }
}

export const vantaApi = new VantaApi();
