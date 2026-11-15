/**
 * A book and its audiobook: which audio item belongs to which book, which one
 * to suggest, and where in the audio your place in the text falls.
 * Pure: no React, no native modules (tested in Node).
 */

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

/** Where to start when you tap Listen: the audio's own place once you have listened, else your place in the book. */
export function listenFrom(a: { lastPlayedAt: number | null; positionTrack: number; positionMs: number }, bookFrac: number): 'audio' | 'book' {
  const listened = a.lastPlayedAt !== null && (a.positionTrack > 0 || a.positionMs > 30_000);
  return !listened && bookFrac > 0.02 ? 'book' : 'audio';
}

/** The speed after this one, round the list. */
export function nextSpeed(rate: number, speeds: readonly number[]): number {
  const at = speeds.findIndex((s) => s > rate + 0.001);
  return speeds[at < 0 ? 0 : at];
}
