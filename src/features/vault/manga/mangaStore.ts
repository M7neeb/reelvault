/**
 * The Manga section's database (schema v12): series, chapters, keywords and
 * reading sessions. The pages themselves are files (see mangaFiles.ts).
 */

import { getDb } from '@/db';

import { sortChapters, type MangaChapter, type MangaKind, type MangaRead, type MangaSeries, type MangaStatus, type ReadingMode } from './mangaLogic';

type SeriesRow = {
  id: string;
  folder: string;
  title: string;
  alt_title: string | null;
  author: string | null;
  artist: string | null;
  description: string | null;
  kind: string | null;
  pub_status: string | null;
  status: string | null;
  rating: number;
  notes: string | null;
  cover: string | null;
  is_private: number;
  reading_mode: string | null;
  source_id: string | null;
  source_key: string | null;
  source_url: string | null;
  created_at: number;
  imported_at: number;
  last_read_at: number | null;
  finished_at: number | null;
  deleted_at: number | null;
};

type ChapterRow = {
  id: string;
  series_id: string;
  folder: string | null;
  number: number | null;
  volume: number | null;
  title: string | null;
  filename: string | null;
  pages_json: string;
  page_count: number;
  size: number;
  content_key: string | null;
  source_key: string | null;
  source_url: string | null;
  scanlator: string | null;
  uploaded_at: number | null;
  added_at: number;
  read_at: number | null;
  last_page: number;
  downloaded: number;
  position: number;
};

const STATUSES = new Set(['reading', 'planned', 'completed', 'onHold', 'dropped']);
const KINDS = new Set(['manga', 'manhwa', 'comic']);
const MODES = new Set(['rtl', 'ltr', 'vertical', 'webtoon']);

function pagesOf(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toChapter(r: ChapterRow): MangaChapter {
  return {
    id: r.id,
    seriesId: r.series_id,
    folder: r.folder,
    number: r.number,
    volume: r.volume,
    title: r.title,
    filename: r.filename,
    pages: pagesOf(r.pages_json),
    pageCount: r.page_count,
    size: r.size,
    contentKey: r.content_key,
    sourceKey: r.source_key,
    sourceUrl: r.source_url,
    scanlator: r.scanlator,
    uploadedAt: r.uploaded_at,
    addedAt: r.added_at,
    readAt: r.read_at,
    lastPage: r.last_page,
    downloaded: r.downloaded === 1,
    position: r.position,
  };
}

function toSeries(r: SeriesRow, tags: string[], chapters: MangaChapter[]): MangaSeries {
  return {
    id: r.id,
    folder: r.folder,
    title: r.title,
    altTitle: r.alt_title,
    author: r.author,
    artist: r.artist,
    description: r.description,
    kind: r.kind && KINDS.has(r.kind) ? (r.kind as MangaKind) : null,
    pubStatus: r.pub_status,
    status: r.status && STATUSES.has(r.status) ? (r.status as MangaStatus) : null,
    rating: r.rating,
    notes: r.notes,
    cover: r.cover,
    isPrivate: r.is_private === 1,
    readingMode: r.reading_mode && MODES.has(r.reading_mode) ? (r.reading_mode as ReadingMode) : null,
    sourceId: r.source_id,
    sourceKey: r.source_key,
    sourceUrl: r.source_url,
    createdAt: r.created_at,
    importedAt: r.imported_at,
    lastReadAt: r.last_read_at,
    finishedAt: r.finished_at,
    deletedAt: r.deleted_at,
    tags,
    chapters: sortChapters(chapters),
  };
}

/** Every series with its chapters and keywords, Recently Deleted included (the UI splits them). */
export async function listManga(): Promise<MangaSeries[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SeriesRow>('SELECT * FROM manga_series ORDER BY imported_at DESC;');
  const chRows = await db.getAllAsync<ChapterRow>('SELECT * FROM manga_chapters;');
  const tagRows = await db.getAllAsync<{ series_id: string; name: string }>('SELECT series_id, name FROM manga_tags ORDER BY name COLLATE NOCASE;');
  const chapters = new Map<string, MangaChapter[]>();
  for (const c of chRows) chapters.set(c.series_id, [...(chapters.get(c.series_id) ?? []), toChapter(c)]);
  const tags = new Map<string, string[]>();
  for (const t of tagRows) tags.set(t.series_id, [...(tags.get(t.series_id) ?? []), t.name]);
  return rows.map((r) => toSeries(r, tags.get(r.id) ?? [], chapters.get(r.id) ?? []));
}

export async function getSeries(id: string): Promise<MangaSeries | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<SeriesRow>('SELECT * FROM manga_series WHERE id = ?;', [id]);
  if (!r) return null;
  const ch = await db.getAllAsync<ChapterRow>('SELECT * FROM manga_chapters WHERE series_id = ?;', [id]);
  const tags = await db.getAllAsync<{ name: string }>('SELECT name FROM manga_tags WHERE series_id = ?;', [id]);
  return toSeries(r, tags.map((t) => t.name), ch.map(toChapter));
}

/** Series not in Recently Deleted, without chapters (for matching a new chapter to its series). */
export async function seriesTitles(): Promise<{ id: string; title: string; altTitle: string | null }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; title: string; alt_title: string | null }>('SELECT id, title, alt_title FROM manga_series WHERE deleted_at IS NULL;');
  return rows.map((r) => ({ id: r.id, title: r.title, altTitle: r.alt_title }));
}

export async function chapterByKey(key: string): Promise<{ id: string; seriesId: string } | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ id: string; series_id: string }>(
    `SELECT c.id, c.series_id FROM manga_chapters c JOIN manga_series s ON s.id = c.series_id WHERE c.content_key = ? AND s.deleted_at IS NULL LIMIT 1;`,
    [key]
  );
  return r ? { id: r.id, seriesId: r.series_id } : null;
}

export type NewSeries = Omit<MangaSeries, 'tags' | 'chapters'>;

export async function insertSeries(s: NewSeries): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO manga_series (id, folder, title, alt_title, author, artist, description, kind, pub_status, status, rating, notes, cover, is_private, reading_mode,
       source_id, source_key, source_url, created_at, imported_at, last_read_at, finished_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      s.id, s.folder, s.title, s.altTitle, s.author, s.artist, s.description, s.kind, s.pubStatus, s.status, s.rating, s.notes, s.cover, s.isPrivate ? 1 : 0, s.readingMode,
      s.sourceId, s.sourceKey, s.sourceUrl, s.createdAt, s.importedAt, s.lastReadAt, s.finishedAt, s.deletedAt,
    ]
  );
}

export async function insertChapter(c: MangaChapter): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO manga_chapters (id, series_id, folder, number, volume, title, filename, pages_json, page_count, size, content_key, source_key, source_url, scanlator,
       uploaded_at, added_at, read_at, last_page, downloaded, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      c.id, c.seriesId, c.folder, c.number, c.volume, c.title, c.filename, JSON.stringify(c.pages), c.pageCount, c.size, c.contentKey, c.sourceKey, c.sourceUrl, c.scanlator,
      c.uploadedAt, c.addedAt, c.readAt, c.lastPage, c.downloaded ? 1 : 0, c.position,
    ]
  );
}

/** The fields you can change on a series. */
export type SeriesPatch = Partial<
  Pick<MangaSeries, 'title' | 'altTitle' | 'author' | 'artist' | 'description' | 'kind' | 'pubStatus' | 'status' | 'rating' | 'notes' | 'cover' | 'isPrivate' | 'readingMode' | 'finishedAt' | 'lastReadAt'>
>;

const COLUMN: Record<keyof SeriesPatch, string> = {
  title: 'title', altTitle: 'alt_title', author: 'author', artist: 'artist', description: 'description', kind: 'kind', pubStatus: 'pub_status', status: 'status',
  rating: 'rating', notes: 'notes', cover: 'cover', isPrivate: 'is_private', readingMode: 'reading_mode', finishedAt: 'finished_at', lastReadAt: 'last_read_at',
};

export async function updateSeries(ids: string[], patch: SeriesPatch): Promise<void> {
  const keys = Object.keys(patch) as (keyof SeriesPatch)[];
  if (!keys.length || !ids.length) return;
  const db = await getDb();
  const values = keys.map((k) => {
    const v = patch[k];
    if (k === 'isPrivate') return v ? 1 : 0;
    return (v ?? null) as string | number | null;
  });
  const set = keys.map((k) => `${COLUMN[k]} = ?`).join(', ');
  for (const id of ids) await db.runAsync(`UPDATE manga_series SET ${set} WHERE id = ?;`, [...values, id]);
}

/** Read or unread, by hand. Read keeps the page you were on at the end. */
export async function setChaptersRead(ids: string[], read: boolean, at: number): Promise<void> {
  const db = await getDb();
  for (const id of ids) {
    if (read) await db.runAsync('UPDATE manga_chapters SET read_at = COALESCE(read_at, ?) WHERE id = ?;', [at, id]);
    else await db.runAsync('UPDATE manga_chapters SET read_at = NULL, last_page = 0 WHERE id = ?;', [id]);
  }
}

/**
 * Where you are in a chapter: saved while reading. Reaching the last page
 * marks it read. The series becomes "Reading" if it had no status or was
 * planned (never Completed by itself: that is yours to set).
 */
export async function saveProgress(seriesId: string, chapterId: string, page: number, finished: boolean, at: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE manga_chapters SET last_page = ?, read_at = CASE WHEN ? = 1 THEN COALESCE(read_at, ?) ELSE read_at END WHERE id = ?;`,
    [Math.max(0, Math.round(page)), finished ? 1 : 0, at, chapterId]
  );
  await db.runAsync(
    `UPDATE manga_series SET last_read_at = ?, status = CASE WHEN status IS NULL OR status = 'planned' THEN 'reading' ELSE status END WHERE id = ?;`,
    [at, seriesId]
  );
}

export async function trashSeries(ids: string[], at: number): Promise<void> {
  const db = await getDb();
  for (const id of ids) await db.runAsync('UPDATE manga_series SET deleted_at = ? WHERE id = ?;', [at, id]);
}

export async function restoreSeries(ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) await db.runAsync('UPDATE manga_series SET deleted_at = NULL WHERE id = ?;', [id]);
}

/** The rows only; the caller removes the folders. */
export async function deleteSeriesRows(ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) {
    await db.runAsync('DELETE FROM manga_chapters WHERE series_id = ?;', [id]);
    await db.runAsync('DELETE FROM manga_tags WHERE series_id = ?;', [id]);
    await db.runAsync('DELETE FROM manga_reads WHERE series_id = ?;', [id]);
    await db.runAsync('DELETE FROM manga_downloads WHERE series_id = ?;', [id]);
    await db.runAsync('DELETE FROM manga_series WHERE id = ?;', [id]);
  }
}

/** A chapter's pages are now on the phone (downloaded). */
export async function setChapterFiles(id: string, folder: string, pages: string[], size: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE manga_chapters SET folder = ?, pages_json = ?, page_count = ?, size = ?, downloaded = 1 WHERE id = ?;', [folder, JSON.stringify(pages), pages.length, size, id]);
}

/** A downloaded chapter's pages are gone again (it stays, readable online). */
export async function clearChapterFiles(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE manga_chapters SET folder = NULL, pages_json = '[]', size = 0, downloaded = 0 WHERE id = ?;", [id]);
}

/** Links a chapter to its place on a source (after importing a backup, or linking a series by hand). */
export async function setChapterSource(id: string, key: string, externalUrl: string | null, pageCount: number | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE manga_chapters SET source_key = ?, source_url = ?, page_count = CASE WHEN ? > 0 THEN ? ELSE page_count END WHERE id = ?;', [key, externalUrl, pageCount ?? 0, pageCount ?? 0, id]);
}

export async function setSeriesSource(id: string, sourceId: string | null, sourceKey: string | null, sourceUrl: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE manga_series SET source_id = ?, source_key = ?, source_url = COALESCE(?, source_url) WHERE id = ?;', [sourceId, sourceKey, sourceUrl, id]);
}

/* ------------------------------------------------------------ downloads */

/** `held`: on hold, waits in the list but is not downloaded until you let it. */
export type DownloadRow = { chapterId: string; seriesId: string; state: 'queued' | 'failed' | 'held'; error: string | null; attempts: number; addedAt: number };

export async function queueDownloads(rows: { chapterId: string; seriesId: string }[], at: number): Promise<void> {
  const db = await getDb();
  for (const [i, r] of rows.entries()) {
    await db.runAsync(
      "INSERT INTO manga_downloads (chapter_id, series_id, state, added_at) VALUES (?, ?, 'queued', ?) ON CONFLICT(chapter_id) DO UPDATE SET state = 'queued', error = NULL;",
      [r.chapterId, r.seriesId, at + i]
    );
  }
}

export async function listDownloads(): Promise<DownloadRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ chapter_id: string; series_id: string; state: string; error: string | null; attempts: number; added_at: number }>('SELECT * FROM manga_downloads ORDER BY added_at;');
  return rows.map((r) => ({ chapterId: r.chapter_id, seriesId: r.series_id, state: r.state === 'failed' || r.state === 'held' ? r.state : 'queued', error: r.error, attempts: r.attempts, addedAt: r.added_at }));
}

/** The first waiting download (one row, not the whole queue). */
export async function nextDownload(): Promise<DownloadRow | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ chapter_id: string; series_id: string; error: string | null; attempts: number; added_at: number }>("SELECT * FROM manga_downloads WHERE state = 'queued' ORDER BY added_at LIMIT 1;");
  return r ? { chapterId: r.chapter_id, seriesId: r.series_id, state: 'queued', error: r.error, attempts: r.attempts, addedAt: r.added_at } : null;
}

/** The chapter is still in the queue (not cancelled). */
export async function isQueued(chapterId: string): Promise<boolean> {
  const db = await getDb();
  return !!(await db.getFirstAsync('SELECT 1 FROM manga_downloads WHERE chapter_id = ?;', [chapterId]));
}

export async function finishDownload(chapterId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM manga_downloads WHERE chapter_id = ?;', [chapterId]);
}

export async function failDownload(chapterId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE manga_downloads SET state = 'failed', error = ?, attempts = attempts + 1 WHERE chapter_id = ?;", [error.slice(0, 300), chapterId]);
}

export async function cancelDownloads(chapterIds: string[] | null): Promise<void> {
  const db = await getDb();
  if (!chapterIds) await db.runAsync('DELETE FROM manga_downloads;');
  else for (const id of chapterIds) await db.runAsync('DELETE FROM manga_downloads WHERE chapter_id = ?;', [id]);
}

/** Puts the waiting downloads in this order (the ones not named keep their place after them). */
export async function orderDownloads(chapterIds: string[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [i, id] of chapterIds.entries()) await db.runAsync('UPDATE manga_downloads SET added_at = ? WHERE chapter_id = ?;', [i + 1, id]);
  });
}

/** Puts waiting downloads on hold (`true`) or lets them download again (`false`). */
export async function holdDownloads(chapterIds: string[], hold: boolean): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of chapterIds) await db.runAsync(hold ? "UPDATE manga_downloads SET state = 'held' WHERE chapter_id = ? AND state = 'queued';" : "UPDATE manga_downloads SET state = 'queued' WHERE chapter_id = ? AND state = 'held';", [id]);
  });
}

export async function retryDownloads(): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE manga_downloads SET state = 'queued', error = NULL WHERE state = 'failed';");
}

export async function setChapterKey(id: string, key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE manga_chapters SET content_key = ? WHERE id = ?;', [key, id]);
}

export async function deleteChapterRows(ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) {
    await db.runAsync('DELETE FROM manga_chapters WHERE id = ?;', [id]);
    await db.runAsync('DELETE FROM manga_downloads WHERE chapter_id = ?;', [id]);
  }
}

export async function expiredSeries(now: number, days: number): Promise<{ id: string; folder: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; folder: string }>('SELECT id, folder FROM manga_series WHERE deleted_at IS NOT NULL AND deleted_at < ?;', [now - days * 86_400_000]);
}

export async function allSeriesFolders(): Promise<string[]> {
  const db = await getDb();
  return (await db.getAllAsync<{ folder: string }>('SELECT folder FROM manga_series;')).map((r) => r.folder);
}

/* -------------------------------------------------------------- keywords */

export async function addMangaTag(id: string, name: string): Promise<void> {
  const n = name.trim().replace(/^#/, '');
  if (!n) return;
  const db = await getDb();
  await db.runAsync('INSERT OR IGNORE INTO manga_tags (series_id, name) VALUES (?, ?);', [id, n]);
}

export async function removeMangaTag(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM manga_tags WHERE series_id = ? AND name = ?;', [id, name]);
}

/* --------------------------------------------------------------- reading */

export async function addRead(r: MangaRead): Promise<void> {
  if (r.readMs < 3000) return;
  const db = await getDb();
  await db.runAsync('INSERT INTO manga_reads (series_id, chapter_id, started_at, read_ms, pages) VALUES (?, ?, ?, ?, ?);', [r.seriesId, r.chapterId, r.startedAt, Math.round(r.readMs), r.pages]);
}

export async function allReads(): Promise<MangaRead[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ series_id: string; chapter_id: string | null; started_at: number; read_ms: number; pages: number }>('SELECT * FROM manga_reads ORDER BY started_at;');
  return rows.map((r) => ({ seriesId: r.series_id, chapterId: r.chapter_id, startedAt: r.started_at, readMs: r.read_ms, pages: r.pages }));
}
