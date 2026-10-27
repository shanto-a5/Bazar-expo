/**
 * Home — customer marketplace shell (M2-G).
 *
 * Market-style discovery layout (sticky brand header, live-promo hero,
 * category grid, deals rail, stores-to-follow rail, personalised rails and a
 * two-column product grid). Every value — hero discount, prices, ratings,
 * sold/follower counts, cart and notification badges — comes from the real
 * catalog, session, cart, notification, voucher and seller services. Nothing
 * is hardcoded and no marketplace feature is simulated.
 */
import * as React from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Image as ExpoImage } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import mediumWeight from 'expo-symbols/androidWeights/medium';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCustomerDockClearance } from '@/components/customer-dock-inset';
import { Logo, taka } from '@/components/ui';
import { useListingCache } from '@/modules/cache/use-listing-cache';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { ProductRail } from '@/modules/discovery/discovery-filters';
import { useSession } from '@/modules/session/session-context';
import { WishlistButton } from '@/modules/wishlist/wishlist-button';
import type { Category, Product, Store } from '@/domain/types';
import { cartService } from '@/services/cart-service';
import { catalogService, effectivePrice } from '@/services/catalog-service';
import { notificationService } from '@/services/notification-service';
import { storeService } from '@/services/store-service';
import { voucherService } from '@/services/voucher-service';
import { colors, makeShadow, radius, spacing, type } from '@/theme/tokens';
import { makePaletteImage, resolveImage } from '@/utils/image';

const ICON_WEIGHT = { ios: 'medium' as const, android: mediumWeight };

const CATEGORY_TILE_WIDTH = 66;
const CATEGORY_ICON_BOX = 52;

/** Short display labels for the reference categories; everything else keeps its own name. */
const CATEGORY_LABELS: Record<string, string> = {
  Groceries: 'Grocery',
  'Health & Wellness': 'Health',
  'Home & Living': 'Home',
  'Baby & Maternity': 'Baby',
  'Sports & Outdoors': 'Sports',
  'Toys & Games': 'Toys',
  'Pets & Supplies': 'Pets',
  'Books & Stationery': 'Books',
};

function labelForCategory(name: string): string {
  return CATEGORY_LABELS[name] ?? name;
}

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

type CategorySymbol = { ios: SFSymbol; android: AndroidSymbol; web: AndroidSymbol };

/**
 * Maps a taxonomy category onto its own icon. Categories are server-seeded and
 * keyed by opaque ids, so the match is keyword-based over id + name and ordered
 * from most specific to most generic: that ordering is what keeps overlapping
 * names apart ("Home Appliances" vs "Home & Living", "Women's" vs "Men's",
 * "Kids' Fashion" vs "Toys & Games"). Every top-level category in the reference
 * taxonomy resolves to a distinct glyph; the final branch is only a safety net
 * for a category the app has not seen yet.
 */
function symbolForCategory(category: Category): CategorySymbol {
  const key = `${category.id} ${category.name}`.toLowerCase();
  if (/(appliance|refrigerator|fridge|washing|washer|vacuum|air.?condition|microwave|dishwasher)/.test(key)) {
    return { ios: 'washer', android: 'local_laundry_service', web: 'local_laundry_service' };
  }
  if (/(kitchen|dining|cookware|bakeware|utensil|tableware|cutlery|drinkware)/.test(key)) {
    return { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' };
  }
  if (/(grocer|supermarket|fresh|produce|dairy|bakery|beverage|food|snack|staple)/.test(key)) {
    return { ios: 'basket', android: 'shopping_basket', web: 'shopping_basket' };
  }
  if (/(women|woman|dress|saree|sari|bridal|gown)/.test(key)) {
    return { ios: 'handbag', android: 'shopping_bag', web: 'shopping_bag' };
  }
  if (/(\bmen|menswear|gents)/.test(key)) {
    return { ios: 'tshirt', android: 'checkroom', web: 'checkroom' };
  }
  if (/(kid|child|children|junior|toddler)/.test(key)) {
    return { ios: 'figure.child', android: 'child_care', web: 'child_care' };
  }
  if (/(shoe|footwear|sneaker|sandal|boot|slipper)/.test(key)) {
    return { ios: 'shoe', android: 'footprint', web: 'footprint' };
  }
  if (/(mobile|phone|tablet|smartphone)/.test(key)) {
    return { ios: 'iphone', android: 'smartphone', web: 'smartphone' };
  }
  if (/(laptop|desktop|computer|workstation|macbook)/.test(key)) {
    return { ios: 'laptopcomputer', android: 'laptop_mac', web: 'laptop_mac' };
  }
  if (/(electron|circuit|gadget|device|television|audio|speaker|headphone|camera)/.test(key)) {
    return { ios: 'desktopcomputer', android: 'memory', web: 'memory' };
  }
  if (/(beauty|cosmetic|makeup|make-up|skin|fragrance|perfume|personal care|hair)/.test(key)) {
    return { ios: 'sparkles', android: 'spa', web: 'spa' };
  }
  if (/(health|wellness|medical|pharmac|medicine|supplement|vitamin|first aid|oral|dental)/.test(key)) {
    return { ios: 'cross.case', android: 'medical_services', web: 'medical_services' };
  }
  if (/(sport|outdoor|fitness|gym|exercise|cycling|cricket|camp|hiking)/.test(key)) {
    return { ios: 'sportscourt', android: 'sports_soccer', web: 'sports_soccer' };
  }
  if (/(toy|game|puzzle|plaything)/.test(key)) {
    return { ios: 'gamecontroller', android: 'toys', web: 'toys' };
  }
  if (/(home|living|furniture|sofa|interior|decor|bedding|lighting)/.test(key)) {
    return { ios: 'house', android: 'home', web: 'home' };
  }
  if (/(book|stationer|stationary|office|notebook|pen|marker|art suppl)/.test(key)) {
    return { ios: 'book', android: 'menu_book', web: 'menu_book' };
  }
  if (/(auto|motorbike|car|vehicle|tyre|tire|bike|scooter)/.test(key)) {
    return { ios: 'car', android: 'directions_car', web: 'directions_car' };
  }
  if (/(baby|maternity|infant|newborn|diaper|nursery|stroller|feeding)/.test(key)) {
    return { ios: 'stroller', android: 'child_friendly', web: 'child_friendly' };
  }
  if (/(pet|dog|cat|aquarium|fish)/.test(key)) {
    return { ios: 'pawprint', android: 'pets', web: 'pets' };
  }
  if (/(jewel|watch|diamond|ring|bracelet|necklace|gold|silver)/.test(key)) {
    return { ios: 'diamond', android: 'diamond', web: 'diamond' };
  }
  return { ios: 'square.grid.2x2', android: 'category', web: 'category' };
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

function SectionTitle({
  title,
  caption,
  actionLabel,
  onAction,
}: {
  title: string;
  caption?: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={{ flex: 1 }}>
        <View style={styles.sectionTitleLine}>
          <View style={styles.sectionTitleBar} />
          <Text style={type.h2} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {caption ? (
          <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={8}>
          <Text style={[type.label, { color: colors.primary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
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

function DealCard({ product, onPress }: { product: Product; onPress: () => void }): React.JSX.Element {
  const off = discountOff(product);
  const price = effectivePrice(product);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={product.name}
      style={({ pressed }) => [styles.railDealCard, pressed && styles.pressed]}
    >
      <View style={styles.railDealImage}>
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
      <View style={styles.railDealBody}>
        <Text numberOfLines={1} style={styles.gridName}>
          {product.name}
        </Text>
        <Text style={styles.railDealPrice}>{taka(price)}</Text>
        {off > 0 ? <Text style={styles.gridWas}>{taka(product.regularPrice)}</Text> : null}
        {product.ratingCount > 0 ? (
          <Text style={styles.gridMeta}>
            <Text style={{ color: colors.accent }}>★ </Text>
            {product.ratingAvg.toFixed(1)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function StoreCard({
  store,
  followed,
  onOpen,
  onFollow,
}: {
  store: Store;
  followed: boolean;
  onOpen: () => void;
  onFollow: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open store ${store.name}`}
      style={({ pressed }) => [styles.storeCard, pressed && styles.pressed]}
    >
      <View style={styles.storeLogo}>
        <HomeImage uri={store.logo} empty="🏪" />
      </View>
      <View style={styles.storeNameRow}>
        <Text numberOfLines={1} style={styles.storeName}>
          {store.name}
        </Text>
        {store.verified ? <Text style={styles.storeVerified}>✓</Text> : null}
      </View>
      <Text style={styles.storeMeta}>
        ★ {store.ratingAvg.toFixed(1)} · {compactNumber(store.followerCount)}
      </Text>
      <Pressable
        onPress={onFollow}
        accessibilityRole="button"
        accessibilityLabel={followed ? `Unfollow ${store.name}` : `Follow ${store.name}`}
        style={({ pressed }) => [styles.followBtn, followed && styles.followBtnFollowing, pressed && styles.pressed]}
      >
        <Text style={[styles.followBtnText, followed && styles.followBtnTextFollowing]}>
          {followed ? 'Following' : '+ Follow'}
        </Text>
      </Pressable>
    </Pressable>
  );
}

export default function HomeScreen(): React.JSX.Element {
  const { user, cartOwnerId } = useSession();
  const insets = useSafeAreaInsets();
  const dockClearance = useCustomerDockClearance() ?? 0;

  const [cartCount, setCartCount] = React.useState(0);
  const [notifCount, setNotifCount] = React.useState(0);
  const [followed, setFollowed] = React.useState<Set<string>>(() => new Set());
  const syncFollowed = React.useCallback(() => {
    setFollowed(user ? new Set(storeService.followedStores(user.id).map((s) => s.id)) : new Set<string>());
  }, [user]);
  useFocusEffect(
    React.useCallback(() => {
      setCartCount(cartService.itemCount(cartOwnerId));
      setNotifCount(user ? notificationService.unreadCount(user.id) : 0);
      syncFollowed();
    }, [cartOwnerId, user, syncFollowed]),
  );

  const { refreshing, refresh, retry: retryHome, error: homeError, version } = useListingCache(cartOwnerId, 'home');

  // Every read below pulls from the device mirror synchronously. `version` ticks
  // whenever a background or pull-to-refresh read settles, so each memo lists it
  // as a dependency and reads it (`void version`) to recompute on that tick.
  const categories = React.useMemo(() => {
    void version;
    return catalogService.getTree();
  }, [version]);
  const products = React.useMemo(() => {
    void version;
    return catalogService.query({
      statuses: ['active'],
      inStockOnly: true,
      sort: 'popularity',
      customerVisibleOnly: true,
      limit: 24,
      offset: 0,
    });
  }, [version]);
  const deals = React.useMemo(() => {
    void version;
    return catalogService.query({
      onlyDiscounted: true,
      inStockOnly: true,
      customerVisibleOnly: true,
      sort: 'popularity',
      limit: 10,
    });
  }, [version]);
  const recommendations = React.useMemo(() => {
    void version;
    return catalogService.recommendations(user?.id, 10);
  }, [user?.id, version]);
  const recent = React.useMemo(() => {
    void version;
    return user ? catalogService.recentlyViewed(user.id, 10) : [];
  }, [user, version]);
  const stores = React.useMemo(() => {
    void version;
    return catalogService.visibleStores().slice(0, 10);
  }, [version]);
  const rails = React.useMemo(() => {
    void version;
    return catalogService.discovery(user?.id, 10);
  }, [user?.id, version]);
  const flashProducts = rails.find((rail) => rail.key === 'flash')?.products ?? [];
  const extraRails = rails.filter((rail) => rail.products.length > 0 && rail.key !== 'flash');
  const flashPromos = React.useMemo(() => {
    void version;
    return catalogService.activeFlashSalePromotions();
  }, [version]);
  const vouchers = React.useMemo(() => {
    void version;
    return voucherService.listActive();
  }, [version]);
  const maxFlashOff = Math.max(0, ...flashPromos.map((p) => Number(p.discountPercent) || 0));

  const firstName = user?.name?.trim().split(/\s+/)[0] ?? 'there';

  const dealRail =
    flashProducts.length > 0
      ? { title: 'Flash sale', caption: 'Limited-time prices from live promotions', items: flashProducts }
      : deals.length > 0
        ? { title: 'Deals of the day', caption: 'Discounted picks from trusted stores', items: deals }
        : null;

  const heroTitle = maxFlashOff > 0 ? `Up to ${maxFlashOff}% off` : 'Real deals, real prices';
  const heroCaption =
    flashPromos[0]?.description ??
    (dealRail ? `${dealRail.items.length} discounted items from trusted stores right now.` : undefined);
  const heroCount = dealRail?.items.length ?? 0;

  const toggleFollow = React.useCallback(
    (id: string) => {
      if (!user) {
        router.push({ pathname: '/login', params: { next: '/' } });
        return;
      }
      if (followed.has(id)) {
        storeService.unfollowStore(user.id, id);
      } else {
        storeService.followStore(user.id, id);
      }
      syncFollowed();
    },
    [user, followed, syncFollowed],
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerInner}>
        <View style={styles.greetingRow}>
          <View style={styles.greetingBlock}>
            <Logo size={30} />
            <View>
              <Text style={styles.greeting}>{`Hi ${firstName}`}</Text>
              <Text style={styles.greetingSub}>Vanta marketplace</Text>
            </View>
          </View>
        </View>
        <View style={styles.searchRow}>
          <Pressable
            onPress={() => router.push('/search')}
            accessibilityRole="button"
            accessibilityLabel="Search products on Vanta"
            style={({ pressed }) => [styles.searchPill, pressed && styles.pressed]}
          >
            <SymbolView
              name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              size={18}
              weight={ICON_WEIGHT}
              tintColor={colors.textMuted}
            />
            <Text style={styles.searchText}>Search products on Vanta</Text>
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
    </View>
  );

  const hero = (
    <View style={styles.heroCard}>
      <View style={styles.heroGlow} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.heroPill}>{flashPromos[0]?.title ?? 'Flash sale'}</Text>
        <Pressable
          onPress={() => router.push('/browse')}
          accessibilityRole="button"
          accessibilityLabel="Shop deals"
          style={({ pressed }) => [styles.heroCta, pressed && styles.pressed]}
        >
          <Text style={styles.heroCtaText}>Shop deals</Text>
        </Pressable>
      </View>
      <Text style={styles.heroTitle}>{heroTitle}</Text>
      {heroCaption ? <Text style={styles.heroCaption}>{heroCaption}</Text> : null}
      {heroCount > 0 ? (
        <View style={styles.heroFooter}>
          <Text style={styles.heroFooterText}>{`${heroCount} items on sale now`}</Text>
        </View>
      ) : null}
      {vouchers.length > 0 ? (
        <Pressable
          onPress={() => router.push('/vouchers')}
          accessibilityRole="button"
          accessibilityLabel="View vouchers"
          style={({ pressed }) => [styles.heroVoucher, pressed && styles.pressed]}
        >
          <Text style={styles.heroVoucherText}>{`${vouchers.length} voucher${vouchers.length > 1 ? 's' : ''} live now — grab yours`}</Text>
          <Text style={styles.heroVoucherCta}>View</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const content = (
    <View>
      {homeError ? (
        <NoticeCard
          tone="warning"
          title="Couldn't refresh"
          message={`${homeError} Showing the last saved catalogue.`}
          actionLabel="Try again"
          onAction={retryHome}
        />
      ) : null}
      {hero}

      {categories.length > 0 ? (
        <View>
          <SectionTitle title="Shop by category" caption={`Swipe to explore ${categories.length} categories`} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryRow}
            contentContainerStyle={styles.categoryRowContent}
          >
            {categories.map((category) => (
              <Pressable
                key={category.id}
                onPress={() => router.push({ pathname: '/browse', params: { categoryId: category.id } })}
                accessibilityRole="button"
                accessibilityLabel={category.name}
                style={({ pressed }) => [styles.categoryTile, pressed && styles.pressed]}
              >
                <View style={styles.categoryIcon}>
                  <SymbolView name={symbolForCategory(category)} size={22} weight={ICON_WEIGHT} tintColor={colors.text} />
                </View>
                <Text numberOfLines={2} style={styles.categoryLabel}>
                  {labelForCategory(category.name)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {dealRail ? (
        <View>
          <SectionTitle
            title={dealRail.title}
            caption={dealRail.caption}
            actionLabel="See all"
            onAction={() => router.push('/browse')}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
            {dealRail.items.map((item) => (
              <DealCard
                key={item.id}
                product={item}
                onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {stores.length > 0 ? (
        <View>
          <SectionTitle
            title="Stores to follow"
            caption="Verified sellers shipping right now"
            actionLabel="All stores"
            onAction={() => router.push('/stores')}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
            {stores.map((store) => (
              <StoreCard
                key={store.id}
                store={store}
                followed={followed.has(store.id)}
                onOpen={() => router.push({ pathname: '/store/[id]', params: { id: store.id } })}
                onFollow={() => toggleFollow(store.id)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {user && recommendations.length > 0 ? (
        <ProductRail
          title="Recommended for you"
          caption="Based on what you viewed and bought"
          products={recommendations}
          onOpen={(id) => router.push({ pathname: '/product/[id]', params: { id } })}
          actionLabel="Browse all"
          onAction={() => router.push('/browse')}
        />
      ) : null}

      {recent.length > 0 ? (
        <ProductRail
          title="Recently viewed"
          caption="Pick up where you left off"
          products={recent}
          onOpen={(id) => router.push({ pathname: '/product/[id]', params: { id } })}
        />
      ) : null}

      {extraRails.map((rail) => (
        <ProductRail
          key={rail.key}
          title={rail.title}
          caption={rail.subtitle}
          products={rail.products}
          onOpen={(id) => router.push({ pathname: '/product/[id]', params: { id } })}
          actionLabel={rail.key === 'trending' ? 'Browse all' : undefined}
          onAction={rail.key === 'trending' ? () => router.push('/browse') : undefined}
        />
      ))}

      <SectionTitle title="Popular right now" caption="Top picks from trusted stores" />
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
        ListHeaderComponent={content}
        renderItem={({ item }) => (
          <GridProductCard
            product={item}
            onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          <Text style={{ ...type.h3, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl }}>
            No products yet — check back soon.
          </Text>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  greetingBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  greeting: {
    ...type.h2,
    color: colors.textInverse,
  },
  greetingSub: {
    ...type.caption,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchPill: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
  },
  searchText: {
    ...type.body,
    color: colors.textMuted,
    flex: 1,
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

  heroCard: {
    backgroundColor: colors.primaryDark,
    borderRadius: radius.lg,
    padding: spacing.lg,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    right: -28,
    bottom: -28,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
  },
  heroPill: {
    alignSelf: 'flex-start',
    color: colors.text,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    overflow: 'hidden',
  },
  heroCta: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  heroCtaText: {
    ...type.label,
    color: colors.textInverse,
  },
  heroTitle: {
    ...type.display,
    color: colors.textInverse,
    marginTop: spacing.sm,
  },
  heroCaption: {
    ...type.body,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: spacing.xs,
  },
  heroFooter: {
    marginTop: spacing.md,
  },
  heroFooterText: {
    ...type.label,
    color: colors.textInverse,
  },
  heroVoucher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  heroVoucherText: {
    ...type.label,
    color: colors.textInverse,
    flex: 1,
  },
  heroVoucherCta: {
    ...type.label,
    color: colors.accent,
  },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitleBar: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },

  categoryRow: {
    marginHorizontal: -spacing.lg,
  },
  categoryRowContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  categoryTile: {
    width: CATEGORY_TILE_WIDTH,
    alignItems: 'center',
  },
  categoryIcon: {
    width: CATEGORY_ICON_BOX,
    height: CATEGORY_ICON_BOX,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...makeShadow(1),
  },
  categoryLabel: {
    ...type.caption,
    color: colors.text,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  railRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  railDealCard: {
    width: 132,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  railDealImage: {
    width: '100%',
    aspectRatio: 1,
  },
  railDealBody: {
    padding: spacing.sm,
  },
  railDealPrice: {
    ...type.label,
    color: colors.primary,
    marginTop: 2,
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

  storeCard: {
    width: 132,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  storeLogo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
  },
  storeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: spacing.sm,
  },
  storeName: {
    ...type.label,
    fontSize: 12,
    color: colors.text,
    flexShrink: 1,
  },
  storeVerified: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  storeMeta: {
    ...type.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  followBtn: {
    marginTop: spacing.sm,
    width: '100%',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    paddingVertical: 6,
  },
  followBtnFollowing: {
    backgroundColor: colors.primarySoft,
  },
  followBtnText: {
    ...type.label,
    fontSize: 12,
    color: colors.textInverse,
  },
  followBtnTextFollowing: {
    color: colors.primary,
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
});