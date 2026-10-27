/**
 * Payment boundary (M7-L).
 *
 * Cash on delivery settles with the courier; every other method is a
 * *simulation* that records a transaction row and nothing else. No external
 * gateway is contacted, no credentials exist, and no response ever claims a
 * provider confirmed a real charge. A real gateway would implement
 * `PaymentProvider` and be selected by id at boot.
 */
import type { PaymentMethod, PaymentStatus } from '../domain/entities';

export interface PaymentMethodOption {
  id: PaymentMethod;
  label: string;
  caption: string;
  simulated: boolean;
  settledOnDelivery: boolean;
}

export interface PaymentProvider {
  readonly id: PaymentMethod;
  /** Initial transaction status for a newly created order. */
  initialStatus(method: PaymentMethod): PaymentStatus;
  /** Opaque reference recorded against the transaction. */
  referenceFor(orderId: string, at: Date): string;
}

const PAYMENT_METHODS: readonly PaymentMethodOption[] = [
  {
    id: 'cod',
    label: 'Cash on delivery',
    caption: 'Pay the courier when the order reaches you',
    simulated: false,
    settledOnDelivery: true,
  },
  {
    id: 'bkash',
    label: 'bKash',
    caption: 'Simulated bKash confirmation — no real money moves',
    simulated: true,
    settledOnDelivery: false,
  },
  {
    id: 'nagad',
    label: 'Nagad',
    caption: 'Simulated Nagad confirmation — no real money moves',
    simulated: true,
    settledOnDelivery: false,
  },
  {
    id: 'card',
    label: 'Card',
    caption: 'Simulated card confirmation — no gateway is contacted',
    simulated: true,
    settledOnDelivery: false,
  },
];

export const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'cod';

export function paymentMethods(): PaymentMethodOption[] {
  return PAYMENT_METHODS.map((option) => ({ ...option }));
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && PAYMENT_METHODS.some((option) => option.id === value);
}

export function paymentMethod(id: PaymentMethod): PaymentMethodOption {
  return { ...(PAYMENT_METHODS.find((option) => option.id === id) ?? PAYMENT_METHODS[0]) };
}

class Provider implements PaymentProvider {
  constructor(readonly id: PaymentMethod) {}

  initialStatus(): PaymentStatus {
    return paymentMethod(this.id).settledOnDelivery ? 'pending' : 'paid';
  }

  referenceFor(orderId: string, at: Date): string {
    const stamp = at.toISOString().replace(/\D/g, '').slice(0, 14);
    return `SIM-${orderId.slice(-6).toUpperCase()}-${stamp}`;
  }
}

const providers = new Map<PaymentMethod, PaymentProvider>(
  PAYMENT_METHODS.map((option) => [option.id, new Provider(option.id)]),
);

export function providerFor(method: PaymentMethod): PaymentProvider {
  return providers.get(method) ?? providers.get(DEFAULT_PAYMENT_METHOD)!;
}

export function initialPaymentStatus(method: PaymentMethod): PaymentStatus {
  return providerFor(method).initialStatus(method);
}

export function paymentReference(method: PaymentMethod, orderId: string, at: Date): string {
  return providerFor(method).referenceFor(orderId, at);
}
