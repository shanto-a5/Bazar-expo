import * as React from 'react';
import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { Button, Card, SectionHeader, taka } from '@/components/ui';
import {
  AddressFormFields,
  EMPTY_ADDRESS_FORM,
  validateAddressForm,
  type AddressFormErrors,
  type AddressFormValue,
} from '@/modules/account/address-form';
import type { CheckoutFlowValue } from '@/modules/checkout/checkout-flow';
import { AddressBlock, ItemsCard, NoticeCard, Radio, SummaryRow } from '@/modules/checkout/checkout-ui';
import { deliveryService } from '@/services/delivery-service';
import { paymentService } from '@/services/payment-service';
import { colors, spacing, type } from '@/theme/tokens';

export function AddressStep({ flow }: { flow: CheckoutFlowValue }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<AddressFormValue>(EMPTY_ADDRESS_FORM);
  const [errors, setErrors] = React.useState<AddressFormErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const update = (key: keyof AddressFormValue, value: string | boolean): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async (): Promise<void> => {
    const found = validateAddressForm(form);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    try {
      await flow.addAddress({ ...form, label: form.label.trim() || 'New address' });
      setForm(EMPTY_ADDRESS_FORM);
      setFormError(null);
      setOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save this address.');
    }
  };

  return (
    <View>
      {flow.addresses.length === 0 && !open ? (
        <NoticeCard tone="info" title="No saved addresses" message="Add the address where this order should be delivered." />
      ) : null}

      {flow.addresses.map((address) => (
        <Radio
          key={address.id}
          selected={flow.address?.id === address.id}
          onPress={() => flow.selectAddress(address.id)}
          label={address.label}
          caption={`${address.recipientName} · ${address.addressLine}, ${address.area}, ${address.district}`}
          trailing={address.isDefault ? 'Default' : undefined}
          accessibilityLabel={`Select address ${address.label}`}
        />
      ))}

      {open ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <SectionHeader title="New address" caption="Saved to your address book" />
          {formError ? (
            <Text style={{ ...type.body, color: colors.danger, marginBottom: spacing.sm }}>{formError}</Text>
          ) : null}
          <AddressFormFields value={form} errors={errors} onChange={update} />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} fullWidth />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Save address" onPress={() => void save()} fullWidth />
            </View>
          </View>
        </Card>
      ) : (
        <Button title="Add new address" variant="secondary" onPress={() => setOpen(true)} fullWidth />
      )}
    </View>
  );
}

export function DeliveryStep({ flow }: { flow: CheckoutFlowValue }): React.JSX.Element {
  const sellers = flow.groups.length;
  return (
    <View>
      {flow.deliveryMethods.map((method) => {
        const quote = deliveryService.quote(method.id, flow.totals.shippingTotal, sellers);
        return (
          <Radio
            key={method.id}
            selected={flow.deliveryMethod === method.id}
            onPress={() => flow.selectDeliveryMethod(method.id)}
            label={method.label}
            caption={`${method.caption} · ${quote.window}`}
            trailing={quote.fee === 0 ? 'Free' : taka(quote.fee)}
            accessibilityLabel={`Select ${method.label}`}
          />
        );
      })}

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={[type.h3, { color: colors.text }]}>What you pay for delivery</Text>
        <Text style={{ ...type.body, color: colors.textMuted, marginTop: spacing.xs }}>
          {flow.totals.shippingTotal === 0
            ? 'Your cart qualifies for free standard shipping.'
            : `Store shipping for this order is ${taka(flow.totals.shippingTotal)}.`}
        </Text>
        {sellers > 1 ? (
          <Text style={{ ...type.caption, marginTop: spacing.xs }}>
            {sellers} sellers ship separately, so express delivery is charged per seller.
          </Text>
        ) : null}
        {flow.deliveryQuote.premiumPerSeller > 0 ? (
          <Text style={{ ...type.caption, marginTop: spacing.xs }}>
            {flow.deliveryQuote.label} adds {taka(flow.deliveryQuote.fee - flow.deliveryQuote.baseFee)} to the store
            shipping fee.
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

export function PaymentStep({ flow }: { flow: CheckoutFlowValue }): React.JSX.Element {
  return (
    <View>
      {flow.paymentMethods.map((method) => (
        <Radio
          key={method.id}
          selected={flow.paymentMethod === method.id}
          onPress={() => flow.selectPaymentMethod(method.id)}
          label={method.label}
          caption={method.caption}
          trailing={method.settledOnDelivery ? 'Pay later' : 'Simulated'}
          accessibilityLabel={`Select ${method.label}`}
        />
      ))}
      <NoticeCard
        tone="info"
        title="No real gateway is connected"
        message="This build records the payment method you choose and the resulting status on the order. No money moves and no card, bKash or Nagad account is contacted."
      />
    </View>
  );
}

export function ReviewStep({ flow, error }: { flow: CheckoutFlowValue; error: string | null }): React.JSX.Element {
  const { address, appliedVoucher, checkoutTotals, deliveryQuote, paymentMethod } = flow;
  return (
    <View>
      {error ? <NoticeCard tone="danger" title="Order not placed" message={error} /> : null}

      {flow.pricingNotice ? (
        <NoticeCard tone="warning" title="Confirming total" message={flow.pricingNotice} />
      ) : null}

      {flow.voucherError ? (
        <NoticeCard
          tone="danger"
          title="Voucher not applied"
          message={`${flow.voucherError} The order will be placed without it.`}
          actionLabel="Edit voucher in cart"
          onAction={() => router.replace('/cart')}
        />
      ) : null}

      {appliedVoucher ? (
        <NoticeCard
          tone="success"
          title={`Voucher ${appliedVoucher} applied`}
          message={`You save ${taka(checkoutTotals.voucherDiscount)} on this order.`}
        />
      ) : null}

      <SectionHeader title="Delivering to" />
      {address ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <AddressBlock address={address} />
        </Card>
      ) : (
        <NoticeCard
          tone="warning"
          title="No delivery address"
          message="Go back to the address step and pick where this order should be delivered."
        />
      )}

      <SectionHeader title="Delivery" />
      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={type.label}>{deliveryQuote.label}</Text>
        <Text style={{ ...type.caption, marginTop: 2 }}>
          {deliveryQuote.caption} · {deliveryQuote.window} ·{' '}
          {checkoutTotals.deliveryFee === 0 ? 'Free' : taka(checkoutTotals.deliveryFee)}
        </Text>
      </Card>

      <SectionHeader title="Payment" />
      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={type.label}>{paymentService.label(paymentMethod)}</Text>
        <Text style={{ ...type.caption, marginTop: 2 }}>{paymentService.method(paymentMethod).caption}</Text>
      </Card>

      <SectionHeader
        title="Items"
        caption={`${flow.totals.itemCount} item(s) from ${flow.groups.length} seller(s)`}
      />
      <ItemsCard groups={flow.groups} />

      <Card style={{ marginBottom: spacing.lg }}>
        <SummaryRow label="Subtotal" value={taka(checkoutTotals.subtotal)} />
        <SummaryRow label="Delivery" value={checkoutTotals.deliveryFee === 0 ? 'Free' : taka(checkoutTotals.deliveryFee)} />
        {checkoutTotals.voucherDiscount > 0 ? (
          <SummaryRow label="Voucher discount" value={`−${taka(checkoutTotals.voucherDiscount)}`} tone="discount" />
        ) : null}
        <View style={{ height: spacing.xs }} />
        <SummaryRow label="Total" value={taka(checkoutTotals.grandTotal)} tone="total" />
      </Card>

      <Text style={{ ...type.caption, textAlign: 'center', color: colors.textFaint }}>
        Stock is checked again when the order is placed. Purchased items leave your cart and unselected items stay.
      </Text>
    </View>
  );
}
