import * as React from 'react';

import { FlatList, Pressable, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import { Button, Card, Logo, ProductCard, Screen, SectionHeader } from '@/components/ui';
import {
  DiscoveryFilterPanel,
  EMPTY_DISCOVERY_FILTERS,
  PAGE_SIZE,
  resultSummary,
  SortRow,
  toServiceFilters,
  type DiscoveryFilters,
} from '@/modules/discovery/discovery-filters';
import { catalogService, effectivePrice } from '@/services/catalog-service';
import type { SearchSort } from '@/services/search-service';
import { WishlistButton } from '@/modules/wishlist/wishlist-button';
import { useSession } from '@/modules/session/session-context';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function BrowseScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ categoryId?: string }>();
  const { user } = useSession();

  const categories = React.useMemo(() => catalogService.getTree(), []);
  const paramCategoryId = Array.isArray(params.categoryId) ? params.categoryId[0] : params.categoryId;
  const [picked, setPicked] = React.useState<{ param: string | undefined; id: string } | null>(null);
  const activeCategoryId =
    (picked && picked.param === paramCategoryId ? picked.id : undefined) ??
    paramCategoryId ??
    categories[0]?.id;
  const [activeSubcategoryId, setActiveSubcategoryId] = React.useState<string | undefined>(undefined);
  const [filters, setFilters] = React.useState<DiscoveryFilters>(EMPTY_DISCOVERY_FILTERS);
  const [sort, setSort] = React.useState<SearchSort>('popularity');
  const [page, setPage] = React.useState(1);

  const pickCategory = React.useCallback((id: string) => {
    setPicked({ param: paramCategoryId, id });
    setActiveSubcategoryId(undefined);
    setPage(1);
  }, [paramCategoryId]);

  const activeCategory = React.useMemo(
    () => categories.find((c) => c.id === activeCategoryId) ?? categories[0],
    [categories, activeCategoryId],
  );

  const subcategories = React.useMemo(
    () => (activeCategory ? catalogService.childrenOf(activeCategory.id) : []),
    [activeCategory],
  );

  const matching = React.useMemo(
    () =>
      catalogService.query({
        categoryId: activeCategory?.id,
        subcategoryId: activeSubcategoryId,
        customerVisibleOnly: true,
        sort,
        ...toServiceFilters(filters),
      }),
    [activeCategory?.id, activeSubcategoryId, filters, sort],
  );

  const products = React.useMemo(() => matching.slice(0, page * PAGE_SIZE), [matching, page]);
  const total = matching.length;
  const hasMore = products.length < total;

  const brands = React.useMemo(
    () => catalogService.brands(),
    [],
  );
  const stores = React.useMemo(() => catalogService.visibleStores(), []);

  const firstName = user?.name?.trim().split(/\s+/)[0] ?? 'there';

  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.lg }}>
        <Logo size={40} />
        <Text style={{ ...type.h3, color: colors.textMuted, flex: 1 }}>{`Browse, ${firstName}`}</Text>
        <Button title="Search" variant="secondary" onPress={() => router.push('/search')} />
        <Button title="Stores" variant="ghost" onPress={() => router.push('/stores')} />
      </View>

      <SectionHeader title="Shop by category" caption="Active shelves from trusted stores" />
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={categories}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.lg }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => pickCategory(item.id)}
            accessibilityRole="button"
            accessibilityLabel={item.name}
          >
            <Card
              padded
              style={{
                minWidth: 96,
                alignItems: 'center',
                borderColor: item.id === activeCategoryId ? colors.primary : colors.border,
              }}
            >
              <Text style={{ ...type.h3, fontSize: 28 }}>{item.icon}</Text>
              <Text style={{ ...type.label, textAlign: 'center', marginTop: 6 }}>{item.name}</Text>
            </Card>
          </Pressable>
        )}
      />

      {subcategories.length ? (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={subcategories}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs, marginBottom: spacing.lg }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setActiveSubcategoryId(item.id === activeSubcategoryId ? undefined : item.id);
                setPage(1);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Subcategory ${item.name}`}
            >
              <Card
                padded={false}
                style={{
                  paddingVertical: spacing.sm,
                  paddingHorizontal: 14,
                  borderRadius: radius.pill,
                  borderColor: item.id === activeSubcategoryId ? colors.primary : colors.border,
                }}
              >
                <Text style={{ ...type.label, color: item.id === activeSubcategoryId ? colors.primary : colors.textMuted }}>
                  {item.name}
                </Text>
              </Card>
            </Pressable>
          )}
        />
      ) : null}

      <SectionHeader title={activeCategory?.name ?? 'Products'} caption={resultSummary(total, products.length)} />
      <SortRow sort={sort} onChange={(next) => { setSort(next); setPage(1); }} />
      <DiscoveryFilterPanel
        filters={filters}
        onChange={(patch) => {
          setFilters((current) => ({ ...current, ...patch }));
          setPage(1);
        }}
        brands={brands}
        stores={stores}
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
            imageOverlay={<WishlistButton productId={item.id} label={item.name} size={16} />}
          />
        )}
        ListEmptyComponent={
          <Text style={{ ...type.h3, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl }}>
            No products in this shelf yet — check back soon.
          </Text>
        }
        ListFooterComponent={
          hasMore ? (
            <View style={{ marginTop: spacing.lg }}>
              <Button
                title={`Load more (${products.length} of ${total})`}
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
