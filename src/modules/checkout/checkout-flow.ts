import * as React from 'react';

import { useLocalSearchParams } from 'expo-router';

import type { Address, DeliveryMethodId, PaymentMethod } from '@/domain/types';
import type { AddressFormValue } from '@/modules/account/address-form';
import { useSession } from '@/modules/session/session-context';
import { addressService } from '@/services/address-service';
import { cartService, type CartMergeResult } from '@/services/cart-service';
import {
  DEFAULT_DELIVERY_METHOD,
  deliveryService,
  type CheckoutTotals,
  type DeliveryMethodOption,
  type DeliveryQuote,
} from '@/services/delivery-service';
import { DEFAULT_PAYMENT_METHOD, paymentService, type PaymentMethodOption } from '@/services/payment-service';
import { orderService } from '@/services/order-service';
import type { CartLineView, CartTotals, SellerGroupView } from '@/services/pricing-service';
import { voucherService } from '@/services/voucher-service';
import { vantaApi, type CheckoutPreview } from '@/api/vanta-api';
import { uuid } from '@/utils/id';

export type NewAddressInput = AddressFormValue;

export type PlaceOrderResult = { ok: true; orderId: string } | { ok: false; message: string };

export interface CheckoutFlowValue {
  userId: string;
  mergeNotice: CartMergeResult | null;
  dismissMergeNotice: () => void;
  totals: CartTotals;
  groups: SellerGroupView[];
  selectedLines: CartLineView[];
  selectedSellerCount: number;
  hasSelectedItems: boolean;
  addresses: Address[];
  address: Address | null;
  selectAddress: (id: string) => void;
  addAddress: (input: NewAddressInput) => Promise<Address>;
  deliveryMethods: DeliveryMethodOption[];
  deliveryMethod: DeliveryMethodId;
  selectDeliveryMethod: (id: DeliveryMethodId) => void;
  deliveryQuote: DeliveryQuote;
  paymentMethods: PaymentMethodOption[];
  paymentMethod: PaymentMethod;
  selectPaymentMethod: (id: PaymentMethod) => void;
  voucherCode: string;
  appliedVoucher: string | undefined;
  voucherError: string | null;
  checkoutTotals: CheckoutTotals;
  /** Remote mode only: set while the server has not yet confirmed delivery/pricing. */
  pricingNotice: string | null;
  canPlaceOrder: boolean;
  unavailableLines: string[];
  /**
   * `paymentReference` is only set once an online payment simulator has actually
   * confirmed the charge, so the recorded transaction carries the reference the
   * customer was shown.
   */
  placeOrder: (paymentReference?: string) => Promise<PlaceOrderResult>;
}

interface BootState {
  mergeNotice: CartMergeResult | null;
  addressId: string | null;
}

function bootCheckout(userId: string): BootState {
  if (!userId) return { mergeNotice: null, addressId: null };
  const merged = cartService.mergeGuestCart(userId);
  const addresses = addressService.list(userId);
  return {
    mergeNotice: merged.merged || merged.adjusted.length > 0 || merged.unavailable.length > 0 ? merged : null,
    addressId: addresses.find((entry) => entry.isDefault)?.id ?? addresses[0]?.id ?? null,
  };
}

function deriveCheckout(
  userId: string,
  voucherCode: string,
  deliveryMethod: DeliveryMethodId,
): {
  totals: CartTotals;
  appliedVoucher: string | undefined;
  voucherError: string | null;
  deliveryQuote: DeliveryQuote;
  checkoutTotals: CheckoutTotals;
} {
  const base = cartService.totals(userId);
  let appliedVoucher: string | undefined;
  let voucherError: string | null = null;
  const wanted = voucherCode.trim().toLowerCase();
  if (wanted) {
    const match = voucherService
      .eligibleForCart(userId, base.groups, base.subtotal)
      .find((quote) => quote.voucher.code.toLowerCase() === wanted);
    if (!match) voucherError = 'We could not find that voucher code.';
    else if (!match.valid) voucherError = match.reason ?? 'This voucher cannot be applied.';
    else appliedVoucher = match.voucher.code;
  }
  const totals = appliedVoucher ? cartService.totals(userId, appliedVoucher) : base;
  const deliveryQuote = deliveryService.quoteForTotals(totals, deliveryMethod);
  return {
    totals,
    appliedVoucher,
    voucherError,
    deliveryQuote,
    checkoutTotals: deliveryService.checkoutTotals(totals, deliveryQuote),
  };
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function useCheckoutFlow(): CheckoutFlowValue {
  const { user } = useSession();
  const userId = user?.id ?? '';
  const params = useLocalSearchParams<{ voucher?: string | string[] }>();
  const voucherCode = firstParam(params.voucher);
  // One idempotency key per checkout attempt. A payment sheet that signals
  // success more than once reuses it, so the server replays the order it already
  // created rather than writing a duplicate. The lazy initialiser mints it once.
  const [attemptKey] = React.useState<string>(() => uuid());
  const [addressId, setAddressId] = React.useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = React.useState<DeliveryMethodId>(DEFAULT_DELIVERY_METHOD);
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>(DEFAULT_PAYMENT_METHOD);
  const [mergeNotice, setMergeNotice] = React.useState<CartMergeResult | null>(null);
  // The merge is a repository write, so it must not run inside a `useState`
  // initialiser: that is a render-phase side effect, and StrictMode's double
  // invocation could run it twice. Deferring it to a microtask keeps the write
  // after commit and the setState inside a callback rather than the effect body.
  React.useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => {
      if (!live) return;
      const next = bootCheckout(userId);
      // The default address is only known once boot has run, so it is applied here
      // rather than read out of an initial state.
      setAddressId(next.addressId);
      setMergeNotice(next.mergeNotice);
    });
    return () => {
      live = false;
    };
  }, [userId]);
  const [version, setVersion] = React.useState(0);
  // In remote mode the server owns pricing and stock, so the pre-flight is the
  // source of truth for totals, the applied voucher and availability. It is keyed
  // by the inputs it answered so a stale response is ignored after any change.
  const [preview, setPreview] = React.useState<{ key: string; value: CheckoutPreview } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const previewKey = `${deliveryMethod}|${voucherCode.trim()}|${version}`;

  const refresh = (): void => setVersion((value) => value + 1);

  React.useEffect(() => {
    if (!userId) return;
    let live = true;
    vantaApi
      .checkoutPreview({ deliveryMethod, voucherCode: voucherCode.trim() || undefined })
      .then((result) => {
        if (!live) return;
        setPreview({ key: `${deliveryMethod}|${voucherCode.trim()}|${version}`, value: result });
        setPreviewError(null);
      })
      .catch(() => {
        if (!live) return;
        setPreviewError('We could not confirm delivery and pricing with the store. Check your connection and try again.');
      });
    return () => {
      live = false;
    };
  }, [userId, deliveryMethod, voucherCode, version]);

  const addresses = addressService.list(userId);
  const derived = deriveCheckout(userId, voucherCode, deliveryMethod);
  const selectedLines = derived.totals.groups.flatMap((group) => group.items).filter((line) => line.selected);
  const selectedSellerCount = derived.deliveryQuote.sellerCount;
  const address = addresses.find((entry) => entry.id === addressId) ?? null;

  // The derived values are a provisional display only: in remote mode they are
  // replaceable by the server preview, and placing the order is gated on that
  // preview having actually succeeded (see `pricingConfirmed` below), so the
  // device never submits or prices against a total the server has not confirmed.
  const serverPreview = preview && preview.key === previewKey ? preview.value : null;
  const appliedVoucher = serverPreview ? serverPreview.voucher?.code : derived.appliedVoucher;
  const voucherError = serverPreview
    ? voucherCode.trim() && !serverPreview.voucher
      ? 'This voucher cannot be applied.'
      : null
    : derived.voucherError;
  const checkoutTotals: CheckoutTotals = serverPreview
    ? {
        subtotal: serverPreview.totals.subtotal,
        voucherDiscount: serverPreview.totals.voucherDiscount,
        deliveryFee: serverPreview.totals.deliveryFee,
        grandTotal: serverPreview.totals.grandTotal,
      }
    : derived.checkoutTotals;

  const selectAddress = (id: string): void => {
    setAddressId(id);
  };

  const addAddress = async (input: NewAddressInput): Promise<Address> => {
    const created = await addressService.add(userId, {
      label: input.label,
      recipientName: input.recipientName,
      phone: input.phone,
      division: input.division,
      district: input.district,
      area: input.area,
      addressLine: input.addressLine,
      postalCode: input.postalCode,
      instructions: input.instructions || undefined,
      isDefault: input.makeDefault,
    });
    setAddressId(created.id);
    refresh();
    return created;
  };

  const selectDeliveryMethod = (id: DeliveryMethodId): void => {
    setDeliveryMethod(id);
  };

  const selectPaymentMethod = (id: PaymentMethod): void => {
    setPaymentMethod(id);
  };

  const dismissMergeNotice = (): void => setMergeNotice(null);

  const unavailableMessages = serverPreview
    ? serverPreview.groups
        .flatMap((group) => group.items)
        .filter((line) => line.selected && !line.available)
        .map((line) => line.unavailableReason ?? `${line.productName} cannot be ordered right now.`)
    : selectedLines
        .filter((line) => !line.available)
        .map((line) => line.unavailableReason ?? `${line.product.name} cannot be ordered right now.`);
  // In remote mode the checkout must not fall back to locally-derived money: the
  // server owns prices, stock and the voucher, and re-prices again on submit.
  // Until a matching preview has succeeded the place-order action stays blocked
  // and the screen explains why, rather than showing a total the device guessed.
  const pricingConfirmed = Boolean(serverPreview);
  const pricingNotice =
    !serverPreview
      ? previewError ?? 'Confirming delivery and pricing with the store…'
      : null;
  const canPlaceOrder =
    Boolean(address) && selectedLines.length > 0 && unavailableMessages.length === 0 && pricingConfirmed;

  const placeOrder = async (paymentReference?: string): Promise<PlaceOrderResult> => {
    const target = address ?? addresses.find((entry) => entry.id === addressId);
    if (!target) return { ok: false, message: 'Choose a delivery address before placing the order.' };
    try {
      const order = await orderService.createOrder(userId, {
        address: target,
        paymentMethod,
        deliveryMethod,
        voucherCode: appliedVoucher,
        customerName: target.recipientName,
        paymentSimulate: !paymentService.method(paymentMethod).settledOnDelivery,
        paymentReference,
        idempotencyKey: attemptKey,
      });
      refresh();
      return { ok: true, orderId: order.id };
    } catch (failure) {
      refresh();
      return { ok: false, message: failure instanceof Error ? failure.message : 'We could not place your order.' };
    }
  };

  return {
    userId,
    mergeNotice,
    dismissMergeNotice,
    totals: derived.totals,
    groups: derived.totals.groups,
    selectedLines,
    selectedSellerCount,
    hasSelectedItems: selectedLines.length > 0,
    addresses,
    address,
    selectAddress,
    addAddress,
    deliveryMethods: deliveryService.methods(),
    deliveryMethod,
    selectDeliveryMethod,
    deliveryQuote: derived.deliveryQuote,
    paymentMethods: paymentService.methods(),
    paymentMethod,
    selectPaymentMethod,
    voucherCode,
    appliedVoucher,
    voucherError,
    checkoutTotals,
    pricingNotice,
    canPlaceOrder,
    unavailableLines: unavailableMessages,
    placeOrder,
  };
}
