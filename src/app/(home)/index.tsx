/**
 * Home — the shopper's area feed.
 *
 * Deliberately bare for first-time smartphone users: a header showing the
 * selected area (tap it to change) and the grid of products sold by shops that
 * serve that area. Everything on screen comes from the cache-first catalogue
 * mirror (`useListingCache`), so a cold start renders the last saved feed
 * immediately and refreshes in the background.
 *
 * The area itself is chosen once, in the full-screen selector that the root
 * layout shows before this screen can mount (see `AreaGate`).
 */
import * as React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Image as ExpoImage } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import mediumWeight from 'expo-symbols/androidWeights/medium';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCustomerDockClearance } from '@/components/customer-dock-inset';
import { Logo, taka } from '@/components/ui';
import { useListingCache } from '@/modules/cache/use-listing-cache';
import { useArea } from '@/modules/area/area-context';
import { matchAreaTokens, productsForArea } from '@/modules/area/area-logic';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { useSession } from '@/modules/session/session-context';
import { WishlistButton } from '@/modules/wishlist/wishlist-button';
import type { Product } from '@/domain/types';
import { cartService } from '@/services/cart-service';
import { catalogService, effectivePrice } from '@/services/catalog-service';
import { notificationService } from '@/services/notification-service';
import { colors, radius, spacing, type } from '@/theme/tokens';
import { makePaletteImage, resolveImage } from '@/utils/image';

export { matchAreaTokens };

const ICON_WEIGHT = { ios: 'medium' as const, android: mediumWeight };

function discountOff(product: { salePrice?: number | null; regularPrice: number }): number {
  if (!product.salePrice || product.salePrice >= product.regularPrice) return 0;
  return Math.round((1 - product.salePrice / product.regularPrice) * 100);
}

function compactNumber(n: number): string {
  if (n >= 1000) {
    const value = n / 1000;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}k`;
  }
  return String(n);
}

function HomeImage({ uri, empty }: { uri?: string | null; empty?: string }): React.JSX.Element {
  const resolved = resolveImage(uri && uri.length > 0 ? uri : empty ? makePaletteImage(empty, 'store') : undefined);
  if (!resolved) {
    return <View style={styles.fill} />;
  }
  if (resolved.kind === 'uri') {
    return <ExpoImage source={resolved.uri} contentFit="cover" transition={150} style={[styles.fill, { backgroundColor: colors.surfaceMuted }]} />;
  }
  return (
    <View style={[styles.fill, { alignItems: 'center', justifyContent: 'center', backgroundColor: resolved.c1 }]}>
      <Text style={{ fontSize: 26 }}>{resolved.emoji}</Text>
    </View>
  );
}

function CountBadge({ count }: { count: number }): React.JSX.Element {
  return (
    <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.badgeText} numberOfLines={1}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

function GridProductCard({ product, onPress }: { product: Product; onPress: () => void }): React.JSX.Element {
  const off = discountOff(product);
  const price = effectivePrice(product);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={product.name}
      style={({ pressed }) => [styles.gridCard, pressed && styles.pressed]}
    >
      <View style={styles.gridImage}>
        <HomeImage uri={product.images?.[0]} />
        {off > 0 ? (
          <View style={styles.offBadge}>
            <Text style={styles.offBadgeText}>{off}% OFF</Text>
          </View>
        ) : null}
        <View style={styles.wishSlot}>
          <WishlistButton productId={product.id} label={product.name} size={15} />
        </View>
      </View>
      <View style={styles.gridBody}>
        <Text numberOfLines={2} style={styles.gridName}>
          {product.name}
        </Text>
        <View style={styles.gridPriceRow}>
          <Text style={styles.gridPrice}>{taka(price)}</Text>
          {off > 0 ? <Text style={styles.gridWas}>{taka(product.regularPrice)}</Text> : null}
        </View>
        <View style={styles.gridMetaRow}>
          {product.ratingCount > 0 ? (
            <Text style={styles.gridMeta}>
              <Text style={{ color: colors.accent }}>★ </Text>
              {product.ratingAvg.toFixed(1)}
            </Text>
          ) : (
            <Text style={styles.gridMeta}>New</Text>
          )}
          {product.soldCount > 0 ? <Text style={styles.gridMeta}>{compactNumber(product.soldCount)} sold</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function HomeScreen(): React.JSX.Element {
  const { user, cartOwnerId } = useSession();
  const { area, openSelector } = useArea();
  const insets = useSafeAreaInsets();
  const dockClearance = useCustomerDockClearance() ?? 0;

  const [cartCount, setCartCount] = React.useState(0);
  const [notifCount, setNotifCount] = React.useState(0);
  useFocusEffect(
    React.useCallback(() => {
      setCartCount(cartService.itemCount(cartOwnerId));
      setNotifCount(user ? notificationService.unreadCount(user.id) : 0);
    }, [cartOwnerId, user]),
  );

  const { loaded: catalogLoaded, refreshing, refresh, retry: retryHome, error: homeError, version } = useListingCache(cartOwnerId, 'home');

  // Every read pulls from the device mirror synchronously. `version` ticks
  // whenever a background or pull-to-refresh read settles, so the memo lists it
  // as a dependency and reads it (`void version`) to recompute on that tick.
  const areaSlug = area?.slug ?? '';
  const products = React.useMemo(() => {
    void version;
    const all = catalogService.query({
      statuses: ['active'],
      inStockOnly: true,
      sort: 'popularity',
      customerVisibleOnly: true,
      limit: 1000,
      offset: 0,
    });
    return productsForArea(all, catalogService.visibleStores(), areaSlug);
  }, [version, areaSlug]);

  const waitingForCatalog = !catalogLoaded && products.length === 0;

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerInner}>
        <Logo size={30} />
        <Pressable
          onPress={openSelector}
          accessibilityRole="button"
          accessibilityLabel={`Your area: ${area?.name ?? ''}. Tap to change.`}
          style={({ pressed }) => [styles.areaChip, pressed && styles.pressed]}
        >
          <Text style={styles.areaPin}>📍</Text>
          <Text style={styles.areaName} numberOfLines={1}>
            {area?.name ?? ''}
          </Text>
          <Text style={styles.areaChange}>▾</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/search')}
          accessibilityRole="button"
          accessibilityLabel="Search products"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <SymbolView
            name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
            size={20}
            weight={ICON_WEIGHT}
            tintColor={colors.textInverse}
          />
        </Pressable>
        {user ? (
          <Pressable
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <SymbolView
              name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
              size={20}
              weight={ICON_WEIGHT}
              tintColor={colors.textInverse}
            />
            {notifCount > 0 ? <CountBadge count={notifCount} /> : null}
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push('/cart')}
          accessibilityRole="button"
          accessibilityLabel="My cart"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <SymbolView
            name={{ ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' }}
            size={20}
            weight={ICON_WEIGHT}
            tintColor={colors.textInverse}
          />
          {cartCount > 0 ? <CountBadge count={cartCount} /> : null}
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      {header}
      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
        contentContainerStyle={{
          gap: spacing.md,
          padding: spacing.lg,
          paddingBottom: dockClearance + insets.bottom + spacing.xxl,
        }}
        style={{ flex: 1 }}
        ListHeaderComponent={
          homeError ? (
            <NoticeCard
              tone="warning"
              title="Couldn't refresh"
              message={`${homeError} Showing the last saved catalogue.`}
              actionLabel="Try again"
              onAction={retryHome}
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <GridProductCard
            product={item}
            onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          waitingForCatalog ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }} accessibilityLabel="Loading products">
              {[0, 1, 2, 3].map((key) => (
                <View key={key} style={{ flex: 1, minWidth: '44%', height: 210, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted }} />
              ))}
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No shops are available here yet. We have notified local sellers!</Text>
              <Text style={styles.emptyBangla}>এখানে এখনো কোনো দোকান নেই। আমরা স্থানীয় বিক্রেতাদের জানিয়েছি!</Text>
              <Pressable onPress={openSelector} accessibilityRole="button" style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}>
                <Text style={styles.emptyActionText}>Choose another area · অন্য এলাকা বাছাই করুন</Text>
              </Pressable>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  pressed: {
    opacity: 0.8,
  },

  header: {
    backgroundColor: colors.primary,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  areaChip: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
  },
  areaPin: {
    fontSize: 14,
  },
  areaName: {
    ...type.h3,
    color: colors.text,
    flex: 1,
  },
  areaChange: {
    ...type.caption,
    color: colors.textMuted,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: radius.pill,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },

  offBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  offBadgeText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: '800',
  },
  wishSlot: {
    position: 'absolute',
    top: 6,
    right: 6,
  },

  gridCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  gridImage: {
    width: '100%',
    aspectRatio: 1,
  },
  gridBody: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  gridName: {
    ...type.label,
    fontSize: 12,
    color: colors.text,
    lineHeight: 15,
  },
  gridPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    marginTop: 4,
  },
  gridPrice: {
    ...type.label,
    fontSize: 15,
    color: colors.primary,
  },
  gridWas: {
    ...type.caption,
    fontSize: 11,
    textDecorationLine: 'line-through',
  },
  gridMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  gridMeta: {
    ...type.caption,
    fontSize: 11,
  },

  empty: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  emptyTitle: {
    ...type.h3,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBangla: {
    ...type.bodyMuted,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  emptyActionText: {
    ...type.label,
    color: colors.textInverse,
  },
});
