/**
 * Adding manga and comics: .cbz / .zip archives (a .cbr that is really a ZIP
 * too), folders of pictures, single pictures, and PDFs (pages rendered to
 * pictures once, on app builds that have the PDF reader).
 *
 * Each archive is read a piece at a time (no unzipping into memory) and its
 * pages are written once into the chapter's folder; nothing is unpacked
 * again while you read. A chapter joins the series you already have with the
 * same title (ComicInfo.xml's, or the one in the file name), so adding
 * chapter 13 later puts it after 12. A chapter you already have is skipped.
 */

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import { openSink, openSource } from '../audio/audioFiles';
import { extractEntry, readEntryText, readZipIndex, safeEntryPath, type ZipEntry } from '../audio/zip';
import { contentKeyOf } from '../contentKey';
import { chapterFolderFor, dirOf, ensureMangaRoot, fileIn, removeDir, seriesFolderFor } from './mangaFiles';
import {
  archiveKindOf,
  naturalCompare,
  normTitle,
  pageFileName,
  pageOrder,
  parseChapterName,
  parseComicInfo,
  planChapters,
  sameChapter,
  type ComicInfo,
  type MangaChapter,
  type PlannedChapter,
} from './mangaLogic';
import { addMangaTag, chapterByKey, getSeries, insertChapter, insertSeries, seriesTitles, setChapterKey, updateSeries } from './mangaStore';

/** A picked file (from Files, "Open in", Wi-Fi). `rel` is its path inside a picked folder. */
export type PickedMangaFile = { uri: string; name: string; size?: number; rel?: string };

export type MangaImportSummary = { chapters: number; newSeries: number; duplicates: string[]; failed: { name: string; reason: string }[]; seriesIds: string[] };

/** Space kept free on the phone, whatever is added. */
const RESERVE = 300 * 1024 * 1024;

const pause = () => new Promise<void>((r) => setTimeout(r, 0));

/** Where a unit's pages come from: entries in an archive, or files in a folder. */
type PageSource = {
  name: string;
  entries: string[];
  bytes: number;
  info: ComicInfo | null;
  /** Writes one entry's bytes to `dest`. */
  copy: (entry: string, dest: File) => Promise<void>;
  close: () => void;
  /** The archive itself (for "already in your library"). */
  keyUri: string | null;
  fallbackSeries: string | null;
};

async function zipSource(file: PickedMangaFile): Promise<PageSource> {
  const f = new File(file.uri);
  const src = openSource(f);
  let entries: ZipEntry[];
  try {
    entries = readZipIndex(src).filter((e) => !e.isDir);
  } catch (e) {
    src.close();
    const msg = String(e);
    if (/not a zip/i.test(msg) && /\.cbr$|\.rar$/i.test(file.name)) throw new Error('This .cbr is packed with RAR, which ReelVault cannot open yet. Most comic tools can save it as .cbz.');
    if (/not a zip/i.test(msg)) throw new Error('This file is not a ZIP archive (.cbz)');
    throw e;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const infoEntry = entries.find((e) => /(^|\/)comicinfo\.xml$/i.test(e.name));
  let info: ComicInfo | null = null;
  if (infoEntry && infoEntry.size < 2_000_000) {
    try {
      info = parseComicInfo(await readEntryText(src, infoEntry));
    } catch {
      info = null;
    }
  }
  return {
    name: file.name,
    entries: entries.map((e) => e.name).filter((n) => safeEntryPath(n)),
    bytes: entries.reduce((a, e) => a + e.size, 0),
    info,
    copy: async (entry, dest) => {
      const e = byName.get(entry);
      if (!e) throw new Error(`${entry} is missing`);
      const sink = openSink(dest);
      try {
        await extractEntry(src, e, (b) => sink.write(b));
      } finally {
        sink.close();
      }
    },
    close: () => src.close(),
    keyUri: file.uri,
    fallbackSeries: null,
  };
}

/** Pictures in a folder (and its sub-folders), each with its path inside it. */
function folderSource(name: string, files: PickedMangaFile[], fallbackSeries: string | null): PageSource {
  const byRel = new Map(files.map((f) => [f.rel ?? f.name, f]));
  const infoFile = files.find((f) => /(^|\/)comicinfo\.xml$/i.test(f.rel ?? f.name));
  let info: ComicInfo | null = null;
  if (infoFile) {
    try {
      info = parseComicInfo(new File(infoFile.uri).textSync());
    } catch {
      info = null;
    }
  }
  return {
    name,
    entries: [...byRel.keys()],
    bytes: files.reduce((a, f) => a + (f.size ?? 0), 0),
    info,
    copy: async (entry, dest) => {
      const f = byRel.get(entry);
      if (!f) throw new Error(`${entry} is missing`);
      if (dest.exists) dest.delete();
      await new File(f.uri).copy(dest);
      await pause();
    },
    close: () => undefined,
    keyUri: null,
    fallbackSeries,
  };
}

type SeriesCache = Map<string, string>;

/** The series a chapter belongs to: one you have (same title), or a new one. */
async function seriesFor(title: string, info: ComicInfo | null, cache: SeriesCache, summary: MangaImportSummary, now: number): Promise<string> {
  const key = normTitle(title) || title;
  const hit = cache.get(key);
  if (hit) return hit;
  const existing = (await seriesTitles()).find((s) => normTitle(s.title) === key || (s.altTitle && normTitle(s.altTitle) === key));
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const id = Crypto.randomUUID();
  const kind = info ? (info.isManga ? 'manga' : 'comic') : null;
  await insertSeries({
    id,
    folder: seriesFolderFor(id),
    title,
    altTitle: null,
    author: info?.writer ?? null,
    artist: info?.artist ?? null,
    description: info?.summary ?? null,
    kind,
    pubStatus: null,
    status: null,
    rating: 0,
    notes: null,
    cover: null,
    isPrivate: false,
    readingMode: null,
    sourceId: null,
    sourceKey: null,
    sourceUrl: info?.web ?? null,
    createdAt: now,
    importedAt: now,
    lastReadAt: null,
    finishedAt: null,
    deletedAt: null,
  });
  for (const g of info?.genres ?? []) await addMangaTag(id, g);
  cache.set(key, id);
  summary.newSeries++;
  summary.seriesIds.push(id);
  return id;
}

/** The series' cover from a page, made small. Only when it has none. */
async function coverFrom(seriesId: string, page: File): Promise<void> {
  const s = await getSeries(seriesId);
  if (!s || s.cover) return;
  const name = `cover-${Date.now()}.jpg`;
  const dest = fileIn(s.folder, name);
  if (!dest.parentDirectory.exists) dest.parentDirectory.create({ intermediates: true });
  await page.copy(dest);
  if (ReelVaultMedia) await ReelVaultMedia.shrinkImage(dest.uri, 600, 0.8).catch(() => -1);
  await updateSeries([seriesId], { cover: name });
}

async function addChapter(
  src: PageSource,
  plan: PlannedChapter,
  key: string | null,
  cache: SeriesCache,
  summary: MangaImportSummary,
  onStep?: (t: string) => void
): Promise<void> {
  const now = Date.now();
  const seriesId = await seriesFor(plan.series, src.info, cache, summary, now);
  const series = await getSeries(seriesId);
  const label = `${plan.series}${plan.number !== null ? ` ${plan.number}` : ''}`;
  if (series?.chapters.some((c) => sameChapter(c, { number: plan.number, volume: plan.volume, filename: plan.filename }))) {
    summary.duplicates.push(label);
    return;
  }
  const id = Crypto.randomUUID();
  const folder = chapterFolderFor(seriesId, id);
  const dir = dirOf(folder);
  if (!dir.exists) dir.create({ intermediates: true });
  const pages: string[] = [];
  let size = 0;
  try {
    for (const [i, entry] of plan.pages.entries()) {
      const name = pageFileName(i, entry);
      const dest = fileIn(folder, name);
      await src.copy(entry, dest);
      size += dest.size ?? 0;
      pages.push(name);
      if (i % 5 === 0) onStep?.(`Adding ${label}… page ${i + 1} of ${plan.pages.length}`);
    }
  } catch (e) {
    removeDir(folder);
    throw e;
  }
  const chapter: MangaChapter = {
    id,
    seriesId,
    folder,
    number: plan.number,
    volume: plan.volume,
    title: plan.title,
    filename: plan.filename,
    pages,
    pageCount: pages.length,
    size,
    contentKey: key,
    sourceKey: null,
    sourceUrl: null,
    scanlator: src.info?.scanlator ?? null,
    uploadedAt: null,
    addedAt: now,
    readAt: null,
    lastPage: 0,
    downloaded: true,
    position: series?.chapters.length ?? 0,
  };
  await insertChapter(chapter);
  if (pages[0]) await coverFrom(seriesId, fileIn(folder, pages[0])).catch((e) => console.log(`[MANGA] cover: ${String(e)}`));
  summary.chapters++;
  if (!summary.seriesIds.includes(seriesId)) summary.seriesIds.push(seriesId);
}

async function importSource(src: PageSource, summary: MangaImportSummary, cache: SeriesCache, onStep?: (t: string) => void): Promise<void> {
  let free = Infinity;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    // unknown
  }
  if (src.bytes + RESERVE > free) throw new Error(`Not enough space: it needs ${Math.ceil(src.bytes / 1e6)} MB`);
  const plans = planChapters(src.entries, src.name, src.info, src.fallbackSeries);
  if (!plans.length) throw new Error('No pictures inside');
  // A single-chapter archive you added before (the very same file) is skipped whatever its name.
  const key = plans.length === 1 && src.keyUri ? await contentKeyOf(src.keyUri) : null;
  if (key && (await chapterByKey(key))) {
    summary.duplicates.push(src.name);
    return;
  }
  for (const plan of plans) await addChapter(src, plan, key, cache, summary, onStep);
}

/** A PDF's pages as pictures, written by the native reader (app builds from 1.11 on). */
async function importPdf(file: PickedMangaFile, summary: MangaImportSummary, cache: SeriesCache, onStep?: (t: string) => void): Promise<void> {
  const media = ReelVaultMedia;
  if (!media?.pdfPages) throw new Error('PDFs open after the next app update (a new install from SideStore). CBZ and folders of pictures work now.');
  const key = await contentKeyOf(file.uri);
  if (key && (await chapterByKey(key))) {
    summary.duplicates.push(file.name);
    return;
  }
  const tmp = new Directory(Paths.cache, `pdf-${Crypto.randomUUID()}`);
  tmp.create({ intermediates: true });
  try {
    onStep?.(`Reading ${file.name}…`);
    const count = await media.pdfPages(file.uri, tmp.uri, 2000, 0.85);
    if (count <= 0) throw new Error('This PDF has no pages ReelVault can read');
    const pages = tmp
      .list()
      .filter((x): x is File => x instanceof File)
      .map((f) => ({ uri: f.uri, name: f.name, size: f.size ?? 0, rel: f.name }));
    const parsed = parseChapterName(file.name);
    const src = folderSource(file.name, pages, parsed.series);
    await importSource({ ...src, keyUri: null }, summary, cache, onStep);
    // The key goes on the chapter so the same PDF is caught next time.
    if (key) {
      const added = summary.seriesIds.length ? await getSeries(summary.seriesIds[summary.seriesIds.length - 1]) : null;
      const ch = added?.chapters.find((c) => c.filename === file.name && !c.contentKey);
      if (ch) await setChapterKey(ch.id, key);
    }
  } finally {
    try {
      tmp.delete();
    } catch {
      // the clean-up at start removes it
    }
  }
}

/**
 * Imports picked files: each archive or PDF on its own, loose pictures
 * together as one chapter. `keepOriginals` for files in a folder you picked
 * (copied, never moved); picker copies are deleted afterwards.
 */
export async function importMangaFiles(picked: PickedMangaFile[], { keepOriginals, onStep }: { keepOriginals: boolean; onStep?: (t: string) => void }): Promise<MangaImportSummary> {
  ensureMangaRoot();
  const summary: MangaImportSummary = { chapters: 0, newSeries: 0, duplicates: [], failed: [], seriesIds: [] };
  const cache: SeriesCache = new Map();
  const images = picked.filter((f) => archiveKindOf(f.name) === 'image');
  const others = picked.filter((f) => archiveKindOf(f.name) !== 'image');
  for (const [n, f] of others.entries()) {
    onStep?.(others.length > 1 ? `Adding ${n + 1} of ${others.length}: ${f.name}` : `Adding ${f.name}…`);
    const kind = archiveKindOf(f.name);
    let src: PageSource | null = null;
    try {
      if (kind === 'pdf') await importPdf(f, summary, cache, onStep);
      else if (kind === 'zip') {
        src = await zipSource(f);
        await importSource(src, summary, cache, onStep);
      } else summary.failed.push({ name: f.name, reason: 'Not a comic file (CBZ, ZIP, PDF or pictures)' });
    } catch (e) {
      console.log(`[MANGA] ${f.name} failed: ${String(e)}`);
      summary.failed.push({ name: f.name, reason: String(e).replace(/^Error:\s*/, '') });
    } finally {
      src?.close();
      if (!keepOriginals) {
        try {
          const file = new File(f.uri);
          if (file.exists) file.delete();
        } catch {
          // a temporary copy; the system clears it
        }
      }
    }
  }
  if (images.length) {
    try {
      const sorted = [...images].sort((a, b) => naturalCompare(a.name, b.name));
      await importSource(folderSource(parseChapterName(sorted[0].name).series ?? 'Pictures', sorted, null), summary, cache, onStep);
    } catch (e) {
      summary.failed.push({ name: `${images.length} pictures`, reason: String(e).replace(/^Error:\s*/, '') });
    }
  }
  return summary;
}

/**
 * A picked folder: archives inside are added one by one; pictures make
 * chapters by sub-folder. The folder's name is the series when nothing else
 * names it ("One Piece/Chapter 1/001.jpg").
 */
export async function importMangaFolder(folderName: string, files: PickedMangaFile[], onStep?: (t: string) => void): Promise<MangaImportSummary> {
  ensureMangaRoot();
  const archives = files.filter((f) => {
    const k = archiveKindOf(f.name);
    return k === 'zip' || k === 'pdf';
  });
  const pics = files.filter((f) => archiveKindOf(f.name) === 'image');
  const info = files.filter((f) => /(^|\/)comicinfo\.xml$/i.test(f.rel ?? f.name));
  const summary = await importMangaFiles(archives, { keepOriginals: true, onStep });
  if (pics.length) {
    const cache: SeriesCache = new Map();
    try {
      // One chapter per sub-folder; pictures right in the folder make one chapter.
      const src = folderSource(folderName, [...pics, ...info], folderName);
      if (pageOrder(src.entries).length) await importSource(src, summary, cache, onStep);
    } catch (e) {
      summary.failed.push({ name: folderName, reason: String(e).replace(/^Error:\s*/, '') });
    }
  }
  return summary;
}
