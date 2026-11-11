/**
 * Pure area helpers shared by the area gate, the selector and the Home feed.
 *
 * The slug rule mirrors the backend's `normalizeArea` (core/areas.js) exactly —
 * NFC, trimmed, single-spaced, lower-cased, runs of non letters/marks/digits
 * collapsed to `-` — so a typed Bangla name produces the same slug the server
 * stores, and the area filter matches without a round trip.
 */
import type { Product, Store } from '@/domain/types';

export interface AreaRef {
  name: string;
  slug: string;
}

/** Collapses whitespace and normalises Unicode; the display form of a typed area. */
export function cleanAreaName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** The canonical slug for an area name, or `''` when nothing usable remains. */
export function areaSlug(value: string): string {
  return cleanAreaName(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

/** Normalises a typed value to `{ name, slug }`, or null when it has no letters/digits. */
export function toAreaRef(value: string): AreaRef | null {
  const name = cleanAreaName(value);
  const slug = areaSlug(name);
  return name && slug ? { name, slug } : null;
}

/** Areas whose name or slug starts with / contains what the user has typed. */
export function suggestAreas(areas: AreaRef[], typed: string): AreaRef[] {
  const needle = areaSlug(typed);
  if (!needle) return areas;
  return areas.filter((area) => area.slug.includes(needle) || area.name.toLowerCase().includes(typed.trim().toLowerCase()));
}

/** The known area that exactly matches what was typed (by slug), if any. */
export function findKnownArea(areas: AreaRef[], typed: string): AreaRef | null {
  const slug = areaSlug(typed);
  return slug ? (areas.find((area) => area.slug === slug) ?? null) : null;
}

/** Picks the known area a reverse-geocoded place belongs to, if any. */
export function matchAreaTokens(tokens: string[], areas: AreaRef[]): AreaRef | null {
  const normalized = tokens.join(' ').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ');
  return (
    areas.find((area) => normalized.includes(area.name.toLowerCase()) || normalized.includes(area.slug.replace(/-/g, ' '))) ?? null
  );
}

/**
 * The stores a shopper in `slug` should see — the same priority rule the
 * backend applies to `/catalog/products?area=`:
 *   1. stores whose PRIMARY area is the slug, and only when there are none,
 *   2. stores that list the slug among their service areas.
 */
export function storesForArea(stores: readonly Store[], slug: string): Store[] {
  if (!slug) return [];
  const active = stores.filter((store) => store.status === 'active');
  const primary = active.filter((store) => store.primaryArea?.slug === slug);
  if (primary.length > 0) return primary;
  return active.filter((store) => (store.serviceAreas ?? []).some((area) => area.slug === slug));
}

/** Keeps only the products sold by the stores that serve `slug`. */
export function productsForArea(products: readonly Product[], stores: readonly Store[], slug: string): Product[] {
  const served = new Set(storesForArea(stores, slug).map((store) => store.id));
  return products.filter((product) => served.has(product.storeId));
}
