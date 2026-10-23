/**
 * Search everything and "Jump back in": one search box over your videos,
 * audio and books, manga and comics, and the Simkl titles you follow, and
 * one row with what you were in the middle of in each section.
 *
 * Private and deleted things are never shown. Pure: no React, no database.
 */

import { fuzzyScore } from '../vault/fuzzy.ts';

export type FindKind = 'video' | 'audio' | 'book' | 'manga' | 'movie' | 'show' | 'anime';

export type FindVideo = {
  id: string;
  title: string | null;
  filename: string;
  notes: string | null;
  tagNames: string[];
  isPrivate: boolean;
  deletedAt: number | null;
  createdAt: number;
  durationMs: number | null;
  rating: number;
};

export type FindAudio = {
  id: string;
  kind: 'audio' | 'book';
  title: string | null;
  filename: string;
  author: string | null;
  album: string | null;
  narrator: string | null;
  genre: string | null;
  notes: string | null;
  tags: string[];
  isPrivate: boolean;
  deletedAt: number | null;
  durationMs: number | null;
  tracks: { durationMs: number | null }[];
  positionTrack: number;
  positionMs: number;
  lastPlayedAt: number | null;
  finishedAt: number | null;
  status: string | null;
  importedAt: number;
  rating: number;
};

export type FindManga = {
  id: string;
  title: string;
  altTitle: string | null;
  author: string | null;
  artist: string | null;
  kind: string | null;
  notes: string | null;
  tags: string[];
  isPrivate: boolean;
  deletedAt: number | null;
  status: string | null;
  lastReadAt: number | null;
  importedAt: number;
  rating: number;
  chapters: { id: string; number: number | null; volume: number | null; title: string | null; readAt: number | null; lastPage: number; pageCount: number }[];
};

export type FindTitle = {
  simklId: number;
  type: 'movie' | 'show' | 'anime';
  title: string;
  year: number | null;
  status: string;
  rating: number | null;
  memo: string | null;
  nextToWatch: string | null;
  nextTitle: string | null;
  watchedEpisodes: number;
  totalEpisodes: number;
  lastWatchedAt: string | null;
  addedAt: string | null;
};

export type FindInput = {
  videos: FindVideo[];
  audio: FindAudio[];
  manga: FindManga[];
  titles: FindTitle[];
};

export type Found = {
  kind: FindKind;
  /** The video, audio item or series id; for Simkl titles the Simkl id as text. */
  id: string;
  title: string;
  /** One short line under the title ("Book · Jane Doe", "Chapter 12 next"). */
  sub: string;
  score: number;
  /** Your rating (0 = none). */
  rating: number;
  /** Every word you typed is really there (not only something close to it). */
  exact: boolean;
};

const KIND_LABEL: Record<FindKind, string> = {
  video: 'Video',
  audio: 'Audio',
  book: 'Book',
  manga: 'Manga',
  movie: 'Movie',
  show: 'Show',
  anime: 'Anime',
};

export const kindLabel = (k: FindKind) => KIND_LABEL[k];

const join = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

/**
 * How well a thing matches: its title counts most, then its people and
 * keywords, then notes and file names. 0 = no match.
 */
function scoreOf(q: string, title: string, people: string[], extra: string[]): number {
  const t = fuzzyScore(q, title);
  const lowerQ = q.trim().toLowerCase();
  const lowerT = title.toLowerCase();
  // A title that starts with what you typed, or is it, comes first.
  const bonus = lowerT === lowerQ ? 4 : lowerT.startsWith(lowerQ) ? 2 : lowerT.includes(lowerQ) ? 1 : 0;
  const p = Math.max(0, ...people.filter(Boolean).map((x) => fuzzyScore(q, x)));
  const e = Math.max(0, ...extra.filter(Boolean).map((x) => fuzzyScore(q, x)));
  const best = Math.max(t + bonus, p * 0.8, e * 0.6);
  return best;
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Every typed word starts a word somewhere in these texts. */
function hasAllWords(q: string, texts: (string | null | undefined)[]): boolean {
  const hay = ` ${plain(texts.filter(Boolean).join(' ')).replace(/[^a-z0-9]+/g, ' ')} `;
  return plain(q)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .every((w) => hay.includes(` ${w}`));
}

/** A chapter's short name ("Ch. 12", "Vol. 2 Ch. 3", or its title). */
export function chapterLabel(c: { number: number | null; volume: number | null; title: string | null }): string {
  if (c.number !== null) return `${c.volume !== null ? `Vol. ${c.volume} ` : ''}Ch. ${c.number}`;
  return c.title ?? 'Chapter';
}

/** Everything that matches `query`, best first (at most `limit`). */
export function findEverything(query: string, input: FindInput, limit = 60): Found[] {
  const q = query.trim();
  if (!q) return [];
  const out: Found[] = [];

  for (const v of input.videos) {
    if (v.isPrivate || v.deletedAt) continue;
    const title = v.title?.trim() || v.filename;
    const score = scoreOf(q, title, [], [...v.tagNames, v.notes ?? '', v.title ? v.filename : '']);
    if (score > 0)
      out.push({
        kind: 'video',
        id: v.id,
        title,
        sub: join([v.tagNames.slice(0, 2).join(', ') || null, new Date(v.createdAt).getFullYear().toString()]),
        score,
        rating: v.rating,
        exact: hasAllWords(q, [title, v.filename, v.notes, ...v.tagNames]),
      });
  }

  for (const a of input.audio) {
    if (a.isPrivate || a.deletedAt) continue;
    const title = a.title?.trim() || a.filename;
    const score = scoreOf(q, title, [a.author ?? '', a.narrator ?? ''], [a.album ?? '', a.genre ?? '', a.notes ?? '', ...a.tags]);
    if (score > 0)
      out.push({
        kind: a.kind === 'book' ? 'book' : 'audio',
        id: a.id,
        title,
        sub: join([a.author, a.album]),
        score,
        rating: a.rating,
        exact: hasAllWords(q, [title, a.author, a.narrator, a.album, a.genre, a.notes, ...a.tags]),
      });
  }

  for (const m of input.manga) {
    if (m.isPrivate || m.deletedAt) continue;
    const score = scoreOf(q, m.title, [m.author ?? '', m.artist ?? '', m.altTitle ?? ''], [m.notes ?? '', ...m.tags]);
    if (score > 0) {
      const unread = m.chapters.filter((c) => !c.readAt).length;
      out.push({
        kind: 'manga',
        id: m.id,
        title: m.title,
        sub: join([m.author, m.chapters.length ? `${m.chapters.length} chapters` : null, unread && unread < m.chapters.length ? `${unread} unread` : null]),
        score,
        rating: m.rating,
        exact: hasAllWords(q, [m.title, m.altTitle, m.author, m.artist, m.notes, ...m.tags]),
      });
    }
  }

  for (const t of input.titles) {
    const score = scoreOf(q, t.title, [], [t.memo ?? '']);
    if (score > 0)
      out.push({
        kind: t.type,
        id: String(t.simklId),
        title: t.title,
        sub: join([t.year ? String(t.year) : null, statusWord(t.status)]),
        score,
        rating: t.rating ?? 0,
        exact: hasAllWords(q, [t.title, t.memo]),
      });
  }

  // Near misses ("night" for "light") only help when nothing has the words themselves.
  const kept = out.some((f) => f.exact) ? out.filter((f) => f.exact) : out;

  // Best match first; on a tie, the one you rated higher.
  return kept.sort((a, b) => b.score - a.score || b.rating - a.rating || a.title.localeCompare(b.title)).slice(0, limit);
}

function statusWord(s: string): string {
  switch (s) {
    case 'watching':
      return 'Watching';
    case 'plantowatch':
      return 'Plan to watch';
    case 'hold':
      return 'On hold';
    case 'completed':
      return 'Watched';
    case 'dropped':
      return 'Dropped';
    default:
      return '';
  }
}

/* --------------------------------------------------------- Jump back in */

export type JumpItem = {
  kind: FindKind;
  id: string;
  title: string;
  /** What comes next ("Ch. 13", "S02E04", "Chapter 3 of 12", "12 min left"). */
  sub: string;
  /** 0..1, or null when there is nothing to measure. */
  progress: number | null;
  /** When you last did it. */
  at: number;
};

const fmtLeft = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min left` : `${min} min left`;
};

/**
 * What you were in the middle of, most recent first: videos you stopped
 * part way (with their resume point), audio and books you have not finished,
 * manga with a chapter waiting, and Simkl shows with a next episode.
 */
export function jumpBackIn(
  input: FindInput & {
    /** Video id -> where you stopped (ms), with when you watched it last. */
    resume: { id: string; ms: number; at: number }[];
  },
  limit = 12
): JumpItem[] {
  const out: JumpItem[] = [];
  const videos = new Map(input.videos.map((v) => [v.id, v]));
  for (const r of input.resume) {
    const v = videos.get(r.id);
    if (!v || v.isPrivate || v.deletedAt || r.ms <= 0) continue;
    const dur = v.durationMs ?? 0;
    out.push({
      kind: 'video',
      id: v.id,
      title: v.title?.trim() || v.filename,
      sub: dur > r.ms ? fmtLeft(dur - r.ms) : 'Continue',
      progress: dur > 0 ? Math.min(1, r.ms / dur) : null,
      at: r.at,
    });
  }

  for (const a of input.audio) {
    if (a.isPrivate || a.deletedAt || !a.lastPlayedAt || a.finishedAt || a.status === 'completed') continue;
    const durs = a.tracks.map((t) => t.durationMs ?? 0);
    const total = durs.reduce((x, y) => x + y, 0) || a.durationMs || 0;
    const done = durs.slice(0, a.positionTrack).reduce((x, y) => x + y, 0) + a.positionMs;
    if (done <= 0) continue;
    out.push({
      kind: a.kind === 'book' ? 'book' : 'audio',
      id: a.id,
      title: a.title?.trim() || a.filename,
      sub: a.tracks.length > 1 ? `Chapter ${a.positionTrack + 1} of ${a.tracks.length}` : total > done ? fmtLeft(total - done) : 'Continue',
      progress: total > 0 ? Math.min(1, done / total) : null,
      at: a.lastPlayedAt,
    });
  }

  for (const m of input.manga) {
    if (m.isPrivate || m.deletedAt || !m.lastReadAt || m.status === 'completed' || m.status === 'dropped') continue;
    // The chapter you are in, else the first unread one after the last you read.
    const started = m.chapters.find((c) => !c.readAt && c.lastPage > 0);
    let lastRead = -1;
    m.chapters.forEach((c, i) => {
      if (c.readAt) lastRead = i;
    });
    const next = started ?? m.chapters.slice(lastRead + 1).find((c) => !c.readAt);
    if (!next) continue;
    const read = m.chapters.filter((c) => c.readAt).length;
    out.push({
      kind: 'manga',
      id: m.id,
      title: m.title,
      sub: started && started.pageCount ? `${chapterLabel(next)} · page ${started.lastPage + 1} of ${started.pageCount}` : `${chapterLabel(next)} next`,
      progress: m.chapters.length ? read / m.chapters.length : null,
      at: m.lastReadAt,
    });
  }

  for (const t of input.titles) {
    if (t.type === 'movie' || t.status !== 'watching' || !t.nextToWatch) continue;
    const at = Date.parse(t.lastWatchedAt ?? t.addedAt ?? '') || 0;
    out.push({
      kind: t.type,
      id: String(t.simklId),
      title: t.title,
      sub: t.nextTitle ? `${t.nextToWatch} · ${t.nextTitle}` : t.nextToWatch,
      progress: t.totalEpisodes > 0 ? Math.min(1, t.watchedEpisodes / t.totalEpisodes) : null,
      at,
    });
  }

  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Counts per kind, for the scope chips ("Videos 12"). */
export function countByKind(found: Found[]): Partial<Record<FindKind, number>> {
  const out: Partial<Record<FindKind, number>> = {};
  for (const f of found) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

/* ------------------------------------------------------------ this week */

export type WeekInput = {
  videoPlays: { startedAt: number; watchedMs: number }[];
  /** Simkl watches (episodes and movies) with their length. */
  watches: { at: number; minutes: number; type: 'movie' | 'show' | 'anime' }[];
  /** When each manga chapter was finished. */
  chapterTimes: number[];
  audioPlays: { startedAt: number; listenedMs: number }[];
};

export type WeekPart = { videoMs: number; episodes: number; movies: number; watchMs: number; chapters: number; listenMs: number };
export type WeekSummary = WeekPart & {
  /** The 7 days before, to compare. */
  before: WeekPart;
  /** Days of the last 7 with anything at all. */
  activeDays: number;
};

const DAY_MS = 86_400_000;

/** The last 7 days across every section (and the 7 before them). */
export function weekSummary(i: WeekInput, now: number): WeekSummary {
  const part = (from: number, to: number): WeekPart => {
    const inR = (t: number) => t >= from && t < to;
    const w = i.watches.filter((x) => inR(x.at));
    return {
      videoMs: i.videoPlays.filter((x) => inR(x.startedAt)).reduce((a, x) => a + x.watchedMs, 0),
      episodes: w.filter((x) => x.type !== 'movie').length,
      movies: w.filter((x) => x.type === 'movie').length,
      watchMs: w.reduce((a, x) => a + x.minutes * 60_000, 0),
      chapters: i.chapterTimes.filter(inR).length,
      listenMs: i.audioPlays.filter((x) => inR(x.startedAt)).reduce((a, x) => a + x.listenedMs, 0),
    };
  };
  const from = now - 7 * DAY_MS;
  const days = new Set<string>();
  const mark = (t: number) => {
    if (t < from || t > now) return;
    const d = new Date(t);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  };
  for (const x of i.videoPlays) if (x.watchedMs >= 30_000) mark(x.startedAt);
  for (const x of i.watches) mark(x.at);
  for (const t of i.chapterTimes) mark(t);
  for (const x of i.audioPlays) if (x.listenedMs >= 30_000) mark(x.startedAt);
  return { ...part(from, now + 1), before: part(from - 7 * DAY_MS, from), activeDays: Math.min(7, days.size) };
}

/** Recent searches: newest first, no repeats (whatever the case), at most `max`. */
export function rememberSearch(list: string[], q: string, max = 8): string[] {
  const t = q.trim();
  if (t.length < 2) return list;
  return [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, max);
}
