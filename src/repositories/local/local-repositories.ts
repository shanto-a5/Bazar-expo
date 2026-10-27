import type { LocalDatabase } from '@/database/local-database';
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
import type {
  AddressRepository,
  CartRepository,
  CategoryRepository,
  InventoryAdjustmentRepository,
  NotificationRepository,
  OrderRepository,
  PaymentRepository,
  ProductRepository,
  PromotionRepository,
  RecentlyViewedRepository,
  ReturnRequestRepository,
  ReviewRepository,
  SearchHistoryRepository,
  SellerOrderRepository,
  SellerRepository,
  SessionRepository,
  StoreFollowerRepository,
  StoreRepository,
  UserRepository,
  VoucherRepository,
  WishlistRepository,
} from '@/repositories/interfaces';

function byId<T extends { id: string }>(collection: T[], id: string): T | undefined {
  return collection.find((x) => x.id === id);
}

export class LocalUserRepository implements UserRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<User>('users'), id);
  }
  getByEmail(email: string) {
    return this.db.getCollection<User>('users').find((u) => u.email.toLowerCase() === email.toLowerCase());
  }
  list() {
    return this.db.getCollection<User>('users');
  }
  create(user: User) {
    this.db.insert('users', user);
  }
  update(id: string, patch: Partial<User>) {
    this.db.update('users', id, patch);
  }
}

export class LocalSessionRepository implements SessionRepository {
  constructor(private db: LocalDatabase) {}
  getByToken(token: string) {
    return this.db.getCollection<Session>('sessions').find((s) => s.token === token);
  }
  create(session: Session) {
    this.db.insert('sessions', session);
  }
  delete(tokenOrId: string) {
    const match = this.db
      .getCollection<Session>('sessions')
      .find((s) => s.token === tokenOrId || s.id === tokenOrId);
    if (match) this.db.remove('sessions', match.id);
  }
  listForUser(userId: string) {
    return this.db.getCollection<Session>('sessions').filter((s) => s.userId === userId);
  }
}

export class LocalCategoryRepository implements CategoryRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<Category>('categories'), id);
  }
  list() {
    return this.db.getCollection<Category>('categories');
  }
  create(category: Category) {
    this.db.insert('categories', category);
  }
}

export class LocalSellerRepository implements SellerRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<SellerProfile>('sellers'), id);
  }
  getByUserId(userId: string) {
    return this.db.getCollection<SellerProfile>('sellers').find((s) => s.userId === userId);
  }
  list() {
    return this.db.getCollection<SellerProfile>('sellers');
  }
  create(seller: SellerProfile) {
    this.db.insert('sellers', seller);
  }
  update(id: string, patch: Partial<SellerProfile>) {
    this.db.update('sellers', id, patch);
  }
}

export class LocalStoreRepository implements StoreRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<Store>('stores'), id);
  }
  getBySellerId(sellerId: string) {
    return this.db.getCollection<Store>('stores').find((s) => s.sellerId === sellerId);
  }
  list() {
    return this.db.getCollection<Store>('stores');
  }
  create(store: Store) {
    this.db.insert('stores', store);
  }
  update(id: string, patch: Partial<Store>) {
    this.db.update('stores', id, patch);
  }
}

export class LocalProductRepository implements ProductRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<Product>('products'), id);
  }
  list(options?: { sellerId?: string; statuses?: Product['status'][] }) {
    let result = this.db.getCollection<Product>('products');
    if (options?.sellerId) result = result.filter((p) => p.sellerId === options.sellerId);
    if (options?.statuses) result = result.filter((p) => options.statuses!.includes(p.status));
    return result;
  }
  create(product: Product) {
    this.db.insert('products', product);
  }
  update(id: string, patch: Partial<Product>) {
    this.db.update('products', id, patch);
  }
}

export class LocalCartRepository implements CartRepository {
  constructor(private db: LocalDatabase) {}
  getByUserId(userId: string) {
    return this.db.getCollection<Cart>('carts').find((c) => c.userId === userId);
  }
  create(cart: Cart) {
    this.db.insert('carts', cart);
  }
  upsert(cart: Cart) {
    this.db.upsert('carts', { ...cart });
  }
}

export class LocalWishlistRepository implements WishlistRepository {
  constructor(private db: LocalDatabase) {}
  getByUserId(userId: string) {
    return this.db.getCollection<Wishlist>('wishlists').find((w) => w.userId === userId);
  }
  create(wishlist: Wishlist) {
    this.db.insert('wishlists', wishlist);
  }
  upsert(wishlist: Wishlist) {
    this.db.upsert('wishlists', { ...wishlist });
  }
}

export class LocalAddressRepository implements AddressRepository {
  constructor(private db: LocalDatabase) {}
  listForUser(userId: string) {
    return this.db.getCollection<Address>('addresses').filter((a) => a.userId === userId);
  }
  getById(id: string) {
    return byId(this.db.getCollection<Address>('addresses'), id);
  }
  create(address: Address) {
    this.db.insert('addresses', address);
  }
  update(id: string, patch: Partial<Address>) {
    this.db.update('addresses', id, patch);
  }
  remove(id: string) {
    this.db.remove('addresses', id);
  }
}

export class LocalVoucherRepository implements VoucherRepository {
  constructor(private db: LocalDatabase) {}
  getByCode(code: string) {
    return this.db
      .getCollection<Voucher>('vouchers')
      .find((v) => v.code.toLowerCase() === code.toLowerCase());
  }
  getById(id: string) {
    return byId(this.db.getCollection<Voucher>('vouchers'), id);
  }
  list() {
    return this.db.getCollection<Voucher>('vouchers');
  }
  create(voucher: Voucher) {
    this.db.insert('vouchers', voucher);
  }
  update(id: string, patch: Partial<Voucher>) {
    this.db.update('vouchers', id, patch);
  }
  remove(id: string) {
    this.db.remove('vouchers', id);
  }
}

export class LocalPromotionRepository implements PromotionRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<Promotion>('promotions'), id);
  }
  list() {
    return this.db.getCollection<Promotion>('promotions');
  }
  create(promotion: Promotion) {
    this.db.insert('promotions', promotion);
  }
  update(id: string, patch: Partial<Promotion>) {
    this.db.update('promotions', id, patch);
  }
}

export class LocalOrderRepository implements OrderRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<Order>('orders'), id);
  }
  listForCustomer(customerId: string) {
    return this.db
      .getCollection<Order>('orders')
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  create(order: Order) {
    this.db.insert('orders', order);
  }
  update(id: string, patch: Partial<Order>) {
    this.db.update('orders', id, patch);
  }
  remove(id: string) {
    this.db.remove('orders', id);
  }
}

export class LocalSellerOrderRepository implements SellerOrderRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<SellerOrder>('sellerOrders'), id);
  }
  listForSeller(sellerId: string) {
    return this.db
      .getCollection<SellerOrder>('sellerOrders')
      .filter((o) => o.sellerId === sellerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  listForOrder(orderId: string) {
    return this.db.getCollection<SellerOrder>('sellerOrders').filter((o) => o.orderId === orderId);
  }
  list() {
    return [...this.db.getCollection<SellerOrder>('sellerOrders')].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  create(sellerOrder: SellerOrder) {
    this.db.insert('sellerOrders', sellerOrder);
  }
  update(id: string, patch: Partial<SellerOrder>) {
    this.db.update('sellerOrders', id, patch);
  }
  remove(id: string) {
    this.db.remove('sellerOrders', id);
  }
}

export class LocalPaymentRepository implements PaymentRepository {
  constructor(private db: LocalDatabase) {}
  getByOrderId(orderId: string) {
    return this.db.getCollection<PaymentTransaction>('payments').filter((p) => p.orderId === orderId);
  }
  create(transaction: PaymentTransaction) {
    this.db.insert('payments', transaction);
  }
  update(id: string, patch: Partial<PaymentTransaction>) {
    this.db.update('payments', id, patch);
  }
  remove(id: string) {
    this.db.remove('payments', id);
  }
}

export class LocalReviewRepository implements ReviewRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<Review>('reviews'), id);
  }
  listForProduct(productId: string) {
    return this.db.getCollection<Review>('reviews').filter((r) => r.productId === productId);
  }
  listForSeller(sellerId: string) {
    return this.db.getCollection<Review>('reviews').filter((r) => r.sellerId === sellerId);
  }
  listForUser(userId: string) {
    return this.db.getCollection<Review>('reviews').filter((r) => r.userId === userId);
  }
  list() {
    return this.db.getCollection<Review>('reviews');
  }
  create(review: Review) {
    this.db.insert('reviews', review);
  }
  update(id: string, patch: Partial<Review>) {
    this.db.update('reviews', id, patch);
  }
  remove(id: string) {
    this.db.remove('reviews', id);
  }
  getByOrderItem(orderItemId: string) {
    return this.db.getCollection<Review>('reviews').find((r) => r.orderItemId === orderItemId);
  }
}

export class LocalReturnRequestRepository implements ReturnRequestRepository {
  constructor(private db: LocalDatabase) {}
  getById(id: string) {
    return byId(this.db.getCollection<ReturnRequest>('returnRequests'), id);
  }
  listForUser(userId: string) {
    return this.db
      .getCollection<ReturnRequest>('returnRequests')
      .filter((r) => r.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  listForSeller(sellerId: string) {
    return this.db
      .getCollection<ReturnRequest>('returnRequests')
      .filter((r) => r.sellerId === sellerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  list() {
    return this.db.getCollection<ReturnRequest>('returnRequests');
  }
  create(request: ReturnRequest) {
    this.db.insert('returnRequests', request);
  }
  update(id: string, patch: Partial<ReturnRequest>) {
    this.db.update('returnRequests', id, patch);
  }
}

export class LocalNotificationRepository implements NotificationRepository {
  constructor(private db: LocalDatabase) {}
  listForUser(userId: string) {
    return this.db
      .getCollection<AppNotification>('notifications')
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  create(notification: AppNotification) {
    this.db.insert('notifications', notification);
  }
  update(id: string, patch: Partial<AppNotification>) {
    this.db.update('notifications', id, patch);
  }
  remove(id: string) {
    this.db.remove('notifications', id);
  }
}

export class LocalSearchHistoryRepository implements SearchHistoryRepository {
  constructor(private db: LocalDatabase) {}
  listForUser(userId: string) {
    return this.db
      .getCollection<SearchHistoryEntry>('searchHistory')
      .filter((e) => e.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  create(entry: SearchHistoryEntry) {
    this.db.insert('searchHistory', entry);
  }
  remove(id: string) {
    this.db.remove('searchHistory', id);
  }
  clearForUser(userId: string) {
    const next = this.db.getCollection<SearchHistoryEntry>('searchHistory').filter((e) => e.userId !== userId);
    this.db.replaceCollection('searchHistory', next);
  }
}

export class LocalRecentlyViewedRepository implements RecentlyViewedRepository {
  constructor(private db: LocalDatabase) {}
  listForUser(userId: string) {
    return this.db
      .getCollection<RecentlyViewedEntry>('recentlyViewed')
      .filter((e) => e.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  create(entry: RecentlyViewedEntry) {
    this.db.insert('recentlyViewed', entry);
  }
  remove(id: string) {
    this.db.remove('recentlyViewed', id);
  }
}

export class LocalStoreFollowerRepository implements StoreFollowerRepository {
  constructor(private db: LocalDatabase) {}
  listForStore(storeId: string) {
    return this.db.getCollection<StoreFollower>('storeFollowers').filter((f) => f.storeId === storeId);
  }
  listForUser(userId: string) {
    return this.db.getCollection<StoreFollower>('storeFollowers').filter((f) => f.userId === userId);
  }
  get(storeId: string, userId: string) {
    return this.db
      .getCollection<StoreFollower>('storeFollowers')
      .find((f) => f.storeId === storeId && f.userId === userId);
  }
  create(follower: StoreFollower) {
    this.db.insert('storeFollowers', follower);
  }
  remove(id: string) {
    this.db.remove('storeFollowers', id);
  }
}

export class LocalInventoryAdjustmentRepository implements InventoryAdjustmentRepository {
  constructor(private db: LocalDatabase) {}
  listForProduct(productId: string) {
    return this.db.getCollection<InventoryAdjustment>('inventoryAdjustments').filter((a) => a.productId === productId);
  }
  listForSeller(sellerId: string) {
    const productIds = new Set(
      this.db.getCollection<Product>('products').filter((p) => p.sellerId === sellerId).map((p) => p.id),
    );
    return this.db.getCollection<InventoryAdjustment>('inventoryAdjustments').filter((a) => productIds.has(a.productId));
  }
  create(adjustment: InventoryAdjustment) {
    this.db.insert('inventoryAdjustments', adjustment);
  }
  remove(id: string) {
    this.db.remove('inventoryAdjustments', id);
  }
}