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
  loadEpisodeRatings,
  loadEpisodes,
  hasOmdbKey,
  saveOmdbKey,
  loadPlayback,
  deletePlayback,
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
import { libraryCsv, type SimklItem, type SimklType } from './logic';
import { allWatchTimes, clearSimklLibrary, listSimklItems, watchedEpisodes } from './repo';
import {
  cachedPlan,
  deleteRewatch,
  endRewatch,
  fillMissingMeta,
  logRewatch,
  rewatchesOnSimkl,
  setRewatchesOnSimkl,
  startRewatch,
} from './actions';
import { allHistory, allPlays, metaMap, playsFor, sessionsFor } from './history';
import { loadFranchises, matchFranchise, prefetchArt, scrobble } from './actions';
import { addManyToList, allLinks, allLists, createList, deleteList, listEntries, setInList, setLink, setSearched, markLinkLogged, updateList, type SimklList } from './collections';
import { buildIcs, calendarEntries } from './ics';
import { pickImportFile, runImport } from './importer';
import { describeImport } from './imports';
import { getSetting, setSetting } from '@/features/vault/library';
import { buildEvents } from './insights';
import { onReminderTap, reminderSettings, rescheduleReminders, saveReminderSettings } from './notify';
import { forgetSyncState, lastSyncAt as readLastSync, syncSimkl } from './sync';
import type { SimklActions, SimklBridge, SimklPrefs } from './ui/types';

const SPOILER_KEY = 'simkl.hideSpoilers';

const message = (e: unknown) => (e instanceof SimklError || e instanceof Error ? e.message : String(e));

export function useSimklData() {
  const configured = hasSimklClientId();
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState<SimklItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus_] = useState('');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [openRequest, setOpenRequest] = useState<{ simklId: number; type: SimklType } | null>(null);
  const [lists, setLists] = useState<SimklList[]>([]);
  const [prefs, setPrefs] = useState<SimklPrefs>({ hideSpoilers: false });
  const cancelled = useRef(false);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    setItems(await listSimklItems());
    setLastSync(await readLastSync());
    setLists(await allLists());
  }, []);

  useEffect(() => {
    getSetting(SPOILER_KEY)
      .then((v) => setPrefs({ hideSpoilers: v === '1' }))
      .catch(() => undefined);
  }, []);

  const sync = useCallback(
    async (force: boolean) => {
      if (busy.current || !configured || !(await isSimklConnected())) return;
      busy.current = true;
      setSyncing(true);
      try {
        const result = await syncSimkl(force, setStatus_);
        if (result.kind !== 'skipped') {
          await reload();
          await rescheduleReminders().catch((e) => console.log(`[NOTIFY] ${String(e)}`));
        }
        // Wide pictures for the Up Next cards, in the background.
        prefetchArt()
          .then((n) => (n ? reload() : undefined))
          .catch(() => undefined);
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

  // A tapped reminder opens its title.
  useEffect(() => onReminderTap(setOpenRequest), []);

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
      loadEpisodeRatings,
      hasOmdbKey,
      saveOmdbKey,
      loadPlayback,
      deletePlayback,
      search: searchSimkl,
      trending: loadTrending,
      calendar: loadCalendar,
      watchTimes: allWatchTimes,
      loadInsights: async () => {
        const [list, history, plays, meta] = await Promise.all([listSimklItems(), allHistory(), allPlays(), metaMap()]);
        return { events: buildEvents(list, history, plays, meta), meta };
      },
      fillMeta: fillMissingMeta,
      loadSessions: sessionsFor,
      loadPlays: playsFor,
      startRewatch: async (item) => {
        const s = await startRewatch(item);
        await reload();
        return s;
      },
      endRewatch: write(endRewatch),
      deleteRewatch: write(deleteRewatch),
      logRewatch: write(logRewatch),
      getRewatchSync: async () => ({ on: await rewatchesOnSimkl(), plan: await cachedPlan() }),
      setRewatchSync: setRewatchesOnSimkl,
      getReminders: reminderSettings,
      setReminders: saveReminderSettings,
      exportCsv: async () => {
        const file = new File(Paths.cache, `simkl-library-${new Date().toISOString().slice(0, 10)}.csv`);
        if (file.exists) file.delete();
        file.create();
        file.write(libraryCsv(await listSimklItems()));
        await Share.share({ url: file.uri });
      },
      loadFranchises,
      matchFranchise,
      createList: async (name, icon) => {
        const id = await createList(name, icon);
        await reload();
        return id;
      },
      updateList: write(updateList),
      deleteList: write(deleteList),
      listEntries,
      setInList: write(setInList),
      addManyToList: async (listId, titles) => {
        try {
          return await addManyToList(listId, titles);
        } finally {
          await reload();
        }
      },
      setSearched,
      importFile: async (onProgress) => {
        const file = await pickImportFile();
        if (!file) return null;
        const result = await runImport(file, onProgress);
        if (result) {
          setStatus_(describeImport(result));
          await sync(true);
        }
        return result ?? 'unknown';
      },
      exportCalendar: async () => {
        const list = await listSimklItems();
        const rows = (await Promise.all((['show', 'anime', 'movie'] as const).map((t) => loadCalendar(t).catch(() => [])))).flat();
        const entries = calendarEntries(rows, list, Date.now());
        if (!entries.length) return 0;
        const file = new File(Paths.cache, 'ReelVault upcoming.ics');
        if (file.exists) file.delete();
        file.create();
        file.write(buildIcs(entries));
        await Share.share({ url: file.uri });
        return entries.length;
      },
      setPrefs: async (next) => {
        setPrefs(next);
        await setSetting(SPOILER_KEY, next.hideSpoilers ? '1' : '0');
      },
      openUrl: (url) => {
        Linking.openURL(url).catch((e) => console.log(`[SIMKL] could not open ${url}: ${String(e)}`));
      },
    }),
    [sync, write, reload]
  );

  /** What the Videos tab needs to link a video to a title and log it when you finish it. */
  const bridge: SimklBridge = useMemo(
    () => ({
      connected,
      search: searchSimkl,
      loadEpisodes,
      links: allLinks,
      insights: async () => {
        const [list, history, plays, meta, lists] = await Promise.all([listSimklItems(), allHistory(), allPlays(), metaMap(), allLists()]);
        return { events: buildEvents(list, history, plays, meta), items: list, meta, lists: lists.length };
      },
      setLink,
      scrobble: async (videoId, link, action, progress) => {
        const r = await scrobble(link, action, progress);
        if (r === 'watched') {
          await markLinkLogged(videoId);
          void sync(true);
        }
        return r;
      },
    }),
    [connected, sync]
  );

  return {
    configured,
    connected,
    items,
    syncing,
    status,
    lastSyncAt: lastSync,
    actions,
    lists,
    prefs,
    bridge,
    openRequest,
    clearOpenRequest: () => setOpenRequest(null),
  };
}
