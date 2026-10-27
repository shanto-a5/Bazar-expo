/**
 * Customer bottom navigation dock.
 *
 * One floating glass surface with exactly four destinations — Home, Cart, Save,
 * Settings — mapped onto the routes that already exist in the `/(home)` shell.
 * No route is duplicated and no navigation state is invented: the active tab is
 * derived from the current pathname and navigation goes through Expo Router.
 *
 * This component is presentation + navigation only. It deliberately owns no
 * business rules: the cart badge reuses the same `cartService.itemCount` read
 * and guest/session owner that the home screen already uses, and the Save tab
 * simply routes to `/wishlist`, where the existing `SignInGate` still applies.
 */
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router, usePathname } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import mediumWeight from 'expo-symbols/androidWeights/medium';
import * as React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/modules/session/session-context';
import { cartService } from '@/services/cart-service';
import { colors, makeShadow, radius, spacing, type } from '@/theme/tokens';
import { CUSTOMER_DOCK_BOTTOM_GAP, CUSTOMER_DOCK_HEIGHT } from './customer-dock-inset';

/** Comfortable margins on phones, capped so the dock stays readable on desktop. */
const DOCK_MAX_WIDTH = 560;
const ICON_SIZE = 22;
const MIN_TOUCH_TARGET = 44;

const ICON_WEIGHT = { ios: 'medium' as const, android: mediumWeight };

type DockHref = '/' | '/cart' | '/wishlist' | '/settings';

type DockTab = {
  key: 'home' | 'cart' | 'save' | 'settings';
  label: string;
  href: DockHref;
};

/**
 * `expo-symbols` takes SF Symbol names on iOS and Material Symbols elsewhere, so
 * each tab names all three rather than shipping one platform's set to the rest.
 */
const TABS: readonly (DockTab & {
  icon: { ios: 'house' | 'cart' | 'heart' | 'gearshape'; android: 'home' | 'shopping_cart' | 'favorite' | 'settings'; web: 'home' | 'shopping_cart' | 'favorite' | 'settings' };
})[] = [
  { key: 'home', label: 'Home', href: '/', icon: { ios: 'house', android: 'home', web: 'home' } },
  { key: 'cart', label: 'Cart', href: '/cart', icon: { ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' } },
  { key: 'save', label: 'Save', href: '/wishlist', icon: { ios: 'heart', android: 'favorite', web: 'favorite' } },
  { key: 'settings', label: 'Settings', href: '/settings', icon: { ios: 'gearshape', android: 'settings', web: 'settings' } },
];

/**
 * Native Liquid Glass is iOS-only and version-gated. Everywhere else — and on
 * iOS versions without it — we fall back to a single restrained translucent
 * surface, adding a CSS backdrop blur on web where the platform supports it.
 */
const NATIVE_GLASS_AVAILABLE = Platform.OS === 'ios' && isLiquidGlassAvailable();

type BlurStyle = ViewStyle & { backdropFilter?: string; WebkitBackdropFilter?: string };

const WEB_BACKDROP_BLUR: BlurStyle | null =
  Platform.OS === 'web'
    ? {
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }
    : null;

export function CustomerBottomDock(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { cartOwnerId } = useSession();

  // Same read the home screen and cart screen use. Derived during render (rather
  // than captured on focus) so that a remote cart round trip — which ripples
  // through the session context — updates the badge without restructuring the
  // navigation. In local mode this is a plain repository read that stays in sync
  // with every mutation's `cart.updatedAt`.
  const cartCount = cartService.itemCount(cartOwnerId);

  const isActive = React.useCallback(
    (href: DockHref) => (href === '/' ? pathname === '/' : pathname === href),
    [pathname],
  );

  const items = (
    <View style={styles.row}>
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        const badge = tab.key === 'cart' ? cartCount : 0;

        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (!active) router.navigate(tab.href);
            }}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            accessibilityHint={
              active ? undefined : `Opens ${tab.label === 'Save' ? 'your saved items' : tab.label.toLowerCase()}`
            }
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          >
            <View style={[styles.itemInner, active && styles.itemInnerActive]}>
              <View style={styles.iconSlot}>
                <SymbolView
                  name={tab.icon}
                  size={ICON_SIZE}
                  weight={ICON_WEIGHT}
                  tintColor={active ? colors.primary : colors.textMuted}
                />
                {badge > 0 ? (
                  <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Text style={styles.badgeText} numberOfLines={1}>
                      {badge > 99 ? '99+' : badge}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>
                {tab.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  const surfaceStyle = [
    styles.surface,
    NATIVE_GLASS_AVAILABLE ? null : styles.surfaceFallback,
    WEB_BACKDROP_BLUR,
    makeShadow(3),
  ];

  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom: insets.bottom + CUSTOMER_DOCK_BOTTOM_GAP }]}
    >
      {NATIVE_GLASS_AVAILABLE ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          tintColor="rgba(255,255,255,0.55)"
          style={surfaceStyle}
        >
          {items}
        </GlassView>
      ) : (
        <View style={surfaceStyle}>{items}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  surface: {
    width: '100%',
    maxWidth: DOCK_MAX_WIDTH,
    height: CUSTOMER_DOCK_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  surfaceFallback: {
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(28,25,23,0.10)',
  },
  row: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  itemPressed: { opacity: 0.6 },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  itemInnerActive: { backgroundColor: 'rgba(248,86,6,0.10)' },
  iconSlot: { width: ICON_SIZE, height: ICON_SIZE },
  badge: {
    position: 'absolute',
    top: -6,
    left: ICON_SIZE - 3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...type.caption,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
    color: colors.textInverse,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  labelActive: { color: colors.primary },
  labelIdle: { color: colors.textMuted },
});
