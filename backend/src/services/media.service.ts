/**
 * Media boundary (M7-L).
 *
 * The app keeps working exactly as before: product photos and avatars are
 * `p:<palette>:<seed>` placeholders or device file URIs, produced on the device.
 * The API only has to *describe* a provider so a future object store can be
 * plugged in without inventing a vendor now. Nothing here uploads bytes, and no
 * cloud account, bucket or credential is required or assumed.
 */
export type MediaProviderId = 'local';

export interface MediaUploadTicket {
  provider: MediaProviderId;
  /** Opaque handle the client would use once a real provider is configured. */
  handle: string;
  uri: string;
  contentType: string;
}

export interface MediaProvider {
  readonly id: MediaProviderId;
  /** True when the provider is configured and able to accept uploads. */
  readonly available: boolean;
  createTicket(input: { folder: string; contentType: string }): MediaUploadTicket;
}

/**
 * Local provider: the device already owns the bytes, so the "ticket" simply
 * echoes the reference back. `available` stays true because local media works
 * with zero configuration.
 */
class LocalMediaProvider implements MediaProvider {
  readonly id: MediaProviderId = 'local';
  readonly available = true;

  createTicket(input: { folder: string; contentType: string }): MediaUploadTicket {
    return {
      provider: this.id,
      handle: `local:${input.folder}`,
      uri: '',
      contentType: input.contentType,
    };
  }
}

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const providers = new Map<MediaProviderId, MediaProvider>([['local', new LocalMediaProvider()]]);

export function mediaProvider(id: MediaProviderId = 'local'): MediaProvider {
  return providers.get(id) ?? providers.get('local')!;
}

export function describeMediaProviders(): {
  active: MediaProviderId;
  providers: { id: MediaProviderId; available: boolean }[];
  acceptedContentTypes: string[];
  note: string;
} {
  return {
    active: 'local',
    providers: [...providers.entries()].map(([id, provider]) => ({ id, available: provider.available })),
    acceptedContentTypes: ALLOWED_CONTENT_TYPES,
    note: 'Product and avatar media is produced on the device. No object-storage vendor is configured.',
  };
}
