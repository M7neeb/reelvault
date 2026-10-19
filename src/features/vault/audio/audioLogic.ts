/**
 * The rules of the Audio section: one item is an audio file, a book made of
 * several files (chapters), or an EPUB 3 book with read-along. Where you are
 * in it (across files), its chapters, progress, finishing, sorting,
 * filtering and search, the speeds, the sleep timer, "smart rewind" after a
 * pause, decimal ratings, and grouping picked files into one book.
 * Pure: no React, no native modules (tested in Node).
 */

export type AudioStatus = 'planned' | 'listening' | 'finished' | 'dropped';
export const AUDIO_STATUSES: { key: AudioStatus; label: string }[] = [
  { key: 'listening', label: 'Listening' },
  { key: 'planned', label: 'To listen' },
  { key: 'finished', label: 'Finished' },
  { key: 'dropped', label: 'Stopped' },
];

export type AudioTrack = { file: string; title: string; durationMs: number | null };
/** A chapter: where it starts (which file, how far in). */
export type AudioChapterRef = { title: string; track: number; startMs: number };

export type AudioItem = {
  id: string;
  kind: 'audio' | 'book';
  /** The item's folder, relative to the app's documents ("audio/<id>"): never a full path (iOS moves the app's folder on updates). */
  folder: string;
  filename: string;
  size: number;
  durationMs: number | null;
  title: string | null;
  author: string | null;
  album: string | null;
  narrator: string | null;
  year: number | null;
  genre: string | null;
  description: string | null;
  notes: string | null;
  /** 0 = not rated, else 1.0..10.0 (one decimal). */
  rating: number;
  status: AudioStatus | null;
  /** File name of the cover in the folder, or null. */
  cover: string | null;
  tracks: AudioTrack[];
  chapters: AudioChapterRef[];
  contentKey: string | null;
  isPrivate: boolean;
  positionTrack: number;
  positionMs: number;
  speed: number | null;
  lastPlayedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  importedAt: number;
  deletedAt: number | null;
  tags: string[];
};

export const SPEEDS = [0.75, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2, 2.5, 3] as const;
export const SLEEP_OPTIONS: { key: string; label: string; minutes: number | 'chapter' }[] = [
  { key: '5', label: '5 min', minutes: 5 },
  { key: '10', label: '10 min', minutes: 10 },
  { key: '15', label: '15 min', minutes: 15 },
  { key: '30', label: '30 min', minutes: 30 },
  { key: '45', label: '45 min', minutes: 45 },
  { key: '60', label: '1 hour', minutes: 60 },
  { key: 'chapter', label: 'End of chapter', minutes: 'chapter' },
];

/** "3 h 12 min", "12 min", "45 s". */
export function fmtLength(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "1:02:03" or "2:03". */
export function fmtClockMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** A rating to one decimal, 0 (none) or 1.0..10.0. */
export function normaliseRating(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(10, Math.max(1, Math.round(v * 10) / 10));
}
export const fmtRating = (r: number) => (r <= 0 ? '' : Number.isInteger(r) ? String(r) : r.toFixed(1));
export const isFavourite = (i: Pick<AudioItem, 'rating'>) => i.rating >= 8;

export const displayTitle = (i: Pick<AudioItem, 'title' | 'filename'>) => i.title?.trim() || i.filename.replace(/\.[^.]+$/, '');

/* ------------------------------------------------------------ position */

export function totalMs(i: Pick<AudioItem, 'tracks' | 'durationMs'>): number {
  const sum = i.tracks.reduce((a, t) => a + (t.durationMs ?? 0), 0);
  return sum || i.durationMs || 0;
}

/** Where you are, counted from the start of the whole item. */
export function overallMs(i: Pick<AudioItem, 'tracks' | 'positionTrack' | 'positionMs'>, track = i.positionTrack, ms = i.positionMs): number {
  let at = 0;
  for (let t = 0; t < Math.min(track, i.tracks.length); t++) at += i.tracks[t].durationMs ?? 0;
  return at + ms;
}

/** From a time in the whole item to (file, time in it). */
export function locate(i: Pick<AudioItem, 'tracks'>, overall: number): { track: number; ms: number } {
  let left = Math.max(0, overall);
  for (let t = 0; t < i.tracks.length; t++) {
    const d = i.tracks[t].durationMs ?? 0;
    if (left < d || t === i.tracks.length - 1) return { track: t, ms: Math.min(left, d || left) };
    left -= d;
  }
  return { track: 0, ms: 0 };
}

export function progressOf(i: AudioItem): number {
  const total = totalMs(i);
  if (i.finishedAt && i.status === 'finished') return 1;
  return total ? Math.min(1, overallMs(i) / total) : 0;
}

/** Close enough to the end to count as finished: the last 2%, or the last minute. */
export function isAtEnd(i: Pick<AudioItem, 'tracks' | 'durationMs'>, overall: number): boolean {
  const total = totalMs(i);
  return total > 0 && (overall >= total * 0.98 || total - overall <= 60_000);
}

export type ChapterView = { title: string; track: number; startMs: number; overallStart: number; lengthMs: number };

/**
 * The chapters of an item: the marks inside the file(s) when there are any,
 * else one per file (a book made of several files), else none.
 */
export function chaptersOf(i: Pick<AudioItem, 'tracks' | 'chapters' | 'durationMs'>): ChapterView[] {
  const marks: AudioChapterRef[] = i.chapters.length ? i.chapters : i.tracks.length > 1 ? i.tracks.map((t, n) => ({ title: t.title, track: n, startMs: 0 })) : [];
  const total = totalMs(i);
  const withStart = marks
    .map((c) => ({ ...c, overallStart: overallMs({ tracks: i.tracks, positionTrack: c.track, positionMs: c.startMs }) }))
    .sort((a, b) => a.overallStart - b.overallStart);
  return withStart.map((c, n) => ({ ...c, lengthMs: Math.max(0, (withStart[n + 1]?.overallStart ?? total) - c.overallStart) }));
}

/** The chapter playing at `overall` ms (index into chaptersOf), or -1. */
export function chapterIndexAt(chapters: ChapterView[], overall: number): number {
  let idx = -1;
  for (let n = 0; n < chapters.length; n++) if (chapters[n].overallStart <= overall + 250) idx = n;
  return idx;
}

/**
 * How far back to start after a pause, so you hear the end of the last
 * sentence again: nothing for under a minute, then 5 s, 15 s (10 min+),
 * 30 s (an hour+).
 */
export function smartRewindMs(pausedForMs: number): number {
  if (pausedForMs < 60_000) return 0;
  if (pausedForMs < 10 * 60_000) return 5_000;
  if (pausedForMs < 60 * 60_000) return 15_000;
  return 30_000;
}

/** The next speed in the list (wraps), for the speed button. */
export function nextSpeed(current: number): number {
  const i = SPEEDS.findIndex((s) => s > current + 0.001);
  return i < 0 ? SPEEDS[0] : SPEEDS[i];
}

/** When the sleep timer stops playback: a time (ms since 1970) or the end of the chapter (null = chapter). */
export function sleepEndsAt(option: number | 'chapter', now: number): number | null {
  return option === 'chapter' ? null : now + option * 60_000;
}

/* ---------------------------------------------------------- the list */

export type AudioSort = 'recent' | 'added' | 'title' | 'author' | 'rating' | 'length' | 'progress';
export const AUDIO_SORTS: { key: AudioSort; label: string }[] = [
  { key: 'recent', label: 'Recently played' },
  { key: 'added', label: 'Recently added' },
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'rating', label: 'Rating' },
  { key: 'length', label: 'Length' },
  { key: 'progress', label: 'Progress' },
];

export type AudioFilter = {
  query?: string;
  status?: AudioStatus | 'inProgress' | 'notStarted' | null;
  tag?: string | null;
  favourites?: boolean;
  kind?: 'audio' | 'book' | null;
};

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function matchesAudio(i: AudioItem, f: AudioFilter): boolean {
  if (f.kind && i.kind !== f.kind) return false;
  if (f.favourites && !isFavourite(i)) return false;
  if (f.tag && !i.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
  if (f.status === 'inProgress') {
    const p = progressOf(i);
    if (!(p > 0 && p < 1 && i.status !== 'finished')) return false;
  } else if (f.status === 'notStarted') {
    if (progressOf(i) > 0 || i.status === 'finished') return false;
  } else if (f.status && i.status !== f.status) return false;
  const q = norm(f.query).trim();
  if (q) {
    const hay = norm([i.title, i.author, i.album, i.narrator, i.filename, i.notes, i.genre, i.description, ...i.tags].filter(Boolean).join(' \u0001 '));
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function sortAudio<T extends AudioItem>(list: T[], sort: AudioSort): T[] {
  const by = (f: (i: T) => number | string, desc = false) => (a: T, b: T) => {
    const x = f(a);
    const y = f(b);
    const c = typeof x === 'string' ? x.localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) : x - (y as number);
    return desc ? -c : c;
  };
  const cmp: Record<AudioSort, (a: T, b: T) => number> = {
    recent: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.importedAt - a.importedAt,
    added: by((i) => i.importedAt, true),
    title: by((i) => displayTitle(i)),
    author: (a, b) => (a.author ?? '￿').localeCompare(b.author ?? '￿', undefined, { sensitivity: 'base' }) || displayTitle(a).localeCompare(displayTitle(b), undefined, { numeric: true }),
    rating: (a, b) => b.rating - a.rating || displayTitle(a).localeCompare(displayTitle(b)),
    length: by((i) => totalMs(i), true),
    progress: by((i) => progressOf(i), true),
  };
  return [...list].sort(cmp[sort]);
}

/** "Continue listening": started, not finished, played most recently first. */
export function continueListening<T extends AudioItem>(list: T[], max = 8): T[] {
  return list
    .filter((i) => !i.deletedAt && i.status !== 'finished' && i.lastPlayedAt && progressOf(i) < 1)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, max);
}

/** Authors with how many items and how long in total, most first. */
export function authorsOf(list: AudioItem[]): { name: string; count: number; ms: number }[] {
  const m = new Map<string, { name: string; count: number; ms: number }>();
  for (const i of list) {
    const name = (i.author ?? '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    const cur = m.get(k) ?? { name, count: 0, ms: 0 };
    cur.count++;
    cur.ms += totalMs(i);
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.ms - a.ms);
}

/* ------------------------------------------------------- picking files */

export type PickedAudio = { name: string; album?: string | null; artist?: string | null; track?: number | null };

/**
 * Picked files that look like one book: two or more with the same album (and
 * artist). The rest stay single items. Order inside a group follows the
 * track numbers, then the names.
 */
export function groupIntoBooks<T extends PickedAudio>(files: T[]): { groups: { album: string; artist: string | null; files: T[] }[]; singles: T[] } {
  const byKey = new Map<string, { album: string; artist: string | null; files: T[] }>();
  const singles: T[] = [];
  for (const f of files) {
    const album = f.album?.trim();
    if (!album) {
      singles.push(f);
      continue;
    }
    const k = `${album.toLowerCase()}\u0001${(f.artist ?? '').trim().toLowerCase()}`;
    const g = byKey.get(k) ?? { album, artist: f.artist?.trim() || null, files: [] };
    g.files.push(f);
    byKey.set(k, g);
  }
  const groups: { album: string; artist: string | null; files: T[] }[] = [];
  for (const g of byKey.values()) {
    if (g.files.length < 2) singles.push(...g.files);
    else
      groups.push({
        ...g,
        files: [...g.files].sort((a, b) => (a.track ?? 9999) - (b.track ?? 9999) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })),
      });
  }
  return { groups, singles };
}

/* -------------------------------------------------------------- stats */

export type AudioPlay = { itemId: string; startedAt: number; listenedMs: number };

const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export type AudioStats = {
  totalMs: number;
  weekMs: number;
  todayMs: number;
  days: number;
  streak: number;
  bestStreak: number;
  finished: number;
  inProgress: number;
  libraryMs: number;
  /** Most listened, all time. */
  top: { id: string; ms: number }[];
  /** Mon..Sun this week. */
  week: { label: string; ms: number; today: boolean }[];
  /** 0..23. */
  hours: number[];
  averageRating: number | null;
};

export function audioStats(items: AudioItem[], plays: AudioPlay[], now: number): AudioStats {
  const live = items.filter((i) => !i.deletedAt);
  const ids = new Set(live.map((i) => i.id));
  const ps = plays.filter((p) => ids.has(p.itemId) && p.listenedMs > 0);
  const today = sod(now);
  const dow = (new Date(now).getDay() + 6) % 7;
  const monday = sod(today - dow * 86_400_000 + 3_600_000);
  const days = new Set(ps.map((p) => sod(p.startedAt)));
  let streak = 0;
  let d = days.has(today) ? today : sod(today - 43_200_000);
  while (days.has(d)) {
    streak++;
    d = sod(d - 43_200_000);
  }
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let n = 0; n < sorted.length; n++) {
    run = n && sorted[n] - sorted[n - 1] <= 90_000_000 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const per = new Map<string, number>();
  for (const p of ps) per.set(p.itemId, (per.get(p.itemId) ?? 0) + p.listenedMs);
  const hours = Array.from({ length: 24 }, () => 0);
  for (const p of ps) hours[new Date(p.startedAt).getHours()] += p.listenedMs;
  const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, n) => {
    const start = sod(monday + n * 86_400_000 + 3_600_000);
    const end = sod(start + 86_400_000 + 3_600_000);
    return { label, ms: ps.filter((p) => p.startedAt >= start && p.startedAt < end).reduce((a, p) => a + p.listenedMs, 0), today: start === today };
  });
  const rated = live.filter((i) => i.rating > 0);
  return {
    totalMs: ps.reduce((a, p) => a + p.listenedMs, 0),
    weekMs: ps.filter((p) => p.startedAt >= monday).reduce((a, p) => a + p.listenedMs, 0),
    todayMs: ps.filter((p) => p.startedAt >= today).reduce((a, p) => a + p.listenedMs, 0),
    days: days.size,
    streak,
    bestStreak: best,
    finished: live.filter((i) => i.status === 'finished').length,
    inProgress: live.filter((i) => i.status !== 'finished' && progressOf(i) > 0).length,
    libraryMs: live.reduce((a, i) => a + totalMs(i), 0),
    top: [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, ms]) => ({ id, ms })),
    week,
    hours,
    averageRating: rated.length ? Math.round((rated.reduce((a, i) => a + i.rating, 0) / rated.length) * 10) / 10 : null,
  };
}
