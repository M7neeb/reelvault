/**
 * Numbers about your own videos: the Videos dashboard, the storage dashboard,
 * Wrapped (yours and Simkl's, for a week or any range), streaks, rating
 * meanings and "continue another time". Pure (no database, no files), so it
 * is tested in Node; the screens get the plays and items from the data layer.
 */

import type { SimklItem } from '../simkl/logic';
// The .ts extension lets Node run this file directly in the tests.
import { friendlyName } from './names.ts';
import type { Meta, WatchEvent } from '../simkl/insights';

/** The parts of a video these numbers need (a subset of VaultItem). */
export type StatVideo = {
  id: string;
  filename: string;
  title: string | null;
  sizeBytes: number;
  durationMs: number | null;
  rating: number;
  width: number | null;
  height: number | null;
  createdAt: number;
  importedAt: number;
  tagNames: string[];
  meta?: { codec?: string } | null;
  originalSizeBytes?: number | null;
};

export type VaultPlay = { videoId: string; startedAt: number; watchedMs: number };

export type Ranked = { key: string; label: string; value: number; sub?: string };

const DAY = 86_400_000;
export const nameOf = (v: Pick<StatVideo, 'title' | 'filename'> & { createdAt?: number }) => friendlyName(v);

/* -------------------------------------------------------------- dashboard */

export type TagStat = { tag: string; videos: number; avgRating: number | null; plays: number; watchedMs: number };

export type VideoDashboard = {
  videos: number;
  footageMs: number;
  plays: number;
  watchedMs: number;
  rated: number;
  avgRating: number | null;
  /** 1..10, how many videos have each rating. */
  ratingHistogram: number[];
  mostWatched: Ranked[];
  mostRewatched: Ranked[];
  topRated: Ranked[];
  /** The tag you rate highest (at least 2 rated videos), else the most used. */
  favouriteTag: TagStat | null;
  /** The tag whose videos you spend the most time watching. */
  mostWatchedTag: TagStat | null;
  tags: TagStat[];
  neverWatched: number;
  weekday: number[];
  hours: number[];
};

export function videoDashboard(items: StatVideo[], plays: VaultPlay[]): VideoDashboard {
  const byId = new Map(items.map((v) => [v.id, v]));
  const per = new Map<string, { plays: number; ms: number }>();
  const weekday = Array(7).fill(0);
  const hours = Array(24).fill(0);
  for (const p of plays) {
    if (!byId.has(p.videoId)) continue;
    const s = per.get(p.videoId) ?? { plays: 0, ms: 0 };
    s.plays++;
    s.ms += p.watchedMs;
    per.set(p.videoId, s);
    const d = new Date(p.startedAt);
    weekday[(d.getDay() + 6) % 7] += p.watchedMs;
    hours[d.getHours()] += p.watchedMs;
  }
  const rated = items.filter((v) => v.rating > 0);
  const hist = Array(10).fill(0);
  for (const v of rated) hist[Math.min(10, Math.max(1, Math.round(v.rating))) - 1]++;

  const tagMap = new Map<string, { videos: number; ratings: number[]; plays: number; ms: number }>();
  for (const v of items) {
    for (const t of v.tagNames) {
      const s = tagMap.get(t) ?? { videos: 0, ratings: [], plays: 0, ms: 0 };
      s.videos++;
      if (v.rating > 0) s.ratings.push(v.rating);
      const w = per.get(v.id);
      if (w) {
        s.plays += w.plays;
        s.ms += w.ms;
      }
      tagMap.set(t, s);
    }
  }
  const tags: TagStat[] = [...tagMap.entries()]
    .map(([tag, s]) => ({
      tag,
      videos: s.videos,
      avgRating: s.ratings.length ? s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length : null,
      plays: s.plays,
      watchedMs: s.ms,
    }))
    .sort((a, b) => b.videos - a.videos || a.tag.localeCompare(b.tag));
  const ratedTags = tags.filter((t) => t.avgRating !== null && tagMap.get(t.tag)!.ratings.length >= 2);
  const favouriteTag =
    [...ratedTags].sort((a, b) => b.avgRating! - a.avgRating! || b.videos - a.videos)[0] ?? tags[0] ?? null;
  const mostWatchedTag = [...tags].filter((t) => t.watchedMs > 0).sort((a, b) => b.watchedMs - a.watchedMs)[0] ?? null;

  const ranked = (pick: (s: { plays: number; ms: number }) => number, sub: (s: { plays: number; ms: number }) => string) =>
    [...per.entries()]
      .filter(([, s]) => pick(s) > 0)
      .sort((a, b) => pick(b[1]) - pick(a[1]))
      .slice(0, 10)
      .map(([id, s]) => ({ key: id, label: nameOf(byId.get(id)!), value: pick(s), sub: sub(s) }));

  return {
    videos: items.length,
    footageMs: items.reduce((a, v) => a + (v.durationMs ?? 0), 0),
    plays: [...per.values()].reduce((a, s) => a + s.plays, 0),
    watchedMs: [...per.values()].reduce((a, s) => a + s.ms, 0),
    rated: rated.length,
    avgRating: rated.length ? rated.reduce((a, v) => a + v.rating, 0) / rated.length : null,
    ratingHistogram: hist,
    mostWatched: ranked((s) => s.ms, (s) => `${s.plays} ${s.plays === 1 ? 'play' : 'plays'}`),
    mostRewatched: ranked((s) => (s.plays > 1 ? s.plays : 0), (s) => fmtMs(s.ms)),
    topRated: [...rated]
      .sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt)
      .slice(0, 10)
      .map((v) => ({ key: v.id, label: nameOf(v), value: v.rating })),
    favouriteTag,
    mostWatchedTag,
    tags,
    neverWatched: items.filter((v) => !per.has(v.id)).length,
    weekday,
    hours,
  };
}

/* ---------------------------------------------------------------- storage */

export type StorageStats = {
  totalBytes: number;
  count: number;
  biggest: Ranked[];
  byQuality: Ranked[];
  byCodec: Ranked[];
  byYear: Ranked[];
  /** Saved so far by Make Smaller. */
  savedBytes: number;
  /** H.264 videos that would roughly halve as HEVC. */
  couldSaveBytes: number;
  couldSaveCount: number;
  deletedBytes: number;
};

export function qualityOf(v: Pick<StatVideo, 'width' | 'height'>): string {
  const short = Math.min(v.width ?? 0, v.height ?? 0);
  if (!short) return 'Unknown';
  if (short >= 2000) return '4K';
  if (short >= 1000) return '1080p';
  if (short >= 700) return '720p';
  return 'Smaller';
}

export function storageStats(items: StatVideo[], deleted: StatVideo[] = []): StorageStats {
  const sum = (list: StatVideo[]) => list.reduce((a, v) => a + v.sizeBytes, 0);
  const group = (key: (v: StatVideo) => string) => {
    const m = new Map<string, StatVideo[]>();
    for (const v of items) m.set(key(v), [...(m.get(key(v)) ?? []), v]);
    return [...m.entries()]
      .map(([k, list]) => ({ key: k, label: k, value: sum(list), sub: `${list.length} ${list.length === 1 ? 'video' : 'videos'}` }))
      .sort((a, b) => b.value - a.value);
  };
  const h264 = items.filter((v) => /avc|264/i.test(v.meta?.codec ?? ''));
  return {
    totalBytes: sum(items),
    count: items.length,
    biggest: [...items]
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, 10)
      .map((v) => ({ key: v.id, label: nameOf(v), value: v.sizeBytes, sub: qualityOf(v) })),
    byQuality: group(qualityOf),
    byCodec: group((v) => (v.meta?.codec ? (/hev|hvc|265/i.test(v.meta.codec) ? 'HEVC' : /avc|264/i.test(v.meta.codec) ? 'H.264' : v.meta.codec) : 'Unknown')),
    byYear: group((v) => String(new Date(v.createdAt).getFullYear())).sort((a, b) => b.key.localeCompare(a.key)),
    savedBytes: items.reduce((a, v) => a + Math.max(0, (v.originalSizeBytes ?? v.sizeBytes) - v.sizeBytes), 0),
    couldSaveBytes: Math.round(sum(h264) * 0.45),
    couldSaveCount: h264.length,
    deletedBytes: sum(deleted),
  };
}

/* ------------------------------------------------------------------ wrapped */

export type Range = { start: number; end: number; label: string };

/** Monday-first weeks, newest first: the weekly Wrapped list. */
export function recentWeeks(now: number, count = 8): Range[] {
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  const out: Range[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(monday - i * 7 * DAY);
    const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7).getTime();
    out.push({ start: startMs, end, label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `Week of ${fmtDay(startMs)}` });
  }
  return out;
}

/** "Last 30 days", "This year" and friends, for a custom Wrapped. */
export function presetRange(kind: 'days7' | 'days30' | 'month' | 'year' | 'all', now: number, earliest = now): Range {
  const d = new Date(now);
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  switch (kind) {
    case 'days7':
      return { start: tomorrow - 7 * DAY, end: tomorrow, label: 'Last 7 days' };
    case 'days30':
      return { start: tomorrow - 30 * DAY, end: tomorrow, label: 'Last 30 days' };
    case 'month':
      return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: tomorrow, label: 'This month' };
    case 'year':
      return { start: new Date(d.getFullYear(), 0, 1).getTime(), end: tomorrow, label: `${d.getFullYear()} so far` };
    default:
      return { start: Math.min(earliest, tomorrow - DAY), end: tomorrow, label: 'All time' };
  }
}

export type VideoWrapped = {
  watchedMs: number;
  plays: number;
  videosWatched: number;
  imported: number;
  importedBytes: number;
  topVideos: Ranked[];
  topTags: Ranked[];
  busiestDay: { day: number; ms: number } | null;
  longestSession: { label: string; ms: number } | null;
  bestNew: Ranked | null;
  /** A one-word take on the period, for the last card. */
  persona: string;
  /** Days with something watched, and the best run of days in a row. */
  activeDays: number;
  bestRun: number;
  /** The hour you most often press play (0..23), or null. */
  peakHour: number | null;
  /** The first thing you watched in the period. */
  firstVideo: Ranked | null;
  /** The share of the time that went to the top video (0..1). */
  topShare: number;
};

export type SimklWrapped = {
  minutes: number;
  episodes: number;
  movies: number;
  titles: number;
  topTitles: Ranked[];
  topGenres: Ranked[];
};

export type Wrapped = { range: Range; videos: VideoWrapped; simkl: SimklWrapped | null; totalMinutes: number };

const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function wrapped(
  range: Range,
  items: StatVideo[],
  plays: VaultPlay[],
  simkl?: { events: WatchEvent[]; items: SimklItem[]; meta: Map<number, Meta> }
): Wrapped {
  const inR = (t: number) => t >= range.start && t < range.end;
  const byId = new Map(items.map((v) => [v.id, v]));
  const ps = plays.filter((p) => inR(p.startedAt) && byId.has(p.videoId));
  const per = new Map<string, number>();
  const days = new Map<number, number>();
  const tags = new Map<string, number>();
  let longest: { label: string; ms: number } | null = null;
  const hourCount = Array(24).fill(0);
  for (const p of ps) {
    hourCount[new Date(p.startedAt).getHours()] += p.watchedMs;
    per.set(p.videoId, (per.get(p.videoId) ?? 0) + p.watchedMs);
    const day = startOfDay(p.startedAt);
    days.set(day, (days.get(day) ?? 0) + p.watchedMs);
    for (const t of byId.get(p.videoId)!.tagNames) tags.set(t, (tags.get(t) ?? 0) + p.watchedMs);
    if (!longest || p.watchedMs > longest.ms) longest = { label: nameOf(byId.get(p.videoId)!), ms: p.watchedMs };
  }
  const imported = items.filter((v) => inR(v.importedAt));
  const best = [...imported].filter((v) => v.rating > 0).sort((a, b) => b.rating - a.rating)[0];
  const busiest = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
  const watchedMs = [...per.values()].reduce((a, b) => a + b, 0);
  const topTags = [...tags.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, ms]) => ({ key: t, label: t, value: ms, sub: fmtMs(ms) }));

  const videos: VideoWrapped = {
    watchedMs,
    plays: ps.length,
    videosWatched: per.size,
    imported: imported.length,
    importedBytes: imported.reduce((a, v) => a + v.sizeBytes, 0),
    topVideos: [...per.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, ms]) => ({ key: id, label: nameOf(byId.get(id)!), value: ms, sub: fmtMs(ms) })),
    topTags,
    busiestDay: busiest ? { day: busiest[0], ms: busiest[1] } : null,
    longestSession: longest,
    bestNew: best ? { key: best.id, label: nameOf(best), value: best.rating } : null,
    persona: persona(ps.length, per.size, topTags[0]?.label),
    activeDays: days.size,
    bestRun: longestStreak(ps.map((p) => p.startedAt)),
    peakHour: Math.max(...hourCount) > 0 ? hourCount.indexOf(Math.max(...hourCount)) : null,
    firstVideo: (() => {
      const f = [...ps].sort((a, b) => a.startedAt - b.startedAt)[0];
      return f ? { key: f.videoId, label: nameOf(byId.get(f.videoId)!), value: f.startedAt } : null;
    })(),
    topShare: watchedMs ? Math.max(0, ...per.values()) / watchedMs : 0,
  };

  let simklPart: SimklWrapped | null = null;
  if (simkl) {
    const ev = simkl.events.filter((e) => inR(e.at));
    const byTitle = new Map<number, number>();
    const genres = new Map<string, number>();
    for (const e of ev) {
      byTitle.set(e.simklId, (byTitle.get(e.simklId) ?? 0) + e.minutes);
      for (const g of simkl.meta.get(e.simklId)?.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + e.minutes);
    }
    const titleOf = new Map(simkl.items.map((i) => [i.simklId, i.title]));
    simklPart = {
      minutes: ev.reduce((a, e) => a + e.minutes, 0),
      episodes: ev.filter((e) => e.type !== 'movie').length,
      movies: ev.filter((e) => e.type === 'movie').length,
      titles: byTitle.size,
      topTitles: [...byTitle.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, m]) => ({ key: String(id), label: titleOf.get(id) ?? 'Unknown', value: m, sub: fmtMs(m * 60000) })),
      topGenres: [...genres.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([g, m]) => ({ key: g, label: g, value: m })),
    };
  }
  return { range, videos, simkl: simklPart, totalMinutes: Math.round(watchedMs / 60000) + (simklPart?.minutes ?? 0) };
}

function persona(plays: number, distinct: number, topTag?: string): string {
  if (!plays) return 'The Collector';
  if (distinct && plays / distinct >= 2.5) return 'The Rewatcher';
  if (distinct >= 15) return 'The Explorer';
  if (topTag) return `The ${topTag[0].toUpperCase()}${topTag.slice(1)} Fan`;
  return 'The Regular';
}

/* ------------------------------------------------------------------ streaks */

/** Longest run of consecutive days that have a play or a Simkl watch. */
export function longestStreak(times: number[]): number {
  const days = [...new Set(times.map(startOfDay))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    // DST days are 23 or 25 hours long, so compare by calendar day.
    run = prev !== null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/* ------------------------------------------------------- rating meanings */

/** Your own words for a rating: 1 = "Waste of time", 5 = "Mid"... Any rating can be left empty. */
export type RatingLabels = Record<number, string>;

export const SUGGESTED_LABELS: RatingLabels = {
  1: 'Waste of time',
  3: 'Bad',
  5: 'Mid',
  7: 'Good',
  8: 'Great',
  9: 'Loved it',
  10: 'All-time favourite',
};

export function parseRatingLabels(json: string | null): RatingLabels {
  try {
    const raw = json ? JSON.parse(json) : {};
    const out: RatingLabels = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const n = Number(k);
      if (Number.isInteger(n) && n >= 1 && n <= 10 && typeof v === 'string' && v.trim()) out[n] = v.trim().slice(0, 40);
    }
    return out;
  } catch {
    return {};
  }
}

/** 7.6 → the label for 7 (decimals use the whole number below them); null when there is none. */
export function ratingLabel(rating: number, labels: RatingLabels): string | null {
  if (!rating || rating <= 0) return null;
  return labels[Math.min(10, Math.max(1, Math.floor(rating)))] ?? null;
}

/* ------------------------------------------------------------------ resume */

/** Only videos at least this long offer "Continue another time". */
export const RESUME_MIN_MS = 5 * 60_000;
/** Start this much before where you stopped, to get back into it. */
export const RESUME_REWIND_MS = 2.5 * 60_000;

/** Where to start a saved video: 2.5 min before the saved point (never below 0, never in the last 30 s). */
export function resumeFrom(savedMs: number, durationMs: number | null): number {
  const at = Math.max(0, savedMs - RESUME_REWIND_MS);
  return durationMs ? Math.min(at, Math.max(0, durationMs - 30_000)) : at;
}

export const canResume = (durationMs: number | null) => (durationMs ?? 0) >= RESUME_MIN_MS;

/* ------------------------------------------------------------- formatting */

export function fmtMs(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return ms > 0 ? `${Math.max(1, Math.round(ms / 1000))} s` : '0 min';
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`;
}

export function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(b >= 1e10 ? 0 : 1)} GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  return `${Math.max(0, Math.round(b / 1e3))} KB`;
}

export function fmtDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "12:34" / "1:02:03" for a bookmark. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
