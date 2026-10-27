import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader, taka } from '@/components/ui';
import { AddressBlock, NoticeCard, SummaryRow } from '@/modules/checkout/checkout-ui';
import {
  MoneySummaryCard,
  OrderItemRow,
  OrderTimeline,
  OrderTotalsCard,
  ReturnReasonCard,
  StatusPill,
  deliveryEtaLabel,
  returnStatusLabel,
} from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { useSession } from '@/modules/session/session-context';
import { withSession, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import {
  orderService,
  statusLabel,
  type CustomerOrderDetail,
} from '@/services/order-service';
import { cartService } from '@/services/cart-service';
import { formatDate, formatDateTime } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

const CANCEL_REASONS = [
  'Ordered by mistake',
  'Delivery is too slow',
  'Found a better price',
  'Product is not needed anymore',
];

function statusNotice(detail: CustomerOrderDetail): { tone: 'info' | 'warning' | 'danger' | 'success'; title: string; message: string } | null {
  const { order } = detail;
  if (order.status === 'cancelled') {
    return {
      tone: 'danger',
      title: 'Order cancelled',
      message: `Cancelled on ${order.cancelledAt ? formatDateTime(order.cancelledAt) : formatDate(order.placedAt)}. Reserved stock was released and any paid amount is recorded as a simulated refund.`,
    };
  }
  if (order.status === 'delivered') {
    return {
      tone: 'success',
      title: 'Delivered',
      message: 'Delivered items can be returned from this screen. The seller decides each request, then records the arrival and refund.',
    };
  }
  if (order.status === 'return_requested' || order.status === 'return_approved') {
    return {
      tone: 'info',
      title: 'Return in progress',
      message: 'The seller reviews the return request. You will be notified when they approve or reject it.',
    };
  }
  if (order.status === 'partially_returned') {
    return {
      tone: 'info',
      title: 'Partly returned',
      message: 'Some units were taken back and refunded. The rest are still yours — you can return them from this screen.',
    };
  }
  if (order.status === 'returned' || order.status === 'refunded') {
    return {
      tone: 'success',
      title: order.status === 'refunded' ? 'Refunded' : 'Returned',
      message: 'The return was completed and the refund is recorded.',
    };
  }
  return {
    tone: 'info',
    title: statusLabel(order.status),
    message: `You can cancel while the order is still being prepared. ${deliveryEtaLabel(order.deliveryMethod)}.`,
  };
}

function OrderDetailScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const { cartOwnerId } = useSession();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const orderId = rawId ?? '';
  const detail = orderService.customerOrderDetail(session.user?.id ?? '', orderId);
  const [confirming, setConfirming] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState(CANCEL_REASONS[0]);
  const [error, setError] = React.useState<string | null>(null);
  const [reorderNote, setReorderNote] = React.useState<string | null>(null);

  if (!detail) {
    return (
      <Screen padded>
        <BackButton fallbackHref="/orders" />
        <Text style={[type.h1, { color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }]}>Order details</Text>
        <NoticeCard
          tone="danger"
          title="Order not found"
          message="We could not find that order for this account. It may belong to another user or the data was cleared."
        />
      </Screen>
    );
  }

  const { order, sellerOrders, returns, transactions, canCancel, cancelBlockReason } = detail;
  const notice = statusNotice(detail);

  const cancel = async (): Promise<void> => {
    try {
      await orderService.cancelOrder(session.user?.id ?? '', order.id, cancelReason);
      setConfirming(false);
      setError(null);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cancellation failed.');
    }
  };

  const reorder = (): void => {
    let candidates: ReturnType<typeof orderService.reorderableItems>;
    try {
      candidates = orderService.reorderableItems(session.user?.id ?? '', order.id);
    } catch {
      setReorderNote('This order cannot be reordered.');
      return;
    }
    let added = 0;
    const failed: string[] = [];
    for (const candidate of candidates) {
      try {
        cartService.addItem(cartOwnerId, candidate.productId, candidate.quantity, candidate.variantId);
        added += 1;
      } catch (error) {
        // Do not claim "no longer available" for what may be a genuine failure.
        failed.push(error instanceof Error ? error.message : candidate.name);
      }
    }
    const total = sellerOrders.reduce((sum, entry) => sum + entry.items.length, 0);
    const unavailable = total - candidates.length;
    if (added > 0) {
      const notes: string[] = [`${added} item${added === 1 ? '' : 's'} added to your cart`];
      if (unavailable > 0) notes.push(`${unavailable} no longer available`);
      if (failed.length > 0) notes.push(`${failed.length} could not be added: ${failed[0]}`);
      setReorderNote(`${notes.join(', ')}.`);
    } else if (failed.length > 0) {
      setReorderNote(`We could not add these items to your cart: ${failed[0]}`);
    } else {
      setReorderNote('None of these items are available to reorder right now.');
    }
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/orders" />
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>Order details</Text>
          <Text style={type.caption}>{`${order.orderCode} · placed ${formatDate(order.placedAt)}`}</Text>
        </View>
        <StatusPill status={order.status} />
      </View>

      {error ? <NoticeCard tone="danger" title="Could not cancel" message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <NoticeCard tone={notice.tone} title={notice.title} message={notice.message} /> : null}

      {canCancel ? (
        confirming ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={[type.h3, { color: colors.text }]}>Cancel this order?</Text>
            <Text style={[type.caption, { marginTop: spacing.xs }]}>Pick a reason so the seller can follow up.</Text>
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {CANCEL_REASONS.map((reason) => (
                <Button
                  key={reason}
                  title={reason}
                  variant={reason === cancelReason ? 'primary' : 'secondary'}
                  onPress={() => setCancelReason(reason)}
                  fullWidth
                />
              ))}
            </View>
            <View style={{ height: spacing.md }} />
            <Button title="Confirm cancellation" variant="danger" onPress={() => void cancel()} fullWidth />
            <View style={{ height: spacing.sm }} />
            <Button title="Keep order" variant="ghost" onPress={() => setConfirming(false)} fullWidth />
          </Card>
        ) : (
          <Button title="Cancel order" variant="danger" onPress={() => setConfirming(true)} fullWidth />
        )
      ) : cancelBlockReason ? (
        <Text style={[type.caption, { marginBottom: spacing.lg }]}>{cancelBlockReason}</Text>
      ) : null}

      <SectionHeader title="Items" caption={`${sellerOrders.length} seller(s) in this order`} />
      {order.status !== 'cancelled' ? (
        <Button title="Reorder available items" variant="secondary" onPress={reorder} fullWidth />
      ) : null}
      {reorderNote ? <Text style={[type.caption, { marginTop: spacing.xs }]}>{reorderNote}</Text> : null}
      {sellerOrders.map((sellerOrder) => (
        <Card key={sellerOrder.id} style={{ marginBottom: spacing.md }}>
          <View style={styles.sellerHeader}>
            <Text style={[type.label, { color: colors.text, flex: 1 }]}>{sellerOrder.storeName}</Text>
            <Text style={type.caption}>{statusLabel(sellerOrder.status)}</Text>
          </View>
          {sellerOrder.items.map((item) => {
            // Only an OPEN return request blocks further returns on this line. A
            // processed (`returned`/`refunded`) or rejected request must not: a partly
            // returned line is still returnable for every unit the customer still
            // holds, and `markReturned` keeps the closed request id on the item - so
            // checking "any request exists" silently killed sequential partial returns.
            const request = item.returnRequestId
              ? returns.find(
                  (entry) =>
                    entry.id === item.returnRequestId &&
                    (entry.status === 'pending' || entry.status === 'approved'),
                )
              : undefined;
            // A partly-returned line can still hand back its remaining units, and a
            // delivered line that was partly returned can still be reviewed for the
            // units the customer kept. Only an open return request blocks both.
            const returnable =
              !request &&
              (item.status === 'delivered' || item.status === 'partially_returned') &&
              orderService.remainingReturnableQuantity(item) > 0;
            const reviewable =
              (item.status === 'delivered' || item.status === 'partially_returned') && !item.hasReview;
            return (
              <OrderItemRow
                key={item.id}
                item={item}
                caption={
                  request
                    ? returnStatusLabel(request.status)
                    : item.status === 'cancelled'
                      ? 'Cancelled'
                      : (item.status === 'delivered' || item.status === 'partially_returned') && item.hasReview
                        ? 'Reviewed'
                        : item.status === 'partially_returned'
                          ? `Partly returned · ${orderService.remainingReturnableQuantity(item)} of ${item.quantity} still yours`
                          : undefined
                }
                actionLabel={returnable ? 'Return' : undefined}
                onAction={() =>
                  router.push({
                    pathname: '/return-request',
                    params: { orderId: order.id, sellerOrderId: sellerOrder.id, itemId: item.id },
                  })
                }
                secondaryActionLabel={
                  reviewable
                    ? 'Write a review'
                    : (item.status === 'delivered' || item.status === 'partially_returned') && item.hasReview
                      ? 'See review'
                      : undefined
                }
                onSecondaryAction={() =>
                  router.push(
                    reviewable
                      ? { pathname: '/write-review', params: { orderItemId: item.id } }
                      : { pathname: '/product/[id]', params: { id: item.productId, reviews: '1' } },
                  )
                }
              />
            );
          })}
          <SummaryRow label="Seller shipping" value={sellerOrder.shippingFee === 0 ? 'Free' : taka(sellerOrder.shippingFee)} />
          <SummaryRow label="Seller total" value={taka(sellerOrder.total)} tone="primary" />
        </Card>
      ))}

      {returns.length > 0 ? (
        <>
          <SectionHeader title="Returns" caption="Decided by the seller for each item" />
          {returns.map((request) => {
            const sellerOrder = sellerOrders.find((entry) => entry.id === request.sellerOrderId);
            const item = sellerOrder?.items.find((entry) => entry.id === request.orderItemId);
            if (!item) return null;
            return (
              <ReturnReasonCard
                key={request.id}
                request={request}
                quantity={orderService.returnQuantity(request, item)}
                amount={orderService.returnRefundAmount(request, item)}
                footer={
                  <Text style={[type.caption, { marginTop: spacing.xs }]}>
                    {`Requested ${formatDate(request.createdAt)} · last update ${formatDate(request.updatedAt)}`}
                  </Text>
                }
              />
            );
          })}
        </>
      ) : null}

      <SectionHeader title="Payment" />
      <OrderTotalsCard order={order} transactions={transactions} />
      <MoneySummaryCard summary={orderService.orderMoneySummary(order)} />

      <SectionHeader title="Delivery" />
      <Card style={{ marginBottom: spacing.lg }}>
        <AddressBlock address={order.shippingAddress} />
        <Text style={[type.caption, { marginTop: spacing.sm }]}>{deliveryEtaLabel(order.deliveryMethod)}</Text>
        {order.cancelledAt ? <Text style={type.caption}>{`Cancelled ${formatDateTime(order.cancelledAt)}`}</Text> : null}
        {order.deliveredAt ? <Text style={type.caption}>{`Delivered ${formatDateTime(order.deliveredAt)}`}</Text> : null}
      </Card>

      <SectionHeader title="Timeline" />
      <Card style={{ marginBottom: spacing.lg }}>
        <OrderTimeline events={orderService.timeLineFor(order, sellerOrders)} />
      </Card>

      <Button title="Back to orders" variant="secondary" onPress={() => router.replace('/orders')} fullWidth />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.lg },
  sellerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
});

export default withSession(OrderDetailScreen, '/orders' satisfies ProtectedRoute);
