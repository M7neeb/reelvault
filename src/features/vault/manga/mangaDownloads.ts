/**
 * Downloading chapters from their source onto the phone, a chapter at a
 * time (three pages at once). The queue is in the database, so it carries on
 * after the app closes; iOS stops apps in the background, so downloads run
 * while ReelVault is open and pick up again when you come back. Each page is
 * tried three times; a chapter that still fails waits under "Failed" with
 * the reason. With "smaller pages" on, each page is saved as a lighter JPEG.
 */

import { File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';

import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import { ReelVaultWifi } from '../../../../modules/reelvault-wifi';
import { chapterFolderFor, dirOf, fileIn, removeDir } from './mangaFiles';
import { pageFileName } from './mangaLogic';
import { pagesOf } from './mangaSources';
import { failDownload, finishDownload, getSeries, isQueued, listDownloads, nextDownload, setChapterFiles, type DownloadRow } from './mangaStore';
import type { BrowsePrefs } from './sources/prefs';

/** Space kept free on the phone. */
const RESERVE = 400 * 1024 * 1024;

export type DownloadProgress = { chapterId: string; seriesId: string; done: number; total: number } | null;

/** `progress`: only the page count of the chapter downloading moved (the queue is the same). */
type Listener = (progress: boolean) => void;

const listeners = new Set<Listener>();
let getPrefs: () => BrowsePrefs = () => {
  throw new Error('downloads not started');
};
let onChapterDone: (seriesId: string) => void = () => undefined;
let running = false;
/** Asked to start while the last run was finishing: start again once it has. */
let again = false;
let paused = false;
let current: DownloadProgress = null;
let lastEmit = 0;
/** The chapter being downloaded was cancelled or deleted: stop it. */
let dropped: string | null = null;

/** The queue changed (or something about it): listeners read it again. */
const emit = (_force = true) => {
  lastEmit = Date.now();
  for (const l of listeners) l(false);
};
/** Only the page count moved: at most once a second, and nobody has to read the queue for it. */
const emitProgress = () => {
  const now = Date.now();
  if (now - lastEmit < 1000) return;
  lastEmit = now;
  for (const l of listeners) l(true);
};

export function subscribeDownloads(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const downloadProgress = () => current;
export const downloadsPaused = () => paused;

/** "Wi-Fi only" is on and the phone is not on Wi-Fi: the queue waits. (Before build 17 the phone cannot tell, so it never waits.) */
export function waitingForWifi(): boolean {
  let prefs: BrowsePrefs;
  try {
    prefs = getPrefs();
  } catch {
    return false;
  }
  if (!prefs.wifiOnly || typeof ReelVaultWifi?.onWifi !== 'function') return false;
  try {
    return !ReelVaultWifi.onWifi();
  } catch {
    return false;
  }
}

/** Whether this app build can tell Wi-Fi from mobile data. */
export const canTellWifi = typeof ReelVaultWifi?.onWifi === 'function';

/** Starts the runner (once, at app start). */
export function startDownloads(prefs: () => BrowsePrefs, chapterDone: (seriesId: string) => void): void {
  getPrefs = prefs;
  onChapterDone = chapterDone;
  AppState.addEventListener('change', (s) => {
    if (s === 'active') kickDownloads();
  });
  kickDownloads();
}

/**
 * Cancelled, deleted or moved to Recently Deleted: if one of these chapters
 * is downloading right now, it stops and leaves nothing behind.
 */
export function forgetDownloads(chapterIds: string[] | null): void {
  if (current && (chapterIds === null || chapterIds.includes(current.chapterId))) dropped = current.chapterId;
}

export function setDownloadsPaused(p: boolean): void {
  paused = p;
  emit(true);
  if (!p) kickDownloads();
}

const extOf = (uri: string) => {
  const m = uri.split('?')[0].match(/\.(jpe?g|png|webp|gif|avif)$/i);
  return m ? `p.${m[1].toLowerCase()}` : 'p.jpg';
};

/** Errors trying again cannot fix (the server lacks the extension, the site blocks the phone, …). */
const PERMANENT = /not installed on the server|behind Cloudflare|does not have this chapter|no longer has this chapter|not set up on this phone|Link it first|is not linked/i;

async function withRetry<T>(job: () => Promise<T>, times = 3, wait = 800): Promise<T> {
  let last: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await job();
    } catch (e) {
      last = e;
      // Paused or cancelled: no point trying again.
      if (/^(Error: )?(Paused|Cancelled)$/.test(String(e)) || PERMANENT.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, wait * (i + 1)));
    }
  }
  throw last;
}

async function downloadOne(row: DownloadRow): Promise<void> {
  const series = await getSeries(row.seriesId);
  const chapter = series?.chapters.find((c) => c.id === row.chapterId);
  // Gone, or in Recently Deleted: nothing to download.
  if (!series || !chapter || series.deletedAt) {
    await finishDownload(row.chapterId);
    return;
  }
  if (chapter.folder && chapter.pages.length) {
    await finishDownload(row.chapterId);
    return;
  }
  const prefs = getPrefs();
  const tries = prefs.patient ? 6 : 3;
  const wait = prefs.patient ? 2500 : 800;
  const pages = await withRetry(() => pagesOf(series, chapter, prefs), tries, wait);
  if (!pages.length) throw new Error('The source gave no pages for this chapter');
  let free = Infinity;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    // unknown
  }
  if (free < RESERVE) throw new Error('The iPhone is almost full. Free some space, then tap Retry.');

  const folder = chapterFolderFor(series.id, chapter.id);
  removeDir(folder);
  dirOf(folder).create({ intermediates: true });
  const names: string[] = new Array(pages.length);
  let size = 0;
  let done = 0;
  current = { chapterId: chapter.id, seriesId: series.id, done: 0, total: pages.length };
  dropped = null;
  emit(true);
  // The first problem stops all three workers before the folder is cleared,
  // so none of them writes a page into a folder that is already gone.
  let stop: Error | null = null;
  const check = () => {
    if (!stop && paused) stop = new Error('Paused');
    if (!stop && dropped === chapter.id) stop = new Error('Cancelled');
    if (stop) throw stop;
  };
  {
    let next = 0;
    const worker = async () => {
      try {
        await pull();
      } catch (e) {
        // The first page that fails for good stops the other workers too.
        stop ??= e instanceof Error ? e : new Error(String(e));
        throw e;
      }
    };
    const pull = async () => {
      while (next < pages.length) {
        check();
        const i = next++;
        const p = pages[i];
        const name = pageFileName(i, extOf(p.uri));
        const dest = fileIn(folder, name);
        await withRetry(async () => {
          check();
          if (dest.exists) dest.delete();
          await File.downloadFileAsync(p.uri, dest, { headers: p.headers ?? {} });
        }, tries, wait);
        check();
        if (prefs.smallerPages && ReelVaultMedia) await ReelVaultMedia.shrinkImage(dest.uri, 1800, 0.82).catch(() => -1);
        size += dest.size ?? 0;
        names[i] = name;
        done++;
        current = { chapterId: chapter.id, seriesId: series.id, done, total: pages.length };
        emitProgress();
      }
    };
    const results = await Promise.allSettled(Array.from({ length: prefs.parallel ?? 3 }, () => worker()));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (stop || failed) {
      removeDir(folder);
      throw stop ?? failed!.reason;
    }
  }
  // Cancelled while the last pages came in: keep nothing.
  if (!(await isQueued(chapter.id))) {
    removeDir(folder);
    return;
  }
  await setChapterFiles(chapter.id, folder, names, size);
  await finishDownload(chapter.id);
  onChapterDone(series.id);
}

/** Works through the queue until it is empty (or paused). */
export function kickDownloads(): void {
  if (paused) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  again = false;
  (async () => {
    try {
      for (;;) {
        if (paused) break;
        if (waitingForWifi()) {
          emit(true);
          break;
        }
        const next = await nextDownload();
        if (!next) break;
        try {
          await downloadOne(next);
        } catch (e) {
          const msg = String(e).replace(/^Error:\s*/, '');
          if (msg === 'Paused') {
            // Already carried on again: keep going instead of stopping.
            if (!paused) continue;
            break;
          }
          // Cancelled or deleted: its row is already gone.
          if (msg === 'Cancelled') continue;
          console.log(`[MANGA] download ${next.chapterId} failed: ${msg}`);
          await failDownload(next.chapterId, msg);
          // The same will happen to the rest of that title: say so now instead of trying each one.
          if (PERMANENT.test(msg)) {
            for (const r of await listDownloads()) if (r.state === 'queued' && r.seriesId === next.seriesId) await failDownload(r.chapterId, msg);
          }
        }
        current = null;
        emit(true);
      }
    } catch (e) {
      console.log(`[MANGA] downloads stopped: ${String(e)}`);
    } finally {
      running = false;
      current = null;
      emit(true);
      // Carry on tapped right after Pause (or something queued as the run ended): go again.
      if (again && !paused) {
        again = false;
        kickDownloads();
      }
    }
  })();
}
