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
import { chapterFolderFor, dirOf, fileIn, removeDir } from './mangaFiles';
import { pageFileName } from './mangaLogic';
import { pagesOf } from './mangaSources';
import { failDownload, finishDownload, getSeries, listDownloads, setChapterFiles, type DownloadRow } from './mangaStore';
import type { BrowsePrefs } from './sources/prefs';

/** Space kept free on the phone. */
const RESERVE = 400 * 1024 * 1024;

export type DownloadProgress = { chapterId: string; seriesId: string; done: number; total: number } | null;

type Listener = () => void;

const listeners = new Set<Listener>();
let getPrefs: () => BrowsePrefs = () => {
  throw new Error('downloads not started');
};
let onChapterDone: (seriesId: string) => void = () => undefined;
let running = false;
let paused = false;
let current: DownloadProgress = null;
let lastEmit = 0;
/** The chapter being downloaded was cancelled or deleted: stop it. */
let dropped: string | null = null;

const emit = (force = false) => {
  const now = Date.now();
  if (!force && now - lastEmit < 400) return;
  lastEmit = now;
  for (const l of listeners) l();
};

export function subscribeDownloads(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const downloadProgress = () => current;
export const downloadsPaused = () => paused;

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

async function withRetry<T>(job: () => Promise<T>, times = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await job();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
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
  const pages = await withRetry(() => pagesOf(series, chapter, prefs));
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
        });
        check();
        if (prefs.smallerPages && ReelVaultMedia) await ReelVaultMedia.shrinkImage(dest.uri, 1800, 0.82).catch(() => -1);
        size += dest.size ?? 0;
        names[i] = name;
        done++;
        current = { chapterId: chapter.id, seriesId: series.id, done, total: pages.length };
        emit();
      }
    };
    const results = await Promise.allSettled([worker(), worker(), worker()]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (stop || failed) {
      removeDir(folder);
      throw stop ?? failed!.reason;
    }
  }
  // Cancelled while the last pages came in: keep nothing.
  if (!(await listDownloads()).some((r) => r.chapterId === chapter.id)) {
    removeDir(folder);
    return;
  }
  await setChapterFiles(chapter.id, folder, names, size);
  await finishDownload(chapter.id);
  onChapterDone(series.id);
}

/** Works through the queue until it is empty (or paused). */
export function kickDownloads(): void {
  if (running || paused) return;
  running = true;
  (async () => {
    try {
      for (;;) {
        if (paused) break;
        const next = (await listDownloads()).find((r) => r.state === 'queued');
        if (!next) break;
        try {
          await downloadOne(next);
        } catch (e) {
          const msg = String(e).replace(/^Error:\s*/, '');
          if (msg === 'Paused') break;
          // Cancelled or deleted: its row is already gone.
          if (msg === 'Cancelled') continue;
          console.log(`[MANGA] download ${next.chapterId} failed: ${msg}`);
          await failDownload(next.chapterId, msg);
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
    }
  })();
}
