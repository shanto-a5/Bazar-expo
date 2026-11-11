import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import { QuickAccountProvider } from '@/modules/session/quick-account-modal';
import { AreaProvider } from '@/modules/area/area-context';
import { AreaGate } from '@/modules/area/area-gate';
import { SessionProvider, useSession } from '@/modules/session/session-context';
import { useBootGate } from '@/infrastructure/bootstrap';
import { Button, Card } from '@/components/ui';
import { GlobalProgressLine } from '@/components/global-progress-line';
import { spacing, colors, type } from '@/theme/tokens';
import { PushNotificationBridge } from '@/services/push-notifications';

/**
 * Vanta root layout.
 *
 * Contract (M2-A):
 *  - SessionProvider wraps the router tree BEFORE any route/component can call
 *    `useSession()` — the native splash and bootstrap gate live INSIDE the
 *    provider tree, never as a bare-Slot prelude. This is the single identity
 *    authority; session restore and the initial `checking` state live inside it
 *    (M2-B).
 *  - The boot gate waits only for the local database. The session gate then
 *    restores the token-matched identity before routes mount; remote catalogue
 *    refreshes continue through the existing cache hooks in the background.
 *    Failed local storage loads still show a retryable error card.
 *  - Route groups decide navigation: (home), (auth) (M2-C).
 *  - The groups are hosted by a native `Stack`, NOT a `Slot` (M10-N1). A `Slot`
 *    renders only the matched child, so crossing into (auth) unmounted (home)
 *    and destroyed its native stack state: returning from a sign-in rebuilt the
 *    customer shell from its anchor, and Back landed on Home instead of the
 *    screen the user actually came from. A `Stack` keeps every group screen
 *    mounted, so each group retains its own history across an auth round trip.
 *    The root header is hidden because (auth) supplies its own native headers.
 *  - `bootstrap.ts` / `route-guard.tsx` are infrastructure modules, NOT routes;
 *    they live under src/infrastructure and src/modules/session (M2-A/M2-C).
 *  - QuickAccountProvider sits inside SessionProvider and above the Stack: the
 *    frictionless order popup blurs and floats over whatever screen opened it, and
 *    creating the account flips the session in place rather than navigating (M14).
 *
 * Safe area:
 *  - SafeAreaProvider is the single source of device inset values (status bar,
 *    notch/cutout, home indicator). `initialWindowMetrics` is passed so the
 *    first frame already knows the real top inset instead of starting at 0 and
 *    jumping. Screens read the inset through the shared `Screen` shell in
 *    `@/components/ui`, so the logo/Settings/Cart header row can never sit
 *    under the status bar on any device with or without a cutout.
 */
/**
 * The customer shell is the app's entry point; the auth group is reached on top
 * of it.
 */
export const unstable_settings = {
  initialRouteName: '(home)',
};

function SessionStartupGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { status } = useSession();
  if (status !== 'checking') return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
      <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Restoring your session" />
    </View>
  );
}

export default function RootLayout(): React.JSX.Element {
  const boot = useBootGate();

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SessionProvider>
        <PushNotificationBridge />
        <QuickAccountProvider>
          <View style={{ flex: 1, backgroundColor: '#FAFAF9' }}>
            <StatusBar style="dark" />
            <GlobalProgressLine />
            {boot.status === 'loading' ? (
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: spacing.lg,
                }}
              >
                <ActivityIndicator
                  size="large"
                  color={colors.primary}
                  accessibilityLabel="Starting Vanta"
                />
              </View>
            ) : null}
            {boot.status === 'ready' ? (
              <AreaProvider>
                <AreaGate>
                  <SessionStartupGate>
                    <Stack screenOptions={{ headerShown: false }} />
                  </SessionStartupGate>
                </AreaGate>
              </AreaProvider>
            ) : null}
            {boot.status === 'failed' ? (
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: spacing.lg,
                }}
              >
                <Card style={{ width: '100%', maxWidth: 420 }}>
                  <Text style={{ ...type.h3, marginBottom: spacing.sm }}>Vanta could not start</Text>
                  <Text style={{ ...type.bodyMuted, marginBottom: spacing.lg }}>{boot.error.message}</Text>
                  <Button title="Try again" fullWidth onPress={boot.retry} />
                </Card>
              </View>
            ) : null}
          </View>
        </QuickAccountProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
