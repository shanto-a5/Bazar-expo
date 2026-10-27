import * as React from 'react';

import { FlatList, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import {
  Button,
  Card,
  Logo,
  ProductCard,
  ProductImage,
  Screen,
  SectionHeader,
  taka,
} from '@/components/ui';
import {
  DiscoveryFilterPanel,
  EMPTY_DISCOVERY_FILTERS,
  PAGE_SIZE,
  resultSummary,
  SortRow,
  toServiceFilters,
  type DiscoveryFilters,
} from '@/modules/discovery/discovery-filters';
import { useSession } from '@/modules/session/session-context';
import { TrustChip, TrustChipRow } from '@/components/trust-chip';
import { catalogService, effectivePrice } from '@/services/catalog-service';
import { reviewService } from '@/services/review-service';
import { storeService } from '@/services/store-service';
import type { SearchSort } from '@/services/search-service';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function StoreScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ id?: string; reviews?: string }>();
  const { user } = useSession();
  const storeId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [, setVersion] = React.useState(0);
  const [sort, setSort] = React.useState<SearchSort>('popularity');
  const [filters, setFilters] = React.useState<DiscoveryFilters>(EMPTY_DISCOVERY_FILTERS);
  const [page, setPage] = React.useState(1);

  const showAllReviews = Array.isArray(params.reviews) ? params.reviews[0] === '1' : params.reviews === '1';

  const store = storeId ? storeService.storeById(storeId) : undefined;
  const visible = React.useMemo(
    () => (storeId ? catalogService.visibleStores().some((s) => s.id === storeId) : false),
    [storeId],
  );
  const following = user && storeId ? storeService.isFollowing(user.id, storeId) : false;
  const trust = React.useMemo(
    () => (storeId ? catalogService.storeTrust(storeId) : null),
    [storeId],
  );
  const reviews = React.useMemo(
    () => (storeId ? reviewService.listForStore(storeId, showAllReviews ? 20 : 3) : []),
    [storeId, showAllReviews],
  );

  const matching = React.useMemo(
    () =>
      store
        ? catalogService.query({
            sellerId: store.sellerId,
            customerVisibleOnly: true,
            sort,
            ...toServiceFilters(filters),
          })
        : [],
    [store, filters, sort],
  );

  const products = React.useMemo(() => matching.slice(0, page * PAGE_SIZE), [matching, page]);
  const hasMore = products.length < matching.length;
  const brands = React.useMemo(() => catalogService.brands(), []);

  if (!store || !visible) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
          <Logo size={64} />
          <Text style={{ ...type.h2, color: colors.text, textAlign: 'center' }}>Store unavailable</Text>
          <Text style={{ ...type.h3, color: colors.textMuted, textAlign: 'center' }}>
            This store is not accepting orders at the moment, or the link is out of date.
          </Text>
          <Button title="Browse products" onPress={() => router.replace('/browse')} />
        </View>
      </Screen>
    );
  }

  const toggleFollow = (): void => {
    if (!user) {
      router.push({ pathname: '/login', params: { next: `/store/${store.id}` } });
      return;
    }
    if (following) {
      storeService.unfollowStore(user.id, store.id);
    } else {
      storeService.followStore(user.id, store.id);
    }
    setVersion((value) => value + 1);
  };

  const header = (
    <View>
      <Card style={{ marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <ProductImage uri={store.logo} size={72} cornerRadius={radius.md} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Text style={{ ...type.h2, color: colors.text, flexShrink: 1 }}>{store.name}</Text>
              {store.verified ? <Text style={{ ...type.caption, color: colors.primary }}>Verified</Text> : null}
            </View>
            <Text style={{ ...type.caption, marginTop: 2 }}>{store.location}</Text>
            <Text style={{ ...type.caption, color: colors.accent, marginTop: 2 }}>
              {`★ ${store.ratingAvg.toFixed(1)} (${store.ratingCount} reviews)`}
            </Text>
            <Text style={{ ...type.caption, marginTop: 2 }}>
              {`${matching.length} products · ${store.followerCount} followers`}
            </Text>
          </View>
        </View>

        {store.description ? (
          <Text style={{ ...type.h3, color: colors.textMuted, marginTop: spacing.md }}>{store.description}</Text>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md }}>
          <Text style={{ ...type.caption }}>{`Delivery in ${store.deliveryEstimateDays.min}–${store.deliveryEstimateDays.max} days`}</Text>
          <Text style={{ ...type.caption }}>
            {store.shippingFee > 0
              ? `Shipping ${taka(store.shippingFee)} · free above ${taka(store.freeShippingThreshold)}`
              : 'Free delivery'}
          </Text>
          <Text style={{ ...type.caption }}>{`Replies in ~${store.responseTimeMinutes} min (${Math.round(store.responseRate)}% of orders)`}</Text>
        </View>

        {trust ? (
          <View style={{ marginTop: spacing.md }}>
            <TrustChipRow>
              {trust.verified ? <TrustChip label="Verified seller" tone="success" /> : null}
              {trust.ratingCount > 0 ? (
                <TrustChip label={`${trust.ratingCount} review(s) on file`} />
              ) : (
                <TrustChip label="No reviews yet" />
              )}
              {trust.verifiedReviewCount > 0 ? (
                <TrustChip label={`${trust.verifiedReviewCount} verified purchase(s)`} tone="success" />
              ) : null}
              {trust.inStockProductCount > 0 ? (
                <TrustChip label={`${trust.inStockProductCount} in stock now`} />
              ) : (
                <TrustChip label="Nothing in stock right now" tone="warning" />
              )}
              {trust.lowStockProductCount > 0 ? (
                <TrustChip label={`${trust.lowStockProductCount} running low`} tone="warning" />
              ) : null}
            </TrustChipRow>
            <Text style={{ ...type.caption }}>
              {`Ratings here come from ${trust.verifiedReviewCount} verified purchase(s) out of ${trust.ratingCount} review(s). Returns are accepted within 7 days of delivery.`}
            </Text>
          </View>
        ) : null}

        <Button
          title={following ? 'Following' : 'Follow store'}
          variant={following ? 'ghost' : 'primary'}
          onPress={toggleFollow}
          fullWidth
          style={{ marginTop: spacing.md }}
          accessibilityLabel={`${following ? 'Unfollow' : 'Follow'} ${store.name}`}
        />
      </Card>

      {reviews.length ? (
        <View style={{ marginBottom: spacing.lg }}>
          <SectionHeader
            title="Recent store reviews"
            caption={`${store.ratingCount} total`}
            actionLabel={showAllReviews ? 'Show less' : 'See all'}
            onAction={() =>
              router.setParams({ reviews: showAllReviews ? undefined : '1' })
            }
          />
          {reviews.map((review) => (
            <Card key={review.id} style={{ marginBottom: spacing.sm }}>
              <Text style={{ ...type.label, color: colors.text }}>{review.userName}</Text>
              <Text style={{ ...type.caption, color: colors.accent }}>
                {`${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}`}
              </Text>
              {review.title ? <Text style={{ ...type.label, color: colors.text, marginTop: spacing.xs }}>{review.title}</Text> : null}
              <Text style={{ ...type.caption, marginTop: spacing.xs }}>{review.text}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      <SectionHeader title="Products" caption={resultSummary(matching.length, products.length)} />
      <SortRow sort={sort} onChange={(next) => { setSort(next); setPage(1); }} />
      <DiscoveryFilterPanel
        filters={filters}
        onChange={(patch) => {
          setFilters((current) => ({ ...current, ...patch }));
          setPage(1);
        }}
        brands={brands}
        stores={[]}
        onReset={() => {
          setFilters(EMPTY_DISCOVERY_FILTERS);
          setPage(1);
        }}
      />
    </View>
  );

  return (
    <Screen padded scroll={false}>
      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
        style={{ flex: 1 }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            price={effectivePrice(item)}
            onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          <Text style={{ ...type.h3, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl }}>
            This store has no products available right now.
          </Text>
        }
        ListFooterComponent={
          hasMore ? (
            <View style={{ marginTop: spacing.lg }}>
              <Button
                title={`Load more (${products.length} of ${matching.length})`}
                variant="secondary"
                onPress={() => setPage((value) => value + 1)}
                fullWidth
              />
            </View>
          ) : null
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasMore) setPage((value) => value + 1);
        }}
      />
    </Screen>
  );
}
