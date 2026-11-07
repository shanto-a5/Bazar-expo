import type { StorageAdapter } from '@/storage/storage-adapter';
import type { CollectionKey } from '@/domain/types';

const COLLECTION_KEYS: Record<CollectionKey, string> = {
  users: 'vanta.collection.users',
  sessions: 'vanta.collection.sessions',
  categories: 'vanta.collection.categories',
  sellers: 'vanta.collection.sellers',
  stores: 'vanta.collection.stores',
  products: 'vanta.collection.products',
  carts: 'vanta.collection.carts',
  wishlists: 'vanta.collection.wishlists',
  addresses: 'vanta.collection.addresses',
  vouchers: 'vanta.collection.vouchers',
  promotions: 'vanta.collection.promotions',
  orders: 'vanta.collection.orders',
  sellerOrders: 'vanta.collection.sellerOrders',
  payments: 'vanta.collection.payments',
  reviews: 'vanta.collection.reviews',
  returnRequests: 'vanta.collection.returnRequests',
  notifications: 'vanta.collection.notifications',
  searchHistory: 'vanta.collection.searchHistory',
  recentlyViewed: 'vanta.collection.recentlyViewed',
  storeFollowers: 'vanta.collection.storeFollowers',
  inventoryAdjustments: 'vanta.collection.inventoryAdjustments',
  listCache: 'vanta.collection.listCache',
  cartCache: 'vanta.collection.cartCache',
};

export class LocalDatabase {
  readonly storage: StorageAdapter;

  private data = new Map<CollectionKey, unknown[]>();
  private listeners = new Set<() => void>();
  private dirty = new Set<CollectionKey>();
  private flushScheduled = false;
  private loaded = false;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  async load(): Promise<void> {
    const entries = await Promise.all(
      (Object.keys(COLLECTION_KEYS) as CollectionKey[]).map(async (key) => {
        const raw = await this.storage.get(COLLECTION_KEYS[key]);
        let value: unknown[] = [];
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) value = parsed;
          } catch {
            console.warn(`LocalDatabase: corrupted data for collection "${key}", resetting.`);
            value = [];
          }
        }
        return [key, value] as const;
      }),
    );
    for (const [key, value] of entries) {
      this.data.set(key, value);
    }
    this.loaded = true;
  }

  get loadedFlag(): boolean {
    return this.loaded;
  }

  getCollection<T>(key: CollectionKey): T[] {
    this.ensureLoaded();
    return this.data.get(key) as T[];
  }

  getById<T extends { id: string }>(key: CollectionKey, id: string): T | undefined {
    return this.getCollection<T>(key).find((item) => item.id === id);
  }

  insert(key: CollectionKey, entity: { id: string }): void {
    this.getCollection<any>(key).push(entity);
    this.markDirty(key);
  }

  update(key: CollectionKey, id: string, patch: Record<string, unknown>): void {
    const collection = this.getCollection<any>(key);
    const index = collection.findIndex((item) => item.id === id);
    if (index >= 0) {
      collection[index] = { ...collection[index], ...patch };
      this.markDirty(key);
    }
  }

  upsert(key: CollectionKey, entity: { id: string } & Record<string, unknown>): void {
    const collection = this.getCollection<any>(key);
    const index = collection.findIndex((item) => item.id === entity.id);
    if (index >= 0) {
      const next = { ...collection[index], ...entity };
      if (JSON.stringify(collection[index]) === JSON.stringify(next)) return;
      collection[index] = next;
    } else {
      collection.push(entity);
    }
    this.markDirty(key);
  }

  remove(key: CollectionKey, id: string): void {
    const collection = this.getCollection<any>(key);
    const next = collection.filter((item) => item.id !== id);
    if (next.length !== collection.length) {
      this.data.set(key, next);
      this.markDirty(key);
    }
  }

  clear(key: CollectionKey): void {
    this.getCollection<any>(key).length = 0;
    this.markDirty(key);
  }

  replaceCollection(key: CollectionKey, items: unknown[]): void {
    this.data.set(key, items);
    this.markDirty(key);
  }

  /**
   * Reconcile a server snapshot by id while preserving references for unchanged
   * rows. Only changed collections are persisted, and absent server rows are
   * removed so stale catalogue entries cannot linger.
   */
  reconcileCollection<T extends { id: string }>(key: CollectionKey, items: T[]): void {
    const current = this.getCollection<T>(key);
    const incoming = new Map(items.map((item) => [item.id, item]));
    const next: T[] = [];
    let changed = false;

    for (const previous of current) {
      const fresh = incoming.get(previous.id);
      if (!fresh) {
        changed = true;
        continue;
      }
      incoming.delete(previous.id);
      if (JSON.stringify(previous) === JSON.stringify(fresh)) {
        next.push(previous);
      } else {
        next.push(fresh);
        changed = true;
      }
    }

    if (incoming.size > 0) {
      next.push(...incoming.values());
      changed = true;
    }

    if (changed) {
      this.data.set(key, next);
      this.markDirty(key);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async persistAll(): Promise<void> {
    for (const key of Object.keys(COLLECTION_KEYS) as CollectionKey[]) {
      await this.persist(key);
    }
  }

  private markDirty(key: CollectionKey): void {
    this.dirty.add(key);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    Promise.resolve().then(() => {
      this.flushScheduled = false;
      const keys = [...this.dirty];
      this.dirty.clear();
      for (const key of keys) {
        void this.persist(key);
      }
      this.notify();
    });
  }

  private async persist(key: CollectionKey): Promise<void> {
    const value = this.data.get(key) ?? [];
    try {
      await this.storage.set(COLLECTION_KEYS[key], JSON.stringify(value));
    } catch (error) {
      console.warn(`LocalDatabase: failed to persist "${key}"`, error);
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('LocalDatabase must be loaded before use.');
    }
  }
}
