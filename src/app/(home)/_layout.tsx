/**
 * Customer home shell (M2-G, M10-N1).
 *
 * PUBLIC marketplace shell: `/`, `/browse`, `/search`, `/product/[id]` and
 * `/cart` are guest-accessible, so this layout holds no session gate at all.
 * Authentication is enforced at protected actions and protected routes
 * (`route-guard.tsx` / `settings.tsx` / `checkout/`), never at entry.
 * Product and category data come exclusively from the existing CatalogService +
 * seeded local repositories — nothing here is hardcoded. No M3 features.
 * Route group: `/(home)` → resolves the public `/` route.
 *
 * Navigation: the stack options live in `@/modules/navigation/stack-options` so
 * the back-gesture contract is declared once. The Liquid Glass dock below is
 * primary-destination navigation (Home / Cart / Save / Settings) and is
 * deliberately NOT the back mechanism — the native stack handles back, and
 * `BackButton` provides the in-app affordance.
 */
import { Stack } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';

import { CustomerBottomDock } from '@/components/customer-bottom-dock';
import { CustomerDockClearanceProvider } from '@/components/customer-dock-inset';
import { ROUTE_GROUP_ANCHORS, vantaStackScreenOptions } from '@/modules/navigation/stack-options';

/**
 * Deep links such as `/product/p1` enter with `index` seeded beneath them, so
 * Back from a cold-linked product returns to the marketplace rather than
 * stranding the user. See `ROUTE_GROUP_ANCHORS`.
 */
export const unstable_settings = { anchor: ROUTE_GROUP_ANCHORS.home };

export default function HomeLayout(): React.JSX.Element {
  return (
    <CustomerDockClearanceProvider>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={vantaStackScreenOptions}>
          <Stack.Screen name="index" />
          <Stack.Screen name="browse" />
          <Stack.Screen name="search" />
          <Stack.Screen name="product/[id]" />
          <Stack.Screen name="cart" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="checkout" />
          <Stack.Screen name="order-confirmation" />
          <Stack.Screen name="orders" />
          <Stack.Screen name="order/[id]" />
          <Stack.Screen name="return-request" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="account" />
          <Stack.Screen name="addresses" />
          <Stack.Screen name="my-reviews" />
          <Stack.Screen name="stores" />
          <Stack.Screen name="store/[id]" />
          <Stack.Screen name="vouchers" />
          <Stack.Screen name="wishlist" />
          <Stack.Screen name="write-review" />
        </Stack>
        <CustomerBottomDock />
      </View>
    </CustomerDockClearanceProvider>
  );
}
