/**
 * React binding for the account-scoped listing cache.
 *
 * Subscribes a screen to one cache resource and kicks off a background refresh
 * when the screen gains focus. The screen keeps rendering whatever the mirror
 * already holds; this hook reports only the load/refresh state it needs, plus a
 * `version` counter that ticks on every settle so memoised reads (a catalogue
 * query, for instance) recompute once fresh data lands.
 */
import * as React from 'react';
import { useFocusEffect } from 'expo-router';

import { listingCache, type ListingResource, type ListingState } from '@/services/listing-cache';

export interface UseListingCacheResult {
  /** At least one successful read exists for this account+resource. */
  loaded: boolean;
  /** A background refresh is running over data already on screen. */
  updating: boolean;
  /** A user-initiated pull-to-refresh is running. */
  refreshing: boolean;
  /** Message from the last failed refresh; null when the last run succeeded. */
  error: string | null;
  /** Bumped whenever any refresh settles, so derived data can re-resolve. */
  version: number;
  /** Trigger a manual refresh (pull-to-refresh); respects the cooldown. */
  refresh: () => void;
  /** Retry after a failure, ignoring the cooldown. */
  retry: () => void;
}

const IDLE_STATE: ListingState = { loaded: false, inflight: false, refreshing: false, error: null };

export function useListingCache(accountId: string | undefined, resource: ListingResource): UseListingCacheResult {
  const [version, forceRender] = React.useReducer((n: number) => n + 1, 0);
  const id = accountId ?? '';

  React.useEffect(() => listingCache.subscribe(forceRender), []);

  // Re-check freshness on focus; `ensure` is a no-op while the copy is fresh.
  useFocusEffect(
    React.useCallback(() => {
      if (id) listingCache.ensure(id, resource);
    }, [id, resource]),
  );

  const state = id ? listingCache.getState(id, resource) : IDLE_STATE;

  const refresh = React.useCallback(() => {
    if (id) listingCache.refresh(id, resource);
  }, [id, resource]);

  const retry = React.useCallback(() => {
    if (id) listingCache.retry(id, resource);
  }, [id, resource]);

  return {
    loaded: state.loaded,
    updating: state.inflight && state.loaded,
    refreshing: state.refreshing,
    error: state.error,
    version,
    refresh,
    retry,
  };
}
