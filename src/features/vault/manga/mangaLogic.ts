/**
 * The Manga section's rules, pure (tested in tests/manga.test.mjs): what a
 * series and a chapter are, reading a chapter's number and series from its
 * file name, reading ComicInfo.xml, putting pages and chapters in order,
 * what to read next, and the library's filters and sorts.
 */

import { findFirst, parseXml, textOf } from '../audio/xml.ts';

export type MangaStatus = 'reading' | 'planned' | 'completed' | 'onHold' | 'dropped';
export type MangaKind = 'manga' | 'manhwa' | 'comic';
/** Right to left (manga), left to right (comics), pages top to bottom, or one long strip (webtoon). */
export type ReadingMode = 'rtl' | 'ltr' | 'vertical' | 'webtoon';

export const MANGA_STATUSES: { key: MangaStatus; label: string }[] = [
  { key: 'reading', label: 'Reading' },
  { key: 'planned', label: 'Plan to Read' },
  { key: 'completed', label: 'Completed' },
  { key: 'onHold', label: 'On Hold' },
  { key: 'dropped', label: 'Dropped' },
];

export const MANGA_KINDS: { key: MangaKind; label: string }[] = [
  { key: 'manga', label: 'Manga' },
  { key: 'manhwa', label: 'Manhwa / Webtoon' },
  { key: 'comic', label: 'Comic' },
];

export const READING_MODES: { key: ReadingMode; label: string; hint: string }[] = [
  { key: 'rtl', label: 'Right to left', hint: 'Manga' },
  { key: 'ltr', label: 'Left to right', hint: 'Comics' },
  { key: 'vertical', label: 'Vertical pages', hint: 'One page at a time, top to bottom' },
  { key: 'webtoon', label: 'Long strip', hint: 'Scroll down; the pages are joined into one (webtoons)' },
];

export type MangaChapter = {
  id: string;
  seriesId: string;
  /** Relative folder of its pages; null when it isn't on the phone (from a source, not downloaded). */
  folder: string | null;
  number: number | null;
  volume: number | null;
  title: string | null;
  filename: string | null;
  /** Page file names, in reading order. */
  pages: string[];
  pageCount: number;
  size: number;
  contentKey: string | null;
  sourceKey: string | null;
  sourceUrl: string | null;
  scanlator: string | null;
  uploadedAt: number | null;
  addedAt: number;
  /** When it was finished; null = unread. */
  readAt: number | null;
  /** The page you were on (0-based). */
  lastPage: number;
  downloaded: boolean;
  position: number;
};

export type MangaSeries = {
  id: string;
  folder: string;
  title: string;
  altTitle: string | null;
  author: string | null;
  artist: string | null;
  description: string | null;
  kind: MangaKind | null;
  pubStatus: string | null;
  status: MangaStatus | null;
  rating: number;
  notes: string | null;
  cover: string | null;
  isPrivate: boolean;
  readingMode: ReadingMode | null;
  sourceId: string | null;
  sourceKey: string | null;
  sourceUrl: string | null;
  createdAt: number;
  importedAt: number;
  lastReadAt: number | null;
  finishedAt: number | null;
  deletedAt: number | null;
  tags: string[];
  /** In reading order. */
  chapters: MangaChapter[];
};

export type MangaRead = { seriesId: string; chapterId: string | null; startedAt: number; readMs: number; pages: number };

/* ------------------------------------------------------------- file names */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i;

export const isImageName = (name: string) => IMAGE_EXT.test(name) && !isJunk(name);

/** Mac and Windows leftovers inside archives and folders. */
export function isJunk(path: string): boolean {
  const parts = path.split('/');
  const last = parts[parts.length - 1];
  return parts.some((p) => p === '__MACOSX' || p.startsWith('.')) || /^thumbs\.db$/i.test(last) || /^desktop\.ini$/i.test(last);
}

export type ArchiveKind = 'zip' | 'pdf' | 'image' | null;

/** What a picked file is: an archive of pages (.cbz, .zip, .cbr that is really a ZIP), a PDF, or one picture. */
export function archiveKindOf(name: string): ArchiveKind {
  const n = name.toLowerCase();
  if (/\.(cbz|zip|cbr|cb7|cbt|rar)$/.test(n)) return 'zip';
  if (n.endsWith('.pdf')) return 'pdf';
  if (isImageName(n)) return 'image';
  return null;
}

/** Sorts like a person would: "page 2" before "page 10". */
export function naturalCompare(a: string, b: string): number {
  const ax = a.toLowerCase().match(/(\d+|\D+)/g) ?? [];
  const bx = b.toLowerCase().match(/(\d+|\D+)/g) ?? [];
  for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
    const x = ax[i];
    const y = bx[i];
    if (x === y) continue;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
      if (x.length !== y.length) return x.length - y.length;
      continue;
    }
    return x < y ? -1 : 1;
  }
  return ax.length - bx.length;
}

/** The pictures of a chapter, in reading order (junk left out). */
export function pageOrder(names: string[]): string[] {
  return names.filter(isImageName).sort(naturalCompare);
}

export type ParsedName = { series: string | null; number: number | null; volume: number | null; title: string | null };

const tidy = (s: string) =>
  s
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:.,#]+|[\s\-–—:.,#]+$/g, '')
    .trim();

/**
 * Reads a chapter's series, number, volume and title from its file or folder
 * name. Copes with the usual shapes:
 * "One Piece - Chapter 12 - Title.cbz", "One Piece v03 c012.cbz",
 * "[Group] Berserk Vol.02 Ch.010.5 (2021).zip", "Batman 004 (2016).cbz",
 * "Chapter 7", "c045".
 */
export function parseChapterName(raw: string): ParsedName {
  let s = raw.replace(/\.[a-z0-9]{2,4}$/i, '');
  let volume: number | null = null;
  // A volume in brackets, "(v02)", counts; every other bracket is a group, year or quality tag.
  const vb = s.match(/[([]\s*v(?:ol(?:ume)?)?\.?\s*(\d+(?:\.\d+)?)\s*[)\]]/i);
  if (vb) volume = Number(vb[1]);
  s = s.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ').replace(/_/g, ' ');

  const vol = s.match(/(?:^|[\s\-–—._])(?:vol(?:ume)?|v)\.?\s*(\d+(?:\.\d+)?)(?=$|[\s\-–—._:,])/i);
  const ch = s.match(/(?:^|[\s\-–—._#])(?:ch(?:apter|ap)?|c|ep(?:isode)?|issue|#)\.?\s*(\d+(?:\.\d+)?)/i);
  if (vol) volume = volume ?? Number(vol[1]);
  let number: number | null = ch ? Number(ch[1]) : null;
  const markers = [vol, ch].filter((m): m is RegExpMatchArray => !!m && m.index !== undefined);
  let series: string | null = null;
  let title: string | null = null;
  if (markers.length) {
    const first = Math.min(...markers.map((m) => m.index ?? 0));
    const lastEnd = Math.max(...markers.map((m) => (m.index ?? 0) + m[0].length));
    series = tidy(s.slice(0, first)) || null;
    const rest = s.slice(lastEnd);
    // A title follows " - " or ":" after the number.
    const t = rest.match(/^\s*[-–—:]\s*(.+)$/);
    title = t ? tidy(t[1]) || null : null;
  } else {
    // "Batman 004", "Title 12 - Name": the last number standing alone is the chapter.
    const m = s.match(/^(.*?\D)?\s*(\d+(?:\.\d+)?)\s*(?:[-–—:]\s*(.*))?$/);
    if (m && m[2] && !/^(19|20)\d\d$/.test(m[2])) {
      number = Number(m[2]);
      series = m[1] ? tidy(m[1]) || null : null;
      title = m[3] ? tidy(m[3]) || null : null;
    } else series = tidy(s) || null;
  }
  return { series, number: number !== null && Number.isFinite(number) ? number : null, volume: volume !== null && Number.isFinite(volume) ? volume : null, title };
}

/** For matching a new chapter to a series you already have: case, punctuation and "The" don't matter. */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9぀-ヿ㐀-鿿가-힯]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

/* -------------------------------------------------------------- ComicInfo */

export type ComicInfo = {
  series: string | null;
  number: number | null;
  volume: number | null;
  title: string | null;
  writer: string | null;
  artist: string | null;
  summary: string | null;
  genres: string[];
  year: number | null;
  /** "YesAndRightToLeft" in the file. */
  rightToLeft: boolean;
  isManga: boolean;
  web: string | null;
  scanlator: string | null;
  pageCount: number | null;
};

/** ComicInfo.xml (the file most comic and manga tools put inside a .cbz). */
export function parseComicInfo(xml: string): ComicInfo | null {
  let root;
  try {
    root = parseXml(xml);
  } catch {
    return null;
  }
  const info = findFirst(root, 'comicinfo');
  if (!info) return null;
  const get = (name: string) => {
    const t = textOf(findFirst(info, name)).trim();
    return t || null;
  };
  const num = (name: string) => {
    const v = get(name);
    if (!v) return null;
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const manga = (get('manga') ?? '').toLowerCase();
  const list = (name: string) =>
    (get(name) ?? '')
      .split(/[,;]/)
      .map((g) => g.trim())
      .filter(Boolean);
  const writer = get('writer');
  const artist = get('penciller') ?? get('artist');
  return {
    series: get('series'),
    number: num('number'),
    volume: num('volume'),
    title: get('title'),
    writer,
    artist: artist && artist !== writer ? artist : null,
    summary: get('summary'),
    genres: [...new Set([...list('genre'), ...list('tags')])],
    year: num('year'),
    rightToLeft: manga === 'yesandrighttoleft',
    isManga: manga === 'yes' || manga === 'yesandrighttoleft',
    web: get('web'),
    scanlator: get('scanlationgroup') ?? get('translator'),
    pageCount: num('pagecount'),
  };
}

/* --------------------------------------------------------------- ordering */

/** Chapters in reading order: by number (volume breaks ties), then by name. */
export function sortChapters<T extends Pick<MangaChapter, 'number' | 'volume' | 'filename' | 'title' | 'position'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.number !== null && b.number !== null && a.number !== b.number) {
      // Numbers that restart each volume ("Vol 2 Ch 1"): the volume comes first.
      if (a.volume !== null && b.volume !== null && a.volume !== b.volume) return a.volume - b.volume;
      return a.number - b.number;
    }
    if (a.volume !== null && b.volume !== null && a.volume !== b.volume) return a.volume - b.volume;
    if (a.number !== null && b.number === null) return -1;
    if (a.number === null && b.number !== null) return 1;
    const n = naturalCompare(a.filename ?? a.title ?? '', b.filename ?? b.title ?? '');
    return n !== 0 ? n : a.position - b.position;
  });
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** "Vol. 2 · Ch. 12 - The Title", "Chapter 12", or the file name. */
export function chapterLabel(c: Pick<MangaChapter, 'number' | 'volume' | 'title' | 'filename'>, short = false): string {
  const parts: string[] = [];
  if (c.volume !== null && !short) parts.push(`Vol. ${fmtNum(c.volume)}`);
  if (c.number !== null) parts.push(c.volume !== null || short ? `Ch. ${fmtNum(c.number)}` : `Chapter ${fmtNum(c.number)}`);
  const head = parts.join(' · ');
  if (short) return head || c.title || (c.filename ?? 'Chapter').replace(/\.[a-z0-9]{2,4}$/i, '');
  if (c.title && head) return `${head} - ${c.title}`;
  return head || c.title || (c.filename ?? 'Chapter').replace(/\.[a-z0-9]{2,4}$/i, '');
}

export const isRead = (c: Pick<MangaChapter, 'readAt'>) => c.readAt !== null;
export const unreadCount = (s: Pick<MangaSeries, 'chapters'>) => s.chapters.filter((c) => !isRead(c)).length;

/** The mode a series opens in: yours, or what suits its kind. */
export function modeOf(s: Pick<MangaSeries, 'readingMode' | 'kind'>): ReadingMode {
  if (s.readingMode) return s.readingMode;
  if (s.kind === 'manhwa') return 'webtoon';
  if (s.kind === 'comic') return 'ltr';
  return 'rtl';
}

/** Where to pick up: a chapter you are part-way through, else the first unread one after the last you read. */
export function nextChapter(s: Pick<MangaSeries, 'chapters'>): MangaChapter | null {
  const list = s.chapters;
  if (!list.length) return null;
  const started = list.find((c) => !isRead(c) && c.lastPage > 0);
  if (started) return started;
  let lastRead = -1;
  list.forEach((c, i) => {
    if (isRead(c)) lastRead = i;
  });
  const after = list.slice(lastRead + 1).find((c) => !isRead(c));
  return after ?? list.find((c) => !isRead(c)) ?? null;
}

/** How far through the series (0..1), by chapters read. */
export function progressOf(s: Pick<MangaSeries, 'chapters'>): number {
  if (!s.chapters.length) return 0;
  return s.chapters.filter(isRead).length / s.chapters.length;
}

/** Series you are in the middle of, most recently read first. */
export function continueReading<T extends MangaSeries>(list: T[], max = 12): T[] {
  return list
    .filter((s) => s.lastReadAt && s.status !== 'completed' && s.status !== 'dropped' && unreadCount(s) > 0)
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
    .slice(0, max);
}

/** The chapter after this one (null at the end). */
export function chapterAfter(s: Pick<MangaSeries, 'chapters'>, id: string, step = 1): MangaChapter | null {
  const i = s.chapters.findIndex((c) => c.id === id);
  if (i < 0) return null;
  return s.chapters[i + step] ?? null;
}

/* -------------------------------------------------------- filters, sorts */

export type MangaFilter = {
  status?: MangaStatus | 'none';
  unread?: boolean;
  favourites?: boolean;
  tag?: string;
  kind?: MangaKind;
  query?: string;
};

export function matchesManga(s: MangaSeries, f: MangaFilter): boolean {
  if (f.status === 'none' ? s.status !== null : f.status && s.status !== f.status) return false;
  if (f.unread && unreadCount(s) === 0) return false;
  if (f.favourites && s.rating < 8) return false;
  if (f.kind && (s.kind ?? 'manga') !== f.kind) return false;
  if (f.tag && !s.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
  const q = f.query?.trim().toLowerCase();
  if (q) {
    const hay = [s.title, s.altTitle, s.author, s.artist, s.notes, s.description, ...s.tags].filter(Boolean).join(' \n ').toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w.replace(/^#/, '')))) return false;
  }
  return true;
}

export type MangaSort = 'recentRead' | 'recentAdded' | 'title' | 'rating' | 'unread' | 'chapters';

export const MANGA_SORTS: { key: MangaSort; label: string }[] = [
  { key: 'recentRead', label: 'Last read' },
  { key: 'recentAdded', label: 'Recently added' },
  { key: 'title', label: 'Title' },
  { key: 'rating', label: 'Your rating' },
  { key: 'unread', label: 'Most unread' },
  { key: 'chapters', label: 'Most chapters' },
];

export function sortManga<T extends MangaSeries>(list: T[], sort: MangaSort): T[] {
  const byTitle = (a: T, b: T) => naturalCompare(a.title, b.title);
  const out = [...list];
  switch (sort) {
    case 'recentRead':
      return out.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.importedAt - a.importedAt);
    case 'recentAdded':
      return out.sort((a, b) => b.importedAt - a.importedAt);
    case 'title':
      return out.sort(byTitle);
    case 'rating':
      return out.sort((a, b) => b.rating - a.rating || byTitle(a, b));
    case 'unread':
      return out.sort((a, b) => unreadCount(b) - unreadCount(a) || byTitle(a, b));
    case 'chapters':
      return out.sort((a, b) => b.chapters.length - a.chapters.length || byTitle(a, b));
  }
}

export const fmtRating = (r: number) => (Number.isInteger(r) ? String(r) : r.toFixed(1));

/* ----------------------------------------------------------------- import */

export type PlannedChapter = {
  /** Where its pages come from: entry names inside the archive, or file paths in a folder. */
  pages: string[];
  series: string;
  number: number | null;
  volume: number | null;
  title: string | null;
  filename: string;
};

/**
 * Splits an archive's (or folder's) pictures into chapters. Pictures that sit
 * in sub-folders make one chapter per sub-folder (a whole series zipped
 * together); otherwise the whole archive is one chapter. `name` is the
 * archive's own name, `fallbackSeries` what to call the series when nothing
 * else says (ComicInfo, the name).
 */
export function planChapters(entries: string[], name: string, info: ComicInfo | null, fallbackSeries?: string | null): PlannedChapter[] {
  const images = entries.filter(isImageName);
  if (!images.length) return [];
  const own = parseChapterName(name);
  const series = info?.series || own.series || fallbackSeries || tidy(name.replace(/\.[a-z0-9]{2,4}$/i, '')) || 'Untitled';
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const dirs = new Map<string, string[]>();
  for (const p of images) dirs.set(dirOf(p), [...(dirs.get(dirOf(p)) ?? []), p]);
  // One folder (or a single wrapper folder): the archive is one chapter.
  if (dirs.size === 1) {
    return [
      {
        pages: pageOrder(images),
        series,
        number: info?.number ?? own.number,
        volume: info?.volume ?? own.volume,
        title: info?.title ?? own.title,
        filename: name,
      },
    ];
  }
  return [...dirs.entries()]
    .sort((a, b) => naturalCompare(a[0], b[0]))
    .map(([dir, pages]) => {
      const parts = dir.split('/').filter(Boolean);
      const leaf = parts[parts.length - 1] || dir;
      const p = parseChapterName(leaf);
      // "One Piece/Chapter 1/001.jpg": the folder above the chapter is its series.
      const parent = parts.length >= 2 ? tidy(parts[parts.length - 2]) : '';
      return { pages: pageOrder(pages), series: info?.series || parent || series, number: p.number, volume: p.volume ?? own.volume, title: p.title, filename: leaf };
    });
}

/** Two chapters are the same chapter when they share a number and volume (or, without numbers, a name). */
export function sameChapter(a: Pick<MangaChapter, 'number' | 'volume' | 'filename'>, b: Pick<MangaChapter, 'number' | 'volume' | 'filename'>): boolean {
  if (a.number !== null && b.number !== null) return a.number === b.number && (a.volume ?? null) === (b.volume ?? null);
  if (a.number === null && b.number === null) return !!a.filename && a.filename === b.filename;
  return false;
}

/** "0001.jpg": a page's name inside a chapter folder (keeps its own extension). */
export function pageFileName(index: number, source: string): string {
  const ext = (source.match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  return `${String(index + 1).padStart(4, '0')}.${ext}`;
}

/* ----------------------------------------------------------------- export */

const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** ComicInfo.xml for a chapter saved as .cbz, so other readers know the series, number and people. */
export function comicInfoXml(s: Pick<MangaSeries, 'title' | 'author' | 'artist' | 'description' | 'tags' | 'sourceUrl' | 'kind' | 'readingMode'>, c: Pick<MangaChapter, 'number' | 'volume' | 'title' | 'scanlator' | 'pageCount' | 'uploadedAt'>): string {
  const fields: [string, string | number | null | undefined][] = [
    ['Series', s.title],
    ['Number', c.number],
    ['Volume', c.volume],
    ['Title', c.title],
    ['Writer', s.author],
    ['Penciller', s.artist],
    ['Summary', s.description],
    ['Genre', s.tags.join(', ') || null],
    ['Web', s.sourceUrl],
    ['ScanlationGroup', c.scanlator],
    ['PageCount', c.pageCount || null],
    ['Year', c.uploadedAt ? new Date(c.uploadedAt).getFullYear() : null],
    ['Manga', modeOf(s) === 'rtl' ? 'YesAndRightToLeft' : s.kind === 'comic' ? 'No' : 'Yes'],
  ];
  const body = fields
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `  <${k}>${xmlText(String(v))}</${k}>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n${body}\n</ComicInfo>\n`;
}

/** A file name that is safe on every system ("One Piece - Ch. 12.cbz"). */
export function safeFileName(s: string, max = 80): string {
  return (
    s
      .replace(/[\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .replace(/[. ]+$/, '') || 'Untitled'
  );
}

/** "One Piece - Vol. 3 Ch. 012.cbz": zero-padded so the files sort in order. */
export function cbzName(seriesTitle: string, c: Pick<MangaChapter, 'number' | 'volume' | 'title' | 'filename'>): string {
  const pad = (n: number) => (Number.isInteger(n) ? String(n).padStart(3, '0') : String(n).replace(/^(\d+)/, (d) => d.padStart(3, '0')));
  const parts = [c.volume !== null ? `Vol. ${c.volume}` : null, c.number !== null ? `Ch. ${pad(c.number)}` : safeFileName(c.title ?? c.filename ?? 'Chapter', 40)].filter(Boolean);
  return `${safeFileName(seriesTitle, 60)} - ${parts.join(' ')}.cbz`;
}

/* ---------------------------------------------------------- logged reading */

/**
 * A reading session you log by hand (read somewhere else, or on paper).
 * Today: it ends now. An earlier day: it starts at 8 pm that day, so it
 * lands on the right day in the stats. No chapter, no pages.
 */
export function loggedRead(seriesId: string, minutes: number, daysAgo: number, now: number): MangaRead {
  const ms = Math.max(1, Math.round(minutes)) * 60_000;
  if (daysAgo <= 0) return { seriesId, chapterId: null, startedAt: now - ms, readMs: ms, pages: 0 };
  const d = new Date(now);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, 20, 0, 0, 0);
  return { seriesId, chapterId: null, startedAt: day.getTime(), readMs: ms, pages: 0 };
}

/** The next `count` chapters you have not read, in reading order. */
export function nextUnread(chapters: Pick<MangaChapter, 'id' | 'readAt'>[], count: number): string[] {
  return chapters
    .filter((c) => !c.readAt)
    .slice(0, Math.max(0, count))
    .map((c) => c.id);
}

/**
 * Roughly how much the waiting downloads will take, from the chapters already
 * on the phone: the same title's average chapter when it has one, else the
 * average of everything downloaded. Null until something is downloaded.
 */
export function downloadSizeLeft(series: { id: string; chapters: Pick<MangaChapter, 'id' | 'size' | 'pageCount' | 'downloaded'>[] }[], waiting: { seriesId: string; chapterId: string }[]): number | null {
  return sizeLeftWith(chapterSizes(series), waiting);
}

type ChapterSizes = { overall: number | null; perSeries: Map<string, number> };

/** The average downloaded chapter, per title and overall (worked out once, used for many estimates). */
function chapterSizes(series: { id: string; chapters: Pick<MangaChapter, 'size' | 'downloaded'>[] }[]): ChapterSizes {
  let allBytes = 0;
  let allCount = 0;
  const perSeries = new Map<string, number>();
  for (const s of series) {
    let bytes = 0;
    let count = 0;
    for (const c of s.chapters)
      if (c.downloaded && c.size > 0) {
        bytes += c.size;
        count++;
      }
    if (count) perSeries.set(s.id, bytes / count);
    allBytes += bytes;
    allCount += count;
  }
  return { overall: allCount ? allBytes / allCount : null, perSeries };
}

function sizeLeftWith(sizes: ChapterSizes, waiting: { seriesId: string }[]): number | null {
  if (sizes.overall === null) return null;
  let left = 0;
  for (const w of waiting) left += sizes.perSeries.get(w.seriesId) ?? sizes.overall;
  return Math.round(left);
}

/** The `count` chapters to read next, from where you are (a part-read one, else after the last one read). */
export function chaptersFromHere(s: Pick<MangaSeries, 'chapters'>, count: number): string[] {
  const start = nextChapter(s);
  const from = start ? s.chapters.indexOf(start) : 0;
  return s.chapters
    .slice(Math.max(0, from))
    .filter((c) => !isRead(c))
    .slice(0, Math.max(0, count))
    .map((c) => c.id);
}

export type QueueTitle = {
  seriesId: string;
  title: string;
  /** Its waiting chapters, in queue order. */
  chapterIds: string[];
  /** Chapters the title has in all. */
  chapterCount: number;
  /** You have started it (read a chapter or part of one). */
  reading: boolean;
  /** Estimated size of its waiting chapters; null when nothing is downloaded yet. */
  bytes: number | null;
};

/** The waiting downloads, one entry per title. */
export function queueByTitle(series: MangaSeries[], waiting: { seriesId: string; chapterId: string }[]): QueueTitle[] {
  const byId = new Map(series.map((s) => [s.id, s]));
  const out = new Map<string, QueueTitle>();
  for (const w of waiting) {
    let t = out.get(w.seriesId);
    if (!t) {
      const s = byId.get(w.seriesId);
      t = {
        seriesId: w.seriesId,
        title: s?.title ?? 'A title',
        chapterIds: [],
        chapterCount: s?.chapters.length ?? 0,
        reading: !!s?.chapters.some((c) => isRead(c) || c.lastPage > 0),
        bytes: null,
      };
      out.set(w.seriesId, t);
    }
    t.chapterIds.push(w.chapterId);
  }
  const list = [...out.values()];
  const sizes = chapterSizes(series);
  for (const t of list) t.bytes = sizeLeftWith(sizes, t.chapterIds.map(() => ({ seriesId: t.seriesId })));
  return list;
}

/** The queue with these titles moved to the front (in the order given); everything else keeps its place. */
export function queueWithFirst(waiting: { seriesId: string; chapterId: string }[], firstSeries: string[]): string[] {
  const rank = new Map(firstSeries.map((id, i) => [id, i]));
  return waiting
    .map((w, i) => ({ w, i, r: rank.get(w.seriesId) ?? Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.w.chapterId);
}

/** Waiting chapters of these titles that are not among the next `keep` from where you are: the ones to cancel. */
export function beyondNext(series: MangaSeries[], waiting: { seriesId: string; chapterId: string }[], seriesIds: string[], keep: number): string[] {
  const wanted = new Set(seriesIds);
  const keepIds = new Set<string>();
  for (const s of series) if (wanted.has(s.id)) for (const id of chaptersFromHere(s, keep)) keepIds.add(id);
  return waiting.filter((w) => wanted.has(w.seriesId) && !keepIds.has(w.chapterId)).map((w) => w.chapterId);
}
