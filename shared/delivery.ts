/**
 * Delivery method + quote rules (M7-E).
 *
 * Checkout totals depend on these (express adds a per-seller premium), so the
 * server has to price delivery the same way the device does. The catalogue of
 * methods and the quote maths therefore live in the shared core.
 */
import { roundMoney } from './money';

export type DeliveryMethodId = 'standard' | 'express';

export interface DeliveryMethodOption {
  id: DeliveryMethodId;
  label: string;
  caption: string;
  premiumPerSeller: number;
  daysMin: number;
  daysMax: number;
}

export interface DeliveryQuote {
  methodId: DeliveryMethodId;
  label: string;
  caption: string;
  baseFee: number;
  premiumPerSeller: number;
  fee: number;
  sellerCount: number;
  daysMin: number;
  daysMax: number;
  window: string;
}

export interface CheckoutTotals {
  subtotal: number;
  voucherDiscount: number;
  deliveryFee: number;
  grandTotal: number;
}

/** Structural view of the priced cart needed to quote delivery. */
export interface DeliveryTotalsInput {
  shippingTotal: number;
  groups: { items: { selected: boolean }[] }[];
}

export const DELIVERY_METHODS: readonly DeliveryMethodOption[] = [
  {
    id: 'standard',
    label: 'Standard delivery',
    caption: 'Store dispatch with tracking',
    premiumPerSeller: 0,
    daysMin: 2,
    daysMax: 5,
  },
  {
    id: 'express',
    label: 'Express delivery',
    caption: 'Priority handling for faster arrival',
    premiumPerSeller: 40,
    daysMin: 1,
    daysMax: 2,
  },
];

export const DEFAULT_DELIVERY_METHOD: DeliveryMethodId = 'standard';

export function isDeliveryMethod(value: unknown): value is DeliveryMethodId {
  return typeof value === 'string' && DELIVERY_METHODS.some((option) => option.id === value);
}

export function deliveryMethod(id: DeliveryMethodId): DeliveryMethodOption {
  return { ...(DELIVERY_METHODS.find((option) => option.id === id) ?? DELIVERY_METHODS[0]) };
}

export function deliveryMethods(): DeliveryMethodOption[] {
  return DELIVERY_METHODS.map((option) => ({ ...option }));
}

export function quoteDelivery(id: DeliveryMethodId, baseFee: number, sellerCount: number): DeliveryQuote {
  const method = DELIVERY_METHODS.find((option) => option.id === id) ?? DELIVERY_METHODS[0];
  const sellers = Math.max(1, sellerCount);
  const extraDays = sellers - 1;
  const daysMin = method.daysMin + extraDays;
  const daysMax = method.daysMax + extraDays;
  return {
    methodId: method.id,
    label: method.label,
    caption: method.caption,
    baseFee: roundMoney(baseFee),
    premiumPerSeller: method.premiumPerSeller,
    fee: roundMoney(baseFee + method.premiumPerSeller * sellers),
    sellerCount: sellers,
    daysMin,
    daysMax,
    window: `${daysMin}–${daysMax} working days`,
  };
}

export function quoteDeliveryForTotals(
  totals: DeliveryTotalsInput,
  id: DeliveryMethodId,
): DeliveryQuote {
  const sellerCount = totals.groups.filter((group) => group.items.some((line) => line.selected)).length;
  return quoteDelivery(id, totals.shippingTotal, sellerCount);
}

export function checkoutTotals(
  totals: { subtotal: number; voucherDiscount: number },
  quote: DeliveryQuote,
): CheckoutTotals {
  const subtotal = roundMoney(totals.subtotal);
  const voucherDiscount = roundMoney(totals.voucherDiscount);
  const deliveryFee = roundMoney(quote.fee);
  return {
    subtotal,
    voucherDiscount,
    deliveryFee,
    grandTotal: roundMoney(subtotal + deliveryFee - voucherDiscount),
  };
}
