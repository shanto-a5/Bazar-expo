/**
 * Delivery quoting (M7-E).
 *
 * All rules and copy now live in `shared/delivery.ts` so the API prices express
 * delivery exactly like the checkout screen. This module keeps the original
 * class-shaped API that screens and services already call.
 */
import type { CartTotals } from './pricing-service';
import {
  DEFAULT_DELIVERY_METHOD,
  DELIVERY_METHODS,
  checkoutTotals as sharedCheckoutTotals,
  deliveryMethod as sharedDeliveryMethod,
  deliveryMethods,
  isDeliveryMethod,
  quoteDelivery,
  quoteDeliveryForTotals,
  type CheckoutTotals,
  type DeliveryMethodId,
  type DeliveryMethodOption,
  type DeliveryQuote,
} from '@shared/delivery';

export type { CheckoutTotals, DeliveryMethodId, DeliveryMethodOption, DeliveryQuote };

export class DeliveryService {
  methods(): DeliveryMethodOption[] {
    return deliveryMethods();
  }

  isMethod(value: unknown): value is DeliveryMethodId {
    return isDeliveryMethod(value);
  }

  method(id: DeliveryMethodId): DeliveryMethodOption {
    return sharedDeliveryMethod(id);
  }

  quote(id: DeliveryMethodId, baseFee: number, sellerCount: number): DeliveryQuote {
    return quoteDelivery(id, baseFee, sellerCount);
  }

  quoteForTotals(totals: CartTotals, id: DeliveryMethodId): DeliveryQuote {
    return quoteDeliveryForTotals(totals, id);
  }

  checkoutTotals(totals: CartTotals, quote: DeliveryQuote): CheckoutTotals {
    return sharedCheckoutTotals(totals, quote);
  }
}

export const deliveryService = new DeliveryService();
export { DEFAULT_DELIVERY_METHOD, DELIVERY_METHODS };
