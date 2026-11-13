/**
 * Books: the rules that need no phone. Where you are in a book (chapter and
 * paragraph), how far through it that is, the reader's look, and the order
 * of the shelf. Pure: no React, no native modules (tested in Node).
 */

export type BookItem = {
  id: string;
  /** Relative to the app's documents folder: 'books/<id>'. */
  folder: string;
  filename: string;
  size: number;
  title: string | null;
  author: string | null;
  language: string | null;
  description: string | null;
  /** Path of the cover inside the book. */
  cover: string | null;
  /** Bytes of each chapter, in reading order: how long each one is. */
  chapterSizes: number[];
  /** Where you stopped: chapter, and the paragraph at the top of the screen. */
  chapter: number;
  block: number;
  /** How far through that chapter (0..1), so progress does not need the chapter opened. */
  chapterFrac: number;
  readMs: number;
  lastReadAt: number | null;
  finishedAt: number | null;
  addedAt: number;
  /** 0 = not rated, else 1..10. */
  rating: number;
  /** What you set; null = worked out from your reading (see statusOf). */
  status: BookStatus | null;
  notes: string | null;
  isPrivate: boolean;
  deletedAt: number | null;
  tags: string[];
};

export type BookStatus = 'want' | 'reading' | 'finished' | 'dropped';
export const BOOK_STATUSES: { key: BookStatus; label: string }[] = [
  { key: 'want', label: 'Want to read' },
  { key: 'reading', label: 'Reading' },
  { key: 'finished', label: 'Finished' },
  { key: 'dropped', label: 'Dropped' },
];
export const statusLabel = (s: BookStatus) => BOOK_STATUSES.find((x) => x.key === s)!.label;

/** The status you set, else what your reading says: finished, started, or not yet. */
export function statusOf(b: Pick<BookItem, 'status' | 'finishedAt' | 'lastReadAt'>): BookStatus {
  if (b.status) return b.status;
  return b.finishedAt ? 'finished' : b.lastReadAt ? 'reading' : 'want';
}

/** A bookmark (a paragraph) or a highlight (words inside one). */
export type BookMark = { id: number; bookId: string; kind: 'bookmark' | 'highlight'; chapter: number; block: number; text: string | null; note: string | null; createdAt: number };

export type BookPlace = { chapter: number; block: number; chapterFrac: number };

/** One sitting with a book: when, how long you read, and how far through the book it took you. */
export type BookRead = { bookId: string; startedAt: number; endedAt: number; ms: number; from: number; to: number };

/** Saves closer together than this are the same sitting. */
export const SESSION_GAP_MS = 10 * 60_000;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** How far through the whole book a place is (0..1), weighting chapters by their length. */
export function progressAt(sizes: number[], chapter: number, frac: number): number {
  if (!sizes.length) return 0;
  const c = Math.min(Math.max(0, Math.floor(chapter)), sizes.length - 1);
  const total = sizes.reduce((a, s) => a + Math.max(1, s), 0);
  let before = 0;
  for (let i = 0; i < c; i++) before += Math.max(1, sizes[i]);
  return clamp01((before + clamp01(frac) * Math.max(1, sizes[c])) / total);
}

export function progressOf(b: BookItem): number {
  if (b.finishedAt) return 1;
  return progressAt(b.chapterSizes, b.chapter, b.chapterFrac);
}

/** "12%", never "0%" once you have started, never "100%" until the end. */
export function fmtProgress(p: number, started: boolean): string {
  if (p >= 1) return 'Finished';
  if (!started) return 'Not started';
  const n = Math.round(p * 100);
  return `${Math.min(99, Math.max(1, n))}%`;
}

export const isStarted = (b: BookItem) => b.lastReadAt !== null;

export function displayTitle(b: Pick<BookItem, 'title' | 'filename'>): string {
  if (b.title?.trim()) return b.title.trim();
  return b.filename.replace(/\.epub$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
}

/** The fraction of a chapter that a paragraph sits at, from its index among `count` paragraphs. */
export function fracOfBlock(block: number, count: number): number {
  if (count <= 1) return 0;
  return clamp01(block / (count - 1));
}

/** The paragraph to open at when a saved place points past the end of a chapter (the book changed). */
export function safeBlock(block: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(block)), count - 1);
}

/* --------------------------------------------------- shelf: sort, filter */

export type BookSort = 'shelf' | 'recent' | 'title' | 'author' | 'progress' | 'added' | 'rating';
export const BOOK_SORTS: { key: BookSort; label: string }[] = [
  { key: 'shelf', label: 'Reading first' },
  { key: 'recent', label: 'Last read' },
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'progress', label: 'Furthest read' },
  { key: 'added', label: 'Recently added' },
  { key: 'rating', label: 'Your rating' },
];

/** "The Brothers Karamazov" files under B; "Dostoevsky, Fyodor" under D. */
const titleKey = (b: BookItem) => displayTitle(b).replace(/^(the|a|an)\s+/i, '').toLowerCase();
const authorKey = (b: BookItem) => {
  const a = (b.author ?? '').split(',')[0].trim();
  return (a.split(/\s+/).pop() ?? '').toLowerCase() || '\uffff';
};

export function sortBooks<T extends BookItem>(books: T[], sort: BookSort): T[] {
  const byTitle = (a: T, b: T) => titleKey(a).localeCompare(titleKey(b));
  switch (sort) {
    case 'shelf':
      return shelfOrder(books);
    case 'recent':
      return [...books].sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || byTitle(a, b));
    case 'title':
      return [...books].sort(byTitle);
    case 'author':
      return [...books].sort((a, b) => authorKey(a).localeCompare(authorKey(b)) || byTitle(a, b));
    case 'progress':
      return [...books].sort((a, b) => progressOf(b) - progressOf(a) || byTitle(a, b));
    case 'added':
      return [...books].sort((a, b) => b.addedAt - a.addedAt);
    case 'rating':
      return [...books].sort((a, b) => b.rating - a.rating || byTitle(a, b));
  }
}

/** A chip above the shelf: a status, or one of your keywords. */
export type BookFilter = { status: BookStatus } | { tag: string } | null;

export function matchesBook(b: BookItem, filter: BookFilter, query: string): boolean {
  if (filter && 'status' in filter && statusOf(b) !== filter.status) return false;
  if (filter && 'tag' in filter && !b.tags.some((t) => t.toLowerCase() === filter.tag.toLowerCase())) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [displayTitle(b), b.author, b.notes, b.filename, ...b.tags].filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Every keyword on the shelf, most used first. */
export function shelfTags(books: BookItem[]): { name: string; count: number }[] {
  const m = new Map<string, { name: string; count: number }>();
  for (const b of books)
    for (const t of b.tags) {
      const k = t.toLowerCase();
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { name: t, count: 1 });
    }
  return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** A keyword as typed: no leading #, spaces tidied, at most 40 characters. */
export const cleanTag = (t: string) => t.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Days left before a book in Recently Deleted goes for good. */
export function daysLeft(deletedAt: number, trashDays: number, now: number): number {
  return Math.max(0, Math.ceil((deletedAt + trashDays * 86_400_000 - now) / 86_400_000));
}

/* ------------------------------------------- highlights and searching */

type RunLike = { t: string; b?: 1; i?: 1 };

/**
 * A paragraph's runs cut so the highlighted words are runs of their own
 * (marked `hl`). Highlights are found by their words, so they stay put if
 * the paragraph is drawn with other text sizes.
 */
export function highlightRuns<R extends RunLike>(runs: R[], highlights: string[]): (R & { hl?: 1 })[] {
  const full = runs.map((r) => r.t).join('');
  const marks: [number, number][] = [];
  for (const h of highlights) {
    const at = h ? full.indexOf(h) : -1;
    if (at >= 0) marks.push([at, at + h.length]);
  }
  if (!marks.length) return runs;
  const inMark = (i: number) => marks.some(([a, b]) => i >= a && i < b);
  const out: (R & { hl?: 1 })[] = [];
  let pos = 0;
  for (const r of runs) {
    let start = 0;
    for (let i = 1; i <= r.t.length; i++) {
      if (i === r.t.length || inMark(pos + i) !== inMark(pos + start)) {
        const piece = r.t.slice(start, i);
        if (piece) out.push({ ...r, t: piece, ...(inMark(pos + start) ? { hl: 1 as const } : {}) });
        start = i;
      }
    }
    pos += r.t.length;
  }
  return out;
}

/** A paragraph split into sentences (to pick which ones to highlight). */
export function sentencesOf(text: string): string[] {
  // A sentence ends at . ! ? or … only when the next word starts one ("Hm … yes" stays whole).
  const out: string[] = [];
  const end = /[.!?…]["'”’)\]]*\s+(?=[A-Z0-9“"‘'(—–-])/g;
  let from = 0;
  for (let m = end.exec(text); m; m = end.exec(text)) {
    const stop = m.index + m[0].trimEnd().length;
    out.push(text.slice(from, stop).trim());
    from = m.index + m[0].length;
  }
  out.push(text.slice(from).trim());
  return out.filter(Boolean);
}

export type BookHit = { chapter: number; block: number; before: string; match: string; after: string };

/** Where the words appear in one chapter's paragraphs, with a little text either side. */
export function findInBlocks(paras: { block: number; text: string }[], chapter: number, query: string, max = 200): BookHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: BookHit[] = [];
  for (const p of paras) {
    const low = p.text.toLowerCase();
    let at = low.indexOf(q);
    while (at >= 0 && out.length < max) {
      const from = Math.max(0, at - 40);
      const to = Math.min(p.text.length, at + q.length + 60);
      out.push({
        chapter,
        block: p.block,
        before: (from > 0 ? '…' : '') + p.text.slice(from, at).replace(/^\S*\s/, from > 0 ? '' : '$&'),
        match: p.text.slice(at, at + q.length),
        after: p.text.slice(at + q.length, to) + (to < p.text.length ? '…' : ''),
      });
      at = low.indexOf(q, at + q.length);
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Shelf order: the book you read last first, then the ones never opened (newest first), finished last. */
export function shelfOrder<T extends BookItem>(books: T[]): T[] {
  const rank = (b: BookItem) => (b.finishedAt ? 2 : b.lastReadAt ? 0 : 1);
  return [...books].sort((a, b) => rank(a) - rank(b) || (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.addedAt - a.addedAt);
}

/** Minutes left at your own pace, once there is enough reading to tell. */
export function minutesLeft(b: BookItem): number | null {
  const p = progressOf(b);
  if (p < 0.02 || p >= 1 || b.readMs < 10 * 60_000) return null;
  return Math.round(((b.readMs / p) * (1 - p)) / 60_000);
}

export function fmtLeft(min: number): string {
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m >= 10 ? `${h} h ${m} min left` : `${h} h left`;
}

/* ------------------------------------------------------- the reader's look */

export type ReaderTheme = 'paper' | 'sepia' | 'night';
export type ReaderFont = 'serif' | 'sans';
export type ReaderPrefs = { theme: ReaderTheme; font: ReaderFont; size: number; spacing: 'tight' | 'normal' | 'loose' };

export const READER_SIZES = [15, 17, 19, 21, 24, 28];
export const DEFAULT_READER: ReaderPrefs = { theme: 'night', font: 'serif', size: 19, spacing: 'normal' };

export function parseReaderPrefs(json: string | null): ReaderPrefs {
  try {
    const r = json ? JSON.parse(json) : {};
    return {
      theme: r?.theme === 'paper' || r?.theme === 'sepia' || r?.theme === 'night' ? r.theme : DEFAULT_READER.theme,
      font: r?.font === 'sans' ? 'sans' : 'serif',
      size: READER_SIZES.includes(r?.size) ? r.size : DEFAULT_READER.size,
      spacing: r?.spacing === 'tight' || r?.spacing === 'loose' ? r.spacing : 'normal',
    };
  } catch {
    return DEFAULT_READER;
  }
}

export const lineHeightFor = (size: number, spacing: ReaderPrefs['spacing']) => Math.round(size * (spacing === 'tight' ? 1.38 : spacing === 'loose' ? 1.72 : 1.55));

/** A reading session only counts while the page is moving: idle minutes on an open book are not reading. */
export const IDLE_MS = 3 * 60_000;
export function countedMs(gapMs: number): number {
  return gapMs > 0 && gapMs <= IDLE_MS ? gapMs : 0;
}

/* ------------------------------------------------------ chapter names */

type TocLike = { title: string; chapter: number; depth: number };

/**
 * What to call a chapter: its entry in the contents, with the part it sits in
 * ("Part I · III") unless that part is just the book's own title.
 */
export function chapterLabel(toc: TocLike[], chapter: number, bookTitle: string | null, fallback: string): string {
  const at = toc.findIndex((t) => t.chapter === chapter);
  if (at < 0) return fallback;
  const own = toc[at];
  if (own.depth === 0) return own.title;
  for (let i = at - 1; i >= 0; i--) {
    if (toc[i].depth >= own.depth) continue;
    const parent = toc[i].title.trim();
    return parent && parent.toLowerCase() !== (bookTitle ?? '').trim().toLowerCase() ? `${parent} · ${own.title}` : own.title;
  }
  return own.title;
}
