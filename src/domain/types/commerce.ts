import type { BaseEntity } from './entity';
import type { Address } from './user';

export interface CartItem {
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

export interface Cart extends BaseEntity {
  userId: string;
  items: CartItem[];
}

export interface Wishlist extends BaseEntity {
  userId: string;
  items: { productId: string; addedAt: string }[];
}

export type VoucherType = 'percentage' | 'fixed' | 'free_shipping';
export type VoucherScope = 'platform' | 'seller';

export interface Voucher extends BaseEntity {
  code: string;
  title: string;
  type: VoucherType;
  discountValue: number;
  minimumOrder: number;
  maximumDiscount?: number;
  scope: VoucherScope;
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
}

export type PromotionType = 'flash_sale' | 'deal' | 'banner';

export interface Promotion extends BaseEntity {
  title: string;
  type: PromotionType;
  description?: string;
  image: string;
  productIds: string[];
  discountPercent: number;
  startAt: string;
  endAt: string;
  active: boolean;
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
  /**
   * The variant actually bought. Restocking used to re-derive it from
   * `variantAttributes`, which credited whichever variant happened to share an
   * attribute value. Optional so snapshots written before this field existed still
   * parse; the restock path falls back to attribute matching for those.
   */
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
   * Units of this line the seller has already taken back and restocked.
   *
   * This is cumulative across returns, so a line bought as 3 can be returned 1
   * unit at a time three times over. Optional so snapshots written before this
   * field existed still parse; it reads as 0, which is the correct reading for a
   * line that was never returned.
   */
  returnedQuantity?: number;
  /**
   * Units still in the customer's hands. Derived from `quantity` and
   * `returnedQuantity`; see `remainingReturnableQuantity` in the order service.
   * This is a denormalised copy kept on the snapshot so the customer and seller
   * order views can render "2 of 3 returned" without re-deriving the history.
   */
  remainingQuantity?: number;
}

export interface SellerOrderTimelineEntry {
  status: OrderStatus | 'new';
  at: string;
}

export interface SellerOrder extends BaseEntity {
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
  shippingAddress: Address;
  carrier?: string;
  trackingNumber?: string;
  timeline: SellerOrderTimelineEntry[];
  fulfilledAt?: string;
}

export interface Order extends BaseEntity {
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
  shippingAddress: Address;
  voucherCodes: string[];
  placedAt: string;
  cancelledAt?: string;
  deliveredAt?: string;
}

export interface PaymentTransaction extends BaseEntity {
  orderId: string;
  userId: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  reference?: string;
  paidAt?: string;
  refundedAt?: string;
  refundedAmount?: number;
}

export type ReturnReason =
  | 'damaged'
  | 'defective'
  | 'wrong_item'
  | 'missing_item'
  | 'does_not_match_description'
  | 'incorrect_size'
  | 'other';

export interface ReturnRequest extends BaseEntity {
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
}

export interface InventoryAdjustment extends BaseEntity {
  productId: string;
  variantId: string | null;
  quantity: number;
  reason: 'sale' | 'restock' | 'manual' | 'cancellation' | 'return';
  referenceId?: string;
}