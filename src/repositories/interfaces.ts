import type {
  Address,
  AppNotification,
  Cart,
  Category,
  InventoryAdjustment,
  Order,
  PaymentTransaction,
  Product,
  Promotion,
  RecentlyViewedEntry,
  ReturnRequest,
  Review,
  SearchHistoryEntry,
  SellerOrder,
  SellerProfile,
  Session,
  Store,
  StoreFollower,
  User,
  Voucher,
  Wishlist,
} from '@/domain/types';

export type FindOptions<T> = {
  where?: Partial<T>;
  orderBy?: { field: keyof T; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
};

export interface UserRepository {
  getById(id: string): User | undefined;
  getByEmail(email: string): User | undefined;
  list(): User[];
  create(user: User): void;
  update(id: string, patch: Partial<User>): void;
}

export interface SessionRepository {
  getByToken(token: string): Session | undefined;
  create(session: Session): void;
  delete(token: string): void;
  listForUser(userId: string): Session[];
}

export interface CategoryRepository {
  getById(id: string): Category | undefined;
  list(): Category[];
  create(category: Category): void;
}

export interface SellerRepository {
  getById(id: string): SellerProfile | undefined;
  getByUserId(userId: string): SellerProfile | undefined;
  list(): SellerProfile[];
  create(seller: SellerProfile): void;
  update(id: string, patch: Partial<SellerProfile>): void;
}

export interface StoreRepository {
  getById(id: string): Store | undefined;
  getBySellerId(sellerId: string): Store | undefined;
  list(): Store[];
  create(store: Store): void;
  update(id: string, patch: Partial<Store>): void;
}

export interface ProductRepository {
  getById(id: string): Product | undefined;
  list(options?: { sellerId?: string; statuses?: Product['status'][] }): Product[];
  create(product: Product): void;
  update(id: string, patch: Partial<Product>): void;
}

export interface CartRepository {
  getByUserId(userId: string): Cart | undefined;
  create(cart: Cart): void;
  upsert(cart: Cart): void;
}

export interface WishlistRepository {
  getByUserId(userId: string): Wishlist | undefined;
  create(wishlist: Wishlist): void;
  upsert(wishlist: Wishlist): void;
}

export interface AddressRepository {
  listForUser(userId: string): Address[];
  getById(id: string): Address | undefined;
  create(address: Address): void;
  update(id: string, patch: Partial<Address>): void;
  remove(id: string): void;
}

export interface VoucherRepository {
  getByCode(code: string): Voucher | undefined;
  getById(id: string): Voucher | undefined;
  list(): Voucher[];
  create(voucher: Voucher): void;
  update(id: string, patch: Partial<Voucher>): void;
  remove(id: string): void;
}

export interface PromotionRepository {
  getById(id: string): Promotion | undefined;
  list(): Promotion[];
  create(promotion: Promotion): void;
  update(id: string, patch: Partial<Promotion>): void;
}

export interface OrderRepository {
  getById(id: string): Order | undefined;
  listForCustomer(customerId: string): Order[];
  create(order: Order): void;
  update(id: string, patch: Partial<Order>): void;
  /** Compensation hook, mirroring the backend contract. */
  remove(id: string): void;
}

export interface SellerOrderRepository {
  getById(id: string): SellerOrder | undefined;
  listForSeller(sellerId: string): SellerOrder[];
  listForOrder(orderId: string): SellerOrder[];
  list(): SellerOrder[];
  create(sellerOrder: SellerOrder): void;
  update(id: string, patch: Partial<SellerOrder>): void;
  /** Compensation hook, mirroring the backend contract. */
  remove(id: string): void;
}

export interface PaymentRepository {
  getByOrderId(orderId: string): PaymentTransaction[];
  create(transaction: PaymentTransaction): void;
  update(id: string, patch: Partial<PaymentTransaction>): void;
  /** Compensation hook, mirroring the backend contract. */
  remove(id: string): void;
}

export interface ReviewRepository {
  getById(id: string): Review | undefined;
  listForProduct(productId: string): Review[];
  listForSeller(sellerId: string): Review[];
  listForUser(userId: string): Review[];
  list(): Review[];
  create(review: Review): void;
  update(id: string, patch: Partial<Review>): void;
  remove(id: string): void;
  getByOrderItem(orderItemId: string): Review | undefined;
}

export interface ReturnRequestRepository {
  getById(id: string): ReturnRequest | undefined;
  listForUser(userId: string): ReturnRequest[];
  listForSeller(sellerId: string): ReturnRequest[];
  list(): ReturnRequest[];
  create(request: ReturnRequest): void;
  update(id: string, patch: Partial<ReturnRequest>): void;
}

export interface NotificationRepository {
  listForUser(userId: string): AppNotification[];
  create(notification: AppNotification): void;
  update(id: string, patch: Partial<AppNotification>): void;
  remove(id: string): void;
}

export interface SearchHistoryRepository {
  listForUser(userId: string): SearchHistoryEntry[];
  create(entry: SearchHistoryEntry): void;
  remove(id: string): void;
  clearForUser(userId: string): void;
}

export interface RecentlyViewedRepository {
  listForUser(userId: string): RecentlyViewedEntry[];
  create(entry: RecentlyViewedEntry): void;
  remove(id: string): void;
}

export interface StoreFollowerRepository {
  listForStore(storeId: string): StoreFollower[];
  listForUser(userId: string): StoreFollower[];
  get(storeId: string, userId: string): StoreFollower | undefined;
  create(follower: StoreFollower): void;
  remove(id: string): void;
}

export interface InventoryAdjustmentRepository {
  listForProduct(productId: string): InventoryAdjustment[];
  listForSeller(sellerId: string): InventoryAdjustment[];
  create(adjustment: InventoryAdjustment): void;
  /** Compensation hook, mirroring the backend contract. */
  remove(id: string): void;
}