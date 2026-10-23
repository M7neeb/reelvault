/**
 * The Manga section's data (native wiring): loads the library, adds files
 * and folders, keeps Recently Deleted, saves where you are, and gives the
 * screens everything as plain data and functions (see ui/manga/mangaTypes.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';

import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import { getSetting } from '../library';
import type { MangaData, MangaUiSeries } from '../ui/manga/mangaTypes';
import { dirBytes, fileIn, fileUri, mangaRoot, removeDir } from './mangaFiles';
import { importMangaFiles, importMangaFolder, type MangaImportSummary, type PickedMangaFile } from './mangaImport';
import type { MangaSeries } from './mangaLogic';
import {
  addMangaTag,
  addRead,
  allSeriesFolders,
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
const PICKER_TYPES = ['public.zip-archive', 'com.pkware.zip-archive', 'application/zip', 'application/x-cbz', 'application/vnd.comicbook+zip', 'application/x-cbr', 'application/pdf', 'image/*', '*/*'];

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

  const refresh = useCallback(async () => {
    try {
      setAll(await listManga());
    } catch (e) {
      console.log(`[MANGA] load failed: ${String(e)}`);
    }
  }, []);

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
    })();
  }, [refresh]);

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
        await trashSeries(ids, Date.now());
        await refresh();
      },
      restore: async (ids) => {
        await restoreSeries(ids);
        await refresh();
      },
      purge: async (ids) => {
        for (const id of ids) {
          const s = byId(id);
          if (s) removeDir(s.folder);
        }
        await deleteSeriesRows(ids);
        await refresh();
      },
      deleteChapters: async (seriesId, chapterIds) => {
        const s = byId(seriesId);
        for (const c of s?.chapters ?? []) if (chapterIds.includes(c.id) && c.folder) removeDir(c.folder);
        await deleteChapterRows(chapterIds);
        await refresh();
      },
      setRead: async (chapterIds, read) => {
        await setChaptersRead(chapterIds, read, Date.now());
        await refresh();
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
      },
      saveProgress: async (seriesId, chapterId, page, finished) => {
        const at = Date.now();
        await saveProgress(seriesId, chapterId, page, finished, at);
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
      },
      addRead,
      pageUris: (chapter) => (chapter.folder ? chapter.pages.map((p) => fileUri(chapter.folder!, p)) : []),
      setCoverFromPhoto: async (seriesId) => {
        const s = byId(seriesId);
        if (!s) return;
        const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
        if (picked.canceled || !picked.assets?.[0]) return;
        await setCover(s, new File(picked.assets[0].uri), true);
        await refresh();
      },
      setCoverFromPage: async (seriesId, chapter, page) => {
        const s = byId(seriesId);
        const name = chapter.pages[page];
        if (!s || !chapter.folder || !name) return;
        await setCover(s, fileIn(chapter.folder, name), false);
        await refresh();
      },
      storageBytes: async () => {
        if (ReelVaultMedia && mangaRoot?.exists) return ReelVaultMedia.dirSize(mangaRoot.uri).catch(() => 0);
        return allRef.current.reduce((a, s) => a + dirBytes(s.folder), 0);
      },
    }),
    [refresh, run]
  );

  const items = useMemo(() => all.filter((s) => !s.deletedAt).map(asUi), [all]);
  const deleted = useMemo(() => all.filter((s) => s.deletedAt).map(asUi), [all]);
  return { items, deleted, busy, status, actions };
}

/** A new cover (a small copy), the old one removed. `move` for a picker's temporary copy. */
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
