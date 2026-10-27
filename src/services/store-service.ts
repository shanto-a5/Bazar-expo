import { getContainer } from '@/infrastructure/container';
import type { Store } from '@/domain/types';
import { newId } from '@/utils/id';
import { vantaApi } from '@/api/vanta-api';
import { mirrorFollowState } from '@/api/remote-social';

/**
 * Customer-facing store (marketplace) reads.
 *
 * This is the customer side of what used to be split across `seller-service`:
 * browsing stores, following/unfollowing them and reading a store by id. It
 * carries no seller-management behaviour — onboarding, product management and
 * store administration live in the Dukan (seller) app.
 */
export class StoreService {
  storeById(id: string): Store | undefined {
    return getContainer().repositories.stores.getById(id);
  }

  storeBySellerId(sellerId: string): Store | undefined {
    return getContainer().repositories.stores.getBySellerId(sellerId);
  }

  followStore(userId: string, storeId: string): boolean {
    return this.remoteFollow(userId, storeId, true);
  }

  unfollowStore(userId: string, storeId: string): boolean {
    return this.remoteFollow(userId, storeId, false);
  }

  /**
   * Remote follow/unfollow: mirror the desired state synchronously (so the
   * toggle reads correctly this render), then let the server decide and
   * reconcile the mirrored follower row + count from its response.
   */
  private remoteFollow(userId: string, storeId: string, follow: boolean): boolean {
    const hasLocal = !!getContainer().repositories.stores.getById(storeId);
    const optimistic = hasLocal ? this.setFollow(userId, storeId, follow) : follow;
    const call = follow ? vantaApi.followStore(storeId) : vantaApi.unfollowStore(storeId);
    void call
      .then((state) => mirrorFollowState(userId, storeId, state))
      .catch(() => undefined);
    return optimistic;
  }

  private setFollow(userId: string, storeId: string, follow: boolean): boolean {
    const { repositories } = getContainer();
    const store = repositories.stores.getById(storeId);
    if (!store) throw new Error('Store not found.');
    const existing = repositories.storeFollowers.get(storeId, userId);
    if (follow && !existing) {
      const now = new Date().toISOString();
      repositories.storeFollowers.create({ id: newId('fol'), userId, storeId, createdAt: now, updatedAt: now });
      repositories.stores.update(storeId, { followerCount: store.followerCount + 1, updatedAt: now });
      return true;
    }
    if (!follow && existing) {
      repositories.storeFollowers.remove(existing.id);
      repositories.stores.update(storeId, { followerCount: Math.max(0, store.followerCount - 1), updatedAt: new Date().toISOString() });
      return false;
    }
    return follow;
  }

  isFollowing(userId: string, storeId: string): boolean {
    return !!getContainer().repositories.storeFollowers.get(storeId, userId);
  }

  followedStores(userId: string): Store[] {
    const { repositories } = getContainer();
    return repositories.storeFollowers
      .listForUser(userId)
      .map((f) => repositories.stores.getById(f.storeId))
      .filter((s): s is Store => !!s);
  }

  newestStores(limit = 10): Store[] {
    return getContainer()
      .repositories.stores.list()
      .filter((s) => s.status === 'active')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}

export const storeService = new StoreService();
