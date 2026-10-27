/**
 * MongoDB/Mongoose schemas (M7-D, corrected in M8).
 *
 * A *top-level* document's primary key is the app's prefixed string id
 * (`usr_…`, `ord_…`), stored in MongoDB's own `_id`, so a document written by the
 * API and one written by the device seed are the same kind of record and
 * cross-references need no mapping. The driver converts between `id` and `_id` on
 * the way in and out (`toDoc` / `map` in `mongo-repositories`).
 *
 * *Nested* objects are different. They keep their id in a plain `id` field and
 * have no MongoDB `_id` at all, because the app addresses them inside their parent
 * document. Declaring a required `_id` on them, as M7 did, contradicted
 * `{ _id: false }` and made every insert of a document containing one fail schema
 * validation — a defect the in-memory driver could not surface, since it never
 * validates anything.
 */
import mongoose, { Schema } from 'mongoose';

const id = { _id: { type: String, required: true } };
const stamps = {
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
};
/** The nested-id shape: an app-level `id`, stored verbatim, with no Mongo `_id`. */
const nestedId = { id: { type: String, required: true } };

const bankSchema = new Schema(
  {
    // A bank block is a value, not an entity: it is addressed as
    // `seller.bank.bankName`, so it carries no id of any kind.
    bankName: { type: String, required: true },
    accountName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    branch: { type: String },
  },
  { _id: false },
);

const agreementSchema = new Schema(
  {
    marketplaceTerms: { type: Boolean, default: false },
    sellerPolicies: { type: Boolean, default: false },
    productAuthenticity: { type: Boolean, default: false },
    fulfillmentResponsibility: { type: Boolean, default: false },
  },
  { _id: false },
);

const variantSchema = new Schema(
  {
    ...nestedId,
    productId: { type: String, required: true },
    sku: { type: String, required: true },
    attributes: { type: Map, of: String, default: {} },
    price: { type: Number, required: true },
    compareAtPrice: { type: Number },
    stock: { type: Number, required: true },
    image: { type: String },
    ...stamps,
  },
  { _id: false },
);

const cartItemSchema = new Schema(
  {
    ...nestedId,
    productId: { type: String, required: true },
    sellerId: { type: String, required: true },
    variantId: { type: String },
    variantAttributes: { type: Map, of: String },
    quantity: { type: Number, required: true },
    selected: { type: Boolean, default: true },
    priceSnapshot: { type: Number, required: true },
    addedAt: { type: String, required: true },
    updatedAt: { type: String },
  },
  { _id: false },
);

const addressSchema = new Schema(
  {
    ...nestedId,
    userId: { type: String, required: true },
    label: { type: String, required: true },
    recipientName: { type: String, required: true },
    phone: { type: String, required: true },
    division: { type: String, required: true },
    district: { type: String, required: true },
    area: { type: String, required: true },
    addressLine: { type: String, required: true },
    postalCode: { type: String, required: true },
    instructions: { type: String },
    isDefault: { type: Boolean, default: false },
    ...stamps,
  },
  { _id: false },
);

const orderItemSnapshotSchema = new Schema(
  {
    ...nestedId,
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    brand: { type: String, default: '' },
    image: { type: String, default: '' },
    variantAttributes: { type: Map, of: String },
    unitPrice: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    quantity: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    status: { type: String, default: 'pending' },
    reviewId: { type: String, default: null },
    hasReview: { type: Boolean, default: false },
    returnRequestId: { type: String, default: null },
  },
  { _id: false },
);

const shippingAddressSchema = new Schema(
  {
    /**
     * A snapshot of the address the customer *typed at checkout*, not a stored
     * `AddressEntity`. It therefore carries no `id` and no timestamps, and using
     * `addressSchema` here made every checkout fail validation for a field the
     * client never sends.
     */
    label: String,
    recipientName: { type: String, required: true },
    phone: { type: String, required: true },
    division: { type: String, required: true },
    district: { type: String, required: true },
    area: { type: String, required: true },
    addressLine: { type: String, required: true },
    postalCode: { type: String, required: true },
    instructions: String,
    isDefault: { type: Boolean, default: false },
  },
  { _id: false },
);

const timelineSchema = new Schema(
  {
    // A timeline entry is a value in a sequence, never addressed on its own.
    status: { type: String, required: true },
    at: { type: String, required: true },
  },
  { _id: false },
);

const sellerReplySchema = new Schema(
  {
    // As above: a single optional reply value, not an entity.
    text: { type: String, required: true },
    at: { type: String, required: true },
  },
  { _id: false },
);

export const UserModel = mongoose.models.User ?? mongoose.model('User', new Schema({ ...id, name: String, email: { type: String, unique: true, index: true }, phone: String, passwordHash: { type: String, required: true }, avatar: String, roles: { type: [String], default: ['customer'] }, ...stamps }));

export const SessionModel = mongoose.models.Session ?? mongoose.model('Session', new Schema({ ...id, userId: { type: String, index: true }, token: { type: String, unique: true, index: true }, expiresAt: { type: Date, required: true }, ...stamps }).index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'session_ttl' }));

export const CategoryModel = mongoose.models.Category ?? mongoose.model('Category', new Schema({ ...id, name: String, icon: String, image: String, parentId: { type: String, default: null, index: true }, order: { type: Number, default: 0 }, ...stamps }));

export const SellerModel = mongoose.models.Seller ?? mongoose.model('Seller', new Schema({ ...id, userId: { type: String, unique: true, index: true }, storeId: { type: String, index: true }, fullName: String, phone: String, email: String, nationalId: String, sellerType: { type: String, default: 'individual' }, entityName: String, pickupDivision: String, pickupDistrict: String, pickupArea: String, pickupAddressLine: String, returnDivision: String, returnDistrict: String, returnArea: String, returnAddressLine: String, bank: { type: bankSchema, required: true }, agreement: { type: agreementSchema, required: true }, status: { type: String, default: 'pending', index: true }, reviewedBy: String, reviewedAt: String, reviewNote: String, ...stamps }));

export const StoreModel = mongoose.models.Store ?? mongoose.model('Store', new Schema({ ...id, sellerId: { type: String, unique: true, index: true }, name: String, description: String, logo: String, banner: String, status: { type: String, default: 'active', index: true }, ratingAvg: { type: Number, default: 0 }, ratingCount: { type: Number, default: 0 }, responseRate: { type: Number, default: 100 }, responseTimeMinutes: { type: Number, default: 60 }, productCount: { type: Number, default: 0 }, followerCount: { type: Number, default: 0 }, shippingFee: { type: Number, default: 0 }, freeShippingThreshold: { type: Number, default: 0 }, deliveryEstimateDays: { type: Map, of: Number }, location: String, verified: { type: Boolean, default: false }, ...stamps }));

export const ProductModel = mongoose.models.Product ?? mongoose.model('Product', new Schema({ ...id, sellerId: { type: String, index: true }, storeId: { type: String, index: true }, name: String, brand: String, categoryId: { type: String, index: true }, subcategoryId: { type: String, default: null }, description: String, highlights: { type: [String], default: [] }, images: { type: [String], default: [] }, video: Schema.Types.Mixed, regularPrice: { type: Number, required: true }, salePrice: Number, costPrice: Number, sku: { type: String, index: true }, stock: { type: Number, default: 0 }, lowStockThreshold: { type: Number, default: 0 }, variants: { type: [variantSchema], default: [] }, hasVariants: { type: Boolean, default: false }, status: { type: String, default: 'draft', index: true }, publishedAt: String, ratingAvg: { type: Number, default: 0 }, ratingCount: { type: Number, default: 0 }, soldCount: { type: Number, default: 0 }, viewCount: { type: Number, default: 0 }, isNewArrival: Boolean, ...stamps }));

export const CartModel = mongoose.models.Cart ?? mongoose.model('Cart', new Schema({ ...id, userId: { type: String, unique: true, index: true }, items: { type: [cartItemSchema], default: [] }, ...stamps }));

export const WishlistModel = mongoose.models.Wishlist ?? mongoose.model('Wishlist', new Schema({ ...id, userId: { type: String, unique: true, index: true }, items: { type: [new Schema({ _id: { type: String, required: true }, productId: String, addedAt: String }, { _id: false })] }, ...stamps }));

export const AddressModel = mongoose.models.Address ?? mongoose.model('Address', new Schema({ ...id, userId: { type: String, index: true }, label: String, recipientName: String, phone: String, division: String, district: String, area: String, addressLine: String, postalCode: String, instructions: String, isDefault: { type: Boolean, default: false }, ...stamps }));

export const VoucherModel = mongoose.models.Voucher ?? mongoose.model('Voucher', new Schema({ ...id, code: { type: String, unique: true, index: true }, title: String, type: { type: String, required: true }, discountValue: { type: Number, required: true }, minimumOrder: { type: Number, default: 0 }, maximumDiscount: Number, scope: { type: String, default: 'platform' }, sellerId: { type: String, index: true }, categoryId: String, productIds: { type: [String] }, startAt: String, expiry: String, usageLimit: Number, usageCount: { type: Number, default: 0 }, perUserLimit: Number, perUserUsed: { type: Map, of: Number, default: {} }, active: { type: Boolean, default: true }, description: String, ...stamps }));

export const PromotionModel = mongoose.models.Promotion ?? mongoose.model('Promotion', new Schema({ ...id, title: String, type: String, description: String, image: String, productIds: { type: [String], default: [] }, discountPercent: { type: Number, default: 0 }, startAt: String, endAt: String, active: { type: Boolean, default: true }, ...stamps }));

export const OrderModel = mongoose.models.Order ?? mongoose.model('Order', new Schema({ ...id, customerId: { type: String, index: true }, orderCode: { type: String, index: true }, status: { type: String, default: 'placed', index: true }, sellerOrderIds: { type: [String], default: [] }, subtotal: { type: Number, required: true }, shippingTotal: { type: Number, required: true }, vouchersDiscount: { type: Number, default: 0 }, total: { type: Number, required: true }, paymentMethod: { type: String, required: true }, paymentStatus: { type: String, default: 'pending' }, deliveryMethod: { type: String, default: 'standard' }, shippingAddress: { type: shippingAddressSchema, required: true }, voucherCodes: { type: [String], default: [] }, placedAt: String, cancelledAt: String, deliveredAt: String, ...stamps }));

export const SellerOrderModel = mongoose.models.SellerOrder ?? mongoose.model('SellerOrder', new Schema({ ...id, orderId: { type: String, index: true }, sellerId: { type: String, index: true }, storeId: String, storeName: String, storeLogo: String, status: { type: String, default: 'new' }, items: { type: [orderItemSnapshotSchema], default: [] }, subtotal: { type: Number, default: 0 }, shippingFee: { type: Number, default: 0 }, vouchersDiscount: { type: Number, default: 0 }, total: { type: Number, default: 0 }, shippingAddress: { type: shippingAddressSchema, required: true }, carrier: String, trackingNumber: String, timeline: { type: [timelineSchema], default: [] }, fulfilledAt: String, ...stamps }));

export const PaymentModel = mongoose.models.Payment ?? mongoose.model('Payment', new Schema({ ...id, orderId: { type: String, index: true }, userId: String, method: String, amount: { type: Number, required: true }, status: { type: String, default: 'pending' }, reference: String, paidAt: String, refundedAt: String, refundedAmount: Number, ...stamps }));

export const ReviewModel = mongoose.models.Review ?? mongoose.model('Review', new Schema({ ...id, userId: { type: String, index: true }, userName: String, productId: { type: String, index: true }, sellerId: { type: String, index: true }, orderItemId: { type: String, index: true }, orderId: String, rating: { type: Number, required: true }, title: String, text: String, images: { type: [String], default: [] }, verifiedPurchase: { type: Boolean, default: false }, sellerReply: sellerReplySchema, helpfulCount: { type: Number, default: 0 }, ...stamps }));

export const ReturnRequestModel = mongoose.models.ReturnRequest ?? mongoose.model('ReturnRequest', new Schema({ ...id, orderId: String, sellerOrderId: String, orderItemId: String, userId: { type: String, index: true }, sellerId: { type: String, index: true }, productName: String, quantity: Number, reason: String, description: String, images: { type: [String], default: [] }, preferredResolution: { type: String, default: 'refund' }, status: { type: String, default: 'pending' }, timeline: { type: [timelineSchema], default: [] }, ...stamps }));

export const NotificationModel = mongoose.models.Notification ?? mongoose.model('Notification', new Schema({ ...id, userId: { type: String, index: true }, type: String, title: String, body: String, read: { type: Boolean, default: false }, data: { type: Map, of: String }, ...stamps }));

export const InventoryAdjustmentModel = mongoose.models.InventoryAdjustment ?? mongoose.model('InventoryAdjustment', new Schema({ ...id, productId: { type: String, index: true }, sellerId: { type: String, index: true }, variantId: { type: String, default: null }, quantity: { type: Number, required: true }, reason: String, referenceId: String, ...stamps }));

/**
 * M8 durability guarantees live in the indexes below, not in application code.
 *
 * `IdempotencyKey` has a unique compound index on (scope, ownerId, key): the
 * insert in `claim` is therefore the mutual exclusion primitive, so two
 * concurrent retries of the same submit cannot both create an order even across
 * processes. The TTL index on `expiresAt` is what bounds the collection.
 *
 * `PasswordResetToken` is indexed on the stored hash (never the token) with the
 * same TTL, so redemption is a single indexed lookup and rows self-expire.
 */
export const IdempotencyRecordModel =
  mongoose.models.IdempotencyRecord ??
  mongoose.model(
    'IdempotencyRecord',
    new Schema(
      {
        ...id,
        scope: { type: String, required: true },
        ownerId: { type: String, required: true },
        key: { type: String, required: true },
        requestFingerprint: { type: String, required: true },
        state: { type: String, required: true, default: 'in_flight' },
        resourceId: { type: String, default: null },
        responseStatus: { type: Number, default: null },
        // A BSON date: the TTL monitor ignores a string field, so `expiresAt: String`
        // would leave this index inert and the collection would grow forever.
        expiresAt: { type: Date, required: true },
        ...stamps,
      },
      { autoIndex: true },
    ).index({ scope: 1, ownerId: 1, key: 1 }, { unique: true, name: 'idempotency_scope_owner_key' })
      .index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'idempotency_ttl' })
      .index({ resourceId: 1 }, { name: 'idempotency_resource' }),
  );

export const PasswordResetTokenModel =
  mongoose.models.PasswordResetToken ??
  mongoose.model(
    'PasswordResetToken',
    new Schema({
      ...id,
      userId: { type: String, required: true, index: true },
      tokenHash: { type: String, required: true, unique: true, index: true },
      // See the note on the idempotency TTL: a string here would make the index inert.
      expiresAt: { type: Date, required: true },
      usedAt: { type: String, default: null },
      ...stamps,
    }).index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'password_reset_ttl' }),
  );

export const AuditLogModel =
  mongoose.models.AuditLog ??
  mongoose.model(
    'AuditLog',
    new Schema({
      ...id,
      action: { type: String, required: true, index: true },
      actorId: { type: String, required: true, index: true },
      subjectId: { type: String, required: true },
      subjectType: { type: String, required: true },
      data: { type: Map, of: String, default: {} },
      ...stamps,
    }).index({ subjectType: 1, subjectId: 1 }, { name: 'audit_subject' }),
  );

/**
 * Applies every declared index against the live database.
 *
 * `autoIndex` is on for the schemas above (that is what makes a fresh test
 * database enforce the unique idempotency key), but a production deploy must
 * call this at boot: a replica set created before M8 has no unique index on
 * (scope, ownerId, key), and without it two processes could both claim a key.
 * Startup fails loudly rather than serving a weaker guarantee than the code
 * claims.
 */
export async function ensureIndexes(): Promise<void> {
  // `syncIndexes()` is a no-op against a namespace that does not exist yet, and on
  // a fresh database *nothing* exists yet. Booting on an empty database would
  // therefore finish happily with no unique index on the idempotency key and no
  // TTL indexes at all — the exact guarantees this function exists to install.
  // Creating the collection first makes the indexes unconditional.
  await Promise.all(
    [
      IdempotencyRecordModel,
      PasswordResetTokenModel,
      AuditLogModel,
      UserModel,
      SessionModel,
      SellerModel,
      StoreModel,
      ProductModel,
      CartModel,
      OrderModel,
      SellerOrderModel,
    ].map(async (model) => {
      await model.createCollection();
      await model.syncIndexes();
    }),
  );
}
