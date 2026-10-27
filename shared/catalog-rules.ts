/**
 * Catalog availability + customer visibility rules (M7-E).
 *
 * Extracted from `src/services/catalog-service.ts` without behavioural change.
 * The store/seller lookups that the old implementation pulled from the
 * container are now injected, which is what allows the API server to run the
 * identical rules against MongoDB-loaded documents.
 */
import type { CatalogLookups, SharedProduct, SharedVariant } from './types';

export function effectivePrice(product: SharedProduct): number {
  return product.salePrice && product.salePrice < product.regularPrice ? product.salePrice : product.regularPrice;
}

export function productIsAvailable(product: SharedProduct): boolean {
  return product.status === 'active' && productStock(product) > 0;
}

export type CustomerVisibilityBlocker =
  | 'not_listed'
  | 'store_missing'
  | 'store_paused'
  | 'seller_missing'
  | 'seller_suspended';

export interface CustomerVisibility {
  visible: boolean;
  blocker?: CustomerVisibilityBlocker;
}

export function customerVisibility(
  product: SharedProduct,
  lookups: CatalogLookups,
): CustomerVisibility {
  if (product.status !== 'active') return { visible: false, blocker: 'not_listed' };
  const store = lookups.getStoreById(product.storeId) ?? lookups.getStoreBySellerId(product.sellerId);
  if (!store) return { visible: false, blocker: 'store_missing' };
  if (store.status !== 'active') return { visible: false, blocker: 'store_paused' };
  const seller = lookups.getSellerById(product.sellerId);
  if (!seller) return { visible: false, blocker: 'seller_missing' };
  if (seller.status !== 'active') return { visible: false, blocker: 'seller_suspended' };
  return { visible: true };
}

export function productIsVisibleToCustomer(
  product: SharedProduct,
  lookups: CatalogLookups,
): boolean {
  return customerVisibility(product, lookups).visible;
}

export const VISIBILITY_MESSAGES: Record<CustomerVisibilityBlocker, string> = {
  not_listed: 'This listing is not available right now.',
  store_missing: 'The store for this listing is no longer available.',
  store_paused: 'This store is paused, so this item cannot be ordered right now.',
  seller_missing: 'The seller for this listing is no longer available.',
  seller_suspended: 'This seller account is suspended, so this item cannot be ordered right now.',
};

export function productStock(product: SharedProduct): number {
  if (product.hasVariants && product.variants.length > 0) {
    return product.variants.reduce((sum, variant) => sum + variant.stock, 0);
  }
  return product.stock;
}

export function stockLevelOf(product: SharedProduct): 'out' | 'low' | 'healthy' {
  const stock = productStock(product);
  if (stock <= 0) return 'out';
  if (stock <= product.lowStockThreshold) return 'low';
  return 'healthy';
}

export interface LineAvailability {
  available: boolean;
  reason: string | null;
}

/**
 * Whether a requested cart quantity can be ordered right now, and the exact
 * customer-facing reason when it cannot. Used by the cart screens *and* by the
 * server before it accepts an order.
 */
export function lineAvailability(
  product: SharedProduct,
  variant: SharedVariant | undefined,
  quantity: number,
  lookups: CatalogLookups,
): LineAvailability {
  const visibility = customerVisibility(product, lookups);
  if (!visibility.visible) {
    return { available: false, reason: VISIBILITY_MESSAGES[visibility.blocker ?? 'not_listed'] };
  }
  // A multi-option product is sold per-variant. A cart line that references an
  // option which no longer exists must be treated as unavailable - silently
  // repricing it to the base listing and checking it against aggregate stock
  // let customers check out with something they never selected.
  if (product.hasVariants && !variant) {
    return { available: false, reason: `One of the options for "${product.name}" is no longer available.` };
  }
  const stock = variant ? variant.stock : productStock(product);
  if (stock <= 0) {
    return { available: false, reason: `"${product.name}" does not have enough stock right now.` };
  }
  if (stock < quantity) {
    return {
      available: false,
      reason: `"${product.name}" does not have enough stock — only ${stock} left.`,
    };
  }
  return { available: true, reason: null };
}
