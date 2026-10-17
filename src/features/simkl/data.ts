/**
 * The Simkl data hook (native half): local library from SQLite, sign-in, sync
 * on open / back from the background / pull-to-refresh, and every write.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';

import {
  addToLibrary,
  loadCalendar,
  loadDetail,
  loadEpisodes,
  loadTrending,
  markMovieWatched,
  removeFromLibrary,
  searchSimkl,
  setEpisodesWatched,
  setRating,
  setStatus,
} from './actions';
import { SimklError } from './api';
import { isSimklConnected, revokeSimklTokens, runSimklDeviceFlow } from './auth';
import { hasSimklClientId } from './config';
import { libraryCsv, type SimklItem } from './logic';
import { allWatchTimes, clearSimklLibrary, listSimklItems, watchedEpisodes } from './repo';
import { forgetSyncState, lastSyncAt as readLastSync, syncSimkl } from './sync';
import type { SimklActions } from './ui/types';

const message = (e: unknown) => (e instanceof SimklError || e instanceof Error ? e.message : String(e));

export function useSimklData() {
  const configured = hasSimklClientId();
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState<SimklItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus_] = useState('');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const cancelled = useRef(false);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    setItems(await listSimklItems());
    setLastSync(await readLastSync());
  }, []);

  const sync = useCallback(
    async (force: boolean) => {
      if (busy.current || !configured || !(await isSimklConnected())) return;
      busy.current = true;
      setSyncing(true);
      try {
        const result = await syncSimkl(force, setStatus_);
        if (result.kind !== 'skipped') await reload();
        setStatus_(result.kind === 'synced' ? `Synced · ${result.changed} updated` : result.kind === 'unchanged' ? 'Up to date' : '');
      } catch (e) {
        console.log(`[SIMKL] sync failed: ${message(e)}`);
        setStatus_(`Sync failed: ${message(e)}`);
      } finally {
        busy.current = false;
        setSyncing(false);
      }
    },
    [configured, reload]
  );

  // Start: show what is stored, then sync (the 15-minute rule decides).
  useEffect(() => {
    (async () => {
      await reload();
      const on = configured && (await isSimklConnected());
      setConnected(on);
      if (on) await sync(false);
    })().catch((e) => console.log(`[SIMKL] start failed: ${message(e)}`));
  }, [configured, reload, sync]);

  // Back from the background counts as opening the app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync(false);
    });
    return () => sub.remove();
  }, [sync]);

  /** Every write: run it, then re-read the local copy; errors become the status line and rethrow. */
  const write = useCallback(
    <A extends unknown[]>(job: (...args: A) => Promise<void>) =>
      async (...args: A) => {
        try {
          await job(...args);
        } catch (e) {
          setStatus_(`Simkl: ${message(e)}`);
          throw e;
        } finally {
          await reload();
        }
      },
    [reload]
  );

  const actions: SimklActions = useMemo(
    () => ({
      connect: async (onCode) => {
        cancelled.current = false;
        try {
          await runSimklDeviceFlow((start) => onCode({ code: start.user_code, url: start.verification_uri_complete }));
          if (cancelled.current) return false;
          setConnected(true);
          setStatus_('Connected - downloading your library…');
          await sync(true);
          return true;
        } catch (e) {
          if (!cancelled.current) setStatus_(message(e));
          return false;
        }
      },
      cancelConnect: () => {
        // The polling loop ends at the code's own deadline; we just stop listening.
        cancelled.current = true;
      },
      disconnect: async () => {
        await revokeSimklTokens();
        await forgetSyncState();
        await clearSimklLibrary();
        setConnected(false);
        await reload();
        setStatus_('Signed out of Simkl');
      },
      sync,
      setStatus: write(setStatus),
      setRating: write(setRating),
      setEpisodes: write(setEpisodesWatched),
      markMovieWatched: write(markMovieWatched),
      addToLibrary: write(addToLibrary),
      remove: write(removeFromLibrary),
      loadDetail,
      loadEpisodes,
      loadWatched: watchedEpisodes,
      search: searchSimkl,
      trending: loadTrending,
      calendar: loadCalendar,
      watchTimes: allWatchTimes,
      exportCsv: async () => {
        const file = new File(Paths.cache, `simkl-library-${new Date().toISOString().slice(0, 10)}.csv`);
        if (file.exists) file.delete();
        file.create();
        file.write(libraryCsv(await listSimklItems()));
        await Share.share({ url: file.uri });
      },
      openUrl: (url) => {
        Linking.openURL(url).catch((e) => console.log(`[SIMKL] could not open ${url}: ${String(e)}`));
      },
    }),
    [sync, write, reload]
  );

  return { configured, connected, items, syncing, status, lastSyncAt: lastSync, actions };
}
