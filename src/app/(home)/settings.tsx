import * as React from 'react';

import { RefreshControl, Pressable, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader } from '@/components/ui';
import { useArea } from '@/modules/area/area-context';
import { useLanguage } from '@/modules/language/language-context';
import { useSession } from '@/modules/session/session-context';
import { useListingCache } from '@/modules/cache/use-listing-cache';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { notificationService } from '@/services/notification-service';
import { colors, radius, spacing, type } from '@/theme/tokens';

function MenuRow({
  label,
  caption,
  actionLabel,
  onPress,
}: {
  label: string;
  caption: string;
  actionLabel: string;
  onPress: () => void;
}): React.JSX.Element {
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
      <Text style={[type.caption, { color: colors.primary, fontWeight: '700' }]}>{actionLabel}</Text>
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
  const { area, openSelector: openAreaSelector } = useArea();
  const { language, setLanguage, t } = useLanguage();
  const { refreshing, refresh: refreshAccount, error: accountError, retry: retryAccount } = useListingCache(
    user?.id ?? '',
    'account',
  );
  const [busy, setBusy] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState<string | null>(null);
  useFocusRefresh();
  const unread = status === 'signedIn' && user ? notificationService.unreadCount(user.id) : 0;
  const openText = t('open');

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
      setSignOutError(
        error instanceof Error ? error.message : 'We could not sign you out everywhere. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      padded
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refreshAccount}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <BackButton fallbackHref="/" />

      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs }}>
        {t('settings')}
      </Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>{t('settingsSubtitle')}</Text>

      {accountError ? (
        <View style={{ marginBottom: spacing.lg }}>
          <NoticeCard
            tone="warning"
            title={t('couldntRefresh')}
            message={accountError}
            actionLabel={t('tryAgain')}
            onAction={retryAccount}
          />
        </View>
      ) : null}

      {/* STEP 2: Bangla / English Switcher */}
      <Card style={{ marginBottom: spacing.md }}>
        <Text style={{ ...type.label, color: colors.text }}>{t('languageTitle')}</Text>
        <Text style={{ ...type.caption, marginTop: 2, marginBottom: spacing.md }}>{t('languageCaption')}</Text>
        <View style={styles.langRow}>
          <Pressable
            onPress={() => setLanguage('bn')}
            accessibilityRole="button"
            accessibilityLabel={t('banglaName')}
            accessibilityState={{ selected: language === 'bn' }}
            style={({ pressed }) => [
              styles.langOption,
              language === 'bn' ? styles.langOptionActive : styles.langOptionIdle,
              pressed && styles.menuRowPressed,
            ]}
          >
            <Text style={[styles.langOptionText, language === 'bn' ? styles.langTextActive : styles.langTextIdle]}>
              🇧🇩 {t('banglaName')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setLanguage('en')}
            accessibilityRole="button"
            accessibilityLabel={t('englishName')}
            accessibilityState={{ selected: language === 'en' }}
            style={({ pressed }) => [
              styles.langOption,
              language === 'en' ? styles.langOptionActive : styles.langOptionIdle,
              pressed && styles.menuRowPressed,
            ]}
          >
            <Text style={[styles.langOptionText, language === 'en' ? styles.langTextActive : styles.langTextIdle]}>
              🌐 {t('englishName')}
            </Text>
          </Pressable>
        </View>
      </Card>

      <MenuRow
        label={t('shoppingArea')}
        caption={area ? `${area.name} · ${t('tapToChange')}` : t('chooseWhereYouShop')}
        actionLabel={openText}
        onPress={openAreaSelector}
      />
      <View style={{ height: spacing.lg }} />

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
                  label={t('setPassword')}
                  caption={t('setPasswordCaption')}
                  actionLabel={openText}
                  onPress={() => router.push('/account')}
                />
              ) : null}
              <MenuRow
                label={t('account')}
                caption={t('accountCaption')}
                actionLabel={openText}
                onPress={() => router.push('/account')}
              />
              <MenuRow
                label={t('addressBook')}
                caption={t('addressBookCaption')}
                actionLabel={openText}
                onPress={() => router.push('/addresses')}
              />
              <MenuRow
                label={t('wishlist')}
                caption={t('wishlistCaption')}
                actionLabel={openText}
                onPress={() => router.push('/wishlist')}
              />
              <MenuRow
                label={t('vouchers')}
                caption={t('vouchersCaption')}
                actionLabel={openText}
                onPress={() => router.push('/vouchers')}
              />
              <MenuRow
                label={t('myReviews')}
                caption={t('myReviewsCaption')}
                actionLabel={openText}
                onPress={() => router.push('/my-reviews')}
              />
              <MenuRow
                label={t('myOrders')}
                caption={t('myOrdersCaption')}
                actionLabel={openText}
                onPress={() => router.push('/orders')}
              />
              <MenuRow
                label={t('notifications')}
                caption={unread > 0 ? `${unread} ${t('unreadUpdatesSuffix')}` : t('notificationsCaption')}
                actionLabel={openText}
                onPress={() => router.push('/notifications')}
              />
            </View>
            <View style={{ height: spacing.lg }} />
            {signOutError ? (
              <View style={{ marginBottom: spacing.md }}>
                <NoticeCard
                  tone="danger"
                  title={t('signOutFailed')}
                  message={signOutError}
                  onDismiss={() => setSignOutError(null)}
                />
              </View>
            ) : null}

            <Button title={t('signOut')} variant="secondary" onPress={onSignOut} loading={busy} fullWidth />
            <View style={{ height: spacing.sm }} />
            <Button
              title={t('signOutEverywhere')}
              variant="secondary"
              onPress={onSignOutEverywhere}
              loading={busy}
              fullWidth
            />
          </Card>
        </>
      ) : (
        <>
          <SectionHeader title={t('customerAccount')} caption={t('customerAccountCaption')} />
          <Card>
            <Text style={{ ...type.body, color: colors.textMuted }}>{t('guestBrowseNotice')}</Text>
            <View style={{ height: spacing.lg }} />
            <View style={{ gap: spacing.sm }}>
              <Button title={t('signIn')} onPress={() => router.push('/login')} fullWidth />
              <Button title={t('createAccount')} variant="secondary" onPress={() => router.push('/register')} fullWidth />
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
  langRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  langOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  langOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  langOptionIdle: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },
  langOptionText: {
    fontSize: 14,
    fontWeight: '800' as const,
  },
  langTextActive: {
    color: colors.textInverse,
  },
  langTextIdle: {
    color: colors.text,
  },
};
