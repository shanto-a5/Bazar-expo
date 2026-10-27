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
import { listingCache } from '@/services/listing-cache';
import { hydrateSellerWorkspace } from '@/api/remote-seller';
import { hydrateFollows, hydrateRecentlyViewed, hydrateWishlist, subscribeSocial } from '@/api/remote-social';
import { hydrateMyReviews, subscribeReviews } from '@/api/remote-reviews';

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

export function SessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = React.useState<SessionStatus>('checking');
  const [user, setUser] = React.useState<User | null>(null);
  // Bumped by CartService when a remote cart round trip is applied. Changing it
  // re-issues the memoised context value, so every useSession consumer (the cart
  // screen, the badge) re-reads the fresh cart copy without touching the screens.
  const [, setCartRevision] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    ensureBooted()
      .then(() => authService.getCurrentUser())
      .then(async (current) => {
        // Pull the seller workspace into the device mirror before the UI unlocks,
        // so the synchronous seller reads see real data instead of an empty store.
        if (current) await hydrateSellerWorkspace().catch(() => undefined);
        // The address book is server-owned in remote mode; prime the mirror now so
        // the account count and the checkout address picker are not empty on open.
        if (current) await addressService.hydrate(current.id).catch(() => undefined);
        if (current) await orderService.hydrateCustomerOrders(current.id).catch(() => undefined);
        if (current) await notificationService.hydrate(current.id).catch(() => undefined);
        if (current) await hydrateWishlist(current.id).catch(() => undefined);
        if (current) await hydrateFollows(current.id).catch(() => undefined);
        if (current) await hydrateMyReviews(current.id).catch(() => undefined);
        if (current) await hydrateRecentlyViewed(current.id).catch(() => undefined);
        if (!mounted) return;
        if (current) listingCache.markHydrated(current.id);
        setUser(current);
        setStatus(current ? 'signedIn' : 'signedOut');
      })
      .catch(() => {
        if (mounted) {
          setUser(null);
          setStatus('signedOut');
        }
      });
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
    listingCache.markHydrated(loggedIn.id);
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
      listingCache.markHydrated(registered.id);
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
    listingCache.markHydrated(created.id);
    setUser(created);
    setStatus('signedIn');
    return created;
  }, []);

  const signOut = React.useCallback(async (userId?: string): Promise<void> => {
    await authService.logout(userId);
    setUser(null);
    setStatus('signedOut');
  }, []);

  // Remote-only affordance: revoke every server session for the account, not just
  // this device. In local mode the gateway maps this to a plain sign-out.
  const signOutEverywhere = React.useCallback(async (userId?: string): Promise<void> => {
    await authService.logoutEverywhere(userId);
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
    if (current) listingCache.markHydrated(current.id);
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
