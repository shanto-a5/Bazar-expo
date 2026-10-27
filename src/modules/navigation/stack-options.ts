/**
 * Shared navigation architecture (M10-N1).
 *
 * One place that defines how Vanta's native stacks behave, so a screen added in
 * future inherits correct back behaviour by being inside a group layout rather
 * than by re-implementing navigation.
 *
 * ## The rule this file exists to enforce
 *
 * > Back ALWAYS means "go to the immediately previous screen in the navigation
 * > history."
 *
 * That falls out of three invariants:
 *
 *  1. **Forward navigation pushes.** `router.push(...)` for screen-to-screen
 *     movement, so history grows. A route is only ever removed from history by a
 *     deliberate state-boundary `replace` (sign-out, auth guard, flow
 *     completion) — never by ordinary navigation.
 *  2. **Nothing intercepts the platform back gesture.** No `BackHandler`, no
 *     `onBackPress`, no "send back to Home" escape hatch. Expo Router's own
 *     `useBackButton` already maps Android hardware back onto the native
 *     navigator's `goBack()`, and iOS uses the native edge swipe. Overriding
 *     either would break the guarantee above, so neither is registered here.
 *  3. **Screens never fabricate a previous screen.** A screen with no history is
 *     a deep-link or root entry. `BackButton` renders nothing there unless the
 *     caller names an explicit, truthful `fallbackHref`.
 *
 * ## Why there is no predictive-back flag
 *
 * `android.predictiveBackGestureEnabled` is deliberately left `false` in
 * `app.json`. Enabling it sets `android:enableOnBackInvokedCallback="true"`,
 * which makes Android dispatch back through `OnBackInvokedCallback` instead of
 * the legacy `onBackPressedDispatcher`. The pinned `react-native-screens@4.26.2`
 * implements back **only** via `OnBackPressedCallback` and registers no
 * `OnBackInvokedCallback`, so opting in would leave Android system back
 * unhandled rather than animated. Plain system back works correctly today;
 * predictive back should be turned on together with a screens release that
 * supports it, and it is not worth risking the working path to get it early.
 *
 * ## Why `fullScreenGestureEnabled` is not set
 *
 * It is available in this Expo SDK, but a full-screen swipe conflicts with the
 * horizontal product rails in `index`, `browse`, `product/[id]` and
 * `discovery-filters` — the edge-swipe would fight the carousels. The standard
 * iOS left-edge `gestureEnabled` swipe is left on, which is the gesture the
 * platform reserves for "back" and the one users expect.
 */
import type { NativeStackNavigationOptions } from 'expo-router';

import { colors } from '@/theme/tokens';

/**
 * `screenOptions` for every Vanta route-group stack.
 *
 * Applied at the group layout, so it reaches routes that are not individually
 * declared in `<Stack.Screen>` as well as the ones that are.
 */
export const vantaStackScreenOptions: NativeStackNavigationOptions = {
  // The customer shell, the seller workspace and the auth stack all draw their
  // own headers, so the native header stays hidden — but hiding a header does
  // NOT disable native back, and the two settings are independent.
  headerShown: false,
  contentStyle: { backgroundColor: colors.background },

  // iOS: the native left-edge back swipe. Explicit rather than implicit so that
  // a future screen cannot silently inherit a disabled gesture.
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/**
 * Auth screens keep the native header: they are a short, linear flow where the
 * platform header (with its back chevron and `headerBackTitle`) is both correct
 * and free, so there is no reason to hand-roll a back control there.
 */
export const vantaAuthStackScreenOptions: NativeStackNavigationOptions = {
  headerTintColor: colors.primary,
  headerTitleStyle: { fontWeight: '700' },
  contentStyle: { backgroundColor: colors.background },
  headerShadowVisible: false,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/**
 * Deep-link anchors.
 *
 * A cold deep link (`vanta://product/p1`, `/order/so_1`) otherwise builds
 * a stack whose only entry is the deep-linked screen, so Back has nowhere real
 * to go. `unstable_settings.anchor` makes Expo Router seed the group stack with
 * the group's root route first, which gives a deep-linked screen a truthful
 * parent to return to instead of leaving the user stranded.
 *
 * Group roots:
 *  - customer: `index` (the public marketplace home)
 *  - auth:     `login`
 */
export const ROUTE_GROUP_ANCHORS = {
  home: 'index',
  auth: 'login',
} as const;
