/**
 * Remote notification bridge (M18).
 *
 * In remote mode the API owns the in-app inbox: the server emits notifications
 * from the order, return, review and catalog flows, and the client reads them
 * back. The screens still read the on-device database synchronously, so this
 * module maps the server DTO onto `AppNotification` and mirrors the signed-in
 * user's page into the `notifications` collection — the same cache pattern
 * `remote-hydration`/`remote-seller` use for the catalogue and seller workspace.
 *
 * The mirror is a cache; the server is the source of truth. Nothing here invents
 * notification state — every field comes from a `/notifications` response.
 */
import type { AppNotification, CollectionKey, NotificationType } from '@/domain/types';
import { getContainer } from '@/infrastructure/container';

export interface NotificationDto {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  data: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export function mapNotification(dto: NotificationDto): AppNotification {
  return {
    id: dto.id,
    userId: dto.userId,
    type: dto.type,
    title: dto.title,
    body: dto.body ?? '',
    read: Boolean(dto.read),
    data: dto.data ?? undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

function mirror(key: CollectionKey, entity: object & { id: string }): void {
  getContainer().db.upsert(key, entity as { id: string } & Record<string, unknown>);
}

export function upsertNotification(dto: NotificationDto): AppNotification {
  const mapped = mapNotification(dto);
  mirror('notifications', mapped);
  return mapped;
}

export function upsertNotificationEntity(notification: AppNotification): void {
  mirror('notifications', notification);
}

export function removeNotification(id: string): void {
  getContainer().db.remove('notifications', id);
}
