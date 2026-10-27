/**
 * Runtime configuration (remote-only since M19).
 *
 * Vanta has a single runtime architecture: a Vanta API is the datastore. Every
 * read and write that matters goes over HTTP to `apiBaseUrl`, and the server is
 * the authority for identity, pricing and stock. The device keeps an in-memory
 * cache/mirror of some server data so the many synchronous read paths keep
 * working, but that mirror is never an alternative source of truth.
 *
 * The former on-device "local marketplace" simulator and its `EXPO_PUBLIC_API_MODE`
 * switch have been removed. `EXPO_PUBLIC_API_BASE_URL` is now the only required
 * setting, and a missing or invalid value is a configuration error thrown at boot
 * rather than a silent fallback to local data.
 *
 * Only `EXPO_PUBLIC_*` values are inlined into the bundle by Expo, and this file
 * references them statically so the substitution works. Nothing secret belongs
 * here: the server holds the session secret, the database URI and the payment
 * configuration, and the client only ever receives an opaque bearer token.
 */

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function readBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (raw === undefined || raw === null || raw.trim() === '') {
    throw new ConfigurationError(
      'EXPO_PUBLIC_API_BASE_URL is required in remote mode (for example http://127.0.0.1:4000).',
    );
  }
  const value = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) {
    throw new ConfigurationError(`EXPO_PUBLIC_API_BASE_URL must be an http(s) URL (received "${raw}").`);
  }
  // A production build must not talk to a plaintext origin.
  if (process.env.NODE_ENV === 'production' && !/^https:/i.test(value)) {
    throw new ConfigurationError('EXPO_PUBLIC_API_BASE_URL must use https in a production build.');
  }
  return value;
}

export interface RuntimeConfig {
  /** The server origin (no trailing slash). */
  apiBaseUrl: string;
  /** Versioned API root used by the client. */
  apiRoot: string;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number;
}

/**
 * Resolved once per process. A misconfiguration throws here rather than at the
 * first network call, so the failure is reported during boot where it is visible.
 */
export const runtimeConfig: RuntimeConfig = (() => {
  const apiBaseUrl = readBaseUrl();
  const rawTimeout = Number.parseInt(process.env.EXPO_PUBLIC_API_TIMEOUT_MS ?? '', 10);
  return {
    apiBaseUrl,
    apiRoot: `${apiBaseUrl}/api/v1`,
    requestTimeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 15_000,
  };
})();

/** Safe to log or render: contains no credentials. */
export function describeRuntimeConfig(): string {
  return `api=${runtimeConfig.apiBaseUrl}`;
}
