import * as React from 'react';

import { FlatList, Pressable, Text, View } from 'react-native';

import { router, useFocusEffect } from 'expo-router';

import { Button, Card, Field, Logo, ProductCard, ProductImage, Screen, SectionHeader } from '@/components/ui';
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
import { WishlistButton } from '@/modules/wishlist/wishlist-button';
import { catalogService, effectivePrice } from '@/services/catalog-service';
import { searchService, type SearchResult, type SearchSort } from '@/services/search-service';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function SearchScreen(): React.JSX.Element {
  const { user } = useSession();

  const [query, setQuery] = React.useState('');
  const [submitted, setSubmitted] = React.useState('');
  const [sort, setSort] = React.useState<SearchSort>('relevance');
  const [filters, setFilters] = React.useState<DiscoveryFilters>(EMPTY_DISCOVERY_FILTERS);
  const [page, setPage] = React.useState(1);
  const [results, setResults] = React.useState<SearchResult | null>(null);
  const [searched, setSearched] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<string[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      setRecent(user ? searchService.history(user.id, 8) : []);
    }, [user]),
  );

  const run = React.useCallback(
    (term: string) => {
      const value = term.trim();
      setQuery(value);
      setSearched(true);
      setPage(1);
      setLoading(true);
      setError(null);
      try {
        const outcome = searchService.search(value, { inStockOnly: true, ...toServiceFilters(filters) }, sort);
        setResults(outcome);
        if (user && value) {
          searchService.recordHistory(user.id, value);
          setRecent(searchService.history(user.id, 8));
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Search failed. Try again.');
        setResults(null);
      } finally {
        setLoading(false);
      }
    },
    [filters, sort, user],
  );

  const applyTerm = React.useCallback(
    (term: string) => {
      setSubmitted(term);
      run(term);
    },
    [run],
  );

  const change = (next: () => void): void => {
    next();
    if (searched) run(submitted);
  };

  const clearHistory = React.useCallback(() => {
    if (!user) return;
    searchService.clearHistory(user.id);
    setRecent([]);
  }, [user]);

  const products = React.useMemo(() => (results ? results.products.slice(0, page * PAGE_SIZE) : []), [results, page]);
  const total = results?.total ?? 0;
  const hasMore = products.length < total;
  const brands = results?.brands.length ? results.brands : catalogService.brands();
  const stores = results?.sellers ?? [];

  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.md }}>
        <Logo size={40} />
        <Text style={{ ...type.h3, color: colors.textMuted, flex: 1 }}>Search the catalogue</Text>
        <Button title="Browse" variant="secondary" onPress={() => router.push('/browse')} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: spacing.xs }}>
        <View style={{ flex: 1 }}>
          <Field
            label="What are you looking for?"
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. sneakers, smart watch, perfume"
            onSubmitEditing={() => applyTerm(query)}
            returnKeyType="search"
          />
        </View>
        <Button title="Search" onPress={() => applyTerm(query)} loading={loading} />
      </View>

      {!searched ? (
        <View>
          <SectionHeader
            title={recent.length ? 'Recent searches' : 'Start searching'}
            caption="Pick a previous search to run it again"
          />
          {recent.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}>
              {recent.map((term) => (
                <Pressable key={term} onPress={() => { setQuery(term); applyTerm(term); }} accessibilityRole="button">
                  <Card padded style={{ paddingVertical: 6, paddingHorizontal: spacing.md }}>
                    <Text style={{ ...type.label, color: colors.primary }}>{term}</Text>
                  </Card>
                </Pressable>
              ))}
              <Pressable onPress={clearHistory} accessibilityRole="button" accessibilityLabel="Clear search history">
                <Card padded style={{ paddingVertical: 6, paddingHorizontal: spacing.md }}>
                  <Text style={{ ...type.label, color: colors.textMuted }}>Clear all</Text>
                </Card>
              </Pressable>
            </View>
          ) : (
            <Text style={{ ...type.h3, color: colors.textMuted, marginTop: spacing.md }}>
              Try a product name, brand, or store. Results reflect the live catalogue.
            </Text>
          )}
        </View>
      ) : null}

      {searched ? (
        <View>
          <SectionHeader
            title={total === 0 ? 'No matches' : resultSummary(total, products.length)}
            caption={submitted ? `Results for “${submitted}”` : 'Filtered catalogue results'}
          />
          <SortRow
            sort={sort}
            onChange={(next) => change(() => setSort(next))}
          />
          <DiscoveryFilterPanel
            filters={filters}
            onChange={(patch) => change(() => setFilters((current) => ({ ...current, ...patch })))}
            brands={brands}
            stores={stores}
            onReset={() => change(() => setFilters(EMPTY_DISCOVERY_FILTERS))}
          />

          {stores.length ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Stores in these results</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {stores.slice(0, 6).map((store) => (
                  <Pressable
                    key={store.id}
                    onPress={() => router.push({ pathname: '/store/[id]', params: { id: store.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Open store ${store.name}`}
                  >
                    <Card padded style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}>
                      <ProductImage uri={store.logo} size={28} cornerRadius={radius.sm} />
                      <Text style={{ ...type.label, color: colors.text }}>{store.name}</Text>
                    </Card>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
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
        keyboardShouldPersistTaps="handled"
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
          error ? (
            <Text style={{ ...type.h3, color: colors.danger, marginTop: spacing.md }}>{error}</Text>
          ) : searched && total === 0 ? (
            <Text style={{ ...type.h3, color: colors.textMuted, marginTop: spacing.md }}>
              Check the spelling, widen your filters, or pick a recent search above.
            </Text>
          ) : null
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
