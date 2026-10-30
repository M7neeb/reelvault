/**
 * The Manga section's data (native wiring): loads the library, adds files
 * and folders, keeps Recently Deleted, saves where you are, and gives the
 * screens everything as plain data and functions (see ui/manga/mangaTypes.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Share } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import { keepAwake } from '../awake';
import { useAniList } from './anilistData';
import { getSetting, setSetting } from '../library';

const EXT_CHECK_KEY = 'manga.extCheck';
/** Cover colours already worked out (series id and cover file → colour). */
const coverColors = new Map<string, string | null>();
import { saveToPhotos } from '../sources';
import { usableAccent } from './coverColor';
import type { BrowseActions, DownloadState, MangaData, MangaUiSeries } from '../ui/manga/mangaTypes';
import { canTellWifi, downloadProgress, downloadsPaused, waitingForWifi, forgetDownloads, kickDownloads, setDownloadsPaused, startDownloads, subscribeDownloads } from './mangaDownloads';
import { exportSeries, writeCbz } from './mangaExport';
import { dueForCheck, markChecked, notifyNewChapters } from './mangaNotify';
import { tachiSourceOf } from './mangaBackup';
import { dirBytes, fileIn, fileUri, mangaRoot, removeDir } from './mangaFiles';
import { importMangaFiles, importMangaFolder, type MangaImportSummary, type PickedMangaFile } from './mangaImport';
import { chapterLabel, type MangaSeries } from './mangaLogic';
import {
  addFromSource,
  addRepo,
  autoLink,
  importTachiBackup,
  linkSeries,
  sourceFor,
  addServer,
  cachedSource,
  installExtension,
  loadBrowsePrefs,
  loadSources,
  pagesOf,
  refreshRepos,
  updateExtensions,
  refreshSeries,
  removeRepo,
  removeServer,
  saveBrowsePrefs,
  uninstallExtension,
  pushProgress,
} from './mangaSources';
import { DEFAULT_BROWSE, type BrowsePrefs } from './sources/prefs';
import {
  addMangaTag,
  addRead,
  allReads,
  allSeriesFolders,
  cancelDownloads,
  clearChapterFiles,
  getSeries,
  listDownloads,
  queueDownloads,
  retryDownloads,
  deleteChapterRows,
  deleteSeriesRows,
  expiredSeries,
  listManga,
  removeMangaTag,
  restoreSeries,
  saveProgress,
  setChaptersRead,
  trashSeries,
  updateSeries,
} from './mangaStore';

/** What the Files picker offers: comic archives, PDFs and pictures. */
// Any file: .cbz has no type iOS knows, so a narrower list greys those out. The import checks each file.
const PICKER_TYPES = ['*/*'];

function asUi(s: MangaSeries): MangaUiSeries {
  return { ...s, coverSource: s.cover ? fileUri(s.folder, s.cover) : null };
}

function describe(s: MangaImportSummary): string {
  const parts = [`Added ${s.chapters} ${s.chapters === 1 ? 'chapter' : 'chapters'}`];
  if (s.newSeries) parts.push(`${s.newSeries} new ${s.newSeries === 1 ? 'series' : 'series'}`);
  if (s.duplicates.length) parts.push(`${s.duplicates.length} already here, skipped`);
  if (s.failed.length) parts.push(`${s.failed.length} failed`);
  return parts.join(' · ');
}

/** Every file in a folder (and its sub-folders), with its path inside it. */
function walk(dir: Directory, prefix = '', depth = 0): PickedMangaFile[] {
  const out: PickedMangaFile[] = [];
  for (const e of dir.list()) {
    if (e instanceof Directory) {
      if (depth < 8) out.push(...walk(e, `${prefix}${e.name}/`, depth + 1));
    } else out.push({ uri: e.uri, name: e.name, size: e.size ?? 0, rel: `${prefix}${e.name}` });
  }
  return out;
}

/** Folders under manga/ no series points at (an import that stopped half way) go after 6 hours. */
async function tidyManga(): Promise<void> {
  if (!mangaRoot?.exists) return;
  const known = new Set((await allSeriesFolders()).map((f) => f.split('/').pop()));
  const ages = ReelVaultMedia ? new Map((await ReelVaultMedia.entries(mangaRoot.uri).catch(() => [])).map((e) => [e.name, e.modified])) : new Map<string, number>();
  for (const d of mangaRoot.list()) {
    if (!(d instanceof Directory) || known.has(d.name)) continue;
    if (Date.now() - (ages.get(d.name) ?? Date.now()) < 6 * 3_600_000) continue;
    try {
      d.delete();
    } catch (e) {
      console.log(`[MANGA] leftover ${d.name} not removed: ${String(e)}`);
    }
  }
}

export function useMangaData(): MangaData {
  const [all, setAll] = useState<MangaSeries[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const allRef = useRef<MangaSeries[]>([]);
  allRef.current = all;
  const [prefs, setPrefsState] = useState<BrowsePrefs>(DEFAULT_BROWSE);
  const prefsRef = useRef<BrowsePrefs>(DEFAULT_BROWSE);
  const setPrefs = useCallback((p: BrowsePrefs) => {
    prefsRef.current = p;
    setPrefsState(p);
  }, []);
  /** When each chapter's progress last went to its server. */
  const pushedAt = useRef(new Map<string, number>());
  /** Chapters marked read or unread by hand: their servers hear about it (one at a time, in the background). */
  const sendRead = useCallback((chapterIds: string[], read: boolean) => {
    const want = new Set(chapterIds);
    const jobs = allRef.current.flatMap((s) => s.chapters.filter((c) => want.has(c.id)).map((c) => ({ s, c })));
    void (async () => {
      for (const { s, c } of jobs.slice(0, 500)) await pushProgress(s.sourceId, c, read ? Math.max(0, c.pageCount - 1) : 0, read, prefsRef.current);
    })();
  }, []);
  useEffect(() => {
    loadBrowsePrefs()
      .then(setPrefs)
      .catch(() => undefined);
  }, [setPrefs]);

  const refresh = useCallback(async () => {
    try {
      setAll(await listManga());
    } catch (e) {
      console.log(`[MANGA] load failed: ${String(e)}`);
    }
  }, []);

  /** Reloads one series only (a chapter finished downloading): no full reload per chapter. */
  const refreshOne = useCallback(async (id: string) => {
    const s = await getSeries(id).catch(() => null);
    if (s) setAll((list) => list.map((x) => (x.id === id ? s : x)));
  }, []);

  const [downloads, setDownloads] = useState<DownloadState>({ queue: [], current: null, paused: false });
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;
  const loadDownloads = useCallback(async () => {
    const queue = await listDownloads().catch(() => []);
    setDownloads({ queue: queue.map((q) => ({ chapterId: q.chapterId, seriesId: q.seriesId, state: q.state, error: q.error })), current: downloadProgress(), paused: downloadsPaused(), waitingWifi: waitingForWifi(), canTellWifi });
  }, []);
  useEffect(() => {
    const off = subscribeDownloads(() => {
      loadDownloads().catch(() => undefined);
    });
    startDownloads(() => prefsRef.current, (id) => {
      refreshOne(id).catch(() => undefined);
    });
    loadDownloads().catch(() => undefined);
    return off;
  }, [loadDownloads, refreshOne]);

  useEffect(() => {
    (async () => {
      await refresh();
      try {
        const prefs = JSON.parse((await getSetting('vault.prefs')) ?? '{}');
        const days = [1, 3, 7, 14, 30].includes(prefs?.trashDays) ? prefs.trashDays : 30;
        const gone = await expiredSeries(Date.now(), days);
        if (gone.length) {
          for (const g of gone) removeDir(g.folder);
          await deleteSeriesRows(gone.map((g) => g.id));
          await refresh();
        }
      } catch (e) {
        console.log(`[MANGA] purge failed: ${String(e)}`);
      }
      setTimeout(() => tidyManga().catch((e) => console.log(`[MANGA] tidy: ${String(e)}`)), 25_000);
      // New chapters: asked when the app opens (at most every 6 hours), quietly.
      setTimeout(() => {
        checkForNew(false).catch((e) => console.log(`[MANGA] check: ${String(e)}`));
      }, 40_000);
      // Extensions update themselves, once a day.
      setTimeout(() => {
        (async () => {
          const p = prefsRef.current;
          if (!p.autoUpdateExt || !p.installed.length) return;
          const last = Number((await getSetting(EXT_CHECK_KEY)) ?? 0);
          if (Date.now() - last < 20 * 3_600_000) return;
          await setSetting(EXT_CHECK_KEY, String(Date.now()));
          const { prefs: next, updated } = await updateExtensions(prefsRef.current);
          setPrefs(next);
          if (updated.length) setStatus(`Updated ${updated.length === 1 ? updated[0] : `${updated.length} extensions`}`);
        })().catch((e) => console.log(`[MANGA] extension updates: ${String(e)}`));
      }, 55_000);
    })();
  }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Asks every title's source for new chapters; tells you, and queues them when you chose that. */
  const checking = useRef(false);
  const checkForNew = async (byHand: boolean): Promise<{ added: number; failed: string[] }> => {
    const p = prefsRef.current;
    // One check at a time (the one at start-up and one by hand could meet).
    if (checking.current) return { added: 0, failed: [] };
    if (!byHand && (!p.checkOnOpen || !(await dueForCheck(Date.now())))) return { added: 0, failed: [] };
    checking.current = true;
    try {
      return await checkNow(byHand, p);
    } finally {
      checking.current = false;
    }
  };
  const checkNow = async (byHand: boolean, p: BrowsePrefs): Promise<{ added: number; failed: string[] }> => {
    const list = allRef.current.filter((x) => !x.deletedAt && x.sourceId && !tachiSourceOf(x.sourceId));
    const found: { title: string; count: number; seriesId: string; ids: string[] }[] = [];
    const failed: string[] = [];
    for (const [i, x] of list.entries()) {
      if (byHand) setStatus(`Checking for new chapters… ${i + 1} of ${list.length}`);
      try {
        const ids = await refreshSeries(x.id, p);
        if (ids.length) found.push({ title: x.title, count: ids.length, seriesId: x.id, ids });
      } catch (e) {
        console.log(`[MANGA] refresh ${x.title}: ${String(e)}`);
        failed.push(x.title);
      }
    }
    await markChecked(Date.now());
    await refresh();
    const added = found.reduce((a, f) => a + f.count, 0);
    if (p.autoDownload) {
      const wanted = found.filter((f) => {
        const s = allRef.current.find((x) => x.id === f.seriesId);
        return s && (s.status === 'reading' || s.status === 'planned' || s.status === null);
      });
      // Only chapters that can be downloaded (not ones published on another website).
      const rows: { chapterId: string; seriesId: string }[] = [];
      for (const f of wanted) {
        const fresh = await getSeries(f.seriesId).catch(() => null);
        for (const c of fresh?.chapters ?? []) if (f.ids.includes(c.id) && !c.folder && c.sourceKey && !c.sourceUrl) rows.push({ chapterId: c.id, seriesId: f.seriesId });
      }
      if (rows.length) {
        await queueDownloads(rows, Date.now());
        await loadDownloads();
        kickDownloads();
      }
    }
    if (!byHand) await notifyNewChapters(found);
    if (byHand || added) setStatus(list.length ? `${added ? `${added} new ${added === 1 ? 'chapter' : 'chapters'}` : 'No new chapters'}${failed.length ? ` · ${failed.length} could not be checked` : ''}` : '');
    return { added, failed };
  };


  // One import at a time.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const run = useCallback(
    (job: () => Promise<MangaImportSummary>) => {
      const next = queue.current.then(async () => {
        setBusy(true);
        try {
          const summary = await job();
          await refresh();
          setStatus(describe(summary));
          if (summary.failed.length) Alert.alert('Some files were not added', summary.failed.map((f) => `${f.name}: ${f.reason}`).join('\n\n'));
        } catch (e) {
          console.log(`[MANGA] import failed: ${String(e)}`);
          setStatus('Adding failed');
        } finally {
          setBusy(false);
        }
      });
      queue.current = next.catch(() => undefined);
      return next;
    },
    [refresh]
  );

  const byId = (id: string) => allRef.current.find((s) => s.id === id);

  const actionsRef = useRef<MangaData['actions'] | null>(null);
  const actions = useMemo<MangaData['actions']>(
    () => ({
      importFiles: async () => {
        const picked = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, multiple: true, copyToCacheDirectory: true });
        if (picked.canceled) return;
        const files = (picked.assets ?? []).map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? undefined }));
        await run(() => importMangaFiles(files, { keepOriginals: false, onStep: setStatus }));
      },
      importFolder: async () => {
        let dir: Directory;
        try {
          dir = await Directory.pickDirectoryAsync();
        } catch {
          return;
        }
        const files = walk(dir);
        if (!files.length) {
          Alert.alert('Nothing here', 'That folder has no comic files or pictures.');
          return;
        }
        await run(() => importMangaFolder(dir.name, files, setStatus));
      },
      update: async (ids, patch) => {
        await updateSeries(ids, { ...patch, ...(patch.status === 'completed' ? { finishedAt: Date.now() } : {}) });
        await refresh();
      },
      addTag: async (ids, name) => {
        for (const id of ids) await addMangaTag(id, name);
        await refresh();
      },
      removeTag: async (id, name) => {
        await removeMangaTag(id, name);
        await refresh();
      },
      trash: async (ids) => {
        forgetDownloads(ids.flatMap((id) => byId(id)?.chapters.map((c) => c.id) ?? []));
        await trashSeries(ids, Date.now());
        await refresh();
      },
      restore: async (ids) => {
        await restoreSeries(ids);
        await refresh();
      },
      purge: async (ids) => {
        forgetDownloads(ids.flatMap((id) => byId(id)?.chapters.map((c) => c.id) ?? []));
        for (const id of ids) {
          const s = byId(id);
          if (s) removeDir(s.folder);
        }
        await deleteSeriesRows(ids);
        await refresh();
      },
      deleteChapters: async (seriesId, chapterIds) => {
        const s = byId(seriesId);
        forgetDownloads(chapterIds);
        for (const c of s?.chapters ?? []) if (chapterIds.includes(c.id) && c.folder) removeDir(c.folder);
        await deleteChapterRows(chapterIds);
        await refresh();
      },
      setRead: async (chapterIds, read) => {
        await setChaptersRead(chapterIds, read, Date.now());
        await refresh();
        sendRead(chapterIds, read);
      },
      markPreviousRead: async (seriesId, chapterId) => {
        const s = byId(seriesId);
        if (!s) return;
        const i = s.chapters.findIndex((c) => c.id === chapterId);
        if (i <= 0) return;
        await setChaptersRead(
          s.chapters.slice(0, i).map((c) => c.id),
          true,
          Date.now()
        );
        await refresh();
        sendRead(
          s.chapters.slice(0, i).map((c) => c.id),
          true
        );
      },
      saveProgress: async (seriesId, chapterId, page, finished) => {
        const at = Date.now();
        await saveProgress(seriesId, chapterId, page, finished, at);
        // Your servers hear about it too: at once when a chapter is finished, otherwise at most every 8 seconds.
        {
          const s = allRef.current.find((x) => x.id === seriesId);
          const c = s?.chapters.find((x) => x.id === chapterId);
          const last = pushedAt.current.get(chapterId) ?? 0;
          if (s && c && (finished || at - last > 8000)) {
            pushedAt.current.set(chapterId, at);
            void pushProgress(s.sourceId, c, page, finished, prefsRef.current);
          }
        }
        // Only this series changes: no full reload while reading.
        setAll((list) =>
          list.map((s) =>
            s.id !== seriesId
              ? s
              : {
                  ...s,
                  lastReadAt: at,
                  status: s.status === null || s.status === 'planned' ? 'reading' : s.status,
                  chapters: s.chapters.map((c) => (c.id === chapterId ? { ...c, lastPage: page, readAt: finished ? (c.readAt ?? at) : c.readAt } : c)),
                }
          )
        );
        // "Remove downloads after reading": the chapters read before this one give their space back
        // (not this one: its pages are still on screen). They stay readable online.
        if (finished && prefsRef.current.removeAfterRead) {
          const s = allRef.current.find((x) => x.id === seriesId);
          const done = (s?.chapters ?? []).filter((c) => c.id !== chapterId && c.readAt && c.folder && c.sourceKey);
          for (const c of done) {
            removeDir(c.folder!);
            await clearChapterFiles(c.id);
          }
          if (done.length) await refreshOne(seriesId);
        }
      },
      addRead,
      loadPages: (series, chapter) => pagesOf(series, chapter, prefsRef.current),
      keepAwake: (on) => keepAwake('manga-reader', on),
      ...(typeof ReelVaultMedia?.startVolumeKeys === 'function'
        ? {
            volumeKeys: (onKey: (direction: 'up' | 'down') => void) => {
              const native = ReelVaultMedia!;
              const sub = native.addListener?.('onVolumeKey', (e) => onKey(e.direction));
              native.startVolumeKeys!();
              return () => {
                sub?.remove();
                native.stopVolumeKeys?.();
              };
            },
          }
        : {}),
      refresh: async (seriesId) => {
        const ids = await refreshSeries(seriesId, prefsRef.current);
        await refresh();
        return ids.length;
      },
      refreshAll: () => checkForNew(true),
      setCoverFromPhoto: async (seriesId) => {
        const s = byId(seriesId);
        if (!s) return;
        // From Photos, where your pictures are (the picker hands over a copy we can move).
        const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
        if (picked.canceled || !picked.assets?.[0]) return;
        await setCover(s, new File(picked.assets[0].uri), true);
        await refresh();
      },
      setCoverFromImage: async (seriesId, img) => {
        const s = byId(seriesId);
        if (!s) return;
        const f = await localPage(img);
        await setCover(s, f.file, f.temp);
        await refresh();
      },
      ...(typeof ReelVaultMedia?.pageMargins === 'function'
        ? {
            pageMargins: async (img: { uri: string; headers?: Record<string, string> }) => {
              const f = await localPage(img);
              try {
                const found = await ReelVaultMedia!.pageMargins!(f.file.uri);
                return found.edge ? found : null;
              } finally {
                if (f.temp) {
                  try {
                    f.file.delete();
                  } catch {
                    // already gone
                  }
                }
              }
            },
          }
        : {}),
      ...(ReelVaultMedia
        ? {
            coverColor: async (seriesId: string) => {
              const s = byId(seriesId);
              if (!s?.cover) return null;
              const key = `${s.id}:${s.cover}`;
              if (coverColors.has(key)) return coverColors.get(key) ?? null;
              const c = await ReelVaultMedia!.colors(fileUri(s.folder, s.cover)).catch(() => null);
              const hex = usableAccent(c?.dominant);
              coverColors.set(key, hex);
              return hex;
            },
          }
        : {}),
      sharePage: async (img) => {
        const f = await localPage(img);
        await Share.share({ url: f.file.uri });
      },
      savePage: async (img) => {
        const f = await localPage(img);
        const n = await saveToPhotos([f.file.uri]);
        return n !== null;
      },
      setCoverFromPage: async (seriesId, chapter, page) => {
        const s = byId(seriesId);
        const name = chapter.pages[page];
        if (!s || !chapter.folder || !name) return;
        await setCover(s, fileIn(chapter.folder, name), false);
        await refresh();
      },
      download: async (seriesId, which) => {
        const series = allRef.current.find((x) => x.id === seriesId);
        if (!series) return 0;
        const queued = new Set(downloadsRef.current.queue.map((q) => q.chapterId));
        const pick = series.chapters.filter((c) => !c.folder && c.sourceKey && !c.sourceUrl && !queued.has(c.id) && (which === 'all' ? true : which === 'unread' ? !c.readAt : which.includes(c.id)));
        if (!pick.length) return 0;
        await queueDownloads(pick.map((c) => ({ chapterId: c.id, seriesId })), Date.now());
        await loadDownloads();
        kickDownloads();
        return pick.length;
      },
      downloadLibrary: async () => {
        const queued = new Set(downloadsRef.current.queue.map((q) => q.chapterId));
        const rows = allRef.current
          .filter((x) => !x.deletedAt && x.sourceId && !tachiSourceOf(x.sourceId))
          .flatMap((x) => x.chapters.filter((c) => !c.folder && c.sourceKey && !c.sourceUrl && !queued.has(c.id)).map((c) => ({ chapterId: c.id, seriesId: x.id })));
        if (!rows.length) return 0;
        await queueDownloads(rows, Date.now());
        await loadDownloads();
        kickDownloads();
        return rows.length;
      },
      removeDownloads: async (seriesId, which) => {
        const series = allRef.current.find((x) => x.id === seriesId);
        if (!series) return;
        // Only chapters that can be read online again lose their pages (files you added yourself stay).
        const pick = series.chapters.filter((c) => c.folder && c.sourceKey && (which === 'all' || which.includes(c.id)));
        for (const c of pick) {
          removeDir(c.folder!);
          await clearChapterFiles(c.id);
        }
        await refreshOne(seriesId);
      },
      cancelDownloads: async (ids) => {
        await cancelDownloads(ids);
        forgetDownloads(ids);
        await loadDownloads();
      },
      retryDownloads: async () => {
        await retryDownloads();
        await loadDownloads();
        kickDownloads();
      },
      pauseDownloads: (paused) => setDownloadsPaused(paused),
      exportCbz: async (seriesId, which) => {
        const series = allRef.current.find((x) => x.id === seriesId);
        if (!series) return '';
        const chapters = series.chapters.filter((c) => which === 'all' || which.includes(c.id));
        setBusy(true);
        try {
          const res = await exportSeries(series, chapters, setStatus);
          setStatus('');
          if (!res.count) return 'No chapters on the phone to save yet. Download them first.';
          return `Saved ${res.count} .cbz ${res.count === 1 ? 'file' : 'files'} to Files › On My iPhone › ReelVault › ${res.folder}${res.skipped ? `. ${res.skipped} not on the phone were left out.` : '.'}`;
        } finally {
          setBusy(false);
        }
      },
      shareCbz: async (seriesId, chapterId) => {
        const series = allRef.current.find((x) => x.id === seriesId);
        const c = series?.chapters.find((x) => x.id === chapterId);
        if (!series || !c) return;
        const dir = new Directory(Paths.cache, 'share-cbz');
        try {
          const f = await writeCbz(series, c, dir);
          await Share.share({ url: f.uri });
        } catch (e) {
          Alert.alert(`Could not save ${chapterLabel(c, true)}`, String(e).replace(/^Error:\s*/, ''));
        } finally {
          try {
            if (dir.exists) dir.delete();
          } catch {
            // cleared later
          }
        }
      },
      importBackup: async () => {
        const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
        if (picked.canceled || !picked.assets?.[0]) return;
        const file = new File(picked.assets[0].uri);
        setBusy(true);
        setStatus('Reading the backup…');
        try {
          const summary = await importTachiBackup(await file.bytes(), prefsRef.current, setStatus);
          await refresh();
          const parts = [`Added ${summary.titles} ${summary.titles === 1 ? 'title' : 'titles'} with ${summary.chapters} chapters`];
          if (summary.added) parts.push(`${summary.added} new ${summary.added === 1 ? 'chapter' : 'chapters'} on titles you had`);
          if (summary.skipped) parts.push(`${summary.skipped} already here`);
          if (summary.linked) parts.push(`${summary.linked} linked to a source`);
          setStatus(parts.join(' · '));
          const missing = summary.unlinked
            ? `\n\n${summary.unlinked} ${summary.unlinked === 1 ? 'title was' : 'titles were'} not found on MangaDex or your extensions (from ${summary.sources.filter((x) => !/mangadex/i.test(x)).join(', ') || 'other sources'}). Their read marks are kept. Open one and tap Find on a source, or add an extension or your Suwayomi server in Browse, then tap Find backup titles.`
            : '';
          if (summary.linked) {
            Alert.alert('Your Tachimanga library is here', `${summary.linked} ${summary.linked === 1 ? 'title is' : 'titles are'} ready to download.${missing}`, [
              { text: 'Later', style: 'cancel' },
              {
                text: 'Download everything',
                onPress: () => {
                  actionsRef.current
                    ?.downloadLibrary()
                    .then((n) => setStatus(n ? `Downloading ${n} chapters (Manga menu > Downloads)` : 'Nothing new to download'))
                    .catch((e) => Alert.alert('Downloads did not start', String(e).replace(/^Error:\s*/, '')));
                },
              },
            ]);
          } else if (missing) {
            Alert.alert('Some titles need a source', missing.trim());
          }
        } catch (e) {
          setStatus('');
          Alert.alert('Could not read the backup', String(e).replace(/^Error:\s*/, ''));
        } finally {
          setBusy(false);
          try {
            if (file.exists) file.delete();
          } catch {
            // a picker copy
          }
        }
      },
      linkSeries: async (seriesId, sourceId, key) => {
        const src = cachedSource(sourceId) ?? (await sourceFor(sourceId, prefsRef.current));
        if (!src) throw new Error('That source is not set up on this phone');
        const res = await linkSeries(seriesId, src, key);
        await refresh();
        return res;
      },
      autoLink: async () => {
        const ids = allRef.current.filter((x) => !x.deletedAt && tachiSourceOf(x.sourceId)).map((x) => x.id);
        setBusy(true);
        try {
          const n = await autoLink(ids, prefsRef.current, setStatus);
          await refresh();
          setStatus(ids.length ? `Linked ${n} of ${ids.length} backup ${ids.length === 1 ? 'title' : 'titles'}` : 'Every title is linked');
          return n;
        } finally {
          setBusy(false);
        }
      },
      loadReads: allReads,
      storageBytes: async () => {
        if (ReelVaultMedia && mangaRoot?.exists) return ReelVaultMedia.dirSize(mangaRoot.uri).catch(() => 0);
        return allRef.current.reduce((a, s) => a + dirBytes(s.folder), 0);
      },
    }),
    [refresh, run, loadDownloads, refreshOne] // eslint-disable-line react-hooks/exhaustive-deps
  );
  actionsRef.current = actions;

  const browseActions = useMemo<BrowseActions>(
    () => ({
      groups: (again) => loadSources(prefsRef.current, again),
      source: cachedSource,
      setLanguages: async (codes) => {
        const next = { ...prefsRef.current, languages: codes.length ? codes : ['en'] };
        await saveBrowsePrefs(next);
        setPrefs(next);
      },
      setAdult: async (on) => {
        const next = { ...prefsRef.current, adult: on };
        await saveBrowsePrefs(next);
        setPrefs(next);
      },
      setOption: async (key, on) => {
        const next = { ...prefsRef.current, [key]: on };
        await saveBrowsePrefs(next);
        setPrefs(next);
        if (key === 'wifiOnly' && !on) kickDownloads();
      },
      setParallel: async (n) => {
        const next = { ...prefsRef.current, parallel: n };
        await saveBrowsePrefs(next);
        setPrefs(next);
      },
      setReader: async (patch) => {
        const next = { ...prefsRef.current, reader: { ...prefsRef.current.reader, ...patch } };
        setPrefs(next);
        await saveBrowsePrefs(next);
      },
      addServer: async (input) => setPrefs(await addServer(prefsRef.current, input)),
      removeServer: async (id) => setPrefs(await removeServer(prefsRef.current, id)),
      addRepo: async (url) => setPrefs(await addRepo(prefsRef.current, url)),
      refreshRepos: async () => {
        const { prefs: next, failed } = await refreshRepos(prefsRef.current);
        setPrefs(next);
        return failed;
      },
      removeRepo: async (url) => setPrefs(await removeRepo(prefsRef.current, url)),
      install: async (repoUrl, ext) => setPrefs(await installExtension(prefsRef.current, repoUrl, ext)),
      uninstall: async (id) => setPrefs(await uninstallExtension(prefsRef.current, id)),
      addToLibrary: async (sourceId, details, chapters) => {
        const id = await addFromSource(sourceId, details, chapters);
        await refresh();
        return id;
      },
      openUrl: (url) => {
        Linking.openURL(url).catch(() => undefined);
      },
    }),
    [refresh, setPrefs]
  );

  const items = useMemo(() => all.filter((s) => !s.deletedAt).map(asUi), [all]);
  const deleted = useMemo(() => all.filter((s) => s.deletedAt).map(asUi), [all]);
  const browse = useMemo(() => ({ prefs, actions: browseActions, canTellWifi }), [prefs, browseActions]);
  const ani = useAniList(all, refresh);
  return { items, deleted, busy, status, actions, browse, downloads, anilist: ani };
}

/** A new cover (a small copy), the old one removed. `move` for a picker's temporary copy. */
/** A page as a file on the phone: itself when downloaded, else fetched into the cache (temp = ours to move or delete). */
async function localPage(img: { uri: string; headers?: Record<string, string> }): Promise<{ file: File; temp: boolean }> {
  if (img.uri.startsWith('file:')) return { file: new File(img.uri), temp: false };
  const ext = /\.(png|webp|gif|jpe?g)(?:[?#]|$)/i.exec(img.uri)?.[1]?.toLowerCase() ?? 'jpg';
  const target = new File(Paths.cache, `page-${Date.now()}.${ext}`);
  const file = await File.downloadFileAsync(img.uri.replace(/#.*$/, ''), target, { headers: img.headers, idempotent: true });
  return { file, temp: true };
}

async function setCover(s: MangaSeries, from: File, move: boolean): Promise<void> {
  const name = `cover-${Date.now()}.jpg`;
  const dest = fileIn(s.folder, name);
  if (!dest.parentDirectory.exists) dest.parentDirectory.create({ intermediates: true });
  if (move) await from.move(dest);
  else await from.copy(dest);
  if (ReelVaultMedia) await ReelVaultMedia.shrinkImage(dest.uri, 600, 0.8).catch(() => -1);
  if (s.cover && /^cover-\d+\.jpg$/.test(s.cover)) {
    try {
      const old = fileIn(s.folder, s.cover);
      if (old.exists) old.delete();
    } catch {
      // ignore
    }
  }
  await updateSeries([s.id], { cover: name });
}
