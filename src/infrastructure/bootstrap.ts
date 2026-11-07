/**
 * Loads the existing device mirror before routes mount. Remote freshness is
 * managed by the existing listing cache after screens are visible, so an API
 * health check or full catalogue read can never hold startup open.
 */
import * as React from 'react';

import { getAuthService } from '@/services/auth-gateway';
import { getContainer } from '@/infrastructure/container';

let bootPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  const { db } = getContainer();
  if (!db.loadedFlag) await db.load();
  getAuthService().installUnauthorizedHandler?.();
}

export type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; error: Error; retry: () => void };

export function useBootGate(): BootState {
  const [attempt, setAttempt] = React.useState(0);
  const [result, setResult] = React.useState<{
    attempt: number;
    status: 'ready' | 'failed';
    error: Error | null;
  }>({ attempt: -1, status: 'ready', error: null });

  React.useEffect(() => {
    let active = true;
    if (!bootPromise) bootPromise = ensureLoaded();
    void bootPromise.then(
      () => {
        if (active) setResult({ attempt, status: 'ready', error: null });
      },
      (error: unknown) => {
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
  if (result.status === 'failed') return { status: 'failed', error: result.error ?? new Error('Boot failed.'), retry };
  return { status: 'ready' };
}

export function ensureBooted(): Promise<void> {
  if (!bootPromise) bootPromise = ensureLoaded();
  return bootPromise;
}

export async function resetBootForTest(): Promise<void> {
  bootPromise = null;
}
