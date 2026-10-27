import * as React from 'react';

import { RefreshControl, Pressable, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { useListingCache } from '@/modules/cache/use-listing-cache';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { notificationService } from '@/services/notification-service';
import { colors, radius, spacing, type } from '@/theme/tokens';

function MenuRow({ label, caption, onPress }: { label: string; caption: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${caption}`}
      style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.text }]}>{label}</Text>
        <Text style={type.caption}>{caption}</Text>
      </View>
      <Text style={[type.caption, { color: colors.primary, fontWeight: '700' }]}>Open</Text>
    </Pressable>
  );
}

/**
 * Seller settings rows use the Vanta signature color for the option name so the
 * whole seller section reads as branded, while staying on the same row anatomy
 * as the neutral customer rows.
 */
export default function SettingsScreen(): React.JSX.Element {
  const { status, user, signOut, signOutEverywhere } = useSession();
  const { refreshing, refresh: refreshAccount, error: accountError, retry: retryAccount } = useListingCache(user?.id ?? '', 'account');
  const [busy, setBusy] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState<string | null>(null);
  useFocusRefresh();
  const unread = status === 'signedIn' && user ? notificationService.unreadCount(user.id) : 0;

  const onSignOut = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    setSignOutError(null);
    try {
      await signOut(user.id);
      router.replace('/(home)');
    } catch (error) {
      // `try/finally` with no `catch` turned a failed sign-out into an unhandled
      // rejection and a screen that silently stayed put.
      setSignOutError(error instanceof Error ? error.message : 'We could not sign you out. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSignOutEverywhere = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    setSignOutError(null);
    try {
      await signOutEverywhere(user.id);
      router.replace('/(home)');
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'We could not sign you out everywhere. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      padded
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refreshAccount} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      <BackButton fallbackHref="/" />

      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs }}>Settings</Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>Your account</Text>

      {accountError ? (
        <View style={{ marginBottom: spacing.lg }}>
          <NoticeCard
            tone="warning"
            title="Couldn't refresh"
            message={accountError}
            actionLabel="Try again"
            onAction={retryAccount}
          />
        </View>
      ) : null}

      {status === 'signedIn' && user ? (
        <>
          <Card>
          <Text style={{ ...type.h3, color: colors.text }}>{user.name}</Text>
          <Text style={{ ...type.caption, marginTop: 2 }}>{user.email}</Text>
          <Text style={{ ...type.caption, marginTop: spacing.sm }}>
            {user.roles.map((role) => role.toUpperCase()).join(' · ')}
          </Text>
          <View style={{ height: spacing.lg }} />
          <View style={{ gap: spacing.sm }}>
            {user.hasPassword === false ? (
              <MenuRow
                label="Set a password"
                caption="Sign in from any device, not just this one"
                onPress={() => router.push('/account')}
              />
            ) : null}
            <MenuRow
              label="Account"
              caption="Name, email, phone and password"
              onPress={() => router.push('/account')}
            />
            <MenuRow
              label="Address book"
              caption="Delivery addresses, default selection and checkout use"
              onPress={() => router.push('/addresses')}
            />
            <MenuRow
              label="Wishlist"
              caption="Items you saved for later"
              onPress={() => router.push('/wishlist')}
            />
            <MenuRow
              label="Vouchers"
              caption="Codes that work on your current cart"
              onPress={() => router.push('/vouchers')}
            />
            <MenuRow
              label="My reviews"
              caption="Ratings and reviews you wrote for delivered items"
              onPress={() => router.push('/my-reviews')}
            />
            <MenuRow
              label="My orders"
              caption="Track, cancel or return anything you ordered"
              onPress={() => router.push('/orders')}
            />
            <MenuRow
              label="Notifications"
              caption={unread > 0 ? `${unread} unread update(s)` : 'Order and return updates'}
              onPress={() => router.push('/notifications')}
            />
          </View>
          <View style={{ height: spacing.lg }} />
          {signOutError ? (
        <View style={{ marginBottom: spacing.md }}>
          <NoticeCard
            tone="danger"
            title="Sign out failed"
            message={signOutError}
            onDismiss={() => setSignOutError(null)}
          />
        </View>
      ) : null}

      <Button title="Sign out" variant="secondary" onPress={onSignOut} loading={busy} fullWidth />
          <View style={{ height: spacing.sm }} />
          <Button
            title="Sign out of all devices"
            variant="secondary"
            onPress={onSignOutEverywhere}
            loading={busy}
            fullWidth
          />
          </Card>
        </>
      ) : (
        <>
          <SectionHeader
            title="Customer account"
            caption="An account is needed to place an order, save items and track deliveries"
          />
          <Card>
            <Text style={{ ...type.body, color: colors.textMuted }}>
              You are browsing as a guest. Browsing, searching and your cart all work without an account.
            </Text>
            <View style={{ height: spacing.lg }} />
            <View style={{ gap: spacing.sm }}>
              <Button title="Sign in" onPress={() => router.push('/login')} fullWidth />
              <Button title="Create an account" variant="secondary" onPress={() => router.push('/register')} fullWidth />
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = {
  menuRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  menuRowPressed: { opacity: 0.85 },
};
