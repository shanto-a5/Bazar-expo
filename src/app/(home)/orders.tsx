import * as React from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, taka } from '@/components/ui';
import { EmptyState, FilterTabs, OrderItemRow, StatusPill } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSession, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { orderService, statusLabel, type CustomerOrderSummary } from '@/services/order-service';
import { notificationService } from '@/services/notification-service';
import type { OrderStatus } from '@/domain/types';
import { useListingCache } from '@/modules/cache/use-listing-cache';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { formatDate, relativeTime } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'progress', label: 'In progress' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

const IN_PROGRESS: OrderStatus[] = [
  'placed',
  'new',
  'confirmed',
  'processing',
  'packed',
  'ready_to_ship',
  'shipped',
  'out_for_delivery',
  'return_requested',
  'return_approved',
];

// A partial return has already arrived and been partly taken back, so it groups
// with delivered rather than with an in-flight return decision.
const DELIVERED_GROUP: OrderStatus[] = ['delivered', 'partially_returned', 'returned', 'refunded'];

function bucketFor(status: OrderStatus): string {
  if (status === 'cancelled') return 'cancelled';
  if (IN_PROGRESS.includes(status)) return 'progress';
  if (DELIVERED_GROUP.includes(status)) return 'delivered';
  return 'all';
}

function OrderCard({ entry }: { entry: CustomerOrderSummary }): React.JSX.Element {
  const { order, preview, lineCount, itemCount, sellerCount } = entry;
  const hidden = lineCount - preview.length;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.orderCode}, ${statusLabel(order.status)}, ${taka(order.total)}`}
    >
      <Card style={{ marginBottom: spacing.md }}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[type.h3, { color: colors.text }]}>{order.orderCode}</Text>
            <Text style={type.caption}>
              {`${formatDate(order.placedAt)} · ${relativeTime(order.placedAt)}`}
            </Text>
          </View>
          <StatusPill status={order.status} />
        </View>
        <Text style={[type.caption, { marginBottom: spacing.sm }]}>
          {`${itemCount} item(s) · ${sellerCount} seller(s) · ${order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'}`}
        </Text>
        {preview.map((item) => (
          <OrderItemRow key={item.id} item={item} />
        ))}
        {hidden > 0 ? <Text style={type.caption}>{`+${hidden} more line(s)`}</Text> : null}
        <View style={styles.cardFooter}>
          <Text style={type.label}>{`Total ${taka(order.total)}`}</Text>
          <Text style={styles.link}>View details</Text>
        </View>
      </Card>
    </Pressable>
  );
}

function OrdersScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const [filter, setFilter] = React.useState<string>('all');
  const userId = session.user?.id ?? '';
  const { refreshing, refresh: refreshOrders, error: ordersError, retry: retryOrders } = useListingCache(userId, 'orders');
  const orders = orderService.customerOrderList(userId);
  const unread = notificationService.unreadCount(userId);
  const visible = orders.filter((entry) => filter === 'all' || bucketFor(entry.order.status) === filter);

  return (
    <Screen
      padded
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refreshOrders} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      <BackButton fallbackHref="/settings" />
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>My orders</Text>
          <Text style={type.caption}>{`${orders.length} order(s)`}</Text>
        </View>
        <Button
          title={unread > 0 ? `Notifications (${unread})` : 'Notifications'}
          variant="secondary"
          onPress={() => {
            refresh();
            router.push('/notifications');
          }}
        />
      </View>

      {ordersError ? (
        <View style={{ marginTop: spacing.lg }}>
          <NoticeCard
            tone="warning"
            title="Couldn't refresh"
            message={ordersError}
            actionLabel="Try again"
            onAction={retryOrders}
          />
        </View>
      ) : null}

      {orders.length > 0 ? (
        <View style={{ marginTop: spacing.lg }}>
          <FilterTabs tabs={FILTERS.map((f) => ({ key: f.key, label: f.label }))} active={filter} onChange={setFilter} />
        </View>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title={orders.length === 0 ? 'No orders yet' : 'Nothing in this filter'}
          message={
            orders.length === 0
              ? 'When you place an order it appears here with live status, cancellation and return options.'
              : 'Try another filter to see the rest of your orders.'
          }
          actionLabel={orders.length === 0 ? 'Start browsing' : undefined}
          onAction={orders.length === 0 ? () => router.push('/browse') : undefined}
        />
      ) : (
        visible.map((entry) => <OrderCard key={entry.order.id} entry={entry} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  link: { color: colors.primary, fontSize: 13, fontWeight: '700' },
});

export default withSession(OrdersScreen, '/orders' satisfies ProtectedRoute);
