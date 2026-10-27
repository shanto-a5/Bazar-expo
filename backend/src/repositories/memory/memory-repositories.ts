/**
 * In-memory repository driver (M7-E / M7-R).
 *
 * Backs two real purposes:
 *   1. `ALLOW_MEMORY_DB=true` development runs and the whole test suite, so the
 *      API can be exercised with no MongoDB process anywhere.
 *   2. The seed target, so `npm run seed` is idempotent without a wipe.
 *
 * It implements the exact same `RepositoryBundle` contract as the Mongo driver,
 * including stock-decrement and voucher-redemption behaviour.
 */
import { nowIso } from '../../lib/identity';
import type { SeedBundle, ProductQuery, RepositoryBundle } from '../contracts';
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
} from '../../domain/entities';

class Table<T extends { id: string }> {
  readonly rows = new Map<string, T>();

  get(id: string): T | null {
    return this.rows.get(id) ?? null;
  }

  all(): T[] {
    return [...this.rows.values()];
  }

  put(row: T): T {
    this.rows.set(row.id, row);
    return row;
  }

  patch(id: string, patch: Partial<T>): T | null {
    const current = this.rows.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id: current.id, updatedAt: nowIso() } as T;
    this.rows.set(id, next);
    return next;
  }

  remove(id: string): boolean {
    return this.rows.delete(id);
  }

  clear(): void {
    this.rows.clear();
  }
}

function matchesSearch(haystack: string[], needle: string): boolean {
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

function applyProductQuery(rows: ProductEntity[], query: ProductQuery): ProductEntity[] {
  let out = rows;
  if (query.sellerId) out = out.filter((row) => row.sellerId === query.sellerId);
  if (query.categoryId) out = out.filter((row) => row.categoryId === query.categoryId);
  if (query.statuses && query.statuses.length > 0) {
    out = out.filter((row) => query.statuses!.includes(row.status));
  }
  if (query.search) {
    const needle = query.search.toLowerCase();
    out = out.filter((row) => matchesSearch([row.name, row.brand, row.sku], needle));
  }
  return out;
}

export function createMemoryRepositories(): SeedBundle {
  const users = new Table<UserEntity>();
  const sessions = new Table<SessionEntity>();
  const categories = new Table<CategoryEntity>();
  const sellers = new Table<SellerProfileEntity>();
  const stores = new Table<StoreEntity>();
  const products = new Table<ProductEntity>();
  const carts = new Table<CartEntity>();
  const wishlists = new Table<WishlistEntity>();
  const addresses = new Table<AddressEntity>();
  const vouchers = new Table<VoucherEntity>();
  const promotions = new Table<PromotionEntity>();
  const orders = new Table<OrderEntity>();
  const sellerOrders = new Table<SellerOrderEntity>();
  const payments = new Table<PaymentTransactionEntity>();
  const reviews = new Table<ReviewEntity>();
  const returnRequests = new Table<ReturnRequestEntity>();
  const notifications = new Table<NotificationEntity>();
  const inventoryAdjustments = new Table<InventoryAdjustmentEntity>();
  const idempotencyRecords = new Table<IdempotencyRecordEntity>();
  const passwordResets = new Table<PasswordResetTokenEntity>();
  const auditLog = new Table<AuditLogEntity>();

  function cartFor(userId: string): CartEntity {
    const existing = carts.all().find((row) => row.userId === userId);
    if (existing) return existing;
    const created: CartEntity = { id: `cart_${userId}`, userId, items: [], createdAt: nowIso(), updatedAt: nowIso() };
    return carts.put(created);
  }

  const bundle: SeedBundle = {
    driver: 'memory',

    /**
     * M8: honest about what it is. A `Map` in one process has no rollback, so a
     * "transaction" here is a plain function call and `OrderService` keeps its
     * compensating writes instead of assuming all-or-nothing.
     */
    supportsTransactions: false,
    transact: async <T,>(work: (repos: RepositoryBundle) => Promise<T>): Promise<T> => work(bundle),

    // The in-memory driver is by definition always reachable; a ping exists to
    // prove that, not to prove a server round-trip.
    ping: async () => ({ ok: true, driver: 'memory' }),

    users: {
      findById: async (id) => users.get(id),
      findByEmail: async (email) => users.all().find((row) => row.email === email) ?? null,
      list: async () => users.all(),
      insert: async (user) => users.put(user),
      patch: async (id, patch) => users.patch(id, patch),
      addRole: async (id, role: Role) => {
        const user = users.get(id);
        if (!user) return null;
        if (user.roles.includes(role)) return user;
        return users.patch(id, { roles: [...user.roles, role] });
      },
      removeRole: async (id, role: Role) => {
        const user = users.get(id);
        if (!user) return null;
        if (!user.roles.includes(role)) return user;
        return users.patch(id, { roles: user.roles.filter((entry) => entry !== role) });
      },
    },

    sessions: {
      findByToken: async (token) => sessions.all().find((row) => row.token === token) ?? null,
      listForUser: async (userId) => sessions.all().filter((row) => row.userId === userId),
      insert: async (session) => sessions.put(session),
      deleteByToken: async (token) => {
        for (const row of sessions.all()) if (row.token === token) sessions.remove(row.id);
      },
      deleteForUser: async (userId, exceptToken) => {
        for (const row of sessions.all()) {
          if (row.userId === userId && row.token !== exceptToken) sessions.remove(row.id);
        }
      },
      deleteExpired: async (now) => {
        const stamp = new Date(now).getTime();
        const expired = sessions.all().filter((row) => new Date(row.expiresAt).getTime() < stamp);
        expired.forEach((row) => sessions.remove(row.id));
        return expired.length;
      },
    },

    categories: {
      findById: async (id) => categories.get(id),
      list: async () => categories.all().sort((a, b) => a.order - b.order),
      insert: async (category) => categories.put(category),
    },

    sellers: {
      findById: async (id) => sellers.get(id),
      findByUserId: async (userId) => sellers.all().find((row) => row.userId === userId) ?? null,
      list: async () => sellers.all(),
      listByStatus: async (status) => sellers.all().filter((row) => row.status === status),
      insert: async (seller) => sellers.put(seller),
      patch: async (id, patch) => sellers.patch(id, patch),
    },

    stores: {
      findById: async (id) => stores.get(id),
      findBySellerId: async (sellerId) => stores.all().find((row) => row.sellerId === sellerId) ?? null,
      list: async () => stores.all(),
      insert: async (store) => stores.put(store),
      patch: async (id, patch) => stores.patch(id, patch),
    },

    products: {
      findById: async (id) => products.get(id),
      query: async (query) => {
        const matched = applyProductQuery(products.all(), query);
        const offset = query.offset ?? 0;
        const limit = query.limit ?? matched.length;
        return matched.slice(offset, offset + limit);
      },
      count: async (query) => applyProductQuery(products.all(), query).length,
      insert: async (product) => products.put(product),
      patch: async (id, patch) => products.patch(id, patch),
      adjustStock: async (productId, delta, variantId) => {
        const product = products.get(productId);
        if (!product) return { ok: false, product: null };
        const updated: ProductEntity = { ...product, updatedAt: nowIso() };
        if (variantId) {
          const variant = updated.variants.find((entry) => entry.id === variantId);
          if (!variant) return { ok: false, product: null };
          const next = variant.stock + delta;
          if (next < 0) return { ok: false, product };
          updated.variants = updated.variants.map((entry) =>
            entry.id === variantId ? { ...entry, stock: next, updatedAt: nowIso() } : entry,
          );
        } else {
          const next = updated.stock + delta;
          if (next < 0) return { ok: false, product };
          updated.stock = next;
        }
        return { ok: true, product: products.put(updated) };
      },
    },

    carts: {
      findByUserId: async (userId) => carts.all().find((row) => row.userId === userId) ?? null,
      upsert: async (cart) => carts.put(cart),
      addItem: async (userId, item: CartItemEntity) => {
        const cart = cartFor(userId);
        const next: CartEntity = {
          ...cart,
          items: [...cart.items, item],
          updatedAt: nowIso(),
        };
        return carts.put(next);
      },
      patchItem: async (userId, itemId, patch) => {
        const cart = cartFor(userId);
        const item = cart.items.find((entry) => entry.id === itemId);
        if (!item) return { cart, item: null };
        const updatedItem: CartItemEntity = { ...item, ...patch, id: item.id, updatedAt: nowIso() };
        const next: CartEntity = {
          ...cart,
          items: cart.items.map((entry) => (entry.id === itemId ? updatedItem : entry)),
          updatedAt: nowIso(),
        };
        return { cart: carts.put(next), item: updatedItem };
      },
      removeItem: async (userId, itemId) => {
        const cart = cartFor(userId);
        const next: CartEntity = {
          ...cart,
          items: cart.items.filter((entry) => entry.id !== itemId),
          updatedAt: nowIso(),
        };
        return carts.put(next);
      },
      clearSelected: async (userId) => {
        const cart = cartFor(userId);
        const next: CartEntity = {
          ...cart,
          items: cart.items.filter((entry) => !entry.selected),
          updatedAt: nowIso(),
        };
        return carts.put(next);
      },
    },

    wishlists: {
      findByUserId: async (userId) => wishlists.all().find((row) => row.userId === userId) ?? null,
      upsert: async (wishlist) => wishlists.put(wishlist),
    },

    addresses: {
      listForUser: async (userId) => addresses.all().filter((row) => row.userId === userId),
      findById: async (id) => addresses.get(id),
      insert: async (address) => addresses.put(address),
      patch: async (id, patch) => addresses.patch(id, patch),
      remove: async (id) => addresses.remove(id),
    },

    vouchers: {
      findByCode: async (code) =>
        vouchers.all().find((row) => row.code.toLowerCase() === code.toLowerCase()) ?? null,
      findById: async (id) => vouchers.get(id),
      list: async () => vouchers.all(),
      insert: async (voucher) => vouchers.put(voucher),
      patch: async (id, patch) => vouchers.patch(id, patch),
      markUsed: async (id, userId, atIso) => {
        const voucher = vouchers.get(id);
        if (!voucher) return null;
        const perUserUsed = { ...voucher.perUserUsed };
        if (userId) perUserUsed[userId] = (perUserUsed[userId] ?? 0) + 1;
        return vouchers.patch(id, { usageCount: voucher.usageCount + 1, perUserUsed, updatedAt: atIso });
      },
    },

    promotions: {
      findById: async (id) => promotions.get(id),
      list: async () => promotions.all(),
      insert: async (promotion) => promotions.put(promotion),
    },

    orders: {
      findById: async (id) => orders.get(id),
      findByCode: async (code) => orders.all().find((row) => row.orderCode === code) ?? null,
      listForCustomer: async (customerId) =>
        // Sorted newest-first to match the Mongo driver, which relies on the index.
        orders
          .all()
          .filter((row) => row.customerId === customerId)
          .sort((a, b) => b.placedAt.localeCompare(a.placedAt)),

      insert: async (order) => orders.put(order),
      patch: async (id, patch) => orders.patch(id, patch),
      delete: async (id) => orders.remove(id),
    },

    sellerOrders: {
      findById: async (id) => sellerOrders.get(id),
      listForSeller: async (sellerId) =>
        // Sorted newest-first to match the Mongo driver.
        sellerOrders
          .all()
          .filter((row) => row.sellerId === sellerId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

      listForOrder: async (orderId) => sellerOrders.all().filter((row) => row.orderId === orderId),
      insert: async (sellerOrder) => sellerOrders.put(sellerOrder),
      patch: async (id, patch) => sellerOrders.patch(id, patch),
      delete: async (id) => sellerOrders.remove(id),
    },

    payments: {
      listForOrder: async (orderId) => payments.all().filter((row) => row.orderId === orderId),
      insert: async (transaction) => payments.put(transaction),
      patch: async (id, patch) => payments.patch(id, patch),
      delete: async (id) => payments.remove(id),
    },

    reviews: {
      findById: async (id) => reviews.get(id),
      listForProduct: async (productId) => reviews.all().filter((row) => row.productId === productId),
      listForSeller: async (sellerId) => reviews.all().filter((row) => row.sellerId === sellerId),
      listForUser: async (userId) => reviews.all().filter((row) => row.userId === userId),
      insert: async (review) => reviews.put(review),
      patch: async (id, patch) => reviews.patch(id, patch),
    },

    returnRequests: {
      findById: async (id) => returnRequests.get(id),
      listForUser: async (userId) => returnRequests.all().filter((row) => row.userId === userId),
      listForSeller: async (sellerId) => returnRequests.all().filter((row) => row.sellerId === sellerId),
      insert: async (request) => returnRequests.put(request),
      patch: async (id, patch) => returnRequests.patch(id, patch),
    },

    notifications: {
      listForUser: async (userId) => notifications.all().filter((row) => row.userId === userId),
      insert: async (notification) => notifications.put(notification),
      patch: async (id, patch) => notifications.patch(id, patch),
    },

    inventoryAdjustments: {
      listForProduct: async (productId) =>
        inventoryAdjustments.all().filter((row) => row.productId === productId),
      listForSeller: async (sellerId) =>
        inventoryAdjustments.all().filter((row) => row.sellerId === sellerId),
      insert: async (adjustment) => inventoryAdjustments.put(adjustment),
      deleteForReference: async (referenceId) => {
        const stale = inventoryAdjustments.all().filter((row) => row.referenceId === referenceId);
        for (const row of stale) inventoryAdjustments.remove(row.id);
        return stale.length;
      },
    },

    // ------------------------------------------------------------------ M8
    idempotency: {
      find: async (scope, ownerId, key) =>
        idempotencyRecords
          .all()
          .find((row) => row.scope === scope && row.ownerId === ownerId && row.key === key) ?? null,
      // Insert-only, matching the Mongo driver's unique-index claim: if a record
      // already exists the caller loses the race and must replay or reject.
      claim: async (record) => {
        const existing = idempotencyRecords
          .all()
          .find((row) => row.scope === record.scope && row.ownerId === record.ownerId && row.key === record.key);
        if (existing) return null;
        return idempotencyRecords.put(record);
      },
      complete: async (scope, ownerId, key, patch: { state: IdempotencyState; resourceId?: string; responseStatus?: number }) => {
        const record = idempotencyRecords
          .all()
          .find((row) => row.scope === scope && row.ownerId === ownerId && row.key === key);
        if (!record) return null;
        return idempotencyRecords.patch(record.id, patch);
      },
      release: async (scope, ownerId, key) => {
        const record = idempotencyRecords
          .all()
          .find((row) => row.scope === scope && row.ownerId === ownerId && row.key === key);
        if (!record || record.state === 'completed') return false;
        return idempotencyRecords.remove(record.id);
      },
      deleteExpired: async (now) => {
        const stamp = new Date(now).getTime();
        const stale = idempotencyRecords.all().filter((row) => new Date(row.expiresAt).getTime() < stamp);
        stale.forEach((row) => idempotencyRecords.remove(row.id));
        return stale.length;
      },
    },

    passwordResets: {
      findByTokenHash: async (tokenHash) => passwordResets.all().find((row) => row.tokenHash === tokenHash) ?? null,
      insert: async (token) => passwordResets.put(token),
      // Single-use: an already-used row is returned unchanged, never restamped.
      markUsed: async (id, atIso) => {
        const token = passwordResets.get(id);
        if (!token || token.usedAt) return token;
        return passwordResets.patch(id, { usedAt: atIso });
      },
      deleteForUser: async (userId) => {
        const stale = passwordResets.all().filter((row) => row.userId === userId);
        stale.forEach((row) => passwordResets.remove(row.id));
        return stale.length;
      },
      deleteExpired: async (now) => {
        const stamp = new Date(now).getTime();
        const stale = passwordResets.all().filter((row) => new Date(row.expiresAt).getTime() < stamp);
        stale.forEach((row) => passwordResets.remove(row.id));
        return stale.length;
      },
    },

    audit: {
      insert: async (entry) => auditLog.put(entry),
      listForSubject: async (subjectType, subjectId) =>
        auditLog.all().filter((row) => row.subjectType === subjectType && row.subjectId === subjectId),
    },

    clear: async () => {
      for (const table of [
        users,
        sessions,
        categories,
        sellers,
        stores,
        products,
        carts,
        wishlists,
        addresses,
        vouchers,
        promotions,
        orders,
        sellerOrders,
        payments,
        reviews,
        returnRequests,
        notifications,
        inventoryAdjustments,
        idempotencyRecords,
        passwordResets,
        auditLog,
      ]) {
        table.clear();
      }
    },
  };

  return bundle;
}
