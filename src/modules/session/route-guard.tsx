/**
 * Route guard primitives (M2-C).
 *
 * Guards are functional, not cosmetic:
 *   - `withSession` — a signed-in user is required.
 *
 * It lives behind the same session authority (SessionProvider) that every
 * screen reads from. No email-string matching, no button-hiding-only logic.
 */
import { router, useGlobalSearchParams, useRouter, type Href } from 'expo-router';
import * as React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';

import { BackButton } from '@/components/back-button';
import { Button, Screen } from '@/components/ui';
import { goBackOrReplace } from '@/modules/navigation/back';
import { useQuickAccount } from '@/modules/session/quick-account-modal';
import { useSession, type SessionContextValue } from '@/modules/session/session-context';
import { colors, type as textType } from '@/theme/tokens';

export const PROTECTED_ROUTES = [
  '/account',
  '/addresses',
  '/checkout',
  '/my-reviews',
  '/order-confirmation',
  '/orders',
  '/notifications',
  '/return-request',
  '/wishlist',
  '/write-review',
] as const;
export type ProtectedRoute = (typeof PROTECTED_ROUTES)[number];
/** An allowlisted protected route, optionally carrying the screen's own search params. */
export type AuthRedirectHref = `${ProtectedRoute}` | `${ProtectedRoute}?${string}` | '/(home)';

/**
 * Rebuilds a post-login destination that keeps the screen's own search params.
 *
 * The guard used to forward the bare route string, so `/checkout?voucher=SAVE10`
 * collapsed to `/checkout` on the way through login and the customer silently lost
 * the discount they had applied. The pathname is still allowlisted, so this cannot
 * become an open redirect — only params already present on the current screen ride
 * along.
 */
export function buildAuthRedirectNext(pathname: ProtectedRoute, params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    const flat = Array.isArray(value) ? value : [value];
    for (const entry of flat) {
      if (entry === undefined || entry === null || entry === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`);
    }
  }
  return parts.length > 0 ? `${pathname}?${parts.join('&')}` : pathname;
}

/**
 * Validates a `next` destination coming back from the login screen. The pathname
 * must be an allowlisted protected route; any search string that arrived with it is
 * preserved so a voucher or order id survives the round trip.
 */
export function authRedirectHref(next: string | string[] | undefined): AuthRedirectHref {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value) return '/(home)';
  const queryIndex = value.indexOf('?');
  const pathname = queryIndex === -1 ? value : value.slice(0, queryIndex);
  const search = queryIndex === -1 ? '' : value.slice(queryIndex);
  if (!PROTECTED_ROUTES.includes(pathname as ProtectedRoute)) return '/(home)';
  return `${pathname}${search}` as AuthRedirectHref;
}

/**
 * Same validation as `authRedirectHref`, but split into the object form expo-router
 * wants for `<Redirect href={...} />`. Passing a query string through the string form
 * lost the search params, which is what silently dropped the cart voucher.
 */
export function authRedirectTarget(next: string | string[] | undefined): Href {
  const href = authRedirectHref(next);
  if (href === '/(home)') return '/(home)' as Href;
  const queryIndex = href.indexOf('?');
  if (queryIndex === -1) return href as Href;
  const pathname = href.slice(0, queryIndex);
  const params: Record<string, string> = {};
  for (const pair of href.slice(queryIndex + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    if (key) params[key] = value;
  }
  // The pathname has already been checked against PROTECTED_ROUTES, so this cast is
  // safe; expo-router's generated `Href` union cannot express "allowlisted plus
  // arbitrary query params".
  return { pathname, params } as Href;
}

export function useRequireAuth(): (intent?: 'login' | 'register') => boolean {
  const session = useSession();
  const router = useRouter();
  return React.useCallback(
    (intent = 'login') => {
      if (session.status === 'checking') return false;
      if (session.status === 'signedIn') return true;
      router.push({ pathname: intent === 'register' ? '/register' : '/login' });
      return false;
    },
    [session.status, router],
  );
}

function CheckingGate(): React.JSX.Element {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[textType.caption, { marginTop: 12 }]}>Restoring your session…</Text>
    </View>
  );
}

/**
 * Sends a signed-out visitor to the auth group and parks the guarded screen
 * while it happens.
 *
 * This PUSHES rather than replaces on purpose (M10-N1). The auth group is a
 * sibling of the group that owns the guarded route, so a replace would unmount
 * that group and throw away its native stack state: after signing in the user
 * would be returned to a shell rebuilt from its anchor, and Back would land on
 * Home instead of the screen they came from. Pushing keeps the originating
 * shell mounted, and {@link resumeAfterAuth} pops straight back to it.
 */
/**
 * Which auth screen a guard sends a signed-out visitor to. `login` is the
 * general wall (sign in or create a password account); `quick` is the order wall,
 * where the only thing that stands between the customer and checkout is a phone
 * number.
 */
export type AuthGate = 'login' | 'quick';

function AuthRedirect({ next, gate = 'login' }: { next?: ProtectedRoute; gate?: AuthGate }): React.JSX.Element {
  const router = useRouter();
  const searchParams = useGlobalSearchParams();
  const { present } = useQuickAccount();
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    // The order wall is no longer a route: the popup overlays this guarded screen
    // (which is parked on `CheckingGate` underneath) and creating the account
    // flips the session in place, so the guarded screen re-renders with its params
    // intact. Dismissing has to leave the parked screen somewhere honest, so it
    // falls back to the cart.
    if (gate === 'quick') {
      present({ onDismiss: () => goBackOrReplace('/cart') });
      return;
    }
    if (next) {
      router.push({ pathname: '/login', params: { next: buildAuthRedirectNext(next, searchParams) } });
      return;
    }
    router.push('/login');
  }, [router, next, searchParams, gate, present]);

  return <CheckingGate />;
}

export function withSession(
  Component: React.ComponentType<{ session: SessionContextValue }>,
  next?: ProtectedRoute,
  options: { gate?: AuthGate } = {},
): (props: Record<string, unknown>) => React.JSX.Element {
  return function SessionGuarded(props: Record<string, unknown>): React.JSX.Element {
    const session = useSession();
    if (session.status === 'checking') return <CheckingGate />;
    if (session.status === 'signedOut') return <AuthRedirect next={next} gate={options.gate} />;
    return <Component {...props} session={session} />;
  };
}

/**
 * True when the auth screen was entered to satisfy a guarded route, so the
 * originating shell is still mounted underneath and should be resumed by
 * popping rather than by navigating again.
 */
export function hasAuthRedirectTarget(next: string | string[] | undefined): boolean {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value) return false;
  return authRedirectHref(value) !== '/(home)';
}

/**
 * Returns the user to the guarded screen that sent them to sign in. The auth
 * screen was pushed on top of that shell, so a single pop restores it with its
 * history intact (`Cart -> Checkout -> Login -> Checkout -> Back -> Cart`).
 */
export function resumeAfterAuth(router: { back: () => void }): void {
  router.back();
}

/**
 * Shown when a signed-out visitor reaches a protected screen.
 *
 * `fallback` is the route to use when there is no history to pop (a cold deep
 * link). It is always a real, relevant screen — never a blanket Home
 * redirect — and BackButton ignores it entirely whenever real history exists.
 */
export function SignInGate({
  title,
  message,
  fallback = '/',
}: {
  title: string;
  message: string;
  fallback?: Href;
}): React.JSX.Element {
  return (
    <Screen padded>
      <BackButton fallbackHref={fallback} />
      <Text style={[textType.h1, { marginTop: 12 }]}>{title}</Text>
      <Text style={[textType.body, { color: colors.textMuted, marginTop: 6 }]}>{message}</Text>
      <View style={{ height: 16 }} />
      <Button title="Sign in" fullWidth onPress={() => router.push('/login')} />
      <View style={{ height: 8 }} />
      <Button title="Create an account" variant="secondary" fullWidth onPress={() => router.push('/register')} />
    </Screen>
  );
}
