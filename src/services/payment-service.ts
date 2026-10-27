import type { PaymentMethod, PaymentStatus } from '@/domain/types';

export interface PaymentMethodOption {
  id: PaymentMethod;
  label: string;
  caption: string;
  simulated: boolean;
  settledOnDelivery: boolean;
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
    caption: 'Simulated card confirmation — no real gateway is contacted',
    simulated: true,
    settledOnDelivery: false,
  },
];

export const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'cod';

export class PaymentService {
  methods(): PaymentMethodOption[] {
    return PAYMENT_METHODS.map((option) => ({ ...option }));
  }

  isMethod(value: unknown): value is PaymentMethod {
    return typeof value === 'string' && PAYMENT_METHODS.some((option) => option.id === value);
  }

  method(id: PaymentMethod): PaymentMethodOption {
    return { ...(PAYMENT_METHODS.find((option) => option.id === id) ?? PAYMENT_METHODS[0]) };
  }

  label(id: PaymentMethod): string {
    return this.method(id).label;
  }

  statusFor(id: PaymentMethod): PaymentStatus {
    return this.method(id).settledOnDelivery ? 'pending' : 'paid';
  }
}

export const paymentService = new PaymentService();
