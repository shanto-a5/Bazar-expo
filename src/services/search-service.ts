import { getContainer } from '@/infrastructure/container';
import type { Product, Store } from '@/domain/types';
import { catalogService, effectivePrice, productIsAvailable, productIsVisibleToCustomer } from './catalog-service';
import { newId } from '@/utils/id';

export interface SearchFilters {
  categoryId?: string;
  subcategoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  brand?: string;
  sellerId?: string;
  inStockOnly?: boolean;
  onlyDiscounted?: boolean;
  freeShippingOnly?: boolean;
}

export type SearchSort = 'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'newest' | 'popularity';

export interface SearchResult {
  products: Product[];
  total: number;
  sellers: Store[];
  brands: string[];
}

const SPECIAL_CHARS = /[^\w\s]/g;

function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(SPECIAL_CHARS, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function scoreProduct(product: Product, terms: string[], query: string): number {
  const name = product.name.toLowerCase();
  const brand = product.brand.toLowerCase();
  const description = product.description.toLowerCase();
  const sku = product.sku.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) score += 100;
    if (name.startsWith(term)) score += 40;
    if (brand.includes(term)) score += 30;
    if (description.includes(term)) score += 15;
    if (sku.includes(term)) score += 10;
  }
  if (product.salePrice) score += Math.min(15, (product.salePrice / product.regularPrice) * 100 - 0) / 10;
  return score;
}

function filtersApplied(filters: SearchFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== false);
}

export class SearchService {
  search(query: string, filters: SearchFilters = {}, sort: SearchSort = 'relevance'): SearchResult {
    const { repositories } = getContainer();
    let products = repositories.products
      .list()
      .filter((p) => p.status === 'active')
      .filter(productIsVisibleToCustomer);
    const q = query.trim();
    const terms = tokens(q);
    const queryLower = q.toLowerCase();

    if (terms.length === 0) {
      products = filtersApplied(filters) ? products : [];
    } else {
      products = products.filter((p) => {
        const haystack = `${p.name} ${p.brand} ${p.description} ${p.sku}`.toLowerCase();
        return terms.every((t) => haystack.includes(t));
      });
    }

    if (filters.categoryId) {
      const ids = catalogService.categoryAndChildrenIds(filters.categoryId);
      products = products.filter((p) => ids.includes(p.categoryId) || ids.includes(p.subcategoryId ?? ''));
    }
    if (filters.subcategoryId) products = products.filter((p) => p.subcategoryId === filters.subcategoryId);
    if (filters.minPrice !== undefined) products = products.filter((p) => effectivePrice(p) >= filters.minPrice!);
    if (filters.maxPrice !== undefined) products = products.filter((p) => effectivePrice(p) <= filters.maxPrice!);
    if (filters.minRating !== undefined) products = products.filter((p) => p.ratingAvg >= filters.minRating!);
    if (filters.brand) products = products.filter((p) => p.brand.toLowerCase() === filters.brand!.toLowerCase());
    if (filters.sellerId) products = products.filter((p) => p.sellerId === filters.sellerId);
    if (filters.inStockOnly) products = products.filter(productIsAvailable);
    if (filters.onlyDiscounted) products = products.filter((p) => !!p.salePrice && p.salePrice < p.regularPrice);
    if (filters.freeShippingOnly) {
      products = products.filter((p) => {
        const store = repositories.stores.getBySellerId(p.sellerId);
        return !!store && store.status === 'active' && store.shippingFee === 0;
      });
    }

    const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort();

    if (sort === 'relevance' && terms.length) {
      products.sort(
        (a, b) =>
          scoreProduct(b, terms, queryLower) - scoreProduct(a, terms, queryLower) ||
          Number(productIsAvailable(b)) - Number(productIsAvailable(a)),
      );
    } else if (sort === 'price_asc') {
      products.sort((a, b) => effectivePrice(a) - effectivePrice(b));
    } else if (sort === 'price_desc') {
      products.sort((a, b) => effectivePrice(b) - effectivePrice(a));
    } else if (sort === 'rating') {
      products.sort((a, b) => b.ratingAvg - a.ratingAvg);
    } else if (sort === 'newest') {
      products.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sort === 'popularity') {
      products.sort(
        (a, b) =>
          Number(productIsAvailable(b)) - Number(productIsAvailable(a)) || b.soldCount - a.soldCount,
      );
    }

    const total = products.length;

    const sellerIds = [...new Set(products.map((p) => p.sellerId))];
    const matchedStores: Store[] = sellerIds
      .map((sellerId) => repositories.stores.getBySellerId(sellerId))
      .filter((store): store is Store => !!store && store.status === 'active')
      .sort((a, b) => b.productCount - a.productCount);

    if (terms.length) {
      const named = repositories.stores
        .list()
        .filter((s) => s.status === 'active')
        .filter((s) => {
          const haystack = `${s.name} ${s.description}`.toLowerCase();
          return terms.every((t) => haystack.includes(t));
        });
      for (const store of named) {
        if (!matchedStores.some((entry) => entry.id === store.id)) matchedStores.push(store);
      }
    }

    return { products, total, sellers: matchedStores, brands };
  }

  recordHistory(userId: string, query: string): void {
    const { repositories } = getContainer();
    const q = query.trim();
    if (!q) return;
    if (!userId) return;
    const existing = repositories.searchHistory.listForUser(userId).find((e) => e.query.toLowerCase() === q.toLowerCase());
    if (existing) {
      repositories.searchHistory.remove(existing.id);
    }
    const now = new Date().toISOString();
    repositories.searchHistory.create({ id: newId('srch'), userId, query: q, createdAt: now, updatedAt: now });
  }

  history(userId: string, limit = 10): string[] {
    if (!userId) return [];
    return getContainer().repositories.searchHistory.listForUser(userId).slice(0, limit).map((e) => e.query);
  }

  clearHistory(userId: string): void {
    getContainer().repositories.searchHistory.clearForUser(userId);
  }
}

export const searchService = new SearchService();