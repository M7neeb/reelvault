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
};

export type BookPlace = { chapter: number; block: number; chapterFrac: number };

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
