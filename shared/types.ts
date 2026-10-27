/**
 * Structural contracts for the shared commerce core (M7-E).
 *
 * These are intentionally *minimal structural* views of the marketplace
 * entities, not copies of the app's domain types. The Expo `Product`,
 * `Store`, `SellerProfile` and `Voucher` interfaces satisfy them structurally,
 * and the API server's Mongoose documents do too, so both runtimes execute the
 * exact same rules without importing each other's type universe.
 */
export interface SharedVariant {
  id: string;
  price: number;
  stock: number;
}

export interface SharedProduct {
  id: string;
  sellerId: string;
  storeId: string;
  name: string;
  status: string;
  regularPrice: number;
  salePrice?: number;
  stock: number;
  lowStockThreshold: number;
  hasVariants: boolean;
  variants: SharedVariant[];
}

export interface SharedStore {
  id: string;
  sellerId: string;
  status: string;
  shippingFee: number;
  freeShippingThreshold: number;
}

export interface SharedSeller {
  id: string;
  status: string;
}

export interface SharedVoucher {
  id: string;
  code: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  scope: 'platform' | 'seller';
  discountValue: number;
  minimumOrder: number;
  maximumDiscount?: number;
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
}

/** Store/seller lookups injected so visibility rules stay free of any data layer. */
export interface CatalogLookups {
  getStoreById(id: string): SharedStore | undefined;
  getStoreBySellerId(sellerId: string): SharedStore | undefined;
  getSellerById(id: string): SharedSeller | undefined;
}

/** A cart line already resolved against the catalog (product + variant + store). */
export interface ResolvedCartLine<TProduct extends SharedProduct = SharedProduct> {
  product: TProduct;
  variant?: SharedVariant;
  sellerId: string;
  selected: boolean;
  quantity: number;
}

export interface SharedSellerGroup {
  sellerId: string;
  subtotal: number;
  shippingFee: number;
  freeShipping: boolean;
}

export interface SharedCartTotals {
  subtotal: number;
  shippingTotal: number;
  voucherDiscount: number;
  grandTotal: number;
  itemCount: number;
}

export type SharedOrderStatus =
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

export interface SharedSellerOrderStatus {
  status: SharedOrderStatus;
}
