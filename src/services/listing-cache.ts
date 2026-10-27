/**
 * Account-scoped local cache + background refresh (customer app).
 *
 * The customer read paths are synchronous repository/service calls — the API
 * snapshot is written into the device mirror at boot, and the cart/orders/
 * addresses are mirrored in memory as the server answers. This coordinator adds
 * the missing layer on top:
 *
 *   - `ensure` is the stale-while-revalidate hook a screen calls on focus. Cached
 *     data is already on screen, so it only starts a background fetch when the
 *     copy has never loaded or is older than the background TTL.
 *   - Freshness is persisted per `accountId:resource` in the `listCache`
 *     collection, so a cold start paints the cached copy immediately and the age
 *     check survives a restart.
 *   - `refresh` is the pull-to-refresh path: deduped against any in-flight read
 *     and rate-limited by a per-page cooldown, so a repeated gesture is dropped
 *     rather than queued.
 *   - `clearAccount` drops one account's freshness stamps and mirrored state on
 *     sign-out, so a later account on the same device can never read it.
 *
 * It owns no data of its own: every fetch is delegated to the service that owns
 * that resource. The mirror stays the single source of truth.
 */
import { getContainer } from '@/infrastructure/container';
import { hydrateRemoteCatalog } from '@/api/remote-hydration';
import { addressService } from './address-service';
import { cartService } from './cart-service';
import { orderService } from './order-service';

export type ListingResource = 'home' | 'cart' | 'orders' | 'account';

export const LISTING_RESOURCES: readonly ListingResource[] = ['home', 'cart', 'orders', 'account'];

/** Metadata collection (rows live in their own stores; this is freshness only). */
const CACHE_COLLECTION = 'listCache' as const;
const KEY_SEPARATOR = ':';

/** Background refreshes within this window are considered fresh. */
const BACKGROUND_TTL_MS = 15_000;
/** A manual pull is ignored for this long after the previous one settled. */
export const MANUAL_COOLDOWN_MS = 4_000;

/** What a screen needs to render its data state. */
export interface ListingState {
  /** The account has completed at least one read for this resource. */
  loaded: boolean;
  /** A request (background or manual) is currently in flight. */
  inflight: boolean;
  /** A manual pull-to-refresh is in flight. */
  refreshing: boolean;
  /** Last refresh failure, cleared when a new attempt starts. */
  error: string | null;
}

interface ListCacheRecord {
  id: string;
  updatedAt: number;
}

interface ResourceState {
  loaded: boolean;
  inflight: boolean;
  manualInflight: boolean;
  lastSuccessAt: number;
  lastCompletedAt: number;
  error: string | null;
}

const EMPTY_STATE: ListingState = { loaded: false, inflight: false, refreshing: false, error: null };

class ListingCache {
  private states = new Map<string, ResourceState>();
  private listeners = new Set<() => void>();
  private progressListeners = new Set<() => void>();
  private pending = 0;

  // ---------------------------------------------------------------- keying

  private key(accountId: string, resource: ListingResource): string {
    return `${accountId}${KEY_SEPARATOR}${resource}`;
  }

  private readRecord(accountId: string, resource: ListingResource): ListCacheRecord | undefined {
    try {
      return getContainer().db.getById<ListCacheRecord>(CACHE_COLLECTION, this.key(accountId, resource));
    } catch {
      return undefined;
    }
  }

  private state(accountId: string, resource: ListingResource): ResourceState {
    const key = this.key(accountId, resource);
    let state = this.states.get(key);
    if (!state) {
      const record = this.readRecord(accountId, resource);
      state = {
        loaded: !!record,
        inflight: false,
        manualInflight: false,
        lastSuccessAt: record?.updatedAt ?? 0,
        lastCompletedAt: 0,
        error: null,
      };
      this.states.set(key, state);
    }
    return state;
  }

  // ---------------------------------------------------------------- reads

  getState(accountId: string, resource: ListingResource): ListingState {
    if (!accountId) return EMPTY_STATE;
    const state = this.state(accountId, resource);
    return {
      loaded: state.loaded,
      inflight: state.inflight,
      refreshing: state.inflight && state.manualInflight,
      error: state.error,
    };
  }

  getProgressPending(): number {
    return this.pending;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeProgress(listener: () => void): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------- writes

  /** On focus: fetch only when never loaded or stale; a no-op while in flight. */
  ensure(accountId: string, resource: ListingResource): void {
    if (!accountId) return;
    const state = this.state(accountId, resource);
    if (state.inflight) return;
    const fresh = state.loaded && Date.now() - state.lastSuccessAt < BACKGROUND_TTL_MS;
    if (fresh) return;
    this.start(accountId, resource, false);
  }

  /**
   * Manual pull-to-refresh. A pull during an in-flight read, or within the
   * cooldown after the previous one, is simply dropped — never queued.
   */
  refresh(accountId: string, resource: ListingResource): void {
    if (!accountId) return;
    const state = this.state(accountId, resource);
    if (state.inflight) return;
    if (state.lastCompletedAt && Date.now() - state.lastCompletedAt < MANUAL_COOLDOWN_MS) return;
    this.start(accountId, resource, true);
  }

  /** Retry after a failure, ignoring the cooldown. */
  retry(accountId: string, resource: ListingResource): void {
    if (!accountId) return;
    const state = this.state(accountId, resource);
    if (state.inflight) return;
    this.start(accountId, resource, false);
  }

  /**
   * Marks resources fresh without a fetch. Called by the session context after
   * boot/restore has already hydrated them, so the first page open does not
   * immediately repeat the same reads.
   */
  markHydrated(accountId: string, resources: readonly ListingResource[] = LISTING_RESOURCES): void {
    if (!accountId) return;
    const now = Date.now();
    for (const resource of resources) {
      const state = this.state(accountId, resource);
      state.loaded = true;
      state.lastSuccessAt = now;
      state.error = null;
      this.persist(accountId, resource, now);
    }
    this.emit();
  }

  /**
   * Drops every trace of one account. Called on sign-out / sign-out-everywhere
   * (and when the signed-in user changes), so a later account on the same device
   * can never read the previous account's cart, orders or addresses.
   */
  clearAccount(accountId: string): void {
    if (!accountId) return;
    let db: ReturnType<typeof getContainer>['db'] | null = null;
    try {
      db = getContainer().db;
    } catch {
      db = null;
    }

    for (const resource of LISTING_RESOURCES) {
      this.states.delete(this.key(accountId, resource));
      if (db) {
        try {
          db.remove(CACHE_COLLECTION, this.key(accountId, resource));
        } catch {
          /* database not loaded: nothing persisted to remove */
        }
      }
    }

    cartService.resetUser(accountId);
    addressService.resetUser(accountId);
    orderService.resetUser(accountId);

    this.emit();
  }

  // ---------------------------------------------------------------- internals

  private start(accountId: string, resource: ListingResource, manual: boolean): void {
    const state = this.state(accountId, resource);
    state.inflight = true;
    state.manualInflight = manual;
    state.error = null;
    this.emit();
    this.pending += 1;
    this.emitProgress();
    void this.run(accountId, resource, state);
  }

  private async run(accountId: string, resource: ListingResource, state: ResourceState): Promise<void> {
    try {
      await this.fetch(accountId, resource);
      state.loaded = true;
      state.lastSuccessAt = Date.now();
      this.persist(accountId, resource, state.lastSuccessAt);
    } catch (error) {
      // Keep the cached copy on screen; surface a discreet message only.
      state.error = error instanceof Error ? error.message : 'Could not refresh right now.';
    } finally {
      state.inflight = false;
      state.manualInflight = false;
      state.lastCompletedAt = Date.now();
      this.pending = Math.max(0, this.pending - 1);
      this.emitProgress();
      this.emit();
    }
  }

  private async fetch(accountId: string, resource: ListingResource): Promise<void> {
    switch (resource) {
      case 'home':
        await hydrateRemoteCatalog();
        return;
      case 'cart':
        await cartService.refresh(accountId);
        return;
      case 'orders':
        await orderService.refreshCustomerOrders(accountId);
        return;
      case 'account':
        await addressService.hydrate(accountId);
        return;
    }
  }

  private persist(accountId: string, resource: ListingResource, updatedAt: number): void {
    try {
      getContainer().db.upsert(CACHE_COLLECTION, { id: this.key(accountId, resource), updatedAt });
    } catch {
      /* the in-memory stamp still serves the current session */
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private emitProgress(): void {
    for (const listener of this.progressListeners) listener();
  }
}

export const listingCache = new ListingCache();
