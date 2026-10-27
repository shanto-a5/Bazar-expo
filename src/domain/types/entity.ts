export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type CollectionKey =
  | 'users'
  | 'sessions'
  | 'categories'
  | 'sellers'
  | 'stores'
  | 'products'
  | 'carts'
  | 'wishlists'
  | 'addresses'
  | 'vouchers'
  | 'promotions'
  | 'orders'
  | 'sellerOrders'
  | 'payments'
  | 'reviews'
  | 'returnRequests'
  | 'notifications'
  | 'searchHistory'
  | 'recentlyViewed'
  | 'storeFollowers'
  | 'inventoryAdjustments'
  | 'listCache'
  | 'cartCache';