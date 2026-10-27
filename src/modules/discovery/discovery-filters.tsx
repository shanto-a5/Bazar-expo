import * as React from 'react';

import { FlatList, Pressable, Text, View } from 'react-native';

import type { Product, Store } from '@/domain/types';
import { Card, Field, ProductCard, SectionHeader } from '@/components/ui';
import { FilterTabs } from '@/modules/orders/order-ui';
import { effectivePrice } from '@/services/catalog-service';
import type { SearchFilters, SearchSort } from '@/services/search-service';
import { colors, radius, spacing, type } from '@/theme/tokens';

export const PAGE_SIZE = 12;

export interface DiscoveryFilters {
  minPrice: string;
  maxPrice: string;
  minRating: number | null;
  brand: string | null;
  sellerId: string | null;
  inStockOnly: boolean;
  onlyDiscounted: boolean;
  freeShippingOnly: boolean;
}

export const EMPTY_DISCOVERY_FILTERS: DiscoveryFilters = {
  minPrice: '',
  maxPrice: '',
  minRating: null,
  brand: null,
  sellerId: null,
  inStockOnly: false,
  onlyDiscounted: false,
  freeShippingOnly: false,
};

export function activeFilterCount(filters: DiscoveryFilters): number {
  let count = 0;
  if (filters.minPrice.trim()) count += 1;
  if (filters.maxPrice.trim()) count += 1;
  if (filters.minRating !== null) count += 1;
  if (filters.brand) count += 1;
  if (filters.sellerId) count += 1;
  if (filters.inStockOnly) count += 1;
  if (filters.onlyDiscounted) count += 1;
  if (filters.freeShippingOnly) count += 1;
  return count;
}

function toNumber(value: string): number | undefined {
  const parsed = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function toServiceFilters(filters: DiscoveryFilters): SearchFilters {
  const result: SearchFilters = {};
  const min = toNumber(filters.minPrice);
  const max = toNumber(filters.maxPrice);
  if (min !== undefined) result.minPrice = min;
  if (max !== undefined) result.maxPrice = max;
  if (filters.minRating !== null) result.minRating = filters.minRating;
  if (filters.brand) result.brand = filters.brand;
  if (filters.sellerId) result.sellerId = filters.sellerId;
  if (filters.inStockOnly) result.inStockOnly = true;
  if (filters.onlyDiscounted) result.onlyDiscounted = true;
  if (filters.freeShippingOnly) result.freeShippingOnly = true;
  return result;
}

export const SORT_TABS: { key: SearchSort; label: string }[] = [
  { key: 'relevance', label: 'Best match' },
  { key: 'popularity', label: 'Popular' },
  { key: 'price_asc', label: 'Price: low' },
  { key: 'price_desc', label: 'Price: high' },
  { key: 'rating', label: 'Top rated' },
  { key: 'newest', label: 'Newest' },
];

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={[styles.toggle, value && styles.toggleOn]}
    >
      <Text style={{ ...type.label, color: value ? colors.textInverse : colors.text }}>{label}</Text>
    </Pressable>
  );
}

export function DiscoveryFilterPanel({
  filters,
  onChange,
  brands,
  stores,
  onReset,
}: {
  filters: DiscoveryFilters;
  onChange: (patch: Partial<DiscoveryFilters>) => void;
  brands: string[];
  stores: Store[];
  onReset: () => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const count = activeFilterCount(filters);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
        <Pressable
          onPress={() => setOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Hide filters' : 'Show filters'}
          style={styles.filterToggle}
        >
          <Text style={{ ...type.label, color: colors.primary }}>
            {open ? 'Hide filters' : `Filters${count > 0 ? ` (${count})` : ''}`}
          </Text>
        </Pressable>
        {count > 0 ? (
            <Pressable onPress={onReset} accessibilityRole="button" accessibilityLabel="Clear all filters" hitSlop={8}>
            <Text style={{ ...type.label, color: colors.textMuted }}>Clear all</Text>
          </Pressable>
        ) : null}
      </View>

      {open ? (
        <Card style={{ marginBottom: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Min price"
                keyboardType="number-pad"
                value={filters.minPrice}
                onChangeText={(minPrice) => onChange({ minPrice })}
                placeholder="0"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Max price"
                keyboardType="number-pad"
                value={filters.maxPrice}
                onChangeText={(maxPrice) => onChange({ maxPrice })}
                placeholder="Any"
              />
            </View>
          </View>

          <View>
            <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Minimum rating</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {[
                { value: null as number | null, label: 'Any rating' },
                { value: 3, label: '3★ & up' },
                { value: 4, label: '4★ & up' },
                { value: 4.5, label: '4.5★ & up' },
              ].map((option) => (
                <Toggle
                  key={option.label}
                  label={option.label}
                  value={filters.minRating === option.value}
                  onChange={() => onChange({ minRating: option.value })}
                />
              ))}
            </View>
          </View>

          {brands.length ? (
            <View>
              <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Brand</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {brands.slice(0, 12).map((brand) => (
                  <Toggle
                    key={brand}
                    label={brand}
                    value={filters.brand === brand}
                    onChange={() => onChange({ brand: filters.brand === brand ? null : brand })}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {stores.length ? (
            <View>
              <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>Store</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {stores.slice(0, 10).map((store) => (
                  <Toggle
                    key={store.id}
                    label={store.name}
                    value={filters.sellerId === store.sellerId}
                    onChange={() => onChange({ sellerId: filters.sellerId === store.sellerId ? null : store.sellerId })}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Toggle
              label="In stock only"
              value={filters.inStockOnly}
              onChange={(inStockOnly) => onChange({ inStockOnly })}
            />
            <Toggle
              label="On sale"
              value={filters.onlyDiscounted}
              onChange={(onlyDiscounted) => onChange({ onlyDiscounted })}
            />
            <Toggle
              label="Free shipping"
              value={filters.freeShippingOnly}
              onChange={(freeShippingOnly) => onChange({ freeShippingOnly })}
            />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

export function SortRow({
  sort,
  onChange,
}: {
  sort: SearchSort;
  onChange: (next: SearchSort) => void;
}): React.JSX.Element {
  return <FilterTabs tabs={SORT_TABS} active={sort} onChange={(key) => onChange(key as SearchSort)} />;
}

export function resultSummary(total: number, shown: number): string {
  return total === shown ? `${total} product${total === 1 ? '' : 's'}` : `Showing ${shown} of ${total} products`;
}

export function ProductRail({
  title,
  caption,
  products,
  onOpen,
  actionLabel,
  onAction,
}: {
  title: string;
  caption?: string;
  products: Product[];
  onOpen: (id: string) => void;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element | null {
  if (!products.length) return null;
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <SectionHeader title={title} caption={caption} actionLabel={actionLabel} onAction={onAction} />
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={products}
        keyExtractor={(product) => product.id}
        contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.xs }}
        renderItem={({ item }) => (
          <View style={styles.railItem}>
            <ProductCard product={item} price={effectivePrice(item)} onPress={() => onOpen(item.id)} />
          </View>
        )}
      />
    </View>
  );
}

const styles = {
  railItem: { width: 168 },
  toggle: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterToggle: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
};
