/**
 * A book and its audiobook: which audio item belongs to which book, which one
 * to suggest, and where in the audio your place in the text falls.
 * Pure: no React, no native modules (tested in Node).
 */

import type { BookRead } from './bookLogic.ts';

type BookLike = { id: string; title: string | null; filename: string; author: string | null };
type AudioLike = { id: string; title: string | null; filename: string; author: string | null; durationMs: number | null; tracks: { durationMs: number | null }[] };

/** Book id to the id of its audiobook in the Audio section. */
export type AudioLinks = Record<string, string>;

export function parseAudioLinks(json: string | null): AudioLinks {
  try {
    const raw = json ? JSON.parse(json) : {};
    const out: AudioLinks = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** The links with one book's audiobook set, or taken away (null). */
export function withAudioLink(links: AudioLinks, bookId: string, audioId: string | null): AudioLinks {
  const next = { ...links };
  if (audioId) next[bookId] = audioId;
  else delete next[bookId];
  return next;
}

/** The audiobook of a book, if it is still in the Audio section. */
export function audioOf<A extends { id: string }>(links: AudioLinks, bookId: string, audio: A[]): A | null {
  const id = links[bookId];
  return id ? (audio.find((a) => a.id === id) ?? null) : null;
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/\.(epub|m4b|m4a|mp3|aac|flac|ogg|opus|wav)$/i, '')
    .replace(/\((un)?abridged\)|\[(un)?abridged\]|audiobook/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();

/** An item in Audio that looks like this book: the same title, or one title inside the other. */
export function suggestAudio<A extends AudioLike>(book: BookLike, audio: A[], links: AudioLinks): A | null {
  const title = norm(book.title || book.filename);
  if (title.length < 3) return null;
  const taken = new Set(Object.entries(links).filter(([b]) => b !== book.id).map(([, a]) => a));
  let best: A | null = null;
  let bestScore = 0;
  for (const a of audio) {
    if (taken.has(a.id)) continue;
    const t = norm(a.title || a.filename);
    if (!t) continue;
    const score = t === title ? 3 : t.startsWith(title) || title.startsWith(t) ? 2 : t.includes(title) || (t.length >= 6 && title.includes(t)) ? 1 : 0;
    if (score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}

export const audioLength = (a: Pick<AudioLike, 'durationMs' | 'tracks'>) => a.durationMs ?? a.tracks.reduce((n, t) => n + (t.durationMs ?? 0), 0);

/**
 * Where in the audio a place in the text falls: the file and the time in it at
 * the same fraction of the whole. Text and audio do not line up to the word,
 * so this lands a little before the place (15 s) and never past the end.
 */
export function placeInAudio(tracks: { durationMs: number | null }[], frac: number): { track: number; ms: number } | null {
  const total = tracks.reduce((n, t) => n + (t.durationMs ?? 0), 0);
  if (total <= 0 || !Number.isFinite(frac)) return null;
  let at = Math.max(0, Math.min(1, frac) * total - 15_000);
  at = Math.min(at, Math.max(0, total - 30_000));
  for (let i = 0; i < tracks.length; i++) {
    const len = tracks[i].durationMs ?? 0;
    if (at < len || i === tracks.length - 1) return { track: i, ms: Math.round(Math.min(at, len)) };
    at -= len;
  }
  return { track: 0, ms: 0 };
}

/** The audio items that were not there before an import (to link what was just added). */
export function newAudio<A extends { id: string }>(before: ReadonlySet<string>, now: A[]): A[] {
  return now.filter((a) => !before.has(a.id));
}

/** How far through the audiobook you are (0..1), from where it was last stopped. */
export function audioDoneFrac(a: Pick<AudioLike, 'durationMs' | 'tracks'> & { positionTrack: number; positionMs: number; finishedAt: number | null }): number {
  if (a.finishedAt) return 1;
  const total = audioLength(a);
  if (total <= 0) return 0;
  let at = Math.max(0, a.positionMs);
  for (let i = 0; i < Math.min(a.positionTrack, a.tracks.length); i++) at += a.tracks[i].durationMs ?? 0;
  return Math.min(1, at / total);
}

/** The speed after this one, round the list. */
export function nextSpeed(rate: number, speeds: readonly number[]): number {
  const at = speeds.findIndex((s) => s > rate + 0.001);
  return speeds[at < 0 ? 0 : at];
}

/* ------------------------------------------- chapters of the text and the audio */

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const KINDS = 'canto|chapter|chap|ch|book|part|section|letter|act|scene|story|kapitel|chapitre|capitolo|capitulo|capítulo|глава|часть';

function numberOf(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  const word = WORDS.indexOf(s);
  if (word >= 0) return word;
  if (!/^[ivxlcdm]+$/.test(s)) return null;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    n += v < (ROMAN[s[i + 1]] ?? 0) ? -v : v;
  }
  return n;
}

/**
 * What a chapter is called, boiled down so the book and the audio can be compared:
 * "Inferno · Canto V", "03 - Canto 05" and "canto five" all give "canto 5".
 * Titles with no number give the words themselves.
 */
export function chapterKey(title: string | null | undefined): string | null {
  const t = (title ?? '').toLowerCase().replace(/[_.]+/g, ' ');
  const re = new RegExp(`(?:^|[^\\p{L}])(${KINDS})\\s*[:#.-]?\\s*(\\d+|[ivxlcdm]+|${WORDS.join('|')})(?![\\p{L}\\d])`, 'gu');
  let last: string | null = null;
  for (const m of t.matchAll(re)) {
    const n = numberOf(m[2]);
    if (n !== null) last = `${m[1] === 'chap' || m[1] === 'ch' ? 'chapter' : m[1]} ${n}`;
  }
  if (last) return last;
  const words = t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return words.length >= 3 && !/^\d+$/.test(words) ? words : null;
}

type AudioChapter = { title: string; overallStart: number; lengthMs: number };

/**
 * The audio chapter that is the same as chapter `chapter` of the text, found by name.
 * A name used more than once (Canto V of each part) is matched by its turn, and
 * only when the text and the audio use it the same number of times.
 */
export function matchingAudioChapter(textTitles: string[], chapter: number, audio: AudioChapter[]): number | null {
  const key = chapterKey(textTitles[chapter]);
  if (!key) return null;
  const inText = textTitles.map((t, i) => (chapterKey(t) === key ? i : -1)).filter((i) => i >= 0);
  const inAudio = audio.map((c, i) => (chapterKey(c.title) === key ? i : -1)).filter((i) => i >= 0);
  if (!inAudio.length || inText.length !== inAudio.length) return null;
  return inAudio[inText.indexOf(chapter)] ?? null;
}

const toTrack = (tracks: { durationMs: number | null }[], overall: number) => {
  let left = Math.max(0, overall);
  for (let i = 0; i < tracks.length; i++) {
    const len = tracks[i].durationMs ?? 0;
    if (left < len || i === tracks.length - 1) return { track: i, ms: Math.round(Math.min(left, len || left)) };
    left -= len;
  }
  return { track: 0, ms: 0 };
};

/**
 * Where to start the audiobook when you listen along from the reader.
 * - The audio stopped inside the chapter on screen: carry on from there
 *   (it is exact; the text place is only a guess). `null` means that.
 * - Else the start of that chapter in the audio, plus how far you are into it.
 * - No chapter to match: the audio's own place while it is near the text,
 *   else the same fraction of the audio as of the text.
 */
export function listenAlongFrom(
  a: { tracks: { durationMs: number | null }[]; lastPlayedAt: number | null; positionTrack: number; positionMs: number; finishedAt: number | null },
  audioChapters: AudioChapter[],
  text: { titles: string[]; chapter: number; chapterFrac: number; frac: number }
): { track: number; ms: number } | null {
  const total = a.tracks.reduce((n, t) => n + (t.durationMs ?? 0), 0);
  let saved = Math.max(0, a.positionMs);
  for (let i = 0; i < Math.min(a.positionTrack, a.tracks.length); i++) saved += a.tracks[i].durationMs ?? 0;
  const listened = a.lastPlayedAt !== null && !a.finishedAt && saved > 30_000;
  // Only listened so far, the text not really started: the audio's place is the only real one.
  if (listened && text.frac <= 0.02) return null;

  const m = matchingAudioChapter(text.titles, text.chapter, audioChapters);
  if (m !== null) {
    const c = audioChapters[m];
    if (listened && saved >= c.overallStart && saved < c.overallStart + c.lengthMs) return null;
    const at = c.overallStart + Math.max(0, Math.min(1, text.chapterFrac) * c.lengthMs - 15_000);
    return toTrack(a.tracks, at);
  }
  const guess = placeInAudio(a.tracks, text.frac);
  if (!guess) return null;
  if (listened && total > 0) {
    let g = guess.ms;
    for (let i = 0; i < guess.track; i++) g += a.tracks[i].durationMs ?? 0;
    if (Math.abs(g - saved) <= total * 0.1) return null;
  }
  return guess;
}

/**
 * Time spent listening to a book's audiobook, as time with that book (for the daily
 * goal, today's minutes, the streak and its page). Listening while reading must not
 * count twice: inside a reading sitting the time counts once, as the reading or the
 * listening, whichever is longer (reading only counts while the page moves, so a long
 * stretch of listening on one page still counts). Outside sittings it all counts.
 */
export function listeningAsReads(plays: { itemId: string; startedAt: number; listenedMs: number }[], links: AudioLinks, reads: BookRead[]): BookRead[] {
  const bookOf = new Map(Object.entries(links).map(([book, audio]) => [audio, book]));
  const out: BookRead[] = [];
  const inSitting = new Map<BookRead, number>();
  for (const pl of plays) {
    const bookId = bookOf.get(pl.itemId);
    if (!bookId || pl.listenedMs <= 0) continue;
    const start = pl.startedAt;
    const end = start + pl.listenedMs;
    let inside = 0;
    for (const r of reads) {
      if (r.bookId !== bookId) continue;
      const o = Math.min(pl.listenedMs - inside, Math.max(0, Math.min(end, r.endedAt) - Math.max(start, r.startedAt)));
      if (o <= 0) continue;
      inside += o;
      inSitting.set(r, (inSitting.get(r) ?? 0) + o);
    }
    const outside = pl.listenedMs - inside;
    if (outside >= 1000) out.push({ bookId, startedAt: start, endedAt: end, ms: outside, from: 0, to: 0, listened: true });
  }
  for (const [r, listened] of inSitting) {
    const extra = Math.min(listened, r.endedAt - r.startedAt) - r.ms;
    if (extra >= 1000) out.push({ bookId: r.bookId, startedAt: r.startedAt, endedAt: r.endedAt, ms: extra, from: 0, to: 0, listened: true });
  }
  return out.sort((x, y) => x.startedAt - y.startedAt);
}

/** The text chapter that is the same as audio chapter `audioIndex` (the other way round from matchingAudioChapter). */
export function matchingTextChapter(textTitles: string[], audioIndex: number, audio: AudioChapter[]): number | null {
  for (let i = 0; i < textTitles.length; i++) if (matchingAudioChapter(textTitles, i, audio) === audioIndex) return i;
  return null;
}
