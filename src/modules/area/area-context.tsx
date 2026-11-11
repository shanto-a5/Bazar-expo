/**
 * Area selection state for the whole app.
 *
 * The chosen area lives in local storage, so every launch after the first goes
 * straight to the area-filtered feed without asking again. The provider reads it
 * once from disk (no network), which keeps the cache-first startup intact: the
 * catalogue mirror hydrates exactly as before and the gate only decides whether
 * the full-screen selector must be shown first.
 *
 * Discovery: when a shopper submits an area nobody serves yet, the area is saved
 * locally FIRST (so the feed opens immediately, even offline) and the request to
 * `POST /catalog/areas/discover` is best-effort. A failed call is remembered and
 * retried on the next launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';

import { vantaApi } from '@/api/vanta-api';
import type { AreaRef } from '@/modules/area/area-logic';

const AREA_KEY = 'bazar.selected-area.v1';
const KNOWN_AREAS_KEY = 'bazar.known-areas.v1';

interface StoredArea extends AreaRef {
  /** The discovery report has not reached the server yet; retry later. */
  discoveryPending?: boolean;
}

interface AreaContextValue {
  /** `loading` only while the tiny local read runs; never waits on the network. */
  status: 'loading' | 'ready';
  area: AreaRef | null;
  /** True while the user is re-choosing an area from the Home header. */
  changing: boolean;
  openSelector: () => void;
  closeSelector: () => void;
  /** Saves the area locally and, for a typed unknown area, reports it. */
  selectArea: (area: AreaRef, options?: { discover?: boolean }) => Promise<void>;
}

const AreaContext = React.createContext<AreaContextValue | null>(null);

function parseStoredArea(raw: string | null): StoredArea | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredArea>;
    if (typeof value.name === 'string' && typeof value.slug === 'string' && value.name && value.slug) {
      return { name: value.name, slug: value.slug, discoveryPending: value.discoveryPending === true };
    }
  } catch {
    /* A corrupt value is treated as "no area saved". */
  }
  return null;
}

/** Last known list of served areas, so the selector still offers choices offline. */
export async function loadKnownAreas(): Promise<AreaRef[]> {
  try {
    const raw = await AsyncStorage.getItem(KNOWN_AREAS_KEY);
    const parsed = raw ? (JSON.parse(raw) as AreaRef[]) : [];
    return Array.isArray(parsed) ? parsed.filter((a) => typeof a?.name === 'string' && typeof a?.slug === 'string') : [];
  } catch {
    return [];
  }
}

export async function refreshKnownAreas(): Promise<AreaRef[]> {
  const { areas } = await vantaApi.areas();
  void AsyncStorage.setItem(KNOWN_AREAS_KEY, JSON.stringify(areas)).catch(() => undefined);
  return areas;
}

export function AreaProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = React.useState<'loading' | 'ready'>('loading');
  const [stored, setStored] = React.useState<StoredArea | null>(null);
  const [changing, setChanging] = React.useState(false);

  const persist = React.useCallback(async (next: StoredArea): Promise<void> => {
    setStored(next);
    setChanging(false);
    await AsyncStorage.setItem(AREA_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const report = React.useCallback(async (area: AreaRef): Promise<boolean> => {
    try {
      await vantaApi.discoverArea(area.name);
      return true;
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(AREA_KEY)
      .then((raw) => parseStoredArea(raw))
      .catch(() => null)
      .then(async (saved) => {
        if (!live) return;
        setStored(saved);
        setStatus('ready');
        // Retry a discovery report that could not be delivered last time.
        if (saved?.discoveryPending && (await report(saved)) && live) {
          const cleared = { name: saved.name, slug: saved.slug };
          setStored((current) => (current?.slug === saved.slug ? cleared : current));
          await AsyncStorage.setItem(AREA_KEY, JSON.stringify(cleared)).catch(() => undefined);
        }
      });
    return () => {
      live = false;
    };
  }, [report]);

  const selectArea = React.useCallback(
    async (area: AreaRef, options?: { discover?: boolean }): Promise<void> => {
      const base: StoredArea = { name: area.name, slug: area.slug };
      if (!options?.discover) {
        await persist(base);
        return;
      }
      // Saved first so the feed opens even if the report is slow or offline.
      await persist({ ...base, discoveryPending: true });
      if (await report(base)) {
        await persist(base);
      }
    },
    [persist, report],
  );

  const value = React.useMemo<AreaContextValue>(
    () => ({
      status,
      area: stored ? { name: stored.name, slug: stored.slug } : null,
      changing,
      openSelector: () => setChanging(true),
      closeSelector: () => setChanging(false),
      selectArea,
    }),
    [status, stored, changing, selectArea],
  );

  return <AreaContext.Provider value={value}>{children}</AreaContext.Provider>;
}

export function useArea(): AreaContextValue {
  const value = React.useContext(AreaContext);
  if (!value) throw new Error('useArea must be used inside <AreaProvider>.');
  return value;
}
