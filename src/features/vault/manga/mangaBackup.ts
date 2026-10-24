/**
 * Tachimanga / Tachiyomi / Mihon backups (.tmb, .tachibk, .proto.gz): read
 * and turned into a plan for your library. Pure (tested in tests/manga-backup.test.mjs).
 *
 * Tachimanga's own .tmb is a ZIP holding meta.json and contents.zip, and
 * contents.zip holds its database (tachimanga.db, SQLite). The caller opens
 * the database and hands its rows to `tachiFromTachimanga`.
 *
 * The file is a gzipped protocol-buffers message (the layout of Mihon's
 * backup models). Kept: every title in the library with its people, summary,
 * genres, status, cover address and categories (as keywords); its chapters
 * with read marks, the page you stopped on and dates; your tracker score and
 * status. Titles from MangaDex link to the built-in MangaDex source at once;
 * the rest can be linked to a source (your Suwayomi server finds most of
 * them by itself, since it runs the same extensions).
 */

import { gunzipSync, strFromU8 } from 'fflate';

import { normTitle, type MangaStatus } from './mangaLogic.ts';
import { readZipIndex, readEntry } from '../audio/zip.ts';

/* ------------------------------------------------- protocol buffers, by hand */

type Raw = { n: number; wt: number; int?: bigint; bytes?: Uint8Array; f32?: number };

function readVarint(b: Uint8Array, at: number): [bigint, number] {
  let v = 0n;
  let shift = 0n;
  for (let i = at; i < b.length && i < at + 10; i++) {
    v |= BigInt(b[i] & 0x7f) << shift;
    shift += 7n;
    if (!(b[i] & 0x80)) return [v, i + 1];
  }
  throw new Error('The backup is damaged (a number runs off the end)');
}

/** The fields of one message, in order. */
export function protoFields(b: Uint8Array): Raw[] {
  const out: Raw[] = [];
  let i = 0;
  while (i < b.length) {
    const [key, next] = readVarint(b, i);
    i = next;
    const n = Number(key >> 3n);
    const wt = Number(key & 7n);
    if (wt === 0) {
      const [v, j] = readVarint(b, i);
      out.push({ n, wt, int: v });
      i = j;
    } else if (wt === 2) {
      const [len, j] = readVarint(b, i);
      const end = j + Number(len);
      if (end > b.length) throw new Error('The backup is damaged (a part runs off the end)');
      out.push({ n, wt, bytes: b.subarray(j, end) });
      i = end;
    } else if (wt === 5) {
      out.push({ n, wt, f32: new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, true) });
      i += 4;
    } else if (wt === 1) {
      out.push({ n, wt, int: new DataView(b.buffer, b.byteOffset + i, 8).getBigUint64(0, true) });
      i += 8;
    } else throw new Error(`The backup is damaged (unknown field type ${wt})`);
  }
  return out;
}

const text = (f: Raw[], n: number) => {
  const x = f.find((r) => r.n === n && r.bytes);
  return x?.bytes ? strFromU8(x.bytes) : '';
};
const texts = (f: Raw[], n: number) => f.filter((r) => r.n === n && r.bytes).map((r) => strFromU8(r.bytes!));
const int = (f: Raw[], n: number, fallback = 0) => {
  const x = f.find((r) => r.n === n && r.int !== undefined);
  return x ? Number(BigInt.asIntN(64, x.int!)) : fallback;
};
/** An int64 kept exact (source ids are larger than JavaScript numbers hold). */
const bigText = (f: Raw[], n: number) => {
  const x = f.find((r) => r.n === n && r.int !== undefined);
  return x ? BigInt.asIntN(64, x.int!).toString() : '0';
};
const float = (f: Raw[], n: number) => f.find((r) => r.n === n && r.f32 !== undefined)?.f32 ?? 0;
const bool = (f: Raw[], n: number, fallback: boolean) => {
  const x = f.find((r) => r.n === n && r.int !== undefined);
  return x ? x.int !== 0n : fallback;
};
const msgs = (f: Raw[], n: number) => f.filter((r) => r.n === n && r.bytes).map((r) => protoFields(r.bytes!));
/** Repeated numbers, written one by one or packed together. */
const ints = (f: Raw[], n: number) => {
  const out: number[] = [];
  for (const r of f.filter((x) => x.n === n)) {
    if (r.int !== undefined) out.push(Number(BigInt.asIntN(64, r.int)));
    else if (r.bytes) {
      let i = 0;
      while (i < r.bytes.length) {
        const [v, j] = readVarint(r.bytes, i);
        out.push(Number(BigInt.asIntN(64, v)));
        i = j;
      }
    }
  }
  return out;
};

/* ------------------------------------------------------------ the backup */

export type TachiChapter = { url: string; name: string; scanlator: string | null; read: boolean; bookmark: boolean; lastPageRead: number; dateFetch: number; dateUpload: number; number: number; sourceOrder: number };
/** syncId 2 = AniList (mediaId is its id), 1 = MyAnimeList, 3 = Kitsu, 7 = MangaUpdates. */
export type TachiTracking = { syncId: number; mediaId: number; title: string; lastChapterRead: number; score: number; status: number; started: number; finished: number };
export type TachiManga = {
  source: string;
  url: string;
  title: string;
  artist: string | null;
  author: string | null;
  description: string | null;
  genres: string[];
  status: number;
  thumbnailUrl: string | null;
  dateAdded: number;
  chapters: TachiChapter[];
  categories: number[];
  tracking: TachiTracking[];
  favorite: boolean;
  history: { url: string; lastRead: number; readDuration: number }[];
  notes: string | null;
};
export type TachiBackup = { mangas: TachiManga[]; categories: { name: string; order: number; id: number }[]; sources: { name: string; id: string }[] };

const orNull = (s: string) => (s.trim() ? s : null);

export function decodeTachiBackup(proto: Uint8Array): TachiBackup {
  const top = protoFields(proto);
  const mangas = msgs(top, 1).map(
    (m): TachiManga => ({
      source: bigText(m, 1),
      url: text(m, 2),
      title: text(m, 3),
      artist: orNull(text(m, 4)),
      author: orNull(text(m, 5)),
      description: orNull(text(m, 6)),
      genres: texts(m, 7).flatMap((g) => g.split(',')).map((g) => g.trim()).filter(Boolean),
      status: int(m, 8),
      thumbnailUrl: orNull(text(m, 9)),
      dateAdded: int(m, 13),
      chapters: msgs(m, 16).map((c) => ({
        url: text(c, 1),
        name: text(c, 2),
        scanlator: orNull(text(c, 3)),
        read: bool(c, 4, false),
        bookmark: bool(c, 5, false),
        lastPageRead: int(c, 6),
        dateFetch: int(c, 7),
        dateUpload: int(c, 8),
        number: float(c, 9),
        sourceOrder: int(c, 10),
      })),
      categories: ints(m, 17),
      tracking: msgs(m, 18).map((t) => ({ syncId: int(t, 1), mediaId: int(t, 100) || int(t, 3), title: text(t, 5), lastChapterRead: float(t, 6), score: float(t, 8), status: int(t, 9), started: int(t, 10), finished: int(t, 11) })),
      favorite: bool(m, 100, true),
      history: msgs(m, 104).map((h) => ({ url: text(h, 1), lastRead: int(h, 2), readDuration: int(h, 3) })),
      notes: orNull(text(m, 110)),
    })
  );
  const categories = msgs(top, 2).map((c) => ({ name: text(c, 1), order: int(c, 2), id: int(c, 3) }));
  const sources = msgs(top, 101).map((s) => ({ name: text(s, 1), id: bigText(s, 2) }));
  return { mangas, categories, sources };
}

/* ------------------------------------------------- Tachimanga (.tmb) */

type Row = Record<string, unknown>;
/** The tables of tachimanga.db that matter, as rows. */
export type TmbRows = { manga: Row[]; chapters: Row[]; categories: Row[]; categoryManga: Row[]; history: Row[]; sources: Row[]; tracks: Row[] };

/** The SQL that fills TmbRows (source ids as text: they are bigger than JavaScript numbers hold). */
export const TMB_QUERIES: Record<keyof TmbRows, string> = {
  manga: 'SELECT id, url, real_url, title, artist, author, description, genre, status, thumbnail_url, in_library, in_library_at, CAST("source" AS TEXT) AS source FROM Manga',
  chapters: 'SELECT * FROM Chapter',
  categories: 'SELECT id, "name", "order" FROM Category ORDER BY "order", id',
  categoryManga: 'SELECT category, manga FROM CategoryManga',
  history: 'SELECT manga_id, last_chapter_id, last_read_at FROM History',
  sources: 'SELECT CAST(id AS TEXT) AS id, "name" FROM "Source"',
  tracks: 'SELECT * FROM TrackRecord',
};

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const n = (v: unknown) => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
/** Tachimanga keeps some times in seconds and some in milliseconds: always milliseconds. */
const ms = (v: unknown) => {
  const x = n(v);
  return x > 0 && x < 100_000_000_000 ? x * 1000 : x;
};

/** The inner database of a Tachimanga .tmb, or null when the ZIP is something else. */
export async function tachimangaDb(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  const src = { size: bytes.length, read: (o: number, len: number) => bytes.subarray(o, o + len) };
  const outer = readZipIndex(src);
  const contents = outer.find((e) => /(^|\/)contents\.zip$/i.test(e.name));
  const direct = outer.find((e) => /tachimanga\.db$/i.test(e.name));
  if (direct) return readEntry(src, direct);
  if (!contents) return null;
  const innerBytes = await readEntry(src, contents);
  const inner = { size: innerBytes.length, read: (o: number, len: number) => innerBytes.subarray(o, o + len) };
  const db = readZipIndex(inner).find((e) => /\.db$/i.test(e.name));
  if (!db) throw new Error('This Tachimanga backup has no library inside (tachimanga.db is missing)');
  return readEntry(inner, db);
}

/** Tachimanga's database rows, in the same shape as a Tachiyomi backup. */
export function tachiFromTachimanga(r: TmbRows): TachiBackup {
  // Titles point at a category by its id here; the plan matches by order, so each gets its place (and no id).
  const categories = r.categories.map((c, i) => ({ name: s(c.name), order: i, id: 0 }));
  const orderOf = new Map(r.categories.map((c, i) => [n(c.id), i]));
  const byManga = <T>(rows: Row[], key: string, map: (row: Row) => T) => {
    const m = new Map<number, T[]>();
    for (const row of rows) {
      const id = n(row[key]);
      m.set(id, [...(m.get(id) ?? []), map(row)]);
    }
    return m;
  };
  const chapterUrl = new Map<number, string>();
  for (const c of r.chapters) chapterUrl.set(n(c.id), s(c.real_url) || s(c.url));
  const lastRead = new Map<number, number>();
  for (const h of r.history) lastRead.set(n(h.last_chapter_id), ms(h.last_read_at));
  const chapters = byManga(r.chapters, 'manga', (c): TachiChapter => {
    const num = c.chapter_number == null ? -1 : n(c.chapter_number);
    return {
      url: s(c.real_url) || s(c.url),
      name: s(c.name),
      scanlator: c.scanlator == null || s(c.scanlator) === '' ? null : s(c.scanlator),
      read: n(c.read) !== 0,
      bookmark: n(c.bookmark) !== 0,
      lastPageRead: n(c.last_page_read),
      dateFetch: ms(c.last_read_at) || lastRead.get(n(c.id)) || ms(c.fetched_at),
      dateUpload: ms(c.date_upload),
      number: num,
      sourceOrder: n(c.source_order),
    };
  });
  const cats = byManga(r.categoryManga, 'manga', (x) => orderOf.get(n(x.category)) ?? -1);
  const history = byManga(r.history, 'manga_id', (h) => ({ url: chapterUrl.get(n(h.last_chapter_id)) ?? '', lastRead: ms(h.last_read_at), readDuration: 0 }));
  const tracks = byManga(r.tracks, 'manga_id', (t): TachiTracking => ({
    syncId: n(t.sync_id),
    mediaId: n(t.remote_id),
    title: s(t.title),
    lastChapterRead: n(t.last_chapter_read),
    score: n(t.score),
    status: n(t.status),
    started: ms(t.start_date),
    finished: ms(t.finish_date),
  }));
  // Read chapters carry when they were last opened (Tachimanga keeps it on the chapter).
  const mangas = r.manga.map((m): TachiManga => {
    const id = n(m.id);
    const chs = chapters.get(id) ?? [];
    return {
      source: s(m.source) || '0',
      url: s(m.real_url) || s(m.url),
      title: s(m.title),
      artist: orNull(s(m.artist)),
      author: orNull(s(m.author)),
      description: orNull(s(m.description)),
      genres: s(m.genre)
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      status: n(m.status),
      thumbnailUrl: orNull(s(m.thumbnail_url)),
      dateAdded: ms(m.in_library_at),
      chapters: chs,
      categories: cats.get(id) ?? [],
      tracking: tracks.get(id) ?? [],
      favorite: n(m.in_library) !== 0,
      history: [...(history.get(id) ?? []), ...chs.filter((c) => c.read && c.dateFetch).map((c) => ({ url: c.url, lastRead: c.dateFetch, readDuration: 0 }))],
      notes: null,
    };
  });
  return { mangas, categories, sources: r.sources.map((x) => ({ name: s(x.name), id: s(x.id) })) };
}

/**
 * The backup file as picked: Tachimanga's .tmb (its database is opened by
 * `openTmb`), gzip, plain, or a ZIP with a Tachiyomi backup inside.
 */
export async function readTachiBackup(bytes: Uint8Array, openTmb?: (db: Uint8Array) => Promise<TmbRows>): Promise<TachiBackup> {
  let data = bytes;
  const tmb = await tachimangaDb(bytes);
  if (tmb) {
    if (!openTmb) throw new Error('Tachimanga backups open in the app, not here');
    const backup = tachiFromTachimanga(await openTmb(tmb));
    if (!backup.mangas.some((m) => m.favorite)) throw new Error('This Tachimanga backup has no titles in your library');
    return backup;
  }
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const src = { size: data.length, read: (o: number, len: number) => data.subarray(o, o + len) };
    const entry = readZipIndex(src).find((e) => /\.(tachibk|proto\.gz|proto)$/i.test(e.name) || /backup/i.test(e.name));
    if (!entry) throw new Error('This ZIP is not a Tachimanga or Tachiyomi backup');
    data = await readEntry(src, entry);
  }
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data);
  if (data[0] === 0x7b) throw new Error('This is an old JSON backup. Make a new backup in Tachimanga (Settings › Backup) and pick that file.');
  let backup: TachiBackup;
  try {
    backup = decodeTachiBackup(data);
  } catch {
    throw new Error('This file is not a Tachimanga or Tachiyomi backup ReelVault can read');
  }
  if (!backup.mangas.length && !backup.categories.length) throw new Error('This backup has no titles in it');
  return backup;
}

/* ------------------------------------------------------------- the plan */

export type PlannedTitle = {
  title: string;
  author: string | null;
  artist: string | null;
  description: string | null;
  genres: string[];
  /** Keywords from your categories. */
  categories: string[];
  pubStatus: string | null;
  status: MangaStatus;
  rating: number;
  notes: string | null;
  cover: string | null;
  addedAt: number;
  /** "mangadex" when it maps to the built-in source, else "tachi:<id>:<source name>". */
  sourceId: string;
  sourceKey: string;
  sourceName: string;
  /** Its AniList id, when it was tracked there. */
  anilistId: number | null;
  chapters: { key: string; name: string; number: number | null; scanlator: string | null; readAt: number | null; lastPage: number; uploadedAt: number | null }[];
};

const PUB: Record<number, string> = { 1: 'ongoing', 2: 'completed', 3: 'licensed', 4: 'completed', 5: 'cancelled', 6: 'hiatus' };
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Tracker status (MyAnimeList, AniList, Kitsu...) as a ReelVault status. */
function trackedStatus(t: TachiTracking): MangaStatus | null {
  const mal = t.syncId === 1;
  switch (t.status) {
    case 1:
      return 'reading';
    case 2:
      return 'completed';
    case 3:
      return 'onHold';
    case 4:
      return 'dropped';
    case 5:
      return mal ? null : 'planned';
    case 6:
      return mal ? 'planned' : 'reading';
    default:
      return null;
  }
}

export function planTachiImport(b: TachiBackup, now: number): PlannedTitle[] {
  const sourceName = new Map(b.sources.map((s) => [s.id, s.name]));
  const out: PlannedTitle[] = [];
  for (const m of b.mangas) {
    if (!m.favorite || !m.title.trim()) continue;
    const name = sourceName.get(m.source) ?? 'Unknown source';
    const history = new Map(m.history.map((h) => [h.url, h.lastRead]));
    // Sources list chapters newest first: the highest sourceOrder is the first chapter.
    const chapters = [...m.chapters]
      .sort((x, y) => y.sourceOrder - x.sourceOrder || x.number - y.number)
      .map((c) => {
        const md = /mangadex/i.test(name) ? c.url.match(UUID)?.[1] : null;
        return {
          key: md ?? c.url,
          name: c.name,
          number: c.number >= 0 ? Math.round(c.number * 1000) / 1000 : null,
          scanlator: c.scanlator,
          readAt: c.read ? history.get(c.url) || c.dateFetch || now : null,
          lastPage: c.read ? 0 : Math.max(0, c.lastPageRead),
          uploadedAt: c.dateUpload || null,
        };
      });
    const readCount = chapters.filter((c) => c.readAt).length;
    const tracked = m.tracking.map(trackedStatus).find((s) => s !== null) ?? null;
    const pubStatus = PUB[m.status] ?? null;
    const status: MangaStatus = tracked ?? (readCount && readCount === chapters.length && pubStatus === 'completed' ? 'completed' : readCount || chapters.some((c) => c.lastPage > 0) ? 'reading' : 'planned');
    const score = Math.max(0, ...m.tracking.map((t) => t.score));
    const rating = score > 0 ? Math.min(10, Math.round((score > 10 ? score / 10 : score) * 10) / 10) : 0;
    const cats = b.categories.filter((c) => m.categories.includes(c.order) || (c.id && m.categories.includes(c.id))).map((c) => c.name.trim()).filter(Boolean);
    const mdKey = /mangadex/i.test(name) ? m.url.match(UUID)?.[1] : null;
    out.push({
      title: m.title.trim(),
      author: m.author,
      artist: m.artist && m.artist !== m.author ? m.artist : null,
      description: m.description,
      genres: [...new Set(m.genres)].slice(0, 12),
      categories: [...new Set(cats)],
      pubStatus,
      status,
      rating,
      notes: m.notes,
      cover: m.thumbnailUrl,
      addedAt: m.dateAdded || now,
      sourceId: mdKey ? 'mangadex' : `tachi:${m.source}:${name}`,
      sourceKey: mdKey ?? m.url,
      sourceName: name,
      anilistId: m.tracking.find((t) => t.syncId === 2 && t.mediaId > 0)?.mediaId ?? null,
      chapters,
    });
  }
  return out;
}

/** Titles of the plan you don't have yet (same title, case and punctuation aside). */
/**
 * A backup of a title you already have: whichever progress is furthest wins,
 * chapter by chapter (matched by number). Read in the backup and not here:
 * marked read. Further into a chapter there: that page. Nothing you read is
 * ever unmarked.
 */
export function progressToMerge(
  local: { id: string; number: number | null; readAt: number | null; lastPage: number }[],
  backup: { number: number | null; readAt: number | null; lastPage: number }[]
): { read: { id: string; at: number }[]; pages: { id: string; page: number }[] } {
  const byNumber = new Map<number, (typeof backup)[number]>();
  for (const c of backup) {
    if (c.number === null) continue;
    const had = byNumber.get(c.number);
    // Two copies of a chapter (scanlators): the one read, or the one further in.
    if (!had || (!had.readAt && (c.readAt || c.lastPage > had.lastPage))) byNumber.set(c.number, c);
  }
  const read: { id: string; at: number }[] = [];
  const pages: { id: string; page: number }[] = [];
  for (const c of local) {
    if (c.number === null || c.readAt) continue;
    const b = byNumber.get(c.number);
    if (!b) continue;
    if (b.readAt) read.push({ id: c.id, at: b.readAt });
    else if (b.lastPage > c.lastPage) pages.push({ id: c.id, page: b.lastPage });
  }
  return { read, pages };
}

export function newTitles(plan: PlannedTitle[], existing: string[]): PlannedTitle[] {
  const have = new Set(existing.map(normTitle));
  const seen = new Set<string>();
  return plan.filter((t) => {
    const k = normTitle(t.title);
    if (have.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** "tachi:<id>:<name>" -> the source's id and name. */
export function tachiSourceOf(sourceId: string | null): { id: string; name: string } | null {
  const m = sourceId?.match(/^tachi:(-?\d+):(.*)$/);
  return m ? { id: m[1], name: m[2] } : null;
}
