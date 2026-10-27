import type { BaseEntity } from './entity';

export interface Review extends BaseEntity {
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

export interface AppNotification extends BaseEntity {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  data?: Record<string, string>;
}

export interface SearchHistoryEntry extends BaseEntity {
  userId: string;
  query: string;
}

export interface RecentlyViewedEntry extends BaseEntity {
  userId: string;
  productId: string;
}

export interface StoreFollower extends BaseEntity {
  userId: string;
  storeId: string;
}