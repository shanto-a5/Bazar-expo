import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen } from '@/components/ui';
import { EmptyState, Pill } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { withSession, type ProtectedRoute } from '@/modules/session/route-guard';
import type { SessionContextValue } from '@/modules/session/session-context';
import { notificationService } from '@/services/notification-service';
import type { AppNotification } from '@/domain/types';
import { relativeTime } from '@/utils/time';
import { colors, spacing, type } from '@/theme/tokens';

function toneFor(notification: AppNotification): 'info' | 'success' | 'warning' | 'neutral' {
  if (notification.type.startsWith('seller_')) return 'success';
  if (notification.type.startsWith('return_')) return 'warning';
  if (notification.type.startsWith('order_')) return 'info';
  return 'neutral';
}

function groupLabel(notification: AppNotification): string {
  if (notification.type.startsWith('seller_')) return 'Selling';
  if (notification.type.startsWith('return_')) return 'Returns';
  if (notification.type.startsWith('order_')) return 'Orders';
  return 'Activity';
}

function NotificationsScreen({ session }: { session: SessionContextValue }): React.JSX.Element {
  const refresh = useFocusRefresh();
  const [scope, setScope] = React.useState<'all' | 'unread'>('all');
  const userId = session.user?.id ?? '';
  const all = notificationService.list(userId);
  const notifications = scope === 'unread' ? all.filter((entry) => !entry.read) : all;
  const unread = all.filter((entry) => !entry.read).length;

  const open = (notification: AppNotification): void => {
    notificationService.markRead(userId, notification.id);
    const orderId = notification.data?.orderId;
    const productId = notification.data?.productId;
    if (typeof orderId === 'string') {
      refresh();
      router.push({ pathname: '/order/[id]', params: { id: orderId } });
      return;
    }
    if (notification.type === 'review_reply' && typeof productId === 'string') {
      refresh();
      router.push({ pathname: '/product/[id]', params: { id: productId } });
      return;
    }
    refresh();
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/orders" />
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.h1, { color: colors.text, marginTop: spacing.md }]}>Notifications</Text>
          <Text style={type.caption}>{unread > 0 ? `${unread} unread` : 'All caught up'}</Text>
        </View>
        {unread > 0 ? (
          <Button
            title="Mark all read"
            variant="secondary"
            onPress={() => {
              notificationService.markAllRead(userId);
              refresh();
            }}
          />
        ) : null}
      </View>

      {all.length > 0 ? (
        <View style={styles.scopeRow}>
          <Pressable
            onPress={() => setScope('all')}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === 'all' }}
            accessibilityLabel="Notifications filter: all"
            style={[styles.tab, scope === 'all' ? styles.tabOn : null]}
          >
            <Text style={[type.label, { color: scope === 'all' ? colors.primary : colors.textMuted }]}>All</Text>
          </Pressable>
          <Pressable
            onPress={() => setScope('unread')}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === 'unread' }}
            accessibilityLabel="Notifications filter: unread"
            style={[styles.tab, scope === 'unread' ? styles.tabOn : null]}
          >
            <Text style={[type.label, { color: scope === 'unread' ? colors.primary : colors.textMuted }]}>Unread</Text>
          </Pressable>
        </View>
      ) : null}

      {notifications.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'No notifications' : 'Nothing unread'}
          message={
            all.length === 0
              ? 'Order and return updates will appear here.'
              : 'Every notification has been read.'
          }
          actionLabel={all.length === 0 ? 'Browse products' : undefined}
          onAction={all.length === 0 ? () => router.push('/browse') : undefined}
        />
      ) : (
        notifications.map((notification) => (
          <Card key={notification.id} padded={false} style={styles.rowCard}>
            <View style={styles.row}>
              <Pressable
                onPress={() => open(notification)}
                accessibilityRole="button"
                accessibilityLabel={`${notification.read ? 'Read' : 'Unread'}: ${notification.title}`}
                style={styles.rowMain}
              >
                <View style={styles.rowHeader}>
                  {!notification.read ? <View style={styles.unreadDot} /> : null}
                  <Text style={[type.label, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {notification.title}
                  </Text>
                  <Pill label={groupLabel(notification)} tone={toneFor(notification)} />
                </View>
                <Text style={type.body} numberOfLines={2}>
                  {notification.body}
                </Text>
                <Text style={type.caption}>{relativeTime(notification.createdAt)}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  notificationService.remove(userId, notification.id);
                  refresh();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove notification: ${notification.title}`}
                hitSlop={8}
                style={styles.remove}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.lg },
  scopeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  tab: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rowCard: { marginBottom: spacing.md, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowMain: { flex: 1, gap: 2 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unreadDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.primary },
  remove: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  removeText: { ...type.caption, color: colors.danger, fontWeight: '700' },
});

export default withSession(NotificationsScreen, '/notifications' satisfies ProtectedRoute);
