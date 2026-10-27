import type { ProductStatus } from './catalog';

export * from './entity';
export * from './user';
export * from './catalog';
export * from './commerce';
export * from './social';

export const CUSTOMER_ORDER_TABS = ['all', 'to_pay', 'to_ship', 'shipped', 'delivered', 'cancelled', 'returns'] as const;
export type CustomerOrderTab = (typeof CUSTOMER_ORDER_TABS)[number];

export const SELLER_ORDER_TABS = [
  'new',
  'to_process',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'returns',
] as const;
export type SellerOrderTab = (typeof SELLER_ORDER_TABS)[number];

export const PRODUCT_ACTIVE_STATUSES: ProductStatus[] = ['active'];