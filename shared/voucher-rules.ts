/**
 * Voucher eligibility + discount rules (M7-E).
 *
 * The pricing screen used to be the only place these rules existed, which meant
 * the server would have had to re-implement them to authorise an order. They now
 * live here and both runtimes call them: the app to render quotes, the server to
 * decide whether a submitted code is honoured.
 */
import { roundMoney } from './money';
import { computeVoucherDiscount } from './pricing';
import type { SharedSellerGroup, SharedVoucher } from './types';

export interface VoucherGroupItemView {
  selected: boolean;
  sellerId: string;
  productId: string;
  categoryId: string;
}

export interface VoucherGroupView {
  sellerId: string;
  subtotal: number;
  /**
   * Real per-seller shipping fee. Optional so existing callers keep compiling, but
   * `free_shipping` quotes are only truthful when it is supplied — the display value
   * is the sum of these fees, while the applied value is the order's shipping total.
   */
  shippingFee?: number;
  items: VoucherGroupItemView[];
}

export interface VoucherQuote<T extends SharedVoucher = SharedVoucher> {
  voucher: T;
  discount: number;
  valid: boolean;
  reason?: string;
}

function sellerSubtotalFor(groups: SharedSellerGroup[], sellerId?: string): number {
  if (!sellerId) return 0;
  return groups.filter((group) => group.sellerId === sellerId).reduce((sum, group) => sum + group.subtotal, 0);
}

/**
 * Unrounded discount for quote display — matches the pre-existing
 * `VoucherService.discountValue`.
 */
export function voucherDisplayValue(
  voucher: SharedVoucher,
  groups: SharedSellerGroup[],
  subtotal: number,
): number {
  if (voucher.type === 'free_shipping') {
    return groups.reduce((sum, group) => sum + group.shippingFee, 0);
  }
  const base =
    voucher.scope === 'seller' && voucher.sellerId ? sellerSubtotalFor(groups, voucher.sellerId) : subtotal;
  if (voucher.type === 'percentage') {
    const raw = (base * voucher.discountValue) / 100;
    return Math.min(raw, voucher.maximumDiscount ?? Infinity);
  }
  if (voucher.type === 'fixed') {
    return Math.min(voucher.discountValue, base);
  }
  return 0;
}

/**
 * Evaluate every voucher against a cart and return quotes sorted by value.
 * `now` is injected so the result is deterministic and testable.
 */
export function evaluateVoucherQuotes<T extends SharedVoucher>(
  vouchers: T[],
  groups: VoucherGroupView[],
  subtotal: number,
  userId: string,
  now: number,
): VoucherQuote<T>[] {
  const selectedItems = groups.flatMap((group) => group.items.filter((item) => item.selected));
  const sellerIds = new Set(selectedItems.map((item) => item.sellerId));
  const categoryIds = new Set(selectedItems.map((item) => item.categoryId));
  const productIds = new Set(selectedItems.map((item) => item.productId));

  const pricingGroups: SharedSellerGroup[] = groups.map((group) => ({
    sellerId: group.sellerId,
    subtotal: group.subtotal,
    // Real fee, not a hard-coded 0: a `free_shipping` quote used to display ৳0 on
    // the cart while the checkout discounted the actual shipping total.
    shippingFee: group.shippingFee ?? 0,
    freeShipping: (group.shippingFee ?? 0) === 0,
  }));

  const quotes: VoucherQuote<T>[] = [];
  for (const voucher of vouchers) {
    if (!voucher.active) continue;
    if (new Date(voucher.startAt).getTime() > now || new Date(voucher.expiry).getTime() < now) continue;
    if (voucher.usageLimit !== undefined && voucher.usageCount >= voucher.usageLimit) {
      quotes.push({ voucher, discount: 0, valid: false, reason: 'Usage limit reached' });
      continue;
    }
    if (voucher.perUserLimit !== undefined && userId) {
      const used = voucher.perUserUsed[userId] ?? 0;
      if (used >= voucher.perUserLimit) {
        quotes.push({ voucher, discount: 0, valid: false, reason: 'Already used' });
        continue;
      }
    }
    if (voucher.scope === 'seller' && voucher.sellerId && !sellerIds.has(voucher.sellerId)) {
      quotes.push({ voucher, discount: 0, valid: false, reason: 'Applies to a different seller' });
      continue;
    }
    if (voucher.scope === 'seller' && voucher.sellerId) {
      const sellerSubtotal = groups
        .filter((group) => group.sellerId === voucher.sellerId)
        .reduce((sum, group) => sum + group.subtotal, 0);
      if (sellerSubtotal < voucher.minimumOrder) {
        quotes.push({ voucher, discount: 0, valid: false, reason: `Minimum ${voucher.minimumOrder} required` });
        continue;
      }
    } else if (subtotal < voucher.minimumOrder) {
      quotes.push({ voucher, discount: 0, valid: false, reason: `Minimum ${voucher.minimumOrder} required` });
      continue;
    }
    if (voucher.categoryId && !categoryIds.has(voucher.categoryId)) {
      quotes.push({ voucher, discount: 0, valid: false, reason: 'Category not in cart' });
      continue;
    }
    if (voucher.productIds && voucher.productIds.length && !voucher.productIds.some((id) => productIds.has(id))) {
      quotes.push({ voucher, discount: 0, valid: false, reason: 'Product not in cart' });
      continue;
    }
    quotes.push({ voucher, discount: voucherDisplayValue(voucher, pricingGroups, subtotal), valid: true });
  }

  quotes.sort((a, b) => b.discount - a.discount);
  return quotes;
}

/** Authoritative discount used when an order total is recomputed server-side. */
export function voucherAppliedValue(
  voucher: SharedVoucher,
  groups: SharedSellerGroup[],
  subtotal: number,
  shippingTotal: number,
): number {
  // Delegates to the pricing core instead of restating the rules. Two copies of
  // this arithmetic is how the seller-scoped `free_shipping` case drifted: the copy
  // here still waived the whole cart's delivery while the authoritative one did not.
  return computeVoucherDiscount(voucher, groups, subtotal, shippingTotal);
}
