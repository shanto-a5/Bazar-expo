import { getContainer } from '@/infrastructure/container';
import type { Product, Wishlist } from '@/domain/types';
import { productIsAvailable, productIsVisibleToCustomer } from './catalog-service';
import { newId } from '@/utils/id';
import { vantaApi } from '@/api/vanta-api';
import { mirrorWishlist } from '@/api/remote-social';

export interface WishlistEntry {
  product: Product;
  addedAt: string;
  available: boolean;
}

export class WishlistService {
  private getOrCreate(userId: string): Wishlist {
    const { repositories } = getContainer();
    let wishlist = repositories.wishlists.getByUserId(userId);
    if (!wishlist) {
      const now = new Date().toISOString();
      wishlist = { id: newId('wsh'), userId, items: [], createdAt: now, updatedAt: now };
      repositories.wishlists.create(wishlist);
    }
    return wishlist;
  }

  private prune(userId: string, wishlist: Wishlist): Wishlist {
    const { repositories } = getContainer();
    const seen = new Set<string>();
    const items = wishlist.items.filter((item) => {
      if (seen.has(item.productId)) return false;
      if (!repositories.products.getById(item.productId)) return false;
      seen.add(item.productId);
      return true;
    });
    if (items.length === wishlist.items.length) return wishlist;
    const cleaned: Wishlist = {
      ...wishlist,
      items,
      updatedAt: new Date().toISOString(),
    };
    repositories.wishlists.upsert(cleaned);
    return cleaned;
  }

  list(userId: string): WishlistEntry[] {
    const { repositories } = getContainer();
    const stored = repositories.wishlists.getByUserId(userId);
    if (!stored) return [];
    const wishlist = this.prune(userId, stored);
    const result: WishlistEntry[] = [];
    for (const item of wishlist.items) {
      const product = repositories.products.getById(item.productId);
      if (!product) continue;
      // Match the product screen's availability exactly: a paused store or
      // suspended seller must not read as "In stock" here (M11 wishlist audit).
      result.push({
        product,
        addedAt: item.addedAt,
        available: productIsVisibleToCustomer(product) && productIsAvailable(product),
      });
    }
    return result.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
  }

  productIds(userId: string): string[] {
    return this.list(userId).map((entry) => entry.product.id);
  }

  contains(userId: string, productId: string): boolean {
    const { repositories } = getContainer();
    const wishlist = repositories.wishlists.getByUserId(userId);
    return !!wishlist?.items.some((i) => i.productId === productId);
  }

  toggle(userId: string, productId: string): boolean {
    if (this.contains(userId, productId)) {
      this.remove(userId, productId);
      return false;
    }
    this.add(userId, productId);
    return true;
  }

  /**
   * Optimistic save/unsave that resolves with the server's answer instead of
   * firing and forgetting. A screen uses this to keep the button in a "saving"
   * state and only flip it once the server confirms; on failure the optimistic
   * write is reverted (from the server's mirrored list when it answers, otherwise
   * locally) and the error is rethrown so the caller can surface it.
   */
  async setSaved(userId: string, productId: string, saved: boolean): Promise<void> {
    if (this.contains(userId, productId) === saved) return;
    const known = !!getContainer().repositories.products.getById(productId);
    if (saved) {
      if (known) this.localAdd(userId, productId);
    } else {
      this.localRemove(userId, productId);
    }
    try {
      const { items } = saved
        ? await vantaApi.addWishlistItem(productId)
        : await vantaApi.removeWishlistItem(productId);
      mirrorWishlist(userId, items);
    } catch (error) {
      // Revert the optimistic flip so the heart the user sees matches the server.
      if (saved) this.localRemove(userId, productId);
      else if (known) this.localAdd(userId, productId);
      throw error;
    }
  }

  remove(userId: string, productId: string): void {
    this.localRemove(userId, productId);
    void vantaApi
      .removeWishlistItem(productId)
      .then(({ items }) => mirrorWishlist(userId, items))
      .catch(() => undefined);
  }

  private localRemove(userId: string, productId: string): void {
    const { repositories } = getContainer();
    const wishlist = repositories.wishlists.getByUserId(userId);
    if (!wishlist) return;
    if (!wishlist.items.some((item) => item.productId === productId)) return;
    wishlist.items = wishlist.items.filter((i) => i.productId !== productId);
    wishlist.updatedAt = new Date().toISOString();
    repositories.wishlists.upsert({ ...wishlist });
  }

  add(userId: string, productId: string): void {
    // Mirror the server's decision optimistically; the API call then replaces the
    // mirror with the authoritative list. If the product is not in the local
    // catalogue we cannot render it, so skip the optimistic write and let the
    // server reconcile the mirror.
    if (getContainer().repositories.products.getById(productId)) this.localAdd(userId, productId);
    void vantaApi
      .addWishlistItem(productId)
      .then(({ items }) => mirrorWishlist(userId, items))
      .catch(() => undefined);
  }

  private localAdd(userId: string, productId: string): void {
    const { repositories } = getContainer();
    if (!repositories.products.getById(productId)) throw new Error('Product not found.');
    const wishlist = this.getOrCreate(userId);
    if (wishlist.items.some((i) => i.productId === productId)) return;
    wishlist.items.unshift({ productId, addedAt: new Date().toISOString() });
    wishlist.updatedAt = new Date().toISOString();
    repositories.wishlists.upsert({ ...wishlist });
  }

  clear(userId: string): void {
    this.localClear(userId);
    void vantaApi
      .clearWishlist()
      .then(({ items }) => mirrorWishlist(userId, items))
      .catch(() => undefined);
  }

  private localClear(userId: string): void {
    const { repositories } = getContainer();
    const wishlist = repositories.wishlists.getByUserId(userId);
    if (!wishlist || wishlist.items.length === 0) return;
    wishlist.items = [];
    wishlist.updatedAt = new Date().toISOString();
    repositories.wishlists.upsert({ ...wishlist });
  }
}

export const wishlistService = new WishlistService();
