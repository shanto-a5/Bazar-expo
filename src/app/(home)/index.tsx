/**
 * Home — the shopper's area feed.
 *
 * Deliberately bare for first-time smartphone users: a header showing the
 * selected area (tap it to change), a compact expandable search bar, and the
 * grid of products sold by shops that serve that area. Everything on screen
 * comes from the cache-first catalogue mirror (`useListingCache`), so a cold
 * start renders the last saved feed immediately and refreshes in the background.
 *
 * The area itself is chosen once, in the full-screen selector that the root
 * layout shows before this screen can mount (see `AreaGate`).
 */
import * as React from 'react';
import {
  Animated,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BlurView } from 'expo-blur';
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
import { useQuickCommerce } from '@/modules/commerce/quick-commerce';
import { useLanguage } from '@/modules/language/language-context';
import { useSession } from '@/modules/session/session-context';
import { WishlistButton } from '@/modules/wishlist/wishlist-button';
import type { Product } from '@/domain/types';
import { cartService } from '@/services/cart-service';
import { catalogService, effectivePrice } from '@/services/catalog-service';
import { notificationService } from '@/services/notification-service';
import { searchService } from '@/services/search-service';
import { colors, makeShadow, radius, spacing, type } from '@/theme/tokens';
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
    return (
      <ExpoImage
        source={resolved.uri}
        contentFit="cover"
        transition={150}
        style={[styles.fill, { backgroundColor: colors.surfaceMuted }]}
      />
    );
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

function GridProductCard({
  product,
  onPress,
  offSuffix,
  newBadge,
  soldSuffix,
}: {
  product: Product;
  onPress: () => void;
  offSuffix: string;
  newBadge: string;
  soldSuffix: string;
}): React.JSX.Element {
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
        <HomeImage uri={product.images?.[0]} empty={product.name} />
        {off > 0 ? (
          <View style={styles.offBadge}>
            <Text style={styles.offBadgeText}>
              {off}
              {offSuffix}
            </Text>
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
            <Text style={styles.gridMeta}>{newBadge}</Text>
          )}
          {product.soldCount > 0 ? (
            <Text style={styles.gridMeta}>
              {compactNumber(product.soldCount)} {soldSuffix}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function HomeScreen(): React.JSX.Element {
  const { user, cartOwnerId } = useSession();
  const { area, openSelector } = useArea();
  const { t } = useLanguage();
  const { openQuickView, openMiniCart, cartBounceScale } = useQuickCommerce();
  const insets = useSafeAreaInsets();
  const dockClearance = useCustomerDockClearance() ?? 0;

  const [notifCount, setNotifCount] = React.useState(0);
  const [searchFocused, setSearchFocused] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [recentSearches, setRecentSearches] = React.useState<string[]>([]);
  const searchInputRef = React.useRef<React.ComponentRef<typeof TextInput> | null>(null);

  const cartCount = cartService.itemCount(cartOwnerId);

  useFocusEffect(
    React.useCallback(() => {
      setNotifCount(user ? notificationService.unreadCount(user.id) : 0);
      setRecentSearches(user ? searchService.history(user.id, 6) : []);
    }, [user]),
  );

  const {
    loaded: catalogLoaded,
    refreshing,
    refresh,
    retry: retryHome,
    error: homeError,
    version,
  } = useListingCache(cartOwnerId, 'home');

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

  // Filter grid products if user typed a search query
  const displayedProducts = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const hay = `${p.name} ${p.brand} ${p.description}`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, searchQuery]);

  // Suggestions shown directly below the expanded search bar
  const keywordSuggestions = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const pool = new Set<string>();
    for (const term of recentSearches) {
      if (!q || term.toLowerCase().includes(q)) pool.add(term);
    }
    for (const p of products) {
      if (!q || p.name.toLowerCase().includes(q)) {
        pool.add(p.name);
      }
      if (p.brand && (!q || p.brand.toLowerCase().includes(q))) {
        pool.add(p.brand);
      }
      if (pool.size >= 6) break;
    }
    return Array.from(pool).slice(0, 5);
  }, [products, recentSearches, searchQuery]);

  const productSuggestions = React.useMemo(() => {
    return displayedProducts.slice(0, 5);
  }, [displayedProducts]);

  const collapseSearch = React.useCallback(() => {
    setSearchFocused(false);
    searchInputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const handleSelectKeyword = React.useCallback(
    (term: string) => {
      setSearchQuery(term);
      if (user && term.trim()) {
        searchService.recordHistory(user.id, term.trim());
        setRecentSearches(searchService.history(user.id, 6));
      }
      collapseSearch();
    },
    [user, collapseSearch],
  );

  const handleSelectSuggestedProduct = React.useCallback(
    (product: Product) => {
      if (user && searchQuery.trim()) {
        searchService.recordHistory(user.id, searchQuery.trim());
      }
      collapseSearch();
      openQuickView(product);
    },
    [user, searchQuery, collapseSearch, openQuickView],
  );

  const waitingForCatalog = !catalogLoaded && products.length === 0;

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }, searchFocused && styles.headerElevated]}>
      <View style={styles.headerInner}>
        {!searchFocused ? (
          <>
            <Logo size={30} />
            <Pressable
              onPress={openSelector}
              accessibilityRole="button"
              accessibilityLabel={`${t('yourArea')}: ${area?.name ?? ''}. ${t('tapToChange')}`}
              style={({ pressed }) => [styles.areaChip, pressed && styles.pressed]}
            >
              <Text style={styles.areaPin}>📍</Text>
              <Text style={styles.areaName} numberOfLines={1}>
                {area?.name ?? ''}
              </Text>
              <Text style={styles.areaChange}>▾</Text>
            </Pressable>
          </>
        ) : null}

        {/* STEP 1: Compact resting search bar that expands to full screen width onFocus */}
        <View style={searchFocused ? styles.searchExpandedContainer : styles.searchCompactContainer}>
          <SymbolView
            name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
            size={16}
            weight={ICON_WEIGHT}
            tintColor={searchFocused ? colors.primary : colors.textMuted}
          />
          <TextInput
            ref={searchInputRef}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t('searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (user && searchQuery.trim()) {
                searchService.recordHistory(user.id, searchQuery.trim());
                setRecentSearches(searchService.history(user.id, 6));
              }
              collapseSearch();
            }}
            style={searchFocused ? styles.searchInputExpanded : styles.searchInputCompact}
            accessibilityLabel={t('search')}
          />
          {searchQuery.length > 0 ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              accessibilityRole="button"
              accessibilityLabel={t('clearHistory')}
              style={styles.clearInputBtn}
            >
              <Text style={styles.clearInputText}>✕</Text>
            </Pressable>
          ) : null}
          {searchFocused ? (
            <Pressable
              onPress={collapseSearch}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={({ pressed }) => [styles.cancelSearchChip, pressed && styles.pressed]}
            >
              <Text style={styles.cancelSearchText}>{t('close')}</Text>
            </Pressable>
          ) : null}
        </View>

        {!searchFocused && user ? (
          <Pressable
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={t('notifications')}
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

        {!searchFocused ? (
          <Animated.View style={{ transform: [{ scale: cartBounceScale }] }}>
            <Pressable
              onPress={openMiniCart}
              accessibilityRole="button"
              accessibilityLabel={t('myCart')}
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
          </Animated.View>
        ) : null}
      </View>

      {/* STEP 1: Search suggestions directly below the expanded search input */}
      {searchFocused ? (
        <View style={styles.suggestionsDropdown}>
          <ScrollView
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            style={styles.suggestionsScroll}
            contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}
          >
            {keywordSuggestions.length > 0 ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={styles.suggestionHeading}>{t('suggestedSearches')}</Text>
                <View style={styles.keywordWrap}>
                  {keywordSuggestions.map((term) => (
                    <Pressable
                      key={term}
                      onPress={() => handleSelectKeyword(term)}
                      accessibilityRole="button"
                      accessibilityLabel={term}
                      style={({ pressed }) => [styles.keywordChip, pressed && styles.pressed]}
                    >
                      <Text numberOfLines={1} style={styles.keywordChipText}>
                        🔍 {term}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={{ gap: spacing.xs }}>
              <Text style={styles.suggestionHeading}>{t('matchingProducts')}</Text>
              {productSuggestions.length === 0 ? (
                <Text style={styles.noMatchText}>{t('noSearchMatches')}</Text>
              ) : (
                productSuggestions.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => handleSelectSuggestedProduct(item)}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                    style={({ pressed }) => [styles.suggestionProductRow, pressed && styles.pressed]}
                  >
                    <View style={styles.suggestionThumb}>
                      <HomeImage uri={item.images?.[0]} empty={item.name} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.suggestionProductName}>
                        {item.name}
                      </Text>
                      <Text style={styles.suggestionProductPrice}>{taka(effectivePrice(item))}</Text>
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      {header}
      <View style={styles.fill}>
        <FlatList
          data={displayedProducts}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
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
                title={t('couldntRefresh')}
                message={`${homeError} ${t('showingSavedCatalogue')}`}
                actionLabel={t('tryAgain')}
                onAction={retryHome}
              />
            ) : undefined
          }
          renderItem={({ item }) => (
            <GridProductCard
              product={item}
              offSuffix={t('offSuffix')}
              newBadge={t('newBadge')}
              soldSuffix={t('soldSuffix')}
              onPress={() => openQuickView(item)}
            />
          )}
          ListEmptyComponent={
            waitingForCatalog ? (
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}
                accessibilityLabel={t('loadingProducts')}
              >
                {[0, 1, 2, 3].map((key) => (
                  <View
                    key={key}
                    style={{
                      flex: 1,
                      minWidth: '44%',
                      height: 210,
                      borderRadius: radius.lg,
                      backgroundColor: colors.surfaceMuted,
                    }}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{t('emptyAreaPrimary')}</Text>
                <Text style={styles.emptyBangla}>{t('emptyAreaSecondary')}</Text>
                <Pressable
                  onPress={openSelector}
                  accessibilityRole="button"
                  accessibilityLabel={t('chooseAnotherArea')}
                  style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}
                >
                  <Text style={styles.emptyActionText}>{t('chooseAnotherArea')}</Text>
                </Pressable>
              </View>
            )
          }
        />

        {/* STEP 1: Full-screen blurred backdrop over the rest of the app when search is focused */}
        {searchFocused ? (
          <View style={[StyleSheet.absoluteFill, styles.blurOverlayWrap]}>
            <BlurView tint="dark" intensity={50} style={StyleSheet.absoluteFill} />
            <Pressable
              onPress={collapseSearch}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={[StyleSheet.absoluteFill, styles.blurDimScrim]}
            />
          </View>
        ) : null}
      </View>
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
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },

  header: {
    backgroundColor: colors.primary,
    zIndex: 10,
  },
  headerElevated: {
    zIndex: 50,
    elevation: 20,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  areaChip: {
    flex: 1,
    minWidth: 84,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
  },
  areaPin: {
    fontSize: 13,
  },
  areaName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  areaChange: {
    ...type.caption,
    color: colors.textMuted,
  },
  searchCompactContainer: {
    width: 112,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
  },
  searchExpandedContainer: {
    flex: 1,
    width: '100%',
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    ...makeShadow(2),
  },
  searchInputCompact: {
    flex: 1,
    fontSize: 12,
    color: colors.text,
    paddingVertical: 0,
  },
  searchInputExpanded: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    paddingVertical: 0,
  },
  clearInputBtn: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearInputText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
  },
  cancelSearchChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  cancelSearchText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  suggestionsDropdown: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...makeShadow(3),
  },
  suggestionsScroll: {
    maxHeight: 300,
  },
  suggestionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  keywordWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  keywordChip: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  keywordChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  noMatchText: {
    fontSize: 12,
    color: colors.textMuted,
    paddingVertical: spacing.xs,
  },
  suggestionProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  suggestionThumb: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  suggestionProductName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  suggestionProductPrice: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  blurOverlayWrap: {
    zIndex: 30,
  },
  blurDimScrim: {
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
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
