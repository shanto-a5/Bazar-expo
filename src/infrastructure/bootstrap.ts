/**
 * Bootstrap gate (M2-A / M2-B, remote-only from M19).
 *
 * Sequence the app's cold-start so the UI never races unmounted infrastructure:
 *
 *   1. Keep the native splash visible while the JS runtime boots.
 *   2. Load every collection from storage into the in-memory LocalDatabase (the
 *      cache/mirror store the synchronous read paths use).
 *   3. Check the API is reachable, then replace the local catalogue mirror with
 *      the server's snapshot. A failure here fails the boot: there is no local
 *      marketplace to fall back to, so an unreachable server is a visible error,
 *      never an empty or stale catalogue.
 *   4. Only then mount the session tree; SessionProvider restores the persisted
 *      session (authService.getCurrentUser) before any guarded route decides.
 *   5. Hide the splash only after the session has been resolved to a state.
 *
 * `boot()` is a module-level promise so repeated mounts await the SAME boot — no
 * double init, no race between two screens.
 */
import * as React from 'react';

import { getContainer } from '@/infrastructure/container';
import { ApiError, getApiClient } from '@/api/api-client';
import { hydrateRemoteCatalog } from '@/api/remote-hydration';
import { vantaApi } from '@/api/vanta-api';
import { getAuthService } from '@/services/auth-gateway';
import { describeRuntimeConfig } from '@/config/runtime-config';

let bootPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  const container = getContainer();
  if (!container.db.loadedFlag) {
    await container.db.load();
  }

  await bootRemote();
}

/**
 * Remote boot. Order matters:
 *
 *   1. Prime the stored bearer token onto the client first, so `/health` and the
 *      catalogue reads are made as the signed-in user.
 *   2. Register the 401 handler, so a token the server rejects clears the stored
 *      copy and drops the UI to signed-out instead of looping on 401s.
 *   3. Probe `/health`, which reports the datastore the server is actually using.
 *      If the server is running on its in-memory driver, say so out loud.
 *   4. Hydrate the catalogue mirror. Only after this is the app usable.
 */
async function bootRemote(): Promise<void> {
  console.info(`[vanta] ${describeRuntimeConfig()}`);

  const token = await getContainer().sessionStorage.getToken();
  if (token) getApiClient().setToken(token);

  getAuthService().installUnauthorizedHandler?.();

  let health;
  try {
    health = await vantaApi.health();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'network_error') {
      throw new Error(
        'Vanta could not reach the Vanta API at the configured base URL. Start the server; there is no local fallback.',
      );
    }
    throw error;
  }

  if (!health.database.ok) {
    throw new Error('The Vanta API is running but its datastore is not ready. Check the server logs.');
  }
  if (health.database.driver !== 'mongo') {
    console.warn(
      `[vanta] the API is using the "${health.database.driver}" datastore driver. Data is not durable.`,
    );
  }

  const report = await hydrateRemoteCatalog();
  console.info(
    `[vanta] catalogue hydrated: ${report.products} products, ${report.stores} stores, ${report.sellers} sellers, ${report.categories} categories`,
  );
}

/**
 * Mount-bootstrap hook. Resolves once the database is loaded and the category
 * taxonomy is installed. Every caller awaits the same boot promise -> idempotent.
 */
export type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; error: Error; retry: () => void };

/**
 * Mount-bootstrap hook. Returns the boot state so the root layout can show a real
 * failure screen — returning a bare `false` left `{booted ? <Slot /> : null}` on a
 * blank screen forever, because a rejected boot promise never resolves `ready`.
 */
export function useBootGate(): BootState {
  const [attempt, setAttempt] = React.useState(0);
  // The result is tagged with the attempt that produced it, so a retry reads as
  // "loading" by derivation rather than by a setState in the effect body.
  const [result, setResult] = React.useState<{
    attempt: number;
    status: 'ready' | 'failed';
    error: Error | null;
  }>({ attempt: -1, status: 'ready', error: null });

  React.useEffect(() => {
    let active = true;
    if (!bootPromise) {
      bootPromise = ensureLoaded();
    }
    void bootPromise.then(
      () => {
        if (active) setResult({ attempt, status: 'ready', error: null });
      },
      (error: unknown) => {
        // A failed boot must not poison the module-level promise: clearing it lets
        // a retry start a fresh attempt instead of replaying the rejection forever.
        bootPromise = null;
        if (active) {
          setResult({ attempt, status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = React.useCallback(() => setAttempt((value) => value + 1), []);

  if (result.attempt !== attempt) return { status: 'loading' };
  if (result.status === 'failed') {
    return { status: 'failed', error: result.error ?? new Error('Boot failed.'), retry };
  }
  return { status: 'ready' };
}

export async function ensureBooted(): Promise<void> {
  if (!bootPromise) {
    bootPromise = ensureLoaded();
  }
  return bootPromise;
}

export async function resetBootForTest(): Promise<void> {
  bootPromise = null;
}
