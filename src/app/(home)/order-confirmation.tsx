import * as React from 'react';
import { Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { Button, Card, ProductImage, Screen, SectionHeader, taka } from '@/components/ui';
import { AddressBlock, NoticeCard, SummaryRow } from '@/modules/checkout/checkout-ui';
import { withSession, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { deliveryService } from '@/services/delivery-service';
import { statusLabel as orderStatusLabel, orderService } from '@/services/order-service';
import { paymentService } from '@/services/payment-service';
import { formatDateTime } from '@/utils/time';
import { colors, radius, spacing, type } from '@/theme/tokens';

function OrderConfirmationScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
  const order = orderId ? orderService.getOrder(orderId) : undefined;

  if (!order || order.customerId !== session.user?.id) {
    return (
      <Screen padded>
        <Text style={{ ...type.h1, color: colors.text, marginBottom: spacing.lg }}>Order</Text>
        <NoticeCard
          tone="danger"
          title="Order not found"
          message="We could not find that order. It may belong to another account or the data was cleared."
        />
        <Button title="Go to home" onPress={() => router.replace('/')} fullWidth />
      </Screen>
    );
  }

  const sellerOrders = orderService.sellerOrdersFor(order.id);
  const paymentOption = paymentService.method(order.paymentMethod);
  const deliveryOption = deliveryService.method(order.deliveryMethod);

  return (
    <Screen padded>
      <Card style={{ marginTop: spacing.lg, marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={styles.tick}>
            <Text style={styles.tickGlyph}>✓</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.h1, color: colors.text }}>Order placed</Text>
            <Text style={{ ...type.caption, marginTop: 2 }}>{formatDateTime(order.placedAt)}</Text>
          </View>
        </View>
        <View style={{ height: spacing.lg }} />
        <SummaryRow label="Order code" value={order.orderCode} />
        <SummaryRow label="Status" value={orderStatusLabel(order.status)} />
        <SummaryRow label="Payment" value={`${paymentOption.label} · ${order.paymentStatus === 'paid' ? 'Paid' : 'Due on delivery'}`} />
        <SummaryRow label="Delivery" value={deliveryOption.label} />
        <SummaryRow label="Items" value={`${sellerOrders.reduce((sum, entry) => sum + entry.items.length, 0)} line(s)`} />
      </Card>

      <SectionHeader title="Delivering to" />
      <Card style={{ marginBottom: spacing.lg }}>
        <AddressBlock address={order.shippingAddress} />
      </Card>

      <SectionHeader title="Payment" caption="Simulated — no gateway was contacted" />
      <Card style={{ marginBottom: spacing.lg }}>
        <SummaryRow label="Method" value={paymentOption.label} />
        <SummaryRow label="Status" value={order.paymentStatus === 'paid' ? 'Paid' : 'Pending'} />
        <SummaryRow label="Amount" value={taka(order.total)} />
      </Card>

      <SectionHeader title="Order summary" />
      <Card style={{ marginBottom: spacing.lg }}>
        <SummaryRow label="Subtotal" value={taka(order.subtotal)} />
        <SummaryRow label="Delivery" value={order.shippingTotal === 0 ? 'Free' : taka(order.shippingTotal)} />
        {order.vouchersDiscount > 0 ? (
          <SummaryRow
            label={order.voucherCodes.length ? `Voucher ${order.voucherCodes[0]}` : 'Voucher discount'}
            value={`−${taka(order.vouchersDiscount)}`}
            tone="discount"
          />
        ) : null}
        <View style={{ height: spacing.xs }} />
        <SummaryRow label="Total" value={taka(order.total)} tone="total" />
      </Card>

      <SectionHeader title="Items" caption="Grouped by seller" />
      {sellerOrders.map((sellerOrder) => (
        <Card key={sellerOrder.id} style={{ marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
            <Text style={type.h3}>{sellerOrder.storeName}</Text>
            <Text style={type.caption}>{sellerOrder.status.replace(/_/g, ' ')}</Text>
          </View>
          {sellerOrder.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <ProductImage uri={item.image} size={56} cornerRadius={radius.md} />
              <View style={{ flex: 1 }}>
                <Text style={[type.label, { color: colors.text }]} numberOfLines={2}>
                  {item.productName}
                </Text>
                {item.variantAttributes ? (
                  <Text style={type.caption}>
                    {Object.entries(item.variantAttributes)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' · ')}
                  </Text>
                ) : null}
                <Text style={type.caption}>Qty {item.quantity}</Text>
              </View>
              <Text style={type.body}>{taka(item.subtotal)}</Text>
            </View>
          ))}
          <View style={{ height: spacing.xs }} />
          <SummaryRow label="Seller shipping" value={sellerOrder.shippingFee === 0 ? 'Free' : taka(sellerOrder.shippingFee)} />
          <SummaryRow label="Seller total" value={taka(sellerOrder.total)} tone="primary" />
        </Card>
      ))}

      <Button title="Continue shopping" fullWidth onPress={() => router.replace('/browse')} />
      <View style={{ height: spacing.sm }} />
      <Button title="View cart" variant="secondary" fullWidth onPress={() => router.replace('/cart')} />
    </Screen>
  );
}

const styles = {
  tick: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  tickGlyph: { color: colors.success, fontSize: 26, fontWeight: '700' as const },
  itemRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
};

export default withSession(OrderConfirmationScreen, '/order-confirmation' satisfies ProtectedRoute);
