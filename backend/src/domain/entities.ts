/**
 * API wire entities (M7-D).
 *
 * These mirror `src/domain/types/*` in the Expo app field-for-field so the
 * remote repository adapters on the client can reuse the app's own domain
 * types without a translation layer, and so a document written by the API is
 * readable by the app unchanged. Dates are ISO-8601 strings on the wire, exactly
 * as the local adapter persists them.
 */

/**
 * M8 adds `seller_approver`: the only role that may activate or reject a seller
 * application. It is never granted by a request — only by the seed dataset or an
 * operator running the admin CLI — so a customer cannot approve themselves.
 */
export type Role = 'customer' | 'seller' | 'seller_approver';

export interface UserEntity {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** bcrypt hash. Never leaves the server — see `toPublicUser`. */
  passwordHash: string;
  avatar: string;
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

export function toPublicUser(user: UserEntity): PublicUser {
  const { passwordHash: _hash, ...rest } = user;
  void _hash;
  return { ...rest };
}

export interface SessionEntity {
  id: string;
  userId: string;
  token: string;
  /**
   * A BSON date, not an ISO string.
   *
   * MongoDB's TTL monitor only acts on date-typed fields; a string column behind
   * `expireAfterSeconds` is silently ignored, so an ISO string here would mean
   * expired sessions accumulate forever. The API still returns an ISO string, but
   * that is formatted at the edge (see `AuthService.issueSession`).
   */
  expiresAt: Date;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryEntity {
  id: string;
  name: string;
  icon: string;
  image: string;
  parentId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface BankInformation {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch?: string;
}

export interface SellerAgreement {
  marketplaceTerms: boolean;
  sellerPolicies: boolean;
  productAuthenticity: boolean;
  fulfillmentResponsibility: boolean;
}

export interface SellerProfileEntity {
  id: string;
  userId: string;
  storeId: string;
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  sellerType: 'individual' | 'business';
  entityName?: string;
  pickupDivision: string;
  pickupDistrict: string;
  pickupArea: string;
  pickupAddressLine: string;
  returnDivision: string;
  returnDistrict: string;
  returnArea: string;
  returnAddressLine: string;
  bank: BankInformation;
  agreement: SellerAgreement;
  /**
   * M8. A self-registered profile starts `pending` and only a server-side
   * approver can move it to `active` or `rejected`. `suspended` is reserved for
   * revoking an already-active seller.
   */
  status: 'pending' | 'active' | 'rejected' | 'suspended';
  /** Review trail, written by the approver — never by the applicant. */
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreEntity {
  id: string;
  sellerId: string;
  name: string;
  description: string;
  logo: string;
  banner: string;
  /**
   * M8: a store is `pending` from the moment it is applied for and only becomes
   * `active` when an approver activates the seller. `paused` remains the staff
   * takedown flag. Widening this union is what stops a freshly applied store from
   * being publicly visible before anyone has reviewed it.
   */
  status: 'pending' | 'active' | 'paused';
  ratingAvg: number;
  ratingCount: number;
  responseRate: number;
  responseTimeMinutes: number;
  productCount: number;
  followerCount: number;
  shippingFee: number;
  freeShippingThreshold: number;
  deliveryEstimateDays: { min: number; max: number };
  location: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariantEntity {
  id: string;
  productId: string;
  sku: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice?: number;
  stock: number;
  image?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProductStatus = 'draft' | 'pending' | 'active' | 'paused' | 'out_of_stock' | 'archived';

export interface ProductEntity {
  id: string;
  sellerId: string;
  storeId: string;
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
  variants: ProductVariantEntity[];
  hasVariants: boolean;
  status: ProductStatus;
  publishedAt?: string;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  viewCount: number;
  isNewArrival?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CartItemEntity {
  id: string;
  productId: string;
  sellerId: string;
  variantId?: string;
  variantAttributes?: Record<string, string>;
  quantity: number;
  selected: boolean;
  priceSnapshot: number;
  addedAt: string;
  updatedAt?: string;
}

export interface CartEntity {
  id: string;
  userId: string;
  items: CartItemEntity[];
  createdAt: string;
  updatedAt: string;
}

export interface AddressEntity {
  id: string;
  userId: string;
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
  instructions?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VoucherEntity {
  id: string;
  code: string;
  title: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  discountValue: number;
  minimumOrder: number;
  maximumDiscount?: number;
  scope: 'platform' | 'seller';
  sellerId?: string;
  categoryId?: string;
  productIds?: string[];
  startAt: string;
  expiry: string;
  usageLimit?: number;
  usageCount: number;
  perUserLimit?: number;
  perUserUsed: Record<string, number>;
  active: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type PromotionType = 'flash_sale' | 'deal' | 'banner';

export interface PromotionEntity {
  id: string;
  title: string;
  type: PromotionType;
  description?: string;
  image: string;
  productIds: string[];
  discountPercent: number;
  startAt: string;
  endAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus =
  | 'placed'
  | 'new'
  | 'confirmed'
  | 'processing'
  | 'packed'
  | 'ready_to_ship'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'return_requested'
  | 'return_approved'
  | 'partially_returned'
  | 'returned'
  | 'refunded';

export type PaymentMethod = 'cod' | 'bkash' | 'nagad' | 'card';
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'failed' | 'refunded';
export type DeliveryMethodId = 'standard' | 'express';

export interface OrderItemSnapshot {
  id: string;
  productId: string;
  productName: string;
  brand: string;
  image: string;
  /** The variant actually bought, so a cancellation credits the right variant. */
  variantId?: string;
  variantAttributes?: Record<string, string>;
  unitPrice: number;
  discount: number;
  quantity: number;
  subtotal: number;
  status:
    | 'delivered'
    | 'cancelled'
    | 'return_requested'
    | 'return_approved'
    | 'partially_returned'
    | 'returned'
    | 'refunded'
    | 'pending';
  reviewId: string | null;
  hasReview: boolean;
  returnRequestId: string | null;
  /**
   * Cumulative units taken back across all returns for this line. Mirrors the local
   * app so both implementations of the same order agree on how much of a line is
   * still with the customer.
   */
  returnedQuantity?: number;
  remainingQuantity?: number;
}

export interface SellerOrderTimelineEntry {
  status: OrderStatus | 'new';
  at: string;
}

export interface SellerOrderEntity {
  id: string;
  orderId: string;
  sellerId: string;
  storeId: string;
  storeName: string;
  storeLogo: string;
  status: OrderStatus;
  items: OrderItemSnapshot[];
  subtotal: number;
  shippingFee: number;
  vouchersDiscount: number;
  total: number;
  shippingAddress: AddressEntity;
  carrier?: string;
  trackingNumber?: string;
  timeline: SellerOrderTimelineEntry[];
  fulfilledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEntity {
  id: string;
  customerId: string;
  orderCode: string;
  status: OrderStatus;
  sellerOrderIds: string[];
  subtotal: number;
  shippingTotal: number;
  vouchersDiscount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  deliveryMethod: DeliveryMethodId;
  shippingAddress: AddressEntity;
  voucherCodes: string[];
  placedAt: string;
  cancelledAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransactionEntity {
  id: string;
  orderId: string;
  userId: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  reference?: string;
  paidAt?: string;
  refundedAt?: string;
  refundedAmount?: number;
  createdAt: string;
  updatedAt: string;
}

export type ReturnReason =
  | 'damaged'
  | 'defective'
  | 'wrong_item'
  | 'missing_item'
  | 'does_not_match_description'
  | 'incorrect_size'
  | 'other';

export interface ReturnRequestEntity {
  id: string;
  orderId: string;
  sellerOrderId: string;
  orderItemId: string;
  userId: string;
  sellerId: string;
  productName: string;
  quantity?: number;
  reason: ReturnReason;
  description: string;
  images: string[];
  preferredResolution: 'refund' | 'replacement';
  status: 'pending' | 'approved' | 'rejected' | 'returned' | 'refunded';
  timeline: { status: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewEntity {
  id: string;
  userId: string;
  userName: string;
  productId: string;
  sellerId: string;
  orderItemId: string;
  orderId: string;
  rating: number;
  title: string;
  text: string;
  images: string[];
  verifiedPurchase: boolean;
  sellerReply?: { text: string; at: string } | null;
  helpfulCount: number;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType =
  | 'order_placed'
  | 'order_confirmed'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_cancelled'
  | 'return_update'
  | 'promotion'
  | 'voucher'
  | 'review_reminder'
  | 'review_reply'
  | 'seller_new_order'
  | 'seller_order_cancelled'
  | 'seller_low_stock'
  | 'seller_return_request'
  | 'seller_review_received'
  | 'seller_account_status'
  | 'system';

export interface NotificationEntity {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  data?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface WishlistEntity {
  id: string;
  userId: string;
  items: { productId: string; addedAt: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface InventoryAdjustmentEntity {
  id: string;
  productId: string;
  sellerId: string;
  variantId: string | null;
  quantity: number;
  reason: 'sale' | 'restock' | 'manual' | 'cancellation' | 'return';
  referenceId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * M8 durable idempotency record.
 *
 * M7 kept "have I seen this submission?" in a process-local `Map`, which is lost
 * on restart and invisible to a second instance. The record lives in the
 * datastore, is claimed with a unique insert (so two concurrent retries cannot
 * both win) and stores the fingerprint of the request it answered, which is how a
 * *different* payload under the same key is rejected instead of silently replayed.
 */
export type IdempotencyState = 'in_flight' | 'completed';

export interface IdempotencyRecordEntity {
  id: string;
  /** Namespace, so `orders` and any future write endpoint cannot collide. */
  scope: string;
  /** The caller's identity: one user's key must never answer another's request. */
  ownerId: string;
  key: string;
  /** Stable hash of the meaningful request fields. */
  requestFingerprint: string;
  state: IdempotencyState;
  /** Set when `state === 'completed'`; points at the order that was created. */
  resourceId?: string;
  /** HTTP status the original request answered with, replayed on a repeat. */
  responseStatus?: number;
  createdAt: string;
  updatedAt: string;
  /**
   * After this instant a repeat is treated as a new submission.
   *
   * A BSON date so the TTL index can act on it — see the note on
   * `SessionEntity.expiresAt`.
   */
  expiresAt: Date;
}

/**
 * M8 password-reset token.
 *
 * Only the SHA-256 of the token is stored, so a dump of the collection does not
 * hand an attacker a working reset link. `usedAt` makes redemption single-use
 * even if two confirm requests arrive together, and `expiresAt` carries a TTL
 * index so spent and stale rows disappear without a sweep.
 */
export interface PasswordResetTokenEntity {
  id: string;
  userId: string;
  tokenHash: string;
  /** A BSON date, so the TTL index actually fires. */
  expiresAt: Date;
  usedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * M8 audit entry for privileged actions (seller approval, password reset
 * completion). Kept append-only and actor-attributed so an operator action is
 * always attributable after the fact.
 */
export interface AuditLogEntity {
  id: string;
  action: string;
  actorId: string;
  /** Entity the action was taken on, e.g. a seller profile id. */
  subjectId: string;
  subjectType: string;
  data?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
