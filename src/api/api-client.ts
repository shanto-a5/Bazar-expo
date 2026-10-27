/**
 * API client (M7-Q).
 *
 * One place that knows how to talk to the Vanta API: the response envelope, the
 * error shape, authentication, timeouts and request ids. Everything above this
 * layer deals in domain values and `ApiError`s.
 *
 * Two behaviours are deliberate and load-bearing:
 *
 *   1. Every response is validated against the envelope before it is handed on,
 *      so a proxy error page or an HTML body becomes a typed error rather than an
 *      undefined access three frames later.
 *   2. There is no retry on a request that may have been applied, and there is no
 *      fallback to another source. A failure is reported; it is never hidden.
 */
import { runtimeConfig } from '@/config/runtime-config';

export type ApiErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'internal_error'
  | 'network_error'
  | 'timeout'
  | 'malformed_response';

/**
 * A failed API call. `field` carries the first field-level message so existing
 * form code can attach it to an input without knowing about the server.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly field?: string;
  readonly fields: { field: string; message: string }[];
  readonly requestId?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: ApiErrorCode | string;
      field?: string;
      fields?: { field: string; message: string }[];
      requestId?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.code = options.code ?? 'network_error';
    this.fields = options.fields ?? [];
    this.field = options.field ?? this.fields[0]?.field;
    this.requestId = options.requestId;
  }

  /** True when the caller is not authenticated (or the token expired). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isRetryable(): boolean {
    return this.code === 'network_error' || this.code === 'timeout' || this.status === 503 || this.status === 429;
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; fields?: { field: string; message: string }[] };
  meta?: { requestId?: string };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** When false the Authorization header is omitted (used by register/login). */
  authenticated?: boolean;
  signal?: AbortSignal;
}

export type TokenProvider = () => string | null;
export type UnauthorizedHandler = () => void | Promise<void>;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registered once by the session layer so a 401 can clear the stored token. */
export function onUnauthorized(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export class ApiClient {
  private token: string | null = null;

  constructor(private readonly root: string = runtimeConfig.apiRoot) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.root) {
      throw new ApiError('No API is configured. The app is running in local mode.', { code: 'network_error' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), runtimeConfig.requestTimeoutMs);
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const usedBearer = options.authenticated !== false && this.token !== null;
    if (usedBearer) headers.authorization = `Bearer ${this.token}`;

    let response: Response;
    let body: string;
    try {
      response = await fetch(`${this.root}${path}${buildQuery(options.query)}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      // Read the body inside the guarded block: a server can send headers and then
      // stall, and awaiting `text()` outside the try left that hang unbounded.
      body = await response.text();
    } catch {
      // An aborted request is a timeout unless the caller aborted it themselves.
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new ApiError('The server took too long to respond. Try again.', { code: 'timeout' });
      }
      throw new ApiError(
        `Could not reach the Vanta API at ${runtimeConfig.apiBaseUrl}. Check that the server is running.`,
        { code: 'network_error' },
      );
    } finally {
      clearTimeout(timeout);
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    let envelope: ApiEnvelope<T> | null = null;
    if (body) {
      try {
        envelope = JSON.parse(body) as ApiEnvelope<T>;
      } catch {
        envelope = null;
      }
    }

    if (!response.ok || !envelope || envelope.ok !== true) {
      const error = this.toError(response.status, envelope, requestId);
      // A rejected *authenticated* token has to clear the session, otherwise the app
      // keeps replaying it forever. Login/register failures are unauthenticated and
      // must not tear the session down, even when a signed-in session is still held
      // on the device.
      if (error.status === 401 && usedBearer) {
        // Clearing the session is best effort: a storage failure here must not
        // replace the real 401 the caller needs to see.
        try {
          await notifyUnauthorized();
        } catch {
          /* keep the original error */
        }
      }
      throw error;
    }

    if (envelope.data === undefined) {
      throw new ApiError('The server returned an empty response.', {
        status: response.status,
        code: 'malformed_response',
        requestId,
      });
    }
    return envelope.data;
  }

  private toError(status: number, envelope: ApiEnvelope<unknown> | null, requestId?: string): ApiError {
    if (!envelope || typeof envelope !== 'object' || !envelope.error) {
      // A body that is not our envelope: a proxy, a crash page, a wrong port.
      return new ApiError(
        `The server returned an unexpected response (HTTP ${status}). It may not be a Vanta API.`,
        { status, code: 'malformed_response', requestId },
      );
    }
    const { code, message, fields } = envelope.error;
    return new ApiError(message || 'The request failed.', { status, code, fields, requestId });
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

let sharedClient: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!sharedClient) sharedClient = new ApiClient();
  return sharedClient;
}

/** Test seam: drops the shared client and any registered 401 handler. */
export function resetApiClientForTest(): void {
  sharedClient = null;
  unauthorizedHandler = null;
}

export async function notifyUnauthorized(): Promise<void> {
  if (unauthorizedHandler) await unauthorizedHandler();
}
