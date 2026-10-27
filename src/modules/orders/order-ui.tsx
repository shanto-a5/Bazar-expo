import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  DeliveryMethodId,
  Order,
  OrderItemSnapshot,
  OrderStatus,
  PaymentStatus,
  PaymentTransaction,
  ReturnReason,
  ReturnRequest,
} from '@/domain/types';
import { Button, Card, ProductImage, taka } from '@/components/ui';
import { SummaryRow } from '@/modules/checkout/checkout-ui';
import { statusLabel, type OrderMoneyLine, type OrderMoneySummary } from '@/services/order-service';
import { paymentService } from '@/services/payment-service';
import { deliveryService } from '@/services/delivery-service';
import { colors, radius, spacing, type } from '@/theme/tokens';
import { formatDateTime, relativeTime } from '@/utils/time';

type Tone = 'info' | 'success' | 'warning' | 'neutral';

const TONE_PALETTE: Record<Tone, { background: string; text: string }> = {
  info: { background: colors.primarySoft, text: colors.primaryDark },
  success: { background: colors.successSoft, text: colors.success },
  warning: { background: colors.surfaceMuted, text: colors.text },
  neutral: { background: colors.surfaceMuted, text: colors.textMuted },
};

const STATUS_TONES: Record<OrderStatus, Tone> = {
  new: 'info',
  placed: 'info',
  confirmed: 'info',
  processing: 'info',
  packed: 'info',
  ready_to_ship: 'info',
  shipped: 'warning',
  out_for_delivery: 'warning',
  delivered: 'success',
  cancelled: 'neutral',
  return_requested: 'warning',
  return_approved: 'warning',
  partially_returned: 'warning',
  returned: 'warning',
  refunded: 'success',
};

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: 'Payment pending',
  authorized: 'Payment authorized',
  paid: 'Payment complete',
  failed: 'Payment failed',
  refunded: 'Payment refunded',
};

const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  damaged: 'Damaged in transit',
  defective: 'Defective or not working',
  wrong_item: 'Wrong item delivered',
  missing_item: 'Missing from the parcel',
  does_not_match_description: 'Does not match the description',
  incorrect_size: 'Incorrect size or variant',
  other: 'Something else',
};

const RETURN_STATUS_LABELS: Record<ReturnRequest['status'], string> = {
  pending: 'Awaiting seller decision',
  approved: 'Approved — send the item back',
  rejected: 'Rejected',
  returned: 'Returned',
  refunded: 'Refunded',
};

const RETURN_STATUS_TONES: Record<ReturnRequest['status'], Tone> = {
  pending: 'warning',
  approved: 'info',
  rejected: 'neutral',
  returned: 'warning',
  refunded: 'success',
};

export function returnReasonLabel(reason: ReturnReason): string {
  return RETURN_REASON_LABELS[reason];
}

export function returnStatusLabel(status: ReturnRequest['status']): string {
  return RETURN_STATUS_LABELS[status];
}

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_LABELS[status];
}

export function deliveryEtaLabel(method: DeliveryMethodId): string {
  const option = deliveryService.method(method);
  return `${option.label} · ${option.daysMin}-${option.daysMax} days`;
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }): React.JSX.Element {
  const palette = TONE_PALETTE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      <Text style={[styles.pillText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: OrderStatus }): React.JSX.Element {
  return <Pill label={statusLabel(status)} tone={STATUS_TONES[status]} />;
}

export function ReturnStatusPill({ status }: { status: ReturnRequest['status'] }): React.JSX.Element {
  return <Pill label={RETURN_STATUS_LABELS[status]} tone={RETURN_STATUS_TONES[status]} />;
}

export function OrderItemRow({
  item,
  caption,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  onPress,
}: {
  item: OrderItemSnapshot;
  caption?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  onPress?: () => void;
}): React.JSX.Element {
  const body = (
    <View style={styles.itemRow}>
      <ProductImage uri={item.image} size={52} cornerRadius={radius.sm} />
      <View style={styles.itemBody}>
        <Text style={[type.label, { color: colors.text }]} numberOfLines={2}>
          {item.productName}
        </Text>
        {item.variantAttributes ? (
          <Text style={type.caption} numberOfLines={1}>
            {Object.entries(item.variantAttributes)
              .map(([key, value]) => `${key}: ${value}`)
              .join(' · ')}
          </Text>
        ) : null}
        <Text style={type.caption}>{`Qty ${item.quantity} · ${taka(item.unitPrice)} each`}</Text>
        {caption ? <Text style={styles.itemCaption}>{caption}</Text> : null}
      </View>
      <View style={styles.itemTrailing}>
        <Text style={[type.label, { color: colors.text }]}>{taka(item.subtotal)}</Text>
        {actionLabel ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} for ${item.productName}`}
            hitSlop={8}
            style={styles.itemAction}
          >
            <Text style={styles.itemActionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        {secondaryActionLabel ? (
          <Pressable
            onPress={onSecondaryAction}
            accessibilityRole="button"
            accessibilityLabel={`${secondaryActionLabel} for ${item.productName}`}
            hitSlop={8}
            style={styles.itemAction}
          >
            <Text style={styles.itemActionText}>{secondaryActionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
        accessibilityLabel={`${item.productName}, quantity ${item.quantity}, ${taka(item.subtotal)}`}
        hitSlop={8}
    >
      {body}
    </Pressable>
  );
}

export function OrderTimeline({
  events,
}: {
  events: { status: OrderStatus; label: string; at: string }[];
}): React.JSX.Element {
  return (
    <View>
      {events.map((event, index) => (
        <View key={`${event.status}-${event.at}-${index}`} style={styles.timelineRow}>
          <View style={styles.timelineRail}>
            <View
              style={[
                styles.timelineDot,
                index === events.length - 1 ? styles.timelineDotLast : null,
                { backgroundColor: index === events.length - 1 ? colors.primary : colors.border },
              ]}
            />
            {index < events.length - 1 ? <View style={styles.timelineLine} /> : null}
          </View>
          <View style={styles.timelineBody}>
            <Text style={[type.label, { color: colors.text }]}>{event.label}</Text>
            <Text style={type.caption}>{`${formatDateTime(event.at)} · ${relativeTime(event.at)}`}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function OrderTotalsCard({
  order,
  transactions,
}: {
  order: Order;
  transactions: PaymentTransaction[];
}): React.JSX.Element {
  const transaction = transactions[0];
  return (
    <Card style={{ marginBottom: spacing.lg }}>
      <SummaryRow label="Subtotal" value={taka(order.subtotal)} />
      <SummaryRow label="Shipping" value={taka(order.shippingTotal)} />
      {order.vouchersDiscount > 0 ? (
        <SummaryRow label="Voucher discount" value={`−${taka(order.vouchersDiscount)}`} tone="discount" />
      ) : null}
      <SummaryRow label="Total" value={taka(order.total)} tone="total" />
      <View style={styles.metaBlock}>
        <Text style={type.body}>
          {`Paid via ${paymentService.label(order.paymentMethod)} · ${paymentStatusLabel(order.paymentStatus)}`}
        </Text>
        {transaction?.reference ? <Text style={type.caption}>{`Reference ${transaction.reference}`}</Text> : null}
        {transaction?.status === 'refunded' ? (
          <Text style={styles.refundLine}>
            {transaction.refundedAmount !== undefined && transaction.refundedAmount < transaction.amount
              ? `Partial refund ${taka(transaction.refundedAmount)} of ${taka(transaction.amount)} (simulated)`
              : `Full refund ${taka(transaction.amount)} (simulated)`}
          </Text>
        ) : null}
        {transaction?.status === 'refunded' && order.paymentStatus !== 'refunded' ? (
          <Text style={type.caption}>Order payment stays recorded until the full amount is refunded.</Text>
        ) : null}
      </View>
    </Card>
  );
}

export function MoneySummaryCard({
  summary,
  title = 'Money',
  caption,
}: {
  summary: OrderMoneySummary;
  title?: string;
  caption?: string;
}): React.JSX.Element {
  return (
    <Card style={{ marginBottom: spacing.lg }}>
      <Text style={type.h3}>{title}</Text>
      <Text style={[type.body, styles.moneyHeadline]} accessibilityLabel={`${title}: ${summary.headline}`}>
        {summary.headline}
      </Text>
      <Text style={type.caption} accessibilityLabel={`${summary.orderCode}, ${summary.settled ? 'settled' : 'still open'}`}>
        {caption
          ? `${caption} · ${summary.settled ? 'settled' : 'still open'}`
          : `${summary.orderCode} · ${paymentService.label(summary.paymentMethod)} · ${summary.settled ? 'settled' : 'still open'}`}
      </Text>
      <View style={styles.moneyLines}>
        {summary.lines.map((line) => (
          <SummaryRow
            key={line.kind + '-' + line.label}
            label={line.label}
            value={`${line.amount < 0 ? '−' : ''}${taka(Math.abs(line.amount))}`}
            tone={MONEY_TONE[line.kind]}
          />
        ))}
      </View>
      {summary.note ? <Text style={type.caption}>{summary.note}</Text> : null}
    </Card>
  );
}

const MONEY_TONE: Record<OrderMoneyLine['kind'], 'default' | 'discount' | 'primary'> = {
  paid: 'default',
  discount: 'discount',
  refunded: 'discount',
  due: 'primary',
};

export function FilterTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`Filter: ${tab.label}`}
            style={[styles.tab, selected ? styles.tabOn : null]}
          >
            <Text style={[type.label, { color: selected ? colors.primary : colors.textMuted }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <Text style={[type.h3, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.body, { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs }]}>{message}</Text>
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button title={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

export function ReturnReasonCard({
  request,
  quantity,
  amount,
  footer,
}: {
  request: ReturnRequest;
  quantity: number;
  amount: number;
  footer?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={styles.returnHeader}>
        <Text style={[type.label, { color: colors.text, flex: 1 }]} numberOfLines={2}>
          {request.productName}
        </Text>
        <ReturnStatusPill status={request.status} />
      </View>
      <Text style={type.body}>{RETURN_REASON_LABELS[request.reason]}</Text>
      {request.description ? <Text style={type.caption}>{request.description}</Text> : null}
      <Text style={[type.caption, { marginTop: spacing.sm }]}>
        {`Quantity ${quantity}${request.preferredResolution === 'refund' ? ` · Refund ${taka(amount)}` : ' · Replacement requested'}`}
      </Text>
      {footer}
    </Card>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '700' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  itemBody: { flex: 1, gap: 2 },
  itemTrailing: { alignItems: 'flex-end', gap: spacing.xs },
  itemCaption: { ...type.caption, color: colors.primary, fontWeight: '600' },
  itemAction: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  itemActionText: { ...type.caption, color: colors.primary, fontWeight: '700' },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { alignItems: 'center', width: 14 },
  timelineDot: { width: 12, height: 12, borderRadius: radius.pill, marginTop: 3 },
  timelineDotLast: { width: 14, height: 14, marginTop: 1 },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  timelineBody: { flex: 1, paddingBottom: spacing.lg },
  metaBlock: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  refundLine: { ...type.label, color: colors.success, marginTop: spacing.xs },
  moneyHeadline: { marginTop: spacing.xs },
  moneyLines: { marginTop: spacing.md, gap: 2 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  tab: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  returnHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
});
