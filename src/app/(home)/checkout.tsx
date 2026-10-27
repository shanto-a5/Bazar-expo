import * as React from 'react';
import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { Button, Card, Screen, taka } from '@/components/ui';
import { goBackOrReplace } from '@/modules/navigation/back';
import { useCheckoutFlow } from '@/modules/checkout/checkout-flow';
import { AddressStep, DeliveryStep, PaymentStep, ReviewStep } from '@/modules/checkout/checkout-steps';
import { BkashPaymentSheet } from '@/modules/checkout/bkash-payment';
import { NagadPaymentSheet } from '@/modules/checkout/nagad-payment';
import { CardPaymentSheet } from '@/modules/checkout/card-payment';
import { CHECKOUT_STEPS, NavRow, NoticeCard, SummaryRow } from '@/modules/checkout/checkout-ui';
import { withSession, type ProtectedRoute } from '@/modules/session/route-guard';
import { colors, spacing, type } from '@/theme/tokens';

const STEP_INDEX: Record<(typeof CHECKOUT_STEPS)[number], number> = {
  Address: 0,
  Delivery: 1,
  Payment: 2,
  Review: 3,
};

type StepName = (typeof CHECKOUT_STEPS)[number];

const STEP_TITLES: Record<StepName, string> = {
  Address: 'Delivery address',
  Delivery: 'Delivery method',
  Payment: 'Payment method',
  Review: 'Review order',
};

const STEP_CONTINUE: Record<StepName, string> = {
  Address: 'Continue to delivery',
  Delivery: 'Continue to payment',
  Payment: 'Review order',
  Review: 'Place order',
};

function CheckoutScreen(): React.JSX.Element {
  const flow = useCheckoutFlow();
  const [step, setStep] = React.useState<StepName>('Address');
  const [placing, setPlacing] = React.useState(false);
  const [placeError, setPlaceError] = React.useState<string | null>(null);
  // bKash, Nagad and card are the methods that are not settled by placing the
  // order: each hands the customer off to its local payment sheet first, and the
  // order is only created once that sheet reports a successful payment.
  const [sheetMethod, setSheetMethod] = React.useState<'bkash' | 'nagad' | 'card' | null>(null);

  const index = STEP_INDEX[step];
  // Checkout is ONE route with internal step state, so stepping backwards is a
  // state change (Address -> Delivery -> Payment -> Review) and must not touch
  // the route stack. Leaving checkout entirely does pop the route, so native
  // back and the visible control both exit to wherever checkout was opened from.
  const leave = (): void => goBackOrReplace('/cart');
  const goBack = (): void => {
    if (index === 0) leave();
    else setStep(CHECKOUT_STEPS[index - 1]);
  };

  const placeOrder = async (paymentReference?: string): Promise<void> => {
    setPlacing(true);
    setPlaceError(null);
    const result = await flow.placeOrder(paymentReference);
    if (result.ok) {
      router.replace({ pathname: '/order-confirmation', params: { orderId: result.orderId } });
      return;
    }
    setPlaceError(result.message);
    setPlacing(false);
  };

  const goNext = (): void => {
    if (index < CHECKOUT_STEPS.length - 1) setStep(CHECKOUT_STEPS[index + 1]);
  };

  // Online wallets and cards confirm the payment before the order is written,
  // so the final button opens the payment sheet instead of placing straight
  // away. Walking away from the sheet leaves the cart untouched and no order
  // behind. Cash on delivery still places directly and settles on delivery.
  const primaryAction = (): void => {
    if (step !== 'Review') {
      goNext();
      return;
    }
    if (flow.paymentMethod === 'bkash' || flow.paymentMethod === 'nagad' || flow.paymentMethod === 'card') {
      setSheetMethod(flow.paymentMethod);
      return;
    }
    void placeOrder();
  };

  if (!flow.hasSelectedItems) {
    return (
      <Screen padded>
        <Button title="Back to cart" variant="ghost" onPress={leave} />
        <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }}>Checkout</Text>
        <Card>
          <Text style={type.h3}>Nothing to check out</Text>
          <Text style={{ ...type.body, marginTop: spacing.sm }}>
            Select at least one item in your cart and we will walk you through address, delivery and payment.
          </Text>
          <View style={{ height: spacing.lg }} />
          <Button title="Go to cart" onPress={() => router.replace('/cart')} fullWidth />
          <View style={{ height: spacing.sm }} />
          <Button title="Browse products" variant="secondary" onPress={() => router.replace('/browse')} fullWidth />
        </Card>
      </Screen>
    );
  }

  const blocked = step === 'Address' && !flow.address;

  return (
    <Screen padded>
      <Button title={index === 0 ? 'Back to cart' : 'Back'} variant="ghost" onPress={goBack} />

      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs }}>Checkout</Text>
      <Text style={{ ...type.label, color: colors.primary, marginBottom: spacing.xs }}>
        Step {index + 1} of {CHECKOUT_STEPS.length} · {STEP_TITLES[step]}
      </Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
        {flow.selectedLines.length} selected line(s) · {flow.totals.itemCount} item
        {flow.totals.itemCount === 1 ? '' : 's'} · {flow.selectedSellerCount} seller(s)
      </Text>

      {flow.mergeNotice ? (
        <NoticeCard
          tone="info"
          title={`${flow.mergeNotice.lines.length} guest cart item${flow.mergeNotice.lines.length === 1 ? '' : 's'} merged`}
          message={[
            flow.mergeNotice.adjusted.length
              ? `Adjusted to available stock: ${flow.mergeNotice.adjusted
                  .map((entry) => `${entry.productName} (${entry.kept} of ${entry.requested})`)
                  .join(', ')}.`
              : '',
            flow.mergeNotice.unavailable.length
              ? `Could not be merged: ${flow.mergeNotice.unavailable
                  .map((entry) => `${entry.productName} (${entry.reason})`)
                  .join(', ')}.`
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onDismiss={flow.dismissMergeNotice}
        />
      ) : null}

      {flow.unavailableLines.length ? (
        <NoticeCard
          tone="danger"
          title="Some selected items cannot be ordered"
          message={flow.unavailableLines.join(' ')}
        />
      ) : null}

      {step === 'Address' ? <AddressStep flow={flow} /> : null}
      {step === 'Delivery' ? <DeliveryStep flow={flow} /> : null}
      {step === 'Payment' ? <PaymentStep flow={flow} /> : null}
      {step === 'Review' ? <ReviewStep flow={flow} error={placeError} /> : null}

      {step === 'Review' ? (
        <Card style={{ marginTop: spacing.lg, marginBottom: spacing.md }}>
          <SummaryRow label="Items" value={taka(flow.checkoutTotals.subtotal)} />
          <SummaryRow
            label={`Delivery · ${flow.deliveryQuote.label}`}
            value={flow.checkoutTotals.deliveryFee === 0 ? 'Free' : taka(flow.checkoutTotals.deliveryFee)}
          />
          {flow.checkoutTotals.voucherDiscount > 0 ? (
            <SummaryRow
              label={flow.appliedVoucher ? `Voucher ${flow.appliedVoucher}` : 'Voucher discount'}
              value={`−${taka(flow.checkoutTotals.voucherDiscount)}`}
              tone="discount"
            />
          ) : null}
          <View style={{ height: spacing.xs }} />
          <SummaryRow label="Total" value={taka(flow.checkoutTotals.grandTotal)} tone="total" />
        </Card>
      ) : null}

      <Button
        title={STEP_CONTINUE[step]}
        fullWidth
        loading={step === 'Review' && placing}
        disabled={blocked || (step === 'Review' && !flow.canPlaceOrder)}
        onPress={primaryAction}
      />

      {step === 'Review' ? (
        <Text style={{ ...type.caption, marginTop: spacing.sm, textAlign: 'center', color: colors.textFaint }}>
          {flow.paymentMethod === 'bkash' || flow.paymentMethod === 'nagad' || flow.paymentMethod === 'card'
            ? `You will confirm the payment in the ${flow.paymentMethods.find((method) => method.id === flow.paymentMethod)?.label ?? 'payment'} sheet. Nothing is charged until it succeeds.`
            : 'Placing the order saves it to your account and reserves the stock for your items.'}
        </Text>
      ) : null}

      <View style={{ height: spacing.xl }} />

      <NavRow
        label="Delivery address"
        value={flow.address ? `${flow.address.label} · ${flow.address.area}, ${flow.address.district}` : 'No address selected yet'}
        missing={!flow.address}
        onPress={() => setStep('Address')}
      />
      <NavRow
        label="Delivery method"
        value={`${flow.deliveryQuote.label} · ${flow.deliveryQuote.window}`}
        onPress={() => setStep('Delivery')}
      />
      <NavRow
        label="Payment method"
        value={flow.paymentMethods.find((method) => method.id === flow.paymentMethod)?.label ?? flow.paymentMethod}
        onPress={() => setStep('Payment')}
      />

      {sheetMethod === 'bkash' && flow.paymentMethod === 'bkash' ? (
        // Mounted only while open, so every run starts from a clean wallet
        // screen and no OTP or PIN from a previous attempt survives.
        <BkashPaymentSheet
          visible
          amount={flow.checkoutTotals.grandTotal}
          stores={flow.groups
            .filter((group) => group.items.some((line) => line.selected))
            .map((group) => group.store.name)}
          onCancel={() => setSheetMethod(null)}
          onSuccess={(receipt) => {
            setSheetMethod(null);
            void placeOrder(receipt.reference);
          }}
        />
      ) : null}

      {sheetMethod === 'nagad' && flow.paymentMethod === 'nagad' ? (
        // Mounted only while open, so every run starts from a clean wallet
        // screen and no OTP or PIN from a previous attempt survives.
        <NagadPaymentSheet
          visible
          amount={flow.checkoutTotals.grandTotal}
          stores={flow.groups
            .filter((group) => group.items.some((line) => line.selected))
            .map((group) => group.store.name)}
          onCancel={() => setSheetMethod(null)}
          onSuccess={(receipt) => {
            setSheetMethod(null);
            void placeOrder(receipt.reference);
          }}
        />
      ) : null}

      {sheetMethod === 'card' && flow.paymentMethod === 'card' ? (
        // Mounted only while open, so every run starts from a clean card form
        // and no details or verification code from a previous attempt survives.
        <CardPaymentSheet
          visible
          amount={flow.checkoutTotals.grandTotal}
          stores={flow.groups
            .filter((group) => group.items.some((line) => line.selected))
            .map((group) => group.store.name)}
          phone={flow.address?.phone ?? ''}
          onCancel={() => setSheetMethod(null)}
          onSuccess={(receipt) => {
            setSheetMethod(null);
            void placeOrder(receipt.reference);
          }}
        />
      ) : null}
    </Screen>
  );
}

// The order wall is the frictionless gate: a signed-out customer who taps
// "Place order" gets the phone-only quick account, not the full sign-in form.
export default withSession(CheckoutScreen, '/checkout' satisfies ProtectedRoute, { gate: 'quick' });