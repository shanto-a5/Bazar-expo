/**
 * Session context: the single source of truth for "who is signed in and their
 * capabilities". Screens subscribe to this instead of talking to storage or
 * repositories directly. All data flows through the auth service.
 */
import * as React from 'react';

import type { User } from '@/domain/types';
import { ensureBooted } from '@/infrastructure/bootstrap';
import { authService } from '@/services/auth-gateway';
import { addressService } from '@/services/address-service';
import { orderService } from '@/services/order-service';
import { cartService, GUEST_CART_OWNER_ID } from '@/services/cart-service';
import { notificationService } from '@/services/notification-service';
import { unregisterAllPushDevices, unregisterPushDevice } from '@/services/push-notifications';
import { listingCache } from '@/services/listing-cache';
import { hydrateSellerWorkspace } from '@/api/remote-seller';
import { hydrateFollows, hydrateRecentlyViewed, hydrateWishlist, subscribeSocial } from '@/api/remote-social';
import { ensureMyReviews, hydrateMyReviews, subscribeReviews } from '@/api/remote-reviews';
import { getContainer } from '@/infrastructure/container';

export type SessionStatus = 'checking' | 'signedIn' | 'signedOut';

export const GUEST_OWNER_ID = GUEST_CART_OWNER_ID;

export interface SessionContextValue {
  status: SessionStatus;
  user: User | null;
  isSeller: boolean;
  cartOwnerId: string;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (input: { name: string; email: string; phone: string; password: string }) => Promise<User>;
  /**
   * Frictionless onboarding: a phone number alone creates (or resumes) the
   * account. Behaves like `signUp` afterwards so the rest of the app cannot tell
   * the two apart.
   */
  quickAccount: (phone: string) => Promise<User>;
  signOut: (userId?: string) => Promise<void>;
  signOutEverywhere: (userId?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

const SESSION_CACHE_ID = 'active-authenticated-user';

interface SessionCacheRecord {
  id: string;
  tokenFingerprint: string;
  user: User;
}

// This fingerprint only binds the cached identity to the token stored on this
// device; it is not used as an authentication credential.
function tokenFingerprint(token: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 3266489917);
  }
  return `${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}:${token.length}`;
}

async function persistSessionCache(user: User, expectedToken?: string | null): Promise<void> {
  const container = getContainer();
  const token = await container.sessionStorage.getToken();
  if (token && (expectedToken === undefined || token === expectedToken)) {
    container.db.upsert('sessions', { id: SESSION_CACHE_ID, tokenFingerprint: tokenFingerprint(token), user });
  }
}

function readSessionCache(token: string | null): User | null {
  if (!token) return null;
  const cached = getContainer().db.getById<SessionCacheRecord>('sessions', SESSION_CACHE_ID);
  return cached?.tokenFingerprint === tokenFingerprint(token) ? cached.user : null;
}

function clearSessionCache(): void {
  getContainer().db.remove('sessions', SESSION_CACHE_ID);
}

function refreshAccountData(user: User): void {
  const { id: userId } = user;
  // These existing read paths own their TTL and in-flight deduplication.
  orderService.customerOrders(userId);
  notificationService.unreadCount(userId);
  ensureMyReviews(userId);
  void Promise.allSettled([
    hydrateSellerWorkspace(),
    hydrateWishlist(userId),
    hydrateFollows(userId),
    hydrateRecentlyViewed(userId),
  ]);
}

export function SessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = React.useState<SessionStatus>('checking');
  const [user, setUser] = React.useState<User | null>(null);
  // Bumped by CartService when a remote cart round trip is applied. Changing it
  // re-issues the memoised context value, so every useSession consumer (the cart
  // screen, the badge) re-reads the fresh cart copy without touching the screens.
  const [, setCartRevision] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await ensureBooted();
        const restoreToken = await getContainer().sessionStorage.getToken();
        const cached = readSessionCache(restoreToken);
        if (cached && mounted) {
          setUser(cached);
          setStatus('signedIn');
        }

        const current = await authService.getCurrentUser();
        if ((await getContainer().sessionStorage.getToken()) !== restoreToken) return;
        if (!mounted) return;
        if (current) {
          setUser(current);
          setStatus('signedIn');
          void persistSessionCache(current, restoreToken);
          listingCache.ensure(current.id, 'home');
          refreshAccountData(current);
        } else {
          clearSessionCache();
          setUser(null);
          setStatus('signedOut');
          listingCache.ensure(GUEST_OWNER_ID, 'home');
        }
      } catch (error) {
        // A network failure cannot establish that a stored session is invalid.
        // Keep a token-matched cached identity signed in; otherwise remain in the
        // checking state instead of briefly presenting a guest account.
        if (mounted) {
          console.warn('[vanta] session restore is waiting for the API', error);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Re-render hook for remote carts: subscribe once, and let any applied server
  // response ripple through the context value. No-ops in local mode, where the
  // device repositories already drive renders.
  React.useEffect(() => cartService.subscribeCart(() => setCartRevision((n) => n + 1)), []);

  // The address book mirror lives in AddressService too; the same re-render hook
  // keeps the account count and any address screen in step with a server answer.
  React.useEffect(() => addressService.subscribe(() => setCartRevision((n) => n + 1)), []);

  // The notification inbox mirror lives in NotificationService; the same hook
  // keeps the inbox and any unread badge in step with a server answer.
  React.useEffect(() => notificationService.subscribe(() => setCartRevision((n) => n + 1)), []);

  // The wishlist and followed-store mirrors live in the social bridge; the same
  // re-render hook keeps the Saved tab and the follow toggles in step with a
  // server answer.
  React.useEffect(() => subscribeSocial(() => setCartRevision((n) => n + 1)), []);
  React.useEffect(() => subscribeReviews(() => setCartRevision((n) => n + 1)), []);

  // When a signed-in account appears, point the cart at that account's server
  // record instead of carrying over the previous account's (or guest's) cache.
  // syncCart no-ops for local mode and for the guest owner.
  React.useEffect(() => {
    if (user) cartService.syncCart(user.id);
  }, [user]);

  // When the signed-in account changes (including sign-out), drop the previous
  // account's cached listings, cart, orders and addresses so nothing leaks to the
  // next account on the same device.
  const previousUserIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const previous = previousUserIdRef.current;
    if (previous && previous !== user?.id) listingCache.clearAccount(previous);
    previousUserIdRef.current = user?.id ?? null;
  }, [user]);

  const signIn = React.useCallback(async (email: string, password: string): Promise<User> => {
    const loggedIn = await authService.login(email, password);
    await authService.createSession(loggedIn.id);
    const current = await authService.getCurrentUser();
    // Fold any basket the same device built while signed out into the account
    // that is signing in. Without this the merge only ran from the checkout CTA,
    // so signing in from Settings, Saved or an address gate silently orphaned the
    // guest cart: `cartOwnerId` flipped to the user id and the cart looked empty.
    // The merge is idempotent - it empties the guest bucket, so a second call no-ops.
    cartService.mergeGuestCart(loggedIn.id);
    // Remote mode has no merge endpoint, so `mergeGuestCart` is a no-op there and
    // the signed-out basket has to be replayed through the cart API instead.
    await cartService.foldGuestCartIntoAccount(loggedIn.id).catch(() => undefined);
    if (current) await hydrateSellerWorkspace().catch(() => undefined);
    await addressService.hydrate(loggedIn.id).catch(() => undefined);
    await orderService.hydrateCustomerOrders(loggedIn.id).catch(() => undefined);
    await notificationService.hydrate(loggedIn.id).catch(() => undefined);
    await hydrateWishlist(loggedIn.id).catch(() => undefined);
    await hydrateFollows(loggedIn.id).catch(() => undefined);
    await hydrateMyReviews(loggedIn.id).catch(() => undefined);
    await hydrateRecentlyViewed(loggedIn.id).catch(() => undefined);
    await persistSessionCache(current ?? loggedIn);
    listingCache.markHydrated(loggedIn.id, ['cart', 'orders', 'account']);
    setUser(current ?? loggedIn);
    setStatus(current ? 'signedIn' : 'signedOut');
    return loggedIn;
  }, []);

  const signUp = React.useCallback(
    async (input: { name: string; email: string; phone: string; password: string }): Promise<User> => {
      const registered = await authService.register(input);
      await authService.createSession(registered.id);
      cartService.mergeGuestCart(registered.id);
      await cartService.foldGuestCartIntoAccount(registered.id).catch(() => undefined);
      await hydrateSellerWorkspace().catch(() => undefined);
      await addressService.hydrate(registered.id).catch(() => undefined);
      await orderService.hydrateCustomerOrders(registered.id).catch(() => undefined);
      await notificationService.hydrate(registered.id).catch(() => undefined);
      await hydrateWishlist(registered.id).catch(() => undefined);
      await hydrateFollows(registered.id).catch(() => undefined);
      await hydrateMyReviews(registered.id).catch(() => undefined);
      await hydrateRecentlyViewed(registered.id).catch(() => undefined);
      await persistSessionCache(registered);
      listingCache.markHydrated(registered.id, ['cart', 'orders', 'account']);
      setUser(registered);
      setStatus('signedIn');
      return registered;
    },
    [],
  );

  // Frictionless onboarding. The server mints the whole account from the phone
  // number, so this mirrors `signUp` exactly after the call: start the session,
  // fold the guest basket, hydrate the mirrors, then publish the user. Keeping it
  // separate (rather than reusing signUp) is deliberate: signUp sends a password
  // that quick-account must never touch.
  const quickAccount = React.useCallback(async (phone: string): Promise<User> => {
    const created = await authService.quickAccount(phone);
    await authService.createSession(created.id);
    cartService.mergeGuestCart(created.id);
    await cartService.foldGuestCartIntoAccount(created.id).catch(() => undefined);
    await hydrateSellerWorkspace().catch(() => undefined);
    await addressService.hydrate(created.id).catch(() => undefined);
    await orderService.hydrateCustomerOrders(created.id).catch(() => undefined);
    await notificationService.hydrate(created.id).catch(() => undefined);
    await hydrateWishlist(created.id).catch(() => undefined);
    await hydrateFollows(created.id).catch(() => undefined);
    await hydrateMyReviews(created.id).catch(() => undefined);
    await hydrateRecentlyViewed(created.id).catch(() => undefined);
    await persistSessionCache(created);
    listingCache.markHydrated(created.id, ['cart', 'orders', 'account']);
    setUser(created);
    setStatus('signedIn');
    return created;
  }, []);

  const signOut = React.useCallback(async (userId?: string): Promise<void> => {
    await unregisterPushDevice();
    await authService.logout(userId);
    clearSessionCache();
    setUser(null);
    setStatus('signedOut');
  }, []);

  // Remote-only affordance: revoke every server session for the account, not just
  // this device. In local mode the gateway maps this to a plain sign-out.
  const signOutEverywhere = React.useCallback(async (userId?: string): Promise<void> => {
    await unregisterAllPushDevices();
    await authService.logoutEverywhere(userId);
    clearSessionCache();
    setUser(null);
    setStatus('signedOut');
  }, []);

  const refresh = React.useCallback(async (): Promise<void> => {
    const current = await authService.getCurrentUser();
    if (current) await hydrateSellerWorkspace().catch(() => undefined);
    if (current) await addressService.hydrate(current.id).catch(() => undefined);
    if (current) await orderService.hydrateCustomerOrders(current.id).catch(() => undefined);
    if (current) await notificationService.hydrate(current.id).catch(() => undefined);
    if (current) await hydrateWishlist(current.id).catch(() => undefined);
    if (current) await hydrateFollows(current.id).catch(() => undefined);
    if (current) await hydrateMyReviews(current.id).catch(() => undefined);
    if (current) await hydrateRecentlyViewed(current.id).catch(() => undefined);
    if (current) await persistSessionCache(current);
    else clearSessionCache();
    if (current) listingCache.markHydrated(current.id, ['cart', 'orders', 'account']);
    setUser(current);
    setStatus(current ? 'signedIn' : 'signedOut');
  }, []);

  const value: SessionContextValue = {
    status,
    user,
    isSeller: Boolean(user?.roles.includes('seller')),
    cartOwnerId: user?.id ?? GUEST_OWNER_ID,
    signIn,
    signUp,
    quickAccount,
    signOut,
    signOutEverywhere,
    refresh,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = React.useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within a SessionProvider.');
  return value;
}
