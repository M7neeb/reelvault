/**
 * What you watched and when: the watch history (plays of the same video close
 * together are one sitting), the stats behind the History tab, the "haven't
 * watched in a year" shelf, a random pick that favours what you rarely see,
 * and sorting by how much you watch. Pure, so it is tested in Node.
 */

import { friendlyName } from './names.ts';

export type HVideo = {
  id: string;
  title: string | null;
  filename: string;
  createdAt: number;
  importedAt: number;
  durationMs: number | null;
  rating: number;
  tagNames: string[];
};

export type HPlay = { videoId: string; startedAt: number; watchedMs: number };

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/* ---------------------------------------------------------------- history */

/** One sitting with one video: plays less than 20 minutes apart are joined. */
export type Sitting = { videoId: string; at: number; ms: number; plays: number };

export type HistoryDay = { key: number; title: string; ms: number; sittings: Sitting[] };

const GAP = 20 * 60_000;

function dayTitle(key: number, now: number): string {
  const today = sod(now);
  if (key === today) return 'Today';
  if (Math.round((today - key) / DAY) === 1) return 'Yesterday';
  const d = new Date(key);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Newest day first, newest sitting first. `known` drops plays of videos that are gone. */
export function historyDays(plays: HPlay[], now: number, known?: Set<string>): HistoryDay[] {
  const list = plays.filter((p) => !known || known.has(p.videoId)).sort((a, b) => a.startedAt - b.startedAt);
  const sittings: Sitting[] = [];
  const open = new Map<string, Sitting & { end: number }>();
  for (const p of list) {
    const cur = open.get(p.videoId);
    if (cur && p.startedAt - cur.end <= GAP && sod(p.startedAt) === sod(cur.at)) {
      cur.ms += p.watchedMs;
      cur.plays += 1;
      cur.end = p.startedAt + p.watchedMs;
    } else {
      const s = { videoId: p.videoId, at: p.startedAt, ms: p.watchedMs, plays: 1, end: p.startedAt + p.watchedMs };
      open.set(p.videoId, s);
      sittings.push(s);
    }
  }
  const days = new Map<number, HistoryDay>();
  for (const s of sittings) {
    const key = sod(s.at);
    const d = days.get(key) ?? { key, title: dayTitle(key, now), ms: 0, sittings: [] };
    d.ms += s.ms;
    d.sittings.push({ videoId: s.videoId, at: s.at, ms: s.ms, plays: s.plays });
    days.set(key, d);
  }
  return [...days.values()].sort((a, b) => b.key - a.key).map((d) => ({ ...d, sittings: d.sittings.sort((a, b) => b.at - a.at) }));
}

/* ------------------------------------------------------------------ stats */

export type WatchStats = {
  totalMs: number;
  plays: number;
  sittings: number;
  /** Different videos you have watched, and how many you never have. */
  watched: number;
  neverWatched: number;
  avgSittingMs: number;
  longest: { videoId: string; ms: number; at: number } | null;
  /** Watch time per hour of the day (0-23) and per weekday (0 = Monday). */
  byHour: number[];
  byWeekday: number[];
  peakHour: number | null;
  peakWeekday: number | null;
  /** The day you watched the most. */
  biggestDay: { at: number; ms: number } | null;
  daysActive: number;
  currentStreak: number;
  longestStreak: number;
  /** Most plays first. */
  rewatched: { videoId: string; plays: number; ms: number }[];
  /** How much of a video you watch on average (0-1), for videos with a known length. */
  finishRate: number | null;
  /** Watch time for each of the last 12 months, oldest first. */
  months: { key: number; label: string; ms: number }[];
  firstPlayAt: number | null;
  /** Tags you watch most, by watch time. */
  topTags: { tag: string; ms: number }[];
};

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function streaks(days: number[], now: number): { current: number; longest: number } {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    run = prev !== null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  // The current streak counts back from today, or from yesterday if today has nothing yet.
  const set = new Set(sorted);
  let day = sod(now);
  if (!set.has(day)) day = sod(day - DAY / 2);
  let current = 0;
  while (set.has(day)) {
    current += 1;
    day = sod(day - DAY / 2);
  }
  return { current, longest };
}

export function watchStats(videos: HVideo[], plays: HPlay[], now: number): WatchStats {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const mine = plays.filter((p) => byId.has(p.videoId));
  const totalMs = mine.reduce((a, p) => a + p.watchedMs, 0);
  const sittingList = historyDays(mine, now).flatMap((d) => d.sittings);
  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const perDay = new Map<number, number>();
  const per = new Map<string, { plays: number; ms: number }>();
  for (const p of mine) {
    const d = new Date(p.startedAt);
    byHour[d.getHours()] += p.watchedMs;
    byWeekday[(d.getDay() + 6) % 7] += p.watchedMs;
    perDay.set(sod(p.startedAt), (perDay.get(sod(p.startedAt)) ?? 0) + p.watchedMs);
    const x = per.get(p.videoId) ?? { plays: 0, ms: 0 };
    x.plays += 1;
    x.ms += p.watchedMs;
    per.set(p.videoId, x);
  }
  const peak = (arr: number[]) => (arr.some((x) => x > 0) ? arr.indexOf(Math.max(...arr)) : null);
  const biggest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const longest = [...sittingList].sort((a, b) => b.ms - a.ms)[0];
  const st = streaks([...perDay.keys()], now);
  const ratios = sittingList
    .map((s) => ({ s, d: byId.get(s.videoId)?.durationMs ?? 0 }))
    .filter((x) => x.d > 0)
    .map((x) => Math.min(1, x.s.ms / x.d));
  const n = new Date(now);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = new Date(n.getFullYear(), n.getMonth() - 11 + i, 1);
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
    return {
      key: m.getTime(),
      label: m.toLocaleDateString('en-GB', { month: 'narrow' }),
      ms: mine.filter((p) => p.startedAt >= m.getTime() && p.startedAt < next).reduce((a, p) => a + p.watchedMs, 0),
    };
  });
  const tagMs = new Map<string, number>();
  for (const p of mine) for (const t of byId.get(p.videoId)!.tagNames) tagMs.set(t, (tagMs.get(t) ?? 0) + p.watchedMs);
  return {
    totalMs,
    plays: mine.length,
    sittings: sittingList.length,
    watched: per.size,
    neverWatched: videos.filter((v) => !per.has(v.id)).length,
    avgSittingMs: sittingList.length ? Math.round(totalMs / sittingList.length) : 0,
    longest: longest ? { videoId: longest.videoId, ms: longest.ms, at: longest.at } : null,
    byHour,
    byWeekday,
    peakHour: peak(byHour),
    peakWeekday: peak(byWeekday),
    biggestDay: biggest ? { at: biggest[0], ms: biggest[1] } : null,
    daysActive: perDay.size,
    currentStreak: st.current,
    longestStreak: st.longest,
    rewatched: [...per.entries()]
      .map(([videoId, x]) => ({ videoId, ...x }))
      .filter((x) => x.plays >= 2)
      .sort((a, b) => b.plays - a.plays || b.ms - a.ms)
      .slice(0, 10),
    finishRate: ratios.length ? ratios.reduce((a, r) => a + r, 0) / ratios.length : null,
    months,
    firstPlayAt: mine.length ? Math.min(...mine.map((p) => p.startedAt)) : null,
    topTags: [...tagMs.entries()].map(([tag, ms]) => ({ tag, ms })).sort((a, b) => b.ms - a.ms).slice(0, 6),
  };
}

export const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);

/* ------------------------------------------------------- rediscovering */

export function lastWatched(plays: HPlay[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const p of plays) last.set(p.videoId, Math.max(last.get(p.videoId) ?? 0, p.startedAt));
  return last;
}

/**
 * "Haven't watched in a year": videos you last watched more than a year ago,
 * then ones filmed over a year ago you have never watched here. Best rated and
 * most loved first.
 */
export function notInAYear<T extends HVideo>(videos: T[], plays: HPlay[], now: number, max = 20): { video: T; why: string }[] {
  const last = lastWatched(plays);
  const count = new Map<string, number>();
  for (const p of plays) count.set(p.videoId, (count.get(p.videoId) ?? 0) + 1);
  const yearAgo = now - 365 * DAY;
  const months = (t: number) => Math.max(12, Math.floor((now - t) / (30.4 * DAY)));
  const lapsed = videos
    .filter((v) => last.has(v.id) && last.get(v.id)! < yearAgo)
    .sort((a, b) => b.rating - a.rating || (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0))
    .map((v) => {
      const m = months(last.get(v.id)!);
      return { video: v, why: `Last watched ${m >= 24 ? `${Math.floor(m / 12)} years` : `${m} months`} ago` };
    });
  const never = videos
    .filter((v) => !last.has(v.id) && v.createdAt < yearAgo)
    .sort((a, b) => b.rating - a.rating || a.createdAt - b.createdAt)
    .map((v) => ({ video: v, why: `Filmed ${new Date(v.createdAt).getFullYear()} · never watched` }));
  return [...lapsed, ...never].slice(0, max);
}

/**
 * A random video, leaning towards what you rarely see: never watched counts
 * three times, not watched for three months twice, and good ratings add a bit.
 * `rand` returns 0..1 (Math.random on the phone, fixed in tests).
 */
export function randomPick<T extends HVideo>(videos: T[], plays: HPlay[], now: number, rand: () => number = Math.random, not?: string): T | null {
  const last = lastWatched(plays);
  const pool = videos.filter((v) => v.id !== not);
  if (!pool.length) return null;
  const weight = (v: T) => {
    const l = last.get(v.id);
    const base = l === undefined ? 3 : l < now - 90 * DAY ? 2 : 1;
    return base + Math.max(0, v.rating - 5) * 0.15;
  };
  const weights = pool.map(weight);
  let r = rand() * weights.reduce((a, w) => a + w, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/* ---------------------------------------------------------------- sorting */

export type WatchSort = 'mostWatched' | 'leastWatched' | 'lastWatched';

/** Sorts by plays (ties: watch time, then newest filmed). Returns a new array. */
export function sortByWatching<T extends { id: string; createdAt: number }>(items: T[], plays: HPlay[], key: WatchSort): T[] {
  const per = new Map<string, { n: number; ms: number; last: number }>();
  for (const p of plays) {
    const x = per.get(p.videoId) ?? { n: 0, ms: 0, last: 0 };
    x.n += 1;
    x.ms += p.watchedMs;
    x.last = Math.max(x.last, p.startedAt);
    per.set(p.videoId, x);
  }
  const g = (id: string) => per.get(id) ?? { n: 0, ms: 0, last: 0 };
  return [...items].sort((a, b) => {
    const x = g(a.id);
    const y = g(b.id);
    if (key === 'lastWatched') return y.last - x.last || b.createdAt - a.createdAt;
    const d = key === 'mostWatched' ? y.n - x.n || y.ms - x.ms : x.n - y.n || x.ms - y.ms;
    return d || b.createdAt - a.createdAt;
  });
}

/** Albums by how much their videos are watched (plays), most first. */
export function albumsByWatching<A extends { id: number }>(albums: A[], members: (albumId: number) => string[], plays: HPlay[]): A[] {
  const count = new Map<string, number>();
  for (const p of plays) count.set(p.videoId, (count.get(p.videoId) ?? 0) + 1);
  const score = (a: A) => members(a.id).reduce((s, id) => s + (count.get(id) ?? 0), 0);
  return [...albums].map((a) => ({ a, s: score(a) })).sort((x, y) => y.s - x.s).map((x) => x.a);
}

export const videoName = (v: Pick<HVideo, 'title' | 'filename' | 'createdAt'>) => friendlyName(v);
