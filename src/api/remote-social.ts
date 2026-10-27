/**
 * Remote wishlist + store-follow bridge (M18).
 *
 * In remote mode the API owns both lists. The screens read the on-device
 * `wishlists` and `storeFollowers` collections synchronously, so this module
 * mirrors the server's answers into those collections — and, for the followed
 * stores, upserts the store rows so `followedStores()` can resolve them. The
 * same pattern `remote-hydration`/`remote-seller` use for the catalogue.
 *
 * The mirror is a cache; the server is the source of truth. Nothing here invents
 * social state — every field comes from a `/wishlist` or `/stores/:id/follow`
 * response.
 */
import type { RecentlyViewedEntry, Store, StoreFollower, Wishlist } from '@/domain/types';
import { getContainer } from '@/infrastructure/container';
import { vantaApi } from './vanta-api';
import { upsertProduct, upsertStore, type ProductDto, type StoreDto } from './remote-seller';

export interface WishlistItemDto {
  productId: string;
  addedAt: string;
  available: boolean;
  product: ProductDto;
}

export interface FollowStateDto {
  following: boolean;
  followerCount: number;
}

const listeners = new Set<() => void>();

/** Re-render hook: the session context subscribes and bumps a revision. */
export function subscribeSocial(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifySocial(): void {
  for (const listener of listeners) listener();
}

const nowIso = (): string => new Date().toISOString();

/**
 * Write the server's wishlist page onto the device: mirror each product first so
 * the synchronous wishlist read can resolve it, then replace the caller's
 * wishlist entity (a stable id per user, so another account's row is untouched).
 */
export function mirrorWishlist(userId: string, items: WishlistItemDto[]): Wishlist {
  const db = getContainer().db;
  for (const item of items) {
    if (item.product) upsertProduct(item.product);
  }
  const stamp = nowIso();
  const wishlist: Wishlist = {
    id: `wsh_${userId}`,
    userId,
    items: items.map((item) => ({ productId: item.productId, addedAt: item.addedAt })),
    createdAt: stamp,
    updatedAt: stamp,
  };
  db.upsert('wishlists', { ...wishlist });
  notifySocial();
  return wishlist;
}

export async function hydrateWishlist(userId: string): Promise<number> {
  const { items } = await vantaApi.wishlist();
  mirrorWishlist(userId, items);
  return items.length;
}

/**
 * Mirror the caller's followed stores: replace their follower rows (so an
 * unfollow made on another device disappears) and upsert each store's public
 * record so `followedStores()` resolves a real `Store`.
 */
export function mirrorFollows(userId: string, stores: StoreDto[]): void {
  const db = getContainer().db;
  for (const row of db.getCollection<StoreFollower>('storeFollowers').filter((f) => f.userId === userId)) {
    db.remove('storeFollowers', row.id);
  }
  const stamp = nowIso();
  for (const dto of stores) {
    upsertStore(dto);
    db.upsert('storeFollowers', {
      id: `fol_${userId}_${dto.id}`,
      userId,
      storeId: dto.id,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
  notifySocial();
}

export async function hydrateFollows(userId: string): Promise<number> {
  const { stores } = await vantaApi.followedStores();
  mirrorFollows(userId, stores);
  return stores.length;
}

/**
 * Replace the caller's recently-viewed history with the server's list
 * (newest-first), mirroring each product so the synchronous read resolves it.
 */
export function mirrorRecentlyViewed(userId: string, items: WishlistItemDto[]): void {
  const db = getContainer().db;
  for (const row of db.getCollection<RecentlyViewedEntry>('recentlyViewed').filter((entry) => entry.userId === userId)) {
    db.remove('recentlyViewed', row.id);
  }
  for (const item of items) {
    if (item.product) upsertProduct(item.product);
    db.upsert('recentlyViewed', {
      id: `rvd_${userId}_${item.productId}`,
      userId,
      productId: item.productId,
      createdAt: item.addedAt,
      updatedAt: item.addedAt,
    });
  }
  notifySocial();
}

export async function hydrateRecentlyViewed(userId: string): Promise<number> {
  const { items } = await vantaApi.recentlyViewed(100);
  mirrorRecentlyViewed(userId, items);
  return items.length;
}

/** Apply one store's follow state to the mirror after a follow/unfollow call. */
export function mirrorFollowState(userId: string, storeId: string, state: FollowStateDto): void {
  const db = getContainer().db;
  const existing = db
    .getCollection<StoreFollower>('storeFollowers')
    .find((f) => f.userId === userId && f.storeId === storeId);
  const stamp = nowIso();

  if (state.following && !existing) {
    db.upsert('storeFollowers', { id: `fol_${userId}_${storeId}`, userId, storeId, createdAt: stamp, updatedAt: stamp });
  } else if (!state.following && existing) {
    db.remove('storeFollowers', existing.id);
  }

  const store = db.getCollection<Store>('stores').find((s) => s.id === storeId);
  if (store) db.upsert('stores', { ...store, followerCount: state.followerCount, updatedAt: stamp });
  notifySocial();
}
