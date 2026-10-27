/**
 * MongoDB driver for the repository bundle (M7-D / M7-E / M8-C).
 *
 * A thin, explicit mapper layer: no service imports these models directly, and
 * the entities returned are the same plain objects the in-memory driver returns,
 * which is what keeps the two drivers interchangeable.
 *
 * M8 — session plumbing. `createMongoRepositories(session?)` produces either the
 * process-wide bundle or a bundle bound to one `ClientSession`. Every read and
 * write in the file routes through `withSession` / `sessionOptions`, so the
 * *only* difference between a transactional checkout and a non-transactional one
 * is which bundle `OrderService` was handed. That is what makes "all of it, or
 * none of it" a property of the code rather than of each call site remembering
 * to pass a session.
 */
import mongoose, { type ClientSession } from 'mongoose';
import { config } from '../../config/env';
import { nowIso } from '../../lib/identity';
import {
  AddressModel,
  AuditLogModel,
  CartModel,
  CategoryModel,
  IdempotencyRecordModel,
  InventoryAdjustmentModel,
  NotificationModel,
  OrderModel,
  PasswordResetTokenModel,
  PaymentModel,
  ProductModel,
  PromotionModel,
  ReturnRequestModel,
  ReviewModel,
  SellerModel,
  SellerOrderModel,
  SessionModel,
  StoreModel,
  UserModel,
  VoucherModel,
  WishlistModel,
} from '../../db/mongo-models';
import type { ProductQuery, RepositoryBundle } from '../contracts';
import type {
  AddressEntity,
  AuditLogEntity,
  CartEntity,
  CartItemEntity,
  CategoryEntity,
  IdempotencyRecordEntity,
  IdempotencyState,  InventoryAdjustmentEntity,
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

type Doc = Record<string, unknown>;

/** Duplicate-key violation. The idempotency claim relies on it. */
const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: number }).code === DUPLICATE_KEY;
}

function map(value: unknown): any {
  if (Array.isArray(value)) return value.map((entry) => map(entry));
  if (value instanceof Map) return Object.fromEntries(value.entries());
  // A Date is an object, and `Object.entries(date)` is empty, so without this it
  // would be rewritten to `{}` on every read — silently turning a session's
  // `expiresAt` into an empty object that compares as never-expiring.
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const source = value as Doc;
    const out: Doc = {};
    for (const [key, entry] of Object.entries(source)) {
      if (key === '_id') {
        out.id = entry;
        continue;
      }
      if (key === '__v' || entry === undefined) continue;
      out[key] = map(entry);
    }
    return out;
  }
  return value;
}

function entity<T>(doc: unknown): T | null {
  if (!doc) return null;
  return map(doc) as T;
}

function entities<T>(docs: unknown[]): T[] {
  return docs.map((doc) => map(doc) as T);
}

/**
 * The inverse of `map`, for writes.
 *
 * Only the *top level* `id` becomes `_id`, because only top-level documents have a
 * MongoDB primary key — nested objects store their id in an `id` field (see the
 * sub-schema note in `mongo-models`). Without this, every insert failed schema
 * validation with "_id is required", because entities carry `id`.
 */
function toDoc(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((entry) => toDoc(entry, depth + 1));
  if (value instanceof Date || value instanceof Map) return value;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      if (depth === 0 && key === 'id') {
        out._id = entry;
        continue;
      }
      out[key] = toDoc(entry, depth + 1);
    }
    return out;
  }
  return value;
}

function filterForProductQuery(query: ProductQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.sellerId) filter.sellerId = query.sellerId;
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.statuses && query.statuses.length > 0) filter.status = { $in: query.statuses };
  if (query.search) {
    const needle = new RegExp(escapeRegExp(query.search), 'i');
    filter.$or = [{ name: needle }, { brand: needle }, { sku: needle }];
  }
  return filter;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withMeta<T extends { createdAt: string; updatedAt: string }>(value: T, now: string): T {
  return { ...value, updatedAt: now };
}

/**
 * M8: the connection state a checkout must satisfy before it may claim
 * all-or-nothing semantics. A standalone `mongod` cannot start a transaction, so
 * this is reported as an explicit degradation rather than discovered at commit
 * time as an error.
 */
export function mongoTransactionCapability(): { capable: boolean; reason?: string; replicaSet?: string } {
  const connection = mongoose.connection;
  if (!connection.readyState) return { capable: false, reason: 'not connected' };
  const topology = (connection as unknown as { client?: { topology?: { description?: { setName?: string } } } }).client
    ?.topology?.description;
  const replicaSet = topology?.setName;
  if (!replicaSet) {
    return {
      capable: false,
      reason: 'connected to a standalone mongod; multi-document transactions require a replica set or sharded cluster',
    };
  }
  return { capable: true, replicaSet };
}

export function createMongoRepositories(session?: ClientSession): RepositoryBundle {
  /** Attach the ambient session to a query, if this bundle has one. */
  const withSession = <T extends { session(value: ClientSession): T }>(query: T): T =>
    session ? query.session(session) : query;

  /** Merge the ambient session into an options object for writes. */
  const sessionOptions = <T extends Record<string, unknown>>(extra?: T): T & { session?: ClientSession } =>
    session ? ({ ...(extra ?? ({} as T)), session } as T & { session?: ClientSession }) : (extra ?? ({} as T));

  /** `create` needs the array form whenever a session is attached. */
  const createOne = async <T>(
    model: { create: (docs: unknown[], options?: Record<string, unknown>) => Promise<unknown[]> },
    doc: T,
  ): Promise<T> => {
    const created = await model.create([toDoc(doc)], sessionOptions());
    return created[0] as T;
  };

  const bundle: RepositoryBundle = {
    driver: 'mongo',

    /**
     * M8: the Mongo driver can genuinely roll back, so services are allowed to
     * use `transact` and skip compensating writes. The flag is computed from the
     * live topology, not from a setting, so a standalone deployment cannot claim
     * an atomicity it does not have.
     */
    supportsTransactions: config.transactionsEnabled && mongoTransactionCapability().capable,

    /**
     * M8: real multi-document transaction. The work function receives a bundle
     * bound to this session, so every repository call it makes is inside the
     * transaction; a throw (including one raised by a business rule) aborts the
     * whole unit. Transient errors are retried by the driver, which is why the
     * work function must not carry state across attempts.
     */
    transact: async <T,>(work: (repos: RepositoryBundle) => Promise<T>): Promise<T> => {
      if (!bundle.supportsTransactions) {
        throw new Error(
          'This deployment cannot run a multi-document transaction. Start the API against a replica set, or set MONGO_TRANSACTIONS=false so services use compensating writes.',
        );
      }
      const active = await mongoose.startSession();
      try {
        let outcome: T | undefined;
        await active.withTransaction(async () => {
          outcome = await work(createMongoRepositories(active));
        });
        return outcome as T;
      } finally {
        await active.endSession();
      }
    },

    ping: async () => {
      try {
        await mongoose.connection.db?.admin().command({ ping: 1 });
        return { ok: true, driver: 'mongo' };
      } catch (error) {
        return { ok: false, driver: 'mongo', detail: error instanceof Error ? error.message : 'ping failed' };
      }
    },

    users: {
      findById: async (id) => entity<UserEntity>(await withSession(UserModel.findById(id)).lean()),
      findByEmail: async (email) => entity<UserEntity>(await withSession(UserModel.findOne({ email })).lean()),
      list: async () => entities<UserEntity>(await withSession(UserModel.find()).lean()),
      insert: async (user) => createOne(UserModel, user),
      patch: async (id, patch) =>
        entity<UserEntity>(
          await withSession(UserModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
      addRole: async (id, role: Role) => {
        const user = entity<UserEntity>(await withSession(UserModel.findById(id)).lean());
        if (!user) return null;
        if (user.roles.includes(role)) return user;
        return entity<UserEntity>(
          await withSession(
            UserModel.findByIdAndUpdate(id, { $set: { roles: [...user.roles, role], updatedAt: nowIso() } }, sessionOptions({ new: true })),
          ).lean(),
        );
      },
      /**
       * M8. `$pull` rather than a read-modify-write, so two concurrent removals
       * cannot clobber a role that was granted in between — the same reason
       * `addRole` is idempotent.
       */
      removeRole: async (id, role: Role) => {
        const user = entity<UserEntity>(await withSession(UserModel.findById(id)).lean());
        if (!user) return null;
        if (!user.roles.includes(role)) return user;
        return entity<UserEntity>(
          await withSession(
            UserModel.findByIdAndUpdate(id, { $pull: { roles: role }, $set: { updatedAt: nowIso() } }, sessionOptions({ new: true })),
          ).lean(),
        );
      },
    },

    sessions: {
      findByToken: async (token) => entity<SessionEntity>(await withSession(SessionModel.findOne({ token })).lean()),
      listForUser: async (userId) => entities<SessionEntity>(await withSession(SessionModel.find({ userId })).lean()),
      insert: async (newSession) => createOne(SessionModel, newSession),
      deleteByToken: async (token) => {
        await withSession(SessionModel.deleteMany({ token })).exec();
      },
      deleteForUser: async (userId, exceptToken) => {
        const filter: Record<string, unknown> = { userId };
        if (exceptToken) filter.token = { $ne: exceptToken };
        await withSession(SessionModel.deleteMany(filter)).exec();
      },
      deleteExpired: async (now) => {
        const result = await withSession(SessionModel.deleteMany({ expiresAt: { $lt: now } })).exec();
        return result.deletedCount ?? 0;
      },
    },

    categories: {
      findById: async (id) => entity<CategoryEntity>(await withSession(CategoryModel.findById(id)).lean()),
      list: async () => entities<CategoryEntity>(await withSession(CategoryModel.find().sort({ order: 1 })).lean()),
      insert: async (category) => createOne(CategoryModel, category),
    },

    sellers: {
      findById: async (id) => entity<SellerProfileEntity>(await withSession(SellerModel.findById(id)).lean()),
      findByUserId: async (userId) => entity<SellerProfileEntity>(await withSession(SellerModel.findOne({ userId })).lean()),
      list: async () => entities<SellerProfileEntity>(await withSession(SellerModel.find()).lean()),
      listByStatus: async (status) =>
        entities<SellerProfileEntity>(await withSession(SellerModel.find({ status })).lean()),
      insert: async (seller) => createOne(SellerModel, seller),
      patch: async (id, patch) =>
        entity<SellerProfileEntity>(
          await withSession(SellerModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
    },

    stores: {
      findById: async (id) => entity<StoreEntity>(await withSession(StoreModel.findById(id)).lean()),
      findBySellerId: async (sellerId) => entity<StoreEntity>(await withSession(StoreModel.findOne({ sellerId })).lean()),
      list: async () => entities<StoreEntity>(await withSession(StoreModel.find()).lean()),
      insert: async (store) => createOne(StoreModel, store),
      patch: async (id, patch) =>
        entity<StoreEntity>(
          await withSession(StoreModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
    },

    products: {
      findById: async (id) => entity<ProductEntity>(await withSession(ProductModel.findById(id)).lean()),
      query: async (query) => {
        const skip = query.offset ?? 0;
        const limit = query.limit ?? 50;
        return entities<ProductEntity>(
          await withSession(ProductModel.find(filterForProductQuery(query)).skip(skip).limit(limit)).lean(),
        );
      },
      count: async (query) => withSession(ProductModel.countDocuments(filterForProductQuery(query))).exec(),
      insert: async (product) => createOne(ProductModel, product),
      patch: async (id, patch) =>
        entity<ProductEntity>(
          await withSession(ProductModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
      /**
       * Conditional decrement: the update only matches while stock is still
       * sufficient, so two concurrent checkouts cannot both take the last unit.
       * Inside a transaction this participates in the same atomic unit as the
       * order write; outside one it is still a single atomic document update.
       */
      adjustStock: async (productId, delta, variantId) => {
        const now = nowIso();
        if (variantId) {
          const result = await withSession(
            ProductModel.findOneAndUpdate(
              { _id: productId, variants: { $elemMatch: { _id: variantId, stock: { $gte: -delta } } } },
              { $inc: { 'variants.$[variant].stock': delta }, $set: { updatedAt: now } },
              sessionOptions({ new: true, arrayFilters: [{ 'variant._id': variantId }] }),
            ),
          ).lean();
          return { ok: Boolean(result), product: entity<ProductEntity>(result) };
        }
        const result = await withSession(
          ProductModel.findOneAndUpdate(
            { _id: productId, stock: { $gte: -delta } },
            { $inc: { stock: delta }, $set: { updatedAt: now } },
            sessionOptions({ new: true }),
          ),
        ).lean();
        return { ok: Boolean(result), product: entity<ProductEntity>(result) };
      },
    },

    carts: {
      findByUserId: async (userId) => entity<CartEntity>(await withSession(CartModel.findOne({ userId })).lean()),
      upsert: async (cart) => {
        await withSession(CartModel.findByIdAndUpdate(cart.id, { $set: cart }, sessionOptions({ upsert: true }))).exec();
        return cart;
      },
      addItem: async (userId, item: CartItemEntity) => {
        const existing = entity<CartEntity>(await withSession(CartModel.findOne({ userId })).lean());
        const cart: CartEntity = existing ?? {
          id: `cart_${userId}`,
          userId,
          items: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        const next: CartEntity = { ...cart, items: [...cart.items, item], updatedAt: nowIso() };
        await withSession(CartModel.findByIdAndUpdate(cart.id, { $set: next }, sessionOptions({ upsert: true }))).exec();
        return next;
      },
      patchItem: async (userId, itemId, patch) => {
        const cart = entity<CartEntity>(await withSession(CartModel.findOne({ userId })).lean());
        if (!cart) return { cart: null, item: null };
        const item = cart.items.find((entry) => entry.id === itemId);
        if (!item) return { cart, item: null };
        const updatedItem: CartItemEntity = { ...item, ...patch, id: item.id, updatedAt: nowIso() };
        const next: CartEntity = {
          ...cart,
          items: cart.items.map((entry) => (entry.id === itemId ? updatedItem : entry)),
          updatedAt: nowIso(),
        };
        await withSession(CartModel.findByIdAndUpdate(cart.id, { $set: next })).exec();
        return { cart: next, item: updatedItem };
      },
      removeItem: async (userId, itemId) => {
        const cart = entity<CartEntity>(await withSession(CartModel.findOne({ userId })).lean());
        if (!cart) return null;
        const next: CartEntity = {
          ...cart,
          items: cart.items.filter((entry) => entry.id !== itemId),
          updatedAt: nowIso(),
        };
        await withSession(CartModel.findByIdAndUpdate(cart.id, { $set: next })).exec();
        return next;
      },
      clearSelected: async (userId) => {
        const cart = entity<CartEntity>(await withSession(CartModel.findOne({ userId })).lean());
        if (!cart) return null;
        const remaining = cart.items.filter((entry) => !entry.selected);
        // Only the two fields that change are sent. `$set`-ing the whole mapped
        // entity would also send `id`, which strict mode drops — a write that looks
        // like it works because the mistake is invisible, not because it is right.
        await withSession(
          CartModel.findByIdAndUpdate(cart.id, { $set: { items: remaining, updatedAt: nowIso() } }, sessionOptions()),
        ).exec();
        return { ...cart, items: remaining, updatedAt: nowIso() };
      },
    },

    wishlists: {
      findByUserId: async (userId) => entity<WishlistEntity>(await withSession(WishlistModel.findOne({ userId })).lean()),
      upsert: async (wishlist) => {
        await withSession(WishlistModel.findByIdAndUpdate(wishlist.id, { $set: wishlist }, sessionOptions({ upsert: true }))).exec();
        return wishlist;
      },
    },

    addresses: {
      listForUser: async (userId) => entities<AddressEntity>(await withSession(AddressModel.find({ userId })).lean()),
      findById: async (id) => entity<AddressEntity>(await withSession(AddressModel.findById(id)).lean()),
      insert: async (address) => createOne(AddressModel, address),
      patch: async (id, patch) =>
        entity<AddressEntity>(
          await withSession(AddressModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
      remove: async (id) => {
        const result = await withSession(AddressModel.deleteOne({ _id: id })).exec();
        return (result.deletedCount ?? 0) > 0;
      },
    },

    vouchers: {
      findByCode: async (code) => entity<VoucherEntity>(await withSession(VoucherModel.findOne({ code })).lean()),
      findById: async (id) => entity<VoucherEntity>(await withSession(VoucherModel.findById(id)).lean()),
      list: async () => entities<VoucherEntity>(await withSession(VoucherModel.find()).lean()),
      insert: async (voucher) => createOne(VoucherModel, voucher),
      patch: async (id, patch) =>
        entity<VoucherEntity>(
          await withSession(
            VoucherModel.findByIdAndUpdate(id, { $set: withMeta(patch as VoucherEntity, nowIso()) }, sessionOptions({ new: true })),
          ).lean(),
        ),
      markUsed: async (id, userId, atIso) => {
        const update: Record<string, unknown> = { $inc: { usageCount: 1 }, $set: { updatedAt: atIso } };
        if (userId) update.$inc = { usageCount: 1, [`perUserUsed.${userId}`]: 1 };
        return entity<VoucherEntity>(
          await withSession(VoucherModel.findByIdAndUpdate(id, update, sessionOptions({ new: true }))).lean(),
        );
      },
    },

    promotions: {
      findById: async (id) => entity<PromotionEntity>(await withSession(PromotionModel.findById(id)).lean()),
      list: async () => entities<PromotionEntity>(await withSession(PromotionModel.find()).lean()),
      insert: async (promotion) => createOne(PromotionModel, promotion),
    },

    orders: {
      findById: async (id) => entity<OrderEntity>(await withSession(OrderModel.findById(id)).lean()),
      findByCode: async (code) => entity<OrderEntity>(await withSession(OrderModel.findOne({ orderCode: code })).lean()),
      listForCustomer: async (customerId) =>
        entities<OrderEntity>(await withSession(OrderModel.find({ customerId }).sort({ placedAt: -1 })).lean()),
      insert: async (order) => createOne(OrderModel, order),
      patch: async (id, patch) =>
        entity<OrderEntity>(
          await withSession(OrderModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
      delete: async (id) => ((await withSession(OrderModel.deleteOne({ _id: id })).exec()).deletedCount ?? 0) > 0,
    },

    sellerOrders: {
      findById: async (id) => entity<SellerOrderEntity>(await withSession(SellerOrderModel.findById(id)).lean()),
      listForSeller: async (sellerId) =>
        entities<SellerOrderEntity>(await withSession(SellerOrderModel.find({ sellerId }).sort({ createdAt: -1 })).lean()),
      listForOrder: async (orderId) => entities<SellerOrderEntity>(await withSession(SellerOrderModel.find({ orderId })).lean()),
      insert: async (sellerOrder) => createOne(SellerOrderModel, sellerOrder),
      patch: async (id, patch) =>
        entity<SellerOrderEntity>(
          await withSession(
            SellerOrderModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true })),
          ).lean(),
        ),
      delete: async (id) => ((await withSession(SellerOrderModel.deleteOne({ _id: id })).exec()).deletedCount ?? 0) > 0,
    },

    payments: {
      listForOrder: async (orderId) => entities<PaymentTransactionEntity>(await withSession(PaymentModel.find({ orderId })).lean()),
      insert: async (transaction) => createOne(PaymentModel, transaction),
      patch: async (id, patch) =>
        entity<PaymentTransactionEntity>(
          await withSession(PaymentModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
      delete: async (id) => ((await withSession(PaymentModel.deleteOne({ _id: id })).exec()).deletedCount ?? 0) > 0,
    },

    reviews: {
      findById: async (id) => entity<ReviewEntity>(await withSession(ReviewModel.findById(id)).lean()),
      listForProduct: async (productId) => entities<ReviewEntity>(await withSession(ReviewModel.find({ productId })).lean()),
      listForSeller: async (sellerId) => entities<ReviewEntity>(await withSession(ReviewModel.find({ sellerId })).lean()),
      listForUser: async (userId) => entities<ReviewEntity>(await withSession(ReviewModel.find({ userId })).lean()),
      insert: async (review) => createOne(ReviewModel, review),
      patch: async (id, patch) =>
        entity<ReviewEntity>(
          await withSession(ReviewModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
    },

    returnRequests: {
      findById: async (id) => entity<ReturnRequestEntity>(await withSession(ReturnRequestModel.findById(id)).lean()),
      listForUser: async (userId) => entities<ReturnRequestEntity>(await withSession(ReturnRequestModel.find({ userId })).lean()),
      listForSeller: async (sellerId) => entities<ReturnRequestEntity>(await withSession(ReturnRequestModel.find({ sellerId })).lean()),
      insert: async (request) => createOne(ReturnRequestModel, request),
      patch: async (id, patch) =>
        entity<ReturnRequestEntity>(
          await withSession(ReturnRequestModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
    },

    notifications: {
      listForUser: async (userId) => entities<NotificationEntity>(await withSession(NotificationModel.find({ userId }).sort({ createdAt: -1 })).lean()),
      insert: async (notification) => createOne(NotificationModel, notification),
      patch: async (id, patch) =>
        entity<NotificationEntity>(
          await withSession(NotificationModel.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true }))).lean(),
        ),
    },

    inventoryAdjustments: {
      listForProduct: async (productId) => entities<InventoryAdjustmentEntity>(await withSession(InventoryAdjustmentModel.find({ productId })).lean()),
      listForSeller: async (sellerId) => entities<InventoryAdjustmentEntity>(await withSession(InventoryAdjustmentModel.find({ sellerId })).lean()),
      insert: async (adjustment) => createOne(InventoryAdjustmentModel, adjustment),
      deleteForReference: async (referenceId) =>
        (await withSession(InventoryAdjustmentModel.deleteMany({ referenceId })).exec()).deletedCount ?? 0,
    },

    // ------------------------------------------------------------------ M8
    idempotency: {
      find: async (scope, ownerId, key) =>
        entity<IdempotencyRecordEntity>(await withSession(IdempotencyRecordModel.findOne({ scope, ownerId, key })).lean()),
      /**
       * The mutual-exclusion primitive. A duplicate key means another writer (or
       * another process) already owns this key, so this returns `null` instead of
       * overwriting it.
       */
      claim: async (record) => {
        try {
          return await createOne(IdempotencyRecordModel, record);
        } catch (error) {
          if (isDuplicateKey(error)) return null;
          throw error;
        }
      },
      complete: async (scope, ownerId, key, patch: { state: IdempotencyState; resourceId?: string; responseStatus?: number }) =>
        entity<IdempotencyRecordEntity>(
          await withSession(
            IdempotencyRecordModel.findOneAndUpdate({ scope, ownerId, key }, { $set: { ...patch, updatedAt: nowIso() } }, sessionOptions({ new: true })),
          ).lean(),
        ),
      release: async (scope, ownerId, key) => {
        const result = await withSession(
          IdempotencyRecordModel.deleteOne({ scope, ownerId, key, state: { $ne: 'completed' } }),
        ).exec();
        return (result.deletedCount ?? 0) > 0;
      },
      deleteExpired: async (now) => (await withSession(IdempotencyRecordModel.deleteMany({ expiresAt: { $lt: now } })).exec()).deletedCount ?? 0,
    },

    passwordResets: {
      findByTokenHash: async (tokenHash) =>
        entity<PasswordResetTokenEntity>(await withSession(PasswordResetTokenModel.findOne({ tokenHash })).lean()),
      insert: async (token) => createOne(PasswordResetTokenModel, token),
      // Only ever stamps a row that has not been used, so a replayed confirm
      // cannot revive a spent token.
      markUsed: async (id, atIso) =>
        entity<PasswordResetTokenEntity>(
          await withSession(PasswordResetTokenModel.findOneAndUpdate({ _id: id, usedAt: null }, { $set: { usedAt: atIso, updatedAt: atIso } }, sessionOptions({ new: true }))).lean(),
        ),
      deleteForUser: async (userId) => (await withSession(PasswordResetTokenModel.deleteMany({ userId })).exec()).deletedCount ?? 0,
      deleteExpired: async (now) => (await withSession(PasswordResetTokenModel.deleteMany({ expiresAt: { $lt: now } })).exec()).deletedCount ?? 0,
    },

    audit: {
      insert: async (entry) => createOne(AuditLogModel, entry),
      listForSubject: async (subjectType, subjectId) =>
        entities<AuditLogEntity>(await withSession(AuditLogModel.find({ subjectType, subjectId })).lean()),
    },
  };

  return bundle;
}
