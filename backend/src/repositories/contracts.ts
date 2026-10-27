/**
 * Server-side repository boundary (M7-E).
 *
 * Every service talks to these contracts and never to Mongoose directly, so the
 * whole API can be exercised against the in-memory implementation with no
 * database running, and the Mongo implementation can be swapped without touching
 * a single service.
 *
 * This is the *async* mirror of the app's synchronous local repository map: the
 * same entity set, the same ownership semantics, the same lookup shapes.
 */
import type {
  AddressEntity,
  AuditLogEntity,
  CartEntity,
  CartItemEntity,
  CategoryEntity,
  IdempotencyRecordEntity,
  IdempotencyState,
  InventoryAdjustmentEntity,
  NotificationEntity,
  OrderEntity,
  PasswordResetTokenEntity,
  PaymentTransactionEntity,
  ProductEntity,
  PromotionEntity,
  PublicUser,
  ReviewEntity,
  ReturnRequestEntity,
  Role,
  SellerOrderEntity,
  SellerProfileEntity,
  SessionEntity,
  StoreEntity,
  UserEntity,
  VoucherEntity,
  WishlistEntity,
} from '../domain/entities';

export interface ProductQuery {
  sellerId?: string;
  categoryId?: string;
  statuses?: ProductEntity['status'][];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UserRepository {
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  list(): Promise<UserEntity[]>;
  insert(user: UserEntity): Promise<UserEntity>;
  patch(id: string, patch: Partial<UserEntity>): Promise<UserEntity | null>;
  addRole(id: string, role: Role): Promise<UserEntity | null>;
  /**
   * M8: the inverse of `addRole`, needed because a seller approval can be revoked.
   * A rejected or suspended seller must lose the role that granted them the seller
   * area, otherwise the status and the authorisation would disagree.
   */
  removeRole(id: string, role: Role): Promise<UserEntity | null>;
}

export interface SessionRepository {
  findByToken(token: string): Promise<SessionEntity | null>;
  listForUser(userId: string): Promise<SessionEntity[]>;
  insert(session: SessionEntity): Promise<SessionEntity>;
  deleteByToken(token: string): Promise<void>;
  deleteForUser(userId: string, exceptToken?: string): Promise<void>;
  deleteExpired(nowIso: string): Promise<number>;
}

export interface CategoryRepository {
  findById(id: string): Promise<CategoryEntity | null>;
  list(): Promise<CategoryEntity[]>;
  insert(category: CategoryEntity): Promise<CategoryEntity>;
}

export interface SellerRepository {
  findById(id: string): Promise<SellerProfileEntity | null>;
  findByUserId(userId: string): Promise<SellerProfileEntity | null>;
  list(): Promise<SellerProfileEntity[]>;
  /** M8: the approval queue — applications waiting on a server-side decision. */
  listByStatus(status: SellerProfileEntity['status']): Promise<SellerProfileEntity[]>;
  insert(seller: SellerProfileEntity): Promise<SellerProfileEntity>;
  patch(id: string, patch: Partial<SellerProfileEntity>): Promise<SellerProfileEntity | null>;
}

export interface StoreRepository {
  findById(id: string): Promise<StoreEntity | null>;
  findBySellerId(sellerId: string): Promise<StoreEntity | null>;
  list(): Promise<StoreEntity[]>;
  insert(store: StoreEntity): Promise<StoreEntity>;
  patch(id: string, patch: Partial<StoreEntity>): Promise<StoreEntity | null>;
}

export interface ProductRepository {
  findById(id: string): Promise<ProductEntity | null>;
  query(query: ProductQuery): Promise<ProductEntity[]>;
  count(query: ProductQuery): Promise<number>;
  insert(product: ProductEntity): Promise<ProductEntity>;
  patch(id: string, patch: Partial<ProductEntity>): Promise<ProductEntity | null>;
  /** Atomic stock movement used by checkout and returns. */
  adjustStock(
    productId: string,
    delta: number,
    variantId: string | null,
  ): Promise<{ ok: boolean; product: ProductEntity | null }>;
}

export interface CartRepository {
  findByUserId(userId: string): Promise<CartEntity | null>;
  upsert(cart: CartEntity): Promise<CartEntity>;
  addItem(userId: string, item: CartItemEntity): Promise<CartEntity>;
  patchItem(
    userId: string,
    itemId: string,
    patch: Partial<CartItemEntity>,
  ): Promise<{ cart: CartEntity | null; item: CartItemEntity | null }>;
  removeItem(userId: string, itemId: string): Promise<CartEntity | null>;
  clearSelected(userId: string): Promise<CartEntity | null>;
}

export interface AddressRepository {
  listForUser(userId: string): Promise<AddressEntity[]>;
  findById(id: string): Promise<AddressEntity | null>;
  insert(address: AddressEntity): Promise<AddressEntity>;
  patch(id: string, patch: Partial<AddressEntity>): Promise<AddressEntity | null>;
  remove(id: string): Promise<boolean>;
}

export interface VoucherRepository {
  findByCode(code: string): Promise<VoucherEntity | null>;
  findById(id: string): Promise<VoucherEntity | null>;
  list(): Promise<VoucherEntity[]>;
  insert(voucher: VoucherEntity): Promise<VoucherEntity>;
  patch(id: string, patch: Partial<VoucherEntity>): Promise<VoucherEntity | null>;
  /** Records one redemption against both the global and per-user counters. */
  markUsed(id: string, userId: string, atIso: string): Promise<VoucherEntity | null>;
}

export interface PromotionRepository {
  findById(id: string): Promise<PromotionEntity | null>;
  list(): Promise<PromotionEntity[]>;
  insert(promotion: PromotionEntity): Promise<PromotionEntity>;
}

export interface OrderRepository {
  findById(id: string): Promise<OrderEntity | null>;
  findByCode(code: string): Promise<OrderEntity | null>;
  listForCustomer(customerId: string): Promise<OrderEntity[]>;
  insert(order: OrderEntity): Promise<OrderEntity>;
  patch(id: string, patch: Partial<OrderEntity>): Promise<OrderEntity | null>;
  /** Compensation hook for a failed checkout; see OrderService.createOrder. */
  delete(id: string): Promise<boolean>;
}

export interface SellerOrderRepository {
  findById(id: string): Promise<SellerOrderEntity | null>;
  listForSeller(sellerId: string): Promise<SellerOrderEntity[]>;
  listForOrder(orderId: string): Promise<SellerOrderEntity[]>;
  insert(sellerOrder: SellerOrderEntity): Promise<SellerOrderEntity>;
  patch(id: string, patch: Partial<SellerOrderEntity>): Promise<SellerOrderEntity | null>;
  /** Compensation hook for a failed checkout; see OrderService.createOrder. */
  delete(id: string): Promise<boolean>;
}

export interface PaymentRepository {
  listForOrder(orderId: string): Promise<PaymentTransactionEntity[]>;
  insert(transaction: PaymentTransactionEntity): Promise<PaymentTransactionEntity>;
  patch(id: string, patch: Partial<PaymentTransactionEntity>): Promise<PaymentTransactionEntity | null>;
  /** Compensation hook for a failed checkout; see OrderService.createOrder. */
  delete(id: string): Promise<boolean>;
}

export interface ReviewRepository {
  findById(id: string): Promise<ReviewEntity | null>;
  listForProduct(productId: string): Promise<ReviewEntity[]>;
  listForSeller(sellerId: string): Promise<ReviewEntity[]>;
  listForUser(userId: string): Promise<ReviewEntity[]>;
  insert(review: ReviewEntity): Promise<ReviewEntity>;
  patch(id: string, patch: Partial<ReviewEntity>): Promise<ReviewEntity | null>;
}

export interface ReturnRequestRepository {
  findById(id: string): Promise<ReturnRequestEntity | null>;
  listForUser(userId: string): Promise<ReturnRequestEntity[]>;
  listForSeller(sellerId: string): Promise<ReturnRequestEntity[]>;
  insert(request: ReturnRequestEntity): Promise<ReturnRequestEntity>;
  patch(id: string, patch: Partial<ReturnRequestEntity>): Promise<ReturnRequestEntity | null>;
}

export interface NotificationRepository {
  listForUser(userId: string): Promise<NotificationEntity[]>;
  insert(notification: NotificationEntity): Promise<NotificationEntity>;
  patch(id: string, patch: Partial<NotificationEntity>): Promise<NotificationEntity | null>;
}

export interface WishlistRepository {
  findByUserId(userId: string): Promise<WishlistEntity | null>;
  upsert(wishlist: WishlistEntity): Promise<WishlistEntity>;
}

export interface InventoryAdjustmentRepository {
  listForProduct(productId: string): Promise<InventoryAdjustmentEntity[]>;
  listForSeller(sellerId: string): Promise<InventoryAdjustmentEntity[]>;
  insert(adjustment: InventoryAdjustmentEntity): Promise<InventoryAdjustmentEntity>;
  /** Compensation hook for a failed checkout; see OrderService.createOrder. */
  deleteForReference(referenceId: string): Promise<number>;
}

/**
 * M8 durable idempotency.
 *
 * `claim` is an insert, never an upsert: the unique index on
 * (scope, ownerId, key) is what makes exactly one concurrent writer win, so two
 * simultaneous retries of the same submit cannot both create an order. A caller
 * that loses the race reads the winner's record and replays or rejects from it.
 */
export interface IdempotencyRepository {
  find(scope: string, ownerId: string, key: string): Promise<IdempotencyRecordEntity | null>;
  /** Insert-only. Returns `null` when the key is already claimed. */
  claim(record: IdempotencyRecordEntity): Promise<IdempotencyRecordEntity | null>;
  complete(
    scope: string,
    ownerId: string,
    key: string,
    patch: { state: IdempotencyState; resourceId?: string; responseStatus?: number },
  ): Promise<IdempotencyRecordEntity | null>;
  /**
   * Releases a claim that did not produce anything, so a failed attempt does not
   * wedge the key for its whole lifetime. A *completed* record is never released:
   * that is the replay entry point.
   */
  release(scope: string, ownerId: string, key: string): Promise<boolean>;
  deleteExpired(nowIso: string): Promise<number>;
}

/**
 * M8 password reset. Lookups are by the stored hash, never by the token, so the
 * collection holds nothing that can be replayed from a dump.
 */
export interface PasswordResetRepository {
  findByTokenHash(tokenHash: string): Promise<PasswordResetTokenEntity | null>;
  insert(token: PasswordResetTokenEntity): Promise<PasswordResetTokenEntity>;
  /** Single-use: a row already stamped `usedAt` is not stamped again. */
  markUsed(id: string, atIso: string): Promise<PasswordResetTokenEntity | null>;
  /** Invalidates every outstanding token for a user (used after a reset). */
  deleteForUser(userId: string): Promise<number>;
  deleteExpired(nowIso: string): Promise<number>;
}

/** M8 append-only trail for privileged actions. */
export interface AuditRepository {
  insert(entry: AuditLogEntity): Promise<AuditLogEntity>;
  listForSubject(subjectType: string, subjectId: string): Promise<AuditLogEntity[]>;
}

export interface RepositoryBundle {
  users: UserRepository;
  sessions: SessionRepository;
  categories: CategoryRepository;
  sellers: SellerRepository;
  stores: StoreRepository;
  products: ProductRepository;
  carts: CartRepository;
  wishlists: WishlistRepository;
  addresses: AddressRepository;
  vouchers: VoucherRepository;
  promotions: PromotionRepository;
  orders: OrderRepository;
  sellerOrders: SellerOrderRepository;
  payments: PaymentRepository;
  reviews: ReviewRepository;
  returnRequests: ReturnRequestRepository;
  notifications: NotificationRepository;
  inventoryAdjustments: InventoryAdjustmentRepository;
  /** M8 */
  idempotency: IdempotencyRepository;
  /** M8 */
  passwordResets: PasswordResetRepository;
  /** M8 */
  audit: AuditRepository;
  /** Name of the active driver, surfaced by /health. */
  driver: 'mongo' | 'memory';
  /**
   * True when `transact` gives real all-or-nothing semantics (MongoDB
   * multi-document transaction). False for the in-memory driver, where a
   * transaction is only a function call and services must use compensating writes.
   */
  supportsTransactions: boolean;
  /**
   * M8 atomic work unit.
   *
   * The Mongo driver runs `work` inside `session.withTransaction`, handing it a
   * bundle whose every operation carries the session, so a throw rolls the whole
   * unit back. The in-memory driver simply invokes it and reports
   * `supportsTransactions: false`, which is what keeps checkout's compensating
   * path honest instead of pretending a single-node RAM map is atomic.
   */
  transact<T>(work: (repos: RepositoryBundle) => Promise<T>): Promise<T>;
  /**
   * Liveness probe for the datastore behind this bundle. Part of the contract (not
   * a module-level helper) so `/health` reports the bundle it was actually given —
   * important for tests, which inject a bundle that never went through connect().
   */
  ping(): Promise<{ ok: boolean; driver: string; detail?: string }>;
}

export interface SeedBundle extends RepositoryBundle {
  clear(): Promise<void>;
}

export type { PublicUser };
