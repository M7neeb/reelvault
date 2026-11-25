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

/**
 * Status and the finished date have to tell the same story, whichever one you
 * change: a book set to Finished gets its date (stats and Wrapped count by it),
 * any other status takes the date away again.
 */
export function withStatus(b: Pick<BookItem, 'status' | 'finishedAt'>, status: BookStatus | null, now: number): Pick<BookItem, 'status' | 'finishedAt'> {
  if (status === null) return { status, finishedAt: b.finishedAt };
  return { status, finishedAt: status === 'finished' ? (b.finishedAt ?? now) : null };
}

/** "Mark as finished" at the end of a book (or its undo): a status set by hand must not contradict it. */
export function withFinished(b: Pick<BookItem, 'status' | 'finishedAt'>, finished: boolean, now: number): Pick<BookItem, 'status' | 'finishedAt'> {
  if (finished) return { status: b.status === 'finished' ? b.status : null, finishedAt: now };
  return { status: b.status === 'finished' ? null : b.status, finishedAt: null };
}

/** A bookmark (a paragraph) or a highlight (words inside one). */
export type BookMark = { id: number; bookId: string; kind: 'bookmark' | 'highlight'; chapter: number; block: number; text: string | null; note: string | null; createdAt: number };

export type BookPlace = { chapter: number; block: number; chapterFrac: number };

/** A sitting with a book. `listened`: time with its audiobook, not the text (no progress then). */
export type BookRead = { bookId: string; startedAt: number; endedAt: number; ms: number; from: number; to: number; listened?: boolean };

/** Saves closer together than this are the same sitting. */
export const SESSION_GAP_MS = 10 * 60_000;

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * Whether reading saved at `at` carries on the sitting that ended at `lastEndedAt`:
 * close enough in time, and on the same day (past midnight the reading belongs to
 * the new day, for today's goal and the streak).
 */
export function joinsSitting(lastEndedAt: number, at: number, addMs: number): boolean {
  return at - lastEndedAt < SESSION_GAP_MS && sameDay(lastEndedAt, at) && sameDay(at - addMs, at);
}

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
  return b.filename.replace(/\.(kepub\.epub|fb2\.zip|epub|pdf|mobi|azw3?|kf8|prc|pdb|fb2|fbz|docx|odt|rtf|html?|xhtml|txt|text|md|markdown|cbz)$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
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

/** Read aloud: the runs with the word being spoken (characters at..at+len) split out and marked `sp`. */
export function spokenRuns<R extends RunLike>(runs: R[], at: number, len: number): (R & { sp?: 1 })[] {
  const total = runs.reduce((n, r) => n + r.t.length, 0);
  if (len <= 0 || at >= total || at < 0) return runs;
  const end = at + len;
  const out: (R & { sp?: 1 })[] = [];
  let pos = 0;
  for (const r of runs) {
    const a = Math.max(at, pos) - pos;
    const b = Math.min(end, pos + r.t.length) - pos;
    if (b <= a) out.push(r);
    else {
      if (a > 0) out.push({ ...r, t: r.t.slice(0, a) });
      out.push({ ...r, t: r.t.slice(a, b), sp: 1 as const });
      if (b < r.t.length) out.push({ ...r, t: r.t.slice(b) });
    }
    pos += r.t.length;
  }
  return out;
}

/** What Read aloud says for a block: its text; nothing for pictures and rules. */
export function blockSpeech(b: { k: string; runs?: RunLike[] }): string {
  return b.runs ? b.runs.map((r) => r.t).join('') : '';
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

/** Shelf order: the book you read last first, then the ones never opened (newest first), then dropped, finished last. */
export function shelfOrder<T extends BookItem>(books: T[]): T[] {
  const rank = (b: BookItem) => (b.finishedAt ? 3 : b.status === 'dropped' ? 2 : b.lastReadAt ? 0 : 1);
  return [...books].sort((a, b) => rank(a) - rank(b) || (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.addedAt - a.addedAt);
}

/** Every book you are in the middle of (or set to Reading by hand), the one you read last first. */
export function readingNow<T extends BookItem>(books: T[]): T[] {
  return books.filter((b) => !b.finishedAt && statusOf(b) === 'reading').sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.addedAt - a.addedAt);
}

/** Minutes left at your own pace, once there is enough reading to tell. */
export function minutesLeft(b: BookItem): number | null {
  const p = progressOf(b);
  if (p < 0.02 || p >= 1 || b.readMs < 10 * 60_000) return null;
  return Math.round(((b.readMs / p) * (1 - p)) / 60_000);
}

/** Minutes left in the chapter you are in, at your own pace through this book. */
export function chapterMinutesLeft(b: Pick<BookItem, 'chapterSizes' | 'readMs'>, chapter: number, frac: number): number | null {
  const sizes = b.chapterSizes;
  if (!sizes.length || b.readMs < 10 * 60_000) return null;
  const read = progressAt(sizes, chapter, frac);
  if (read < 0.02) return null;
  const c = Math.min(Math.max(0, Math.floor(chapter)), sizes.length - 1);
  const total = sizes.reduce((a, x) => a + Math.max(1, x), 0);
  const rest = ((Math.max(1, sizes[c]) / total) * (1 - Math.min(1, Math.max(0, frac)))) / read;
  return Math.max(1, Math.round((b.readMs * rest) / 60_000));
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
/** How pages move: free scrolling, or a screen at a time by tapping the edges (sliding or fading). */
export type PageTurn = 'scroll' | 'slide' | 'fade';
/** voice: a voice id for Read aloud ('' = the phone's best for its language); speech: its speed (1 = normal). */
export type ReaderPrefs = { theme: ReaderTheme; font: ReaderFont; size: number; spacing: 'tight' | 'normal' | 'loose'; turn: PageTurn; voice: string; speech: number };
export const SPEECH_SPEEDS = [0.8, 1, 1.2, 1.5, 2];

export const READER_SIZES = [15, 17, 19, 21, 24, 28];
export const DEFAULT_READER: ReaderPrefs = { theme: 'night', font: 'serif', size: 19, spacing: 'normal', turn: 'scroll', voice: '', speech: 1 };

export function parseReaderPrefs(json: string | null): ReaderPrefs {
  try {
    const r = json ? JSON.parse(json) : {};
    return {
      theme: r?.theme === 'paper' || r?.theme === 'sepia' || r?.theme === 'night' ? r.theme : DEFAULT_READER.theme,
      font: r?.font === 'sans' ? 'sans' : 'serif',
      size: READER_SIZES.includes(r?.size) ? r.size : DEFAULT_READER.size,
      spacing: r?.spacing === 'tight' || r?.spacing === 'loose' ? r.spacing : 'normal',
      turn: r?.turn === 'slide' || r?.turn === 'fade' ? r.turn : 'scroll',
      voice: typeof r?.voice === 'string' ? r.voice : '',
      speech: SPEECH_SPEEDS.includes(r?.speech) ? r.speech : 1,
    };
  } catch {
    return DEFAULT_READER;
  }
}

export const lineHeightFor = (size: number, spacing: ReaderPrefs['spacing']) => Math.round(size * (spacing === 'tight' ? 1.38 : spacing === 'loose' ? 1.72 : 1.55));

/**
 * What saving your place changes on a book, or null when nothing does: opening a
 * book and closing it again at the same paragraph is not reading it, so it must not
 * move the book to the top of Reading now (or start a book you only looked at).
 */
export function placeSaved(b: Pick<BookItem, 'chapter' | 'block' | 'readMs'>, place: BookPlace, addMs: number, at: number): (BookPlace & { readMs: number; lastReadAt: number }) | null {
  if (addMs <= 0 && b.chapter === place.chapter && b.block === place.block) return null;
  return { ...place, readMs: b.readMs + Math.max(0, addMs), lastReadAt: at };
}

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

/**
 * The plain shelf in two parts: the books still to read (want to read, or started but not in
 * "Reading now") stand as covers in a row, the finished and dropped ones stay in the list. Every
 * book lands in exactly one part, in the order it came. `heading` names the list part.
 */
export function splitShelf<T extends Pick<BookItem, 'status' | 'finishedAt' | 'lastReadAt'>>(books: readonly T[]): { toRead: T[]; listed: T[]; heading: string } {
  const toRead: T[] = [];
  const listed: T[] = [];
  for (const b of books) (statusOf(b) === 'want' || statusOf(b) === 'reading' ? toRead : listed).push(b);
  const dropped = listed.some((b) => statusOf(b) === 'dropped');
  const finished = listed.some((b) => statusOf(b) === 'finished');
  return { toRead, listed, heading: dropped ? (finished ? 'Finished and dropped' : 'Dropped') : 'Finished' };
}

/**
 * The type size for a title set on a plain cover (a book without cover art): about an eighth of the
 * cover's width, but small enough that the longest word fits on one line, so "Underground" never
 * breaks into "Undergroun / d". Bold letters are taken as about 0.64 of the size wide.
 */
export function coverTitleSize(width: number, title: string): number {
  const inner = width - 2 * Math.max(6, width * 0.1);
  const longest = Math.max(1, ...title.split(/\s+/).map((w) => w.length));
  return Math.max(9, Math.min(width * 0.13, inner / (longest * 0.64)));
}

/**
 * The scroll position one page on (dir 1) or back (-1). A page is the screen
 * less one line, so the last line read stays in view. At either end of the
 * chapter: 'next' or 'previous' instead.
 */
export function pageTurn(offset: number, viewH: number, contentH: number, lineH: number, dir: 1 | -1): number | 'next' | 'previous' {
  const maxOff = Math.max(0, contentH - viewH);
  const step = Math.max(1, viewH - lineH);
  if (dir === 1) return offset >= maxOff - 1 ? 'next' : Math.min(offset + step, maxOff);
  return offset <= 1 ? 'previous' : Math.max(0, offset - step);
}
