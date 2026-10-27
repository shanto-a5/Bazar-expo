import { getContainer } from '@/infrastructure/container';
import type { AppNotification, NotificationType } from '@/domain/types';
import { vantaApi } from '@/api/vanta-api';
import { mapNotification, removeNotification, upsertNotificationEntity } from '@/api/remote-notifications';

/**
 * In-app inbox. The server owns the inbox — it emits notifications from the
 * order/return/review/catalog flows — so this service keeps a per-user in-memory
 * copy of the server page and mirrors it into the device `notifications`
 * collection for the synchronous screens. Every read/mark/delete is
 * server-authoritative.
 */
interface RemoteInbox {
  notifications: AppNotification[];
  unreadCount: number;
  loaded: boolean;
  inflight: boolean;
  updatedAt: number;
}

const REMOTE_NOTIFICATION_TTL_MS = 15_000;

export class NotificationService {
  private remote = new Map<string, RemoteInbox>();
  private listeners = new Set<() => void>();

  /** Re-render hook: the session context subscribes and bumps a revision. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private inbox(userId: string): RemoteInbox {
    let state = this.remote.get(userId);
    if (!state) {
      state = { notifications: [], unreadCount: 0, loaded: false, inflight: false, updatedAt: 0 };
      this.remote.set(userId, state);
    }
    return state;
  }

  private async pull(userId: string): Promise<void> {
    const state = this.inbox(userId);
    try {
      const { notifications, unreadCount } = await vantaApi.notifications();
      const mapped = notifications.map(mapNotification);
      getContainer().db.replaceCollection('notifications', mapped);
      state.notifications = mapped;
      state.unreadCount = unreadCount;
      state.loaded = true;
      state.updatedAt = Date.now();
      this.notify();
    } catch (error) {
      // Keep the last known good page; a 401 already cleared the session.
      if (error instanceof Error) console.warn(`[vanta] notifications ${userId.slice(0, 8)}: ${error.message}`);
    }
  }

  /** Awaited read used on boot/sign-in so the inbox is ready before the UI opens. */
  async hydrate(userId: string): Promise<void> {
    if (!userId) return;
    await this.pull(userId);
  }

  /** Lazy read path behind the synchronous `list`/`unreadCount`. */
  private ensureLoaded(userId: string): void {
    const state = this.inbox(userId);
    if (state.inflight) return;
    if (state.loaded && Date.now() - state.updatedAt < REMOTE_NOTIFICATION_TTL_MS) return;
    state.inflight = true;
    void this.pull(userId).finally(() => {
      const current = this.remote.get(userId);
      if (current) current.inflight = false;
    });
  }

  /** Force a fresh read (sign-in, focus, or reconcile after a mutation). */
  sync(userId: string, force = false): void {
    if (!userId) return;
    const state = this.inbox(userId);
    if (state.inflight && !force) return;
    state.inflight = true;
    void this.pull(userId).finally(() => {
      const current = this.remote.get(userId);
      if (current) current.inflight = false;
    });
  }

  /**
   * No-op by design: the server emits its own notifications alongside the domain
   * change, so a device-side create would only produce a row the server does not
   * know about (and that the next hydration would erase).
   */
  create(
    _userId: string,
    _type: NotificationType,
    _title: string,
    _body: string,
    _data?: Record<string, string>,
  ): void {
    return;
  }

  list(userId: string): AppNotification[] {
    if (!userId) return [];
    this.ensureLoaded(userId);
    return this.inbox(userId).notifications;
  }

  unreadCount(userId: string): number {
    if (!userId) return 0;
    this.ensureLoaded(userId);
    return this.inbox(userId).unreadCount;
  }

  markRead(userId: string, id: string): void {
    if (!userId) return;
    const state = this.inbox(userId);
    const target = state.notifications.find((n) => n.id === id);
    if (target && !target.read) {
      target.read = true;
      state.unreadCount = Math.max(0, state.unreadCount - 1);
      target.updatedAt = new Date().toISOString();
      upsertNotificationEntity(target);
      this.notify();
    }
    void vantaApi
      .markNotificationRead(id)
      .then(() => this.sync(userId, true))
      .catch(() => this.sync(userId, true));
  }

  markAllRead(userId: string): void {
    if (!userId) return;
    const state = this.inbox(userId);
    const stamp = new Date().toISOString();
    for (const notification of state.notifications) {
      if (!notification.read) {
        notification.read = true;
        notification.updatedAt = stamp;
        upsertNotificationEntity(notification);
      }
    }
    state.unreadCount = 0;
    this.notify();
    void vantaApi
      .markAllNotificationsRead()
      .then(() => this.sync(userId, true))
      .catch(() => this.sync(userId, true));
  }

  remove(userId: string, id: string): void {
    if (!userId) return;
    const state = this.inbox(userId);
    const target = state.notifications.find((n) => n.id === id);
    if (target) {
      state.notifications = state.notifications.filter((n) => n.id !== id);
      if (!target.read) state.unreadCount = Math.max(0, state.unreadCount - 1);
      removeNotification(id);
      this.notify();
    }
    void vantaApi
      .deleteNotification(id)
      .then(() => this.sync(userId, true))
      .catch(() => this.sync(userId, true));
  }
}

export const notificationService = new NotificationService();
