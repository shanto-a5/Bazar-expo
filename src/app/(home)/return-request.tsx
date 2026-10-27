import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Field, Screen, SectionHeader, taka } from '@/components/ui';
import { NoticeCard, Radio, SummaryRow } from '@/modules/checkout/checkout-ui';
import { Pill, returnReasonLabel, returnStatusLabel } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSession, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { orderService } from '@/services/order-service';
import type { ReturnReason } from '@/domain/types';
import { formatDate } from '@/utils/time';
import { colors, radius, spacing, type } from '@/theme/tokens';

const REASONS: ReturnReason[] = [
  'damaged',
  'defective',
  'wrong_item',
  'missing_item',
  'does_not_match_description',
  'incorrect_size',
  'other',
];

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function ReturnRequestScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const params = useLocalSearchParams<{
    orderId?: string | string[];
    sellerOrderId?: string | string[];
    itemId?: string | string[];
  }>();
  const orderId = firstParam(params.orderId);
  const sellerOrderId = firstParam(params.sellerOrderId);
  const itemId = firstParam(params.itemId);

  const detail = orderService.customerOrderDetail(session.user?.id ?? '', orderId);
  const sellerOrder = detail?.sellerOrders.find((entry) => entry.id === sellerOrderId);
  const item = sellerOrder?.items.find((entry) => entry.id === itemId);
  // Only an OPEN request blocks a new one. A processed or rejected request must
  // let the customer file for the units they still hold (sequential partials).
  const openRequest = detail?.returns.find(
    (entry) => entry.orderItemId === itemId && (entry.status === 'pending' || entry.status === 'approved'),
  );

  const [quantity, setQuantity] = React.useState(1);
  const [reason, setReason] = React.useState<ReturnReason>('defective');
  const [description, setDescription] = React.useState('');
  const [resolution, setResolution] = React.useState<'refund' | 'replacement'>('refund');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // A partly-returned line is still returnable for what the customer keeps.
  const returnable = item ? orderService.remainingReturnableQuantity(item) : 0;
  const alreadyReturned = item ? item.quantity - returnable : 0;
  const eligible =
    !!item && (item.status === 'delivered' || item.status === 'partially_returned') && returnable > 0;

  if (detail && openRequest) {
    // A repeat submit (or a fresh open of this screen) must show the request the
    // server already holds and its status, not offer the form again.
    return (
      <Screen padded>
        <BackButton fallbackHref="/orders" />
        <Text style={[type.h1, { color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }]}>Return request</Text>
        <NoticeCard
          tone="info"
          title="Return already requested"
          message={`Your return for ${item?.productName ?? 'this item'} is already on file: ${returnStatusLabel(openRequest.status)}. The seller updates it and you are notified.`}
        />
        <View style={{ height: spacing.md }} />
        <Button
          title="Back to order"
          onPress={() => router.replace({ pathname: '/order/[id]', params: { id: orderId } })}
          fullWidth
        />
      </Screen>
    );
  }

  if (!detail || !sellerOrder || !item || !eligible) {
    return (
      <Screen padded>
        <BackButton fallbackHref="/orders" />
        <Text style={[type.h1, { color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg }]}>Request a return</Text>
        <NoticeCard
          tone="danger"
          title="This item cannot be returned"
          message={
            item && alreadyReturned >= item.quantity
              ? 'Every unit of this item has already been returned.'
              : 'Only delivered items from your own orders can be returned. Open the order again to see what is eligible.'
          }
        />
      </Screen>
    );
  }

  const maxQuantity = returnable;
  const safeQuantity = Math.max(1, Math.min(quantity, maxQuantity));
  const refundEstimate = orderService.refundEstimateForItem(item, safeQuantity);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await orderService.requestReturn(session.user?.id ?? '', sellerOrderId, itemId, {
        reason,
        description: description.trim(),
        images: [],
        preferredResolution: resolution,
        quantity: safeQuantity,
      });
      router.replace({ pathname: '/order/[id]', params: { id: orderId } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not submit this return.');
      setBusy(false);
      // The failure may be a duplicate the server already holds; re-read the
      // returns so the open-request notice above replaces the form.
      refresh();
    }
  };

  return (
    <Screen padded>
      <BackButton fallbackHref={{ pathname: '/order/[id]', params: { id: orderId } }} />
      <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>Request a return</Text>
      <Text style={[type.caption, { marginBottom: spacing.lg }]}>
        {`${detail.order.orderCode} · ${sellerOrder.storeName}`}
      </Text>

      {error ? <NoticeCard tone="danger" title="Return not submitted" message={error} onDismiss={() => setError(null)} /> : null}

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={[type.label, { color: colors.text }]}>{item.productName}</Text>
        <Text style={type.caption}>
          {detail.order.deliveredAt ? `Delivered on ${formatDate(detail.order.deliveredAt)}` : 'Delivered for this order'}
        </Text>
        <View style={{ height: spacing.md }} />
        <SummaryRow label="Unit price" value={taka(item.unitPrice)} />
        <SummaryRow label="Ordered quantity" value={String(item.quantity)} />
        {alreadyReturned > 0 ? (
          <SummaryRow label="Already returned" value={`${alreadyReturned} of ${item.quantity}`} tone="discount" />
        ) : null}
        <SummaryRow label="Still returnable" value={String(maxQuantity)} />
        <SummaryRow
          label={resolution === 'refund' ? 'Estimated refund' : 'Requested resolution'}
          value={resolution === 'refund' ? `${taka(refundEstimate)} (simulated)` : 'Replacement item'}
          tone={resolution === 'refund' ? 'discount' : 'primary'}
        />
      </Card>

      <SectionHeader
        title="How many units"
        caption={
          alreadyReturned > 0
            ? `Return between 1 and ${maxQuantity} of the ${maxQuantity} you still have`
            : `Return between 1 and ${maxQuantity}`
        }
      />
      <View style={styles.qtyRow}>
        <Pressable
          onPress={() => setQuantity((value) => Math.max(1, value - 1))}
          accessibilityRole="button"
          accessibilityLabel="Decrease return quantity"
          style={styles.qtyButton}
        >
          <Text style={styles.qtyGlyph}>−</Text>
        </Pressable>
        <View style={styles.qtyValue}>
          <Text style={[type.h2, { color: colors.text }]}>{String(quantity)}</Text>
        </View>
        <Pressable
          onPress={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}
          accessibilityRole="button"
          accessibilityLabel="Increase return quantity"
          style={styles.qtyButton}
        >
          <Text style={styles.qtyGlyph}>+</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pill label={`of ${maxQuantity}`} tone="info" />
      </View>

      <SectionHeader title="Reason" />
      {REASONS.map((entry) => (
        <Radio
          key={entry}
          selected={reason === entry}
          label={returnReasonLabel(entry)}
          accessibilityLabel={`Return reason: ${returnReasonLabel(entry)}`}
          onPress={() => setReason(entry)}
        />
      ))}

      <SectionHeader title="What happened?" />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="A short note helps the seller decide faster"
        multiline
        minHeight={88}
        hint="Shared with the seller"
      />

      <SectionHeader title="How should this be settled?" />
      <Radio
        selected={resolution === 'refund'}
        label="Refund to the original payment method"
        caption="Simulated — no gateway is contacted"
        accessibilityLabel="Resolution: refund"
        onPress={() => setResolution('refund')}
      />
      <Radio
        selected={resolution === 'replacement'}
        label="Send a replacement"
        caption="The seller approves a replacement instead of a refund"
        accessibilityLabel="Resolution: replacement"
        onPress={() => setResolution('replacement')}
      />

      <Button title="Submit return request" onPress={() => void submit()} loading={busy} fullWidth />
      <View style={{ height: spacing.sm }} />
      <Button
        title="Back to order"
        variant="ghost"
        onPress={() => router.replace({ pathname: '/order/[id]', params: { id: orderId } })}
        fullWidth
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  qtyButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyGlyph: { fontSize: 20, fontWeight: '700', color: colors.primary },
  qtyValue: { minWidth: 56, alignItems: 'center' },
});

export default withSession(ReturnRequestScreen, '/return-request' satisfies ProtectedRoute);