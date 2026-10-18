/**
 * Badges and achievements, worked out from what is really in the app (your
 * videos, every play, bookmarks, albums, series, Simkl). Nothing is stored:
 * an achievement can never be lost by a reset, and nothing is made up.
 *
 * Three kinds, after Apple Fitness' awards:
 * - ladders: the same goal in bigger steps (10 → 100 → 500 videos), each step
 *   a tier from bronze to diamond;
 * - one-offs: a thing done once (a 3-hour day, rating something 10);
 * - monthly challenges: a new goal each month, kept once earned.
 *
 * Where the data has a date, `earnedAt` says when it was earned. Pure, so it
 * is tested in Node.
 */

export type AchGroup = 'Library' | 'Watching' | 'Habits' | 'Organising' | 'Monthly' | 'Simkl';

export type Achievement = {
  /** Stable: the old badge ids ("library-100") are kept. */
  id: string;
  /** The ladder or one-off it belongs to ("library"). */
  family: string;
  kind: 'ladder' | 'once' | 'monthly';
  group: AchGroup;
  /** An icon name the UI knows (see ui/icons.ts). */
  icon: string;
  title: string;
  /** What to do, in plain words. */
  detail: string;
  current: number;
  target: number;
  unlocked: boolean;
  /** 1 bronze · 2 silver · 3 gold · 4 platinum · 5 diamond. */
  tier: number;
  earnedAt: number | null;
  /** The video that earned it, where one did (its picture is shown with the badge). */
  videoId: string | null;
  /** Hidden ("???") until earned. */
  secret?: boolean;
  /** How progress is written ("3.5 / 5 h"). */
  unit?: string;
};

/** When something was reached, and by which video (if one). */
type Hit = { at: number; videoId?: string | null } | null;

export type AchVideo = {
  id: string;
  rating: number;
  tagNames: string[];
  importedAt: number;
  createdAt: number;
  durationMs: number | null;
  sizeBytes: number;
  originalSizeBytes?: number | null;
  flag?: number;
  location?: { lat: number; lon: number } | null;
  title?: string | null;
  notes?: string | null;
};

export type AchPlay = { videoId: string; startedAt: number; watchedMs: number };

export type AchInput = {
  videos: AchVideo[];
  plays: AchPlay[];
  bookmarks: number;
  albums: number;
  smartFilters: number;
  /** Series made in Overview, and how many of them you have watched to the end. */
  series: number;
  seriesFinished: number;
  /** Removed videos whose info is kept. */
  kept: number;
  simkl?: {
    episodes: number;
    movies: number;
    completed: number;
    rewatches: number;
    lists: number;
    /** When each Simkl watch happened (counts for streaks and active days). */
    times: number[];
  } | null;
  now: number;
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const GB = 1024 ** 3;

const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const monday = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
};

/** When a running total first reaches `target` (events in time order), and the event that did it. */
function whenReached(events: { at: number; add: number; videoId?: string }[], target: number): Hit {
  let sum = 0;
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    sum += e.add;
    if (sum >= target) return { at: e.at, videoId: e.videoId ?? null };
  }
  return null;
}
const dated = (t: number | null | undefined): Hit => (t === null || t === undefined ? null : { at: t });

/** Days in a row: the best run, and the day each run length was first reached. */
export function streaks(times: number[], now: number): { best: number; current: number; reachedAt: Map<number, number> } {
  const days = [...new Set(times.map(startOfDay))].sort((a, b) => a - b);
  const reachedAt = new Map<number, number>();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    // DST days are 23 or 25 hours long, so compare by calendar day.
    run = prev !== null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    if (!reachedAt.has(run)) reachedAt.set(run, d);
    best = Math.max(best, run);
    prev = d;
  }
  const today = startOfDay(now);
  const last = days[days.length - 1];
  // A streak is still alive if you watched today or yesterday.
  const current = last !== undefined && Math.round((today - last) / DAY) <= 1 ? run : 0;
  return { best, current, reachedAt };
}

/** Weeks (Monday to Sunday) with something watched on all seven days; the end of each. */
export function perfectWeeks(times: number[], now: number): number[] {
  const days = new Set(times.map(dayKey));
  const weeks = [...new Set(times.map(monday))].sort((a, b) => a - b);
  const out: number[] = [];
  for (const w of weeks) {
    const start = new Date(w);
    let all = true;
    for (let i = 0; i < 7; i++) {
      const t = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime();
      if (t > now || !days.has(dayKey(t))) {
        all = false;
        break;
      }
    }
    if (all) out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6).getTime());
  }
  return out;
}

type Ladder = {
  family: string;
  group: AchGroup;
  icon: string;
  tiers: number[];
  title: (n: number) => string;
  detail: (n: number) => string;
  unit?: string;
  value: (i: AchInput) => number;
  /** When `target` was reached (and by which video), if the data says. */
  when?: (i: AchInput, target: number) => Hit;
};

const watchTimes = (i: AchInput) => i.plays.map((p) => p.startedAt);
const allTimes = (i: AchInput) => [...watchTimes(i), ...(i.simkl?.times ?? [])];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const LADDERS: Ladder[] = [
  {
    family: 'library',
    group: 'Library',
    icon: 'videos',
    tiers: [10, 100, 500, 1000, 5000],
    title: (n) => `${n.toLocaleString()} videos`,
    detail: (n) => `Have ${n.toLocaleString()} videos in ReelVault`,
    value: (i) => i.videos.length,
    when: (i, n) => whenReached(i.videos.map((v) => ({ at: v.importedAt, add: 1, videoId: v.id })), n),
  },
  {
    family: 'critic',
    group: 'Library',
    icon: 'star',
    tiers: [10, 50, 250, 1000],
    title: (n) => `Critic · ${n}`,
    detail: (n) => `Rate ${n} videos`,
    value: (i) => i.videos.filter((v) => v.rating > 0).length,
  },
  {
    family: 'tagger',
    group: 'Organising',
    icon: 'tag',
    tiers: [10, 100, 500],
    title: (n) => `Tagger · ${n}`,
    detail: (n) => `Give keywords to ${n} videos`,
    value: (i) => i.videos.filter((v) => v.tagNames.length > 0).length,
  },
  {
    family: 'vocabulary',
    group: 'Organising',
    icon: 'tag',
    tiers: [5, 25, 100],
    title: (n) => `${n} keywords`,
    detail: (n) => `Use ${n} different keywords`,
    value: (i) => new Set(i.videos.flatMap((v) => v.tagNames.map((t) => t.toLowerCase()))).size,
  },
  {
    family: 'curator',
    group: 'Organising',
    icon: 'lists',
    tiers: [3, 10, 25],
    title: (n) => `Curator · ${n}`,
    detail: (n) => `Make ${n} albums`,
    value: (i) => i.albums,
  },
  {
    family: 'showrunner',
    group: 'Organising',
    icon: 'tv',
    tiers: [1, 5, 20],
    title: (n) => (n === 1 ? 'Showrunner' : `Showrunner · ${n}`),
    detail: (n) => (n === 1 ? 'Group videos into a series in Overview' : `Make ${n} series`),
    value: (i) => i.series,
  },
  {
    family: 'bookmarks',
    group: 'Watching',
    icon: 'bookmark',
    tiers: [1, 10, 50],
    title: (n) => (n === 1 ? 'First bookmark' : `${n} bookmarks`),
    detail: (n) => (n === 1 ? 'Bookmark a moment in a video' : `Bookmark ${n} moments`),
    value: (i) => i.bookmarks,
  },
  {
    family: 'hours',
    group: 'Watching',
    icon: 'clock',
    tiers: [1, 10, 50, 200, 1000],
    title: (n) => (n === 1 ? 'First hour' : `${n.toLocaleString()} hours`),
    detail: (n) => `Watch ${plural(n, 'hour')} of your videos`,
    unit: 'h',
    value: (i) => Math.floor(i.plays.reduce((a, p) => a + p.watchedMs, 0) / HOUR),
    when: (i, n) => whenReached(i.plays.map((p) => ({ at: p.startedAt, add: p.watchedMs, videoId: p.videoId })), n * HOUR),
  },
  {
    family: 'explorer',
    group: 'Watching',
    icon: 'globe',
    tiers: [10, 50, 200, 1000],
    title: (n) => `Explorer · ${n}`,
    detail: (n) => `Watch ${n} different videos`,
    value: (i) => new Set(i.plays.map((p) => p.videoId)).size,
    when: (i, n) => {
      const seen = new Set<string>();
      for (const p of [...i.plays].sort((a, b) => a.startedAt - b.startedAt)) {
        seen.add(p.videoId);
        if (seen.size >= n) return { at: p.startedAt, videoId: p.videoId };
      }
      return null;
    },
  },
  {
    family: 'replay',
    group: 'Watching',
    icon: 'rewatch',
    tiers: [3, 10, 25],
    title: (n) => `On repeat ×${n}`,
    detail: (n) => `Watch one video ${n} times`,
    value: (i) => {
      const m = new Map<string, number>();
      for (const p of i.plays) m.set(p.videoId, (m.get(p.videoId) ?? 0) + 1);
      return Math.max(0, ...m.values());
    },
    when: (i, n) => {
      const m = new Map<string, number>();
      for (const p of [...i.plays].sort((a, b) => a.startedAt - b.startedAt)) {
        const c = (m.get(p.videoId) ?? 0) + 1;
        m.set(p.videoId, c);
        if (c >= n) return { at: p.startedAt, videoId: p.videoId };
      }
      return null;
    },
  },
  {
    family: 'streak',
    group: 'Habits',
    icon: 'trending',
    tiers: [3, 7, 30, 100, 365],
    title: (n) => `${n}-day streak`,
    detail: (n) => `Watch something ${n} days in a row`,
    unit: 'days',
    value: (i) => streaks(allTimes(i), i.now).best,
    when: (i, n) => dated(streaks(allTimes(i), i.now).reachedAt.get(n)),
  },
  {
    family: 'days',
    group: 'Habits',
    icon: 'calendar',
    tiers: [7, 30, 100, 365],
    title: (n) => `${n} days watched`,
    detail: (n) => `Watch on ${n} different days`,
    unit: 'days',
    value: (i) => new Set(allTimes(i).map(dayKey)).size,
    when: (i, n) => {
      const days = [...new Set(allTimes(i).map(startOfDay))].sort((a, b) => a - b);
      return dated(days[n - 1]);
    },
  },
  {
    family: 'perfect-week',
    group: 'Habits',
    icon: 'checkCircle',
    tiers: [1, 4, 12, 52],
    title: (n) => (n === 1 ? 'Perfect week' : `${n} perfect weeks`),
    detail: (n) => (n === 1 ? 'Watch something every day from Monday to Sunday' : `Have ${n} weeks with something watched every day`),
    value: (i) => perfectWeeks(allTimes(i), i.now).length,
    when: (i, n) => dated(perfectWeeks(allTimes(i), i.now)[n - 1]),
  },
  {
    family: 'saver',
    group: 'Library',
    icon: 'storage',
    tiers: [1, 5, 20, 100],
    title: (n) => `${n} GB saved`,
    detail: (n) => `Free ${n} GB with Make Smaller`,
    unit: 'GB',
    value: (i) => Math.floor(i.videos.reduce((a, v) => a + Math.max(0, (v.originalSizeBytes ?? v.sizeBytes) - v.sizeBytes), 0) / GB),
  },
  {
    family: 'century',
    group: 'Watching',
    icon: 'play',
    tiers: [100, 500, 2000, 10000],
    title: (n) => `${n.toLocaleString()} plays`,
    detail: (n) => `Press play ${n.toLocaleString()} times`,
    value: (i) => i.plays.length,
    when: (i, n) => whenReached(i.plays.map((p) => ({ at: p.startedAt, add: 1, videoId: p.videoId })), n),
  },
  {
    family: 'anniversary',
    group: 'Library',
    icon: 'calendar',
    tiers: [1, 2, 3, 5],
    title: (n) => (n === 1 ? 'One year together' : `${n} years together`),
    detail: (n) => `Keep your videos in ReelVault for ${n === 1 ? 'a year' : `${n} years`}`,
    unit: 'years',
    value: (i) => {
      const first = Math.min(...i.videos.map((v) => v.importedAt));
      return Number.isFinite(first) ? Math.floor((i.now - first) / (365.25 * DAY)) : 0;
    },
    when: (i, n) => {
      const first = [...i.videos].sort((a, b) => a.importedAt - b.importedAt)[0];
      if (!first) return null;
      const d = new Date(first.importedAt);
      return { at: new Date(d.getFullYear() + n, d.getMonth(), d.getDate()).getTime(), videoId: first.id };
    },
  },
  {
    family: 'storyteller',
    group: 'Organising',
    icon: 'edit',
    tiers: [5, 25, 100],
    title: (n) => `Storyteller · ${n}`,
    detail: (n) => `Give ${n} videos a title or a caption`,
    value: (i) => i.videos.filter((v) => (v.title ?? '').trim() || (v.notes ?? '').trim()).length,
  },
  {
    family: 'episodes',
    group: 'Simkl',
    icon: 'tv',
    tiers: [10, 100, 500, 1000, 5000],
    title: (n) => `${n.toLocaleString()} episodes`,
    detail: (n) => `Watch ${n.toLocaleString()} episodes`,
    value: (i) => i.simkl?.episodes ?? 0,
  },
  {
    family: 'movies',
    group: 'Simkl',
    icon: 'movie',
    tiers: [10, 50, 100, 500],
    title: (n) => `${n} movies`,
    detail: (n) => `Watch ${n} movies`,
    value: (i) => i.simkl?.movies ?? 0,
  },
  {
    family: 'finisher',
    group: 'Simkl',
    icon: 'flag',
    tiers: [1, 10, 50, 100],
    title: (n) => (n === 1 ? 'Finisher' : `Finisher · ${n}`),
    detail: (n) => (n === 1 ? 'Complete a show or anime' : `Complete ${n} shows or anime`),
    value: (i) => i.simkl?.completed ?? 0,
  },
  {
    family: 'rewatcher',
    group: 'Simkl',
    icon: 'rewatch',
    tiers: [1, 10, 50],
    title: (n) => (n === 1 ? 'Rewatcher' : `Rewatcher · ${n}`),
    detail: (n) => (n === 1 ? 'Log a rewatch' : `Log ${n} rewatches`),
    value: (i) => i.simkl?.rewatches ?? 0,
  },
  {
    family: 'lists',
    group: 'Simkl',
    icon: 'listAdd',
    tiers: [1, 5, 15],
    title: (n) => (n === 1 ? 'First list' : `${n} lists`),
    detail: (n) => (n === 1 ? 'Make a list of your own' : `Make ${n} of your own lists`),
    value: (i) => i.simkl?.lists ?? 0,
  },
];

type Once = {
  family: string;
  group: AchGroup;
  icon: string;
  title: string;
  detail: string;
  target: number;
  unit?: string;
  secret?: boolean;
  /** Progress, and when it was done (and by which video). */
  check: (i: AchInput) => { current: number; at: number | null; videoId?: string | null };
};

/** The n-th play (in time order) that passes `test`. */
function nthPlay(i: AchInput, n: number, test: (p: AchPlay) => boolean): { current: number; at: number | null; videoId: string | null } {
  const list = i.plays.filter(test).sort((a, b) => a.startedAt - b.startedAt);
  return { current: list.length, at: list[n - 1]?.startedAt ?? null, videoId: list[n - 1]?.videoId ?? null };
}

/** The first day with at least `ms` watched (optionally only some days), and its most watched video. */
function bigDay(i: AchInput, ms: number, only?: (day: Date) => boolean): { current: number; at: number | null; videoId: string | null } {
  const byDay = new Map<number, { ms: number; top: Map<string, number> }>();
  for (const p of i.plays) {
    const d = startOfDay(p.startedAt);
    if (only && !only(new Date(d))) continue;
    const s = byDay.get(d) ?? { ms: 0, top: new Map() };
    s.ms += p.watchedMs;
    s.top.set(p.videoId, (s.top.get(p.videoId) ?? 0) + p.watchedMs);
    byDay.set(d, s);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const hit = days.find(([, v]) => v.ms >= ms);
  return {
    current: Math.max(0, ...[...byDay.values()].map((v) => v.ms)) / HOUR,
    at: hit ? hit[0] : null,
    videoId: hit ? ([...hit[1].top.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null,
  };
}

/** The first day with `n` different videos watched. */
function varietyDay(i: AchInput, n: number): { current: number; at: number | null; videoId: string | null } {
  const byDay = new Map<number, Set<string>>();
  let at: number | null = null;
  let videoId: string | null = null;
  for (const p of [...i.plays].sort((a, b) => a.startedAt - b.startedAt)) {
    const d = startOfDay(p.startedAt);
    const s = byDay.get(d) ?? new Set<string>();
    s.add(p.videoId);
    byDay.set(d, s);
    if (at === null && s.size >= n) {
      at = p.startedAt;
      videoId = p.videoId;
    }
  }
  return { current: Math.max(0, ...[...byDay.values()].map((s) => s.size)), at, videoId };
}

const ONCE: Once[] = [
  {
    family: 'first-play',
    group: 'Watching',
    icon: 'play',
    title: 'Press play',
    detail: 'Watch one of your videos in ReelVault',
    target: 1,
    check: (i) => nthPlay(i, 1, () => true),
  },
  {
    family: 'night-owl',
    group: 'Habits',
    icon: 'moon',
    title: 'Night owl',
    detail: 'Start 5 videos between midnight and 5 am',
    target: 5,
    check: (i) => nthPlay(i, 5, (p) => new Date(p.startedAt).getHours() < 5),
  },
  {
    family: 'early-bird',
    group: 'Habits',
    icon: 'sun',
    title: 'Early bird',
    detail: 'Start 5 videos between 5 and 8 am',
    target: 5,
    check: (i) => nthPlay(i, 5, (p) => {
      const h = new Date(p.startedAt).getHours();
      return h >= 5 && h < 8;
    }),
  },
  {
    family: 'marathon',
    group: 'Watching',
    icon: 'hourglass',
    title: 'Marathon',
    detail: 'Watch 3 hours of your videos in one day',
    target: 3,
    unit: 'h',
    check: (i) => bigDay(i, 3 * HOUR),
  },
  {
    family: 'weekender',
    group: 'Habits',
    icon: 'calendar',
    title: 'Weekender',
    detail: 'Watch 2 hours on a Saturday or a Sunday',
    target: 2,
    unit: 'h',
    check: (i) => bigDay(i, 2 * HOUR, (d) => d.getDay() === 0 || d.getDay() === 6),
  },
  {
    family: 'long-haul',
    group: 'Watching',
    icon: 'film',
    title: 'The long haul',
    detail: 'Watch an hour of one video in a single sitting',
    target: 1,
    check: (i) => nthPlay(i, 1, (p) => p.watchedMs >= HOUR),
  },
  {
    family: 'perfect-10',
    group: 'Library',
    icon: 'star',
    title: 'Perfect 10',
    detail: 'Give a video a 10',
    target: 1,
    check: (i) => {
      const ten = i.videos.find((v) => v.rating >= 10);
      return { current: ten ? 1 : 0, at: null, videoId: ten?.id ?? null };
    },
  },
  {
    family: 'full-range',
    group: 'Library',
    icon: 'stats',
    title: 'Full range',
    detail: 'Use every rating from 1 to 10 at least once',
    target: 10,
    check: (i) => ({ current: new Set(i.videos.filter((v) => v.rating > 0).map((v) => Math.min(10, Math.max(1, Math.floor(v.rating))))).size, at: null }),
  },
  {
    family: 'decisive',
    group: 'Organising',
    icon: 'flag',
    title: 'Decisive',
    detail: 'Mark 25 videos as Pick or Reject',
    target: 25,
    check: (i) => ({ current: i.videos.filter((v) => (v.flag ?? 0) !== 0).length, at: null }),
  },
  {
    family: 'smart',
    group: 'Organising',
    icon: 'sparkle',
    title: 'Smart thinking',
    detail: 'Save a Smart Filter',
    target: 1,
    check: (i) => ({ current: i.smartFilters, at: null }),
  },
  {
    family: 'completionist',
    group: 'Watching',
    icon: 'checkCircle',
    title: 'Completionist',
    detail: 'Watch every episode of a series you made',
    target: 1,
    check: (i) => ({ current: i.seriesFinished, at: null }),
  },
  {
    family: 'time-traveller',
    group: 'Library',
    icon: 'hourglass',
    title: 'Time traveller',
    detail: 'Have videos filmed in 5 different years',
    target: 5,
    check: (i) => ({
      current: new Set(i.videos.map((v) => new Date(v.createdAt).getFullYear())).size,
      at: null,
      videoId: [...i.videos].sort((a, b) => a.createdAt - b.createdAt)[0]?.id ?? null,
    }),
  },
  {
    family: 'globetrotter',
    group: 'Library',
    icon: 'globe',
    title: 'Globetrotter',
    detail: 'Have videos filmed in 5 places far apart',
    target: 5,
    // Places are cells about 50 km wide, so one city counts once.
    check: (i) => ({
      current: new Set(i.videos.filter((v) => v.location).map((v) => `${Math.round(v.location!.lat * 2)}:${Math.round(v.location!.lon * 2)}`)).size,
      at: null,
    }),
  },
  {
    family: 'keeper',
    group: 'Library',
    icon: 'lock',
    title: 'Memory keeper',
    detail: 'Remove a video for good and keep its rating',
    target: 1,
    check: (i) => ({ current: i.kept, at: null }),
  },
  {
    family: 'throwback',
    group: 'Watching',
    icon: 'rewatch',
    title: 'Throwback',
    detail: 'Watch a video that was filmed 3 or more years earlier',
    target: 1,
    check: (i) => {
      const byId = new Map(i.videos.map((v) => [v.id, v]));
      return nthPlay(i, 1, (p) => {
        const v = byId.get(p.videoId);
        return !!v && p.startedAt - v.createdAt >= 3 * 365.25 * DAY;
      });
    },
  },
  {
    family: 'fresh',
    group: 'Watching',
    icon: 'sparkle',
    title: 'Fresh off the press',
    detail: 'Watch a video on the day you added it',
    target: 1,
    check: (i) => {
      const byId = new Map(i.videos.map((v) => [v.id, v]));
      return nthPlay(i, 1, (p) => {
        const v = byId.get(p.videoId);
        return !!v && startOfDay(v.importedAt) === startOfDay(p.startedAt);
      });
    },
  },
  {
    family: 'five-a-day',
    group: 'Habits',
    icon: 'videos',
    title: 'Five a day',
    detail: 'Watch 5 different videos in one day',
    target: 5,
    check: (i) => varietyDay(i, 5),
  },
  {
    family: 'witching-hour',
    group: 'Habits',
    icon: 'moon',
    title: 'Witching hour',
    detail: 'Press play between 3 and 4 in the morning',
    target: 1,
    secret: true,
    check: (i) => nthPlay(i, 1, (p) => new Date(p.startedAt).getHours() === 3),
  },
  {
    family: 'holidays',
    group: 'Habits',
    icon: 'sparkle',
    title: 'Holiday spirit',
    detail: 'Watch something on Christmas Eve, Christmas Day, Boxing Day or New Year’s Day',
    target: 1,
    secret: true,
    check: (i) =>
      nthPlay(i, 1, (p) => {
        const d = new Date(p.startedAt);
        return (d.getMonth() === 11 && d.getDate() >= 24 && d.getDate() <= 26) || (d.getMonth() === 0 && d.getDate() === 1);
      }),
  },
];

/* ------------------------------------------------------------ monthly */

type Challenge = { key: 'hours' | 'days' | 'variety'; target: number; unit?: string; title: string; detail: string };

const CHALLENGES: Challenge[] = [
  { key: 'hours', target: 5, unit: 'h', title: 'Five-hour month', detail: 'Watch 5 hours of your videos this month' },
  { key: 'days', target: 12, unit: 'days', title: 'Regular', detail: 'Watch on 12 different days this month' },
  { key: 'variety', target: 15, title: 'Variety pack', detail: 'Watch 15 different videos this month' },
];

/** Each month has its own goal, picked from the month itself (so it never changes). */
export function challengeFor(year: number, month: number): Challenge {
  return CHALLENGES[(year * 12 + month) % CHALLENGES.length];
}

function monthlies(i: AchInput, monthsBack = 6): Achievement[] {
  const out: Achievement[] = [];
  const now = new Date(i.now);
  for (let k = 0; k < monthsBack; k++) {
    const start = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
    const c = challengeFor(start.getFullYear(), start.getMonth());
    const ps = i.plays.filter((p) => p.startedAt >= start.getTime() && p.startedAt < end).sort((a, b) => a.startedAt - b.startedAt);
    let current = 0;
    let at: number | null = null;
    let videoId: string | null = null;
    if (c.key === 'hours') {
      current = ps.reduce((a, p) => a + p.watchedMs, 0) / HOUR;
      const hit = whenReached(ps.map((p) => ({ at: p.startedAt, add: p.watchedMs, videoId: p.videoId })), c.target * HOUR);
      at = hit?.at ?? null;
      videoId = hit?.videoId ?? null;
    } else {
      const seen = new Set<string>();
      for (const p of ps) {
        seen.add(c.key === 'days' ? dayKey(p.startedAt) : p.videoId);
        if (at === null && seen.size >= c.target) {
          at = p.startedAt;
          videoId = p.videoId;
        }
      }
      current = seen.size;
    }
    const label = start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const unlocked = current >= c.target;
    // Past months only count if they were earned; the current one shows its progress.
    if (k > 0 && !unlocked) continue;
    out.push({
      id: `month-${start.getFullYear()}-${start.getMonth() + 1}`,
      family: 'monthly',
      kind: 'monthly',
      group: 'Monthly',
      icon: 'calendar',
      title: `${label}: ${c.title}`,
      detail: k === 0 ? c.detail : c.detail.replace('this month', `in ${label}`),
      current: Math.round(current * 10) / 10,
      target: c.target,
      unlocked,
      tier: 3,
      earnedAt: unlocked ? at : null,
      videoId: unlocked ? videoId : null,
      unit: c.unit,
    });
  }
  return out;
}

/* --------------------------------------------------------------- build */

/**
 * Every achievement: for a ladder, all the steps you reached plus the next
 * one (`everyStep` adds the later ones too, for a badge's page); one-offs;
 * this month's challenge and the months you earned.
 */
export function achievements(i: AchInput, opts: { everyStep?: boolean } = {}): Achievement[] {
  const out: Achievement[] = [];
  for (const l of LADDERS) {
    const v = l.value(i);
    l.tiers.forEach((t, n) => {
      const unlocked = v >= t;
      const isNext = !unlocked && (n === 0 || v >= l.tiers[n - 1]);
      if (!unlocked && !isNext && !opts.everyStep) return;
      const hit = unlocked ? (l.when?.(i, t) ?? null) : null;
      out.push({
        id: `${l.family}-${t}`,
        family: l.family,
        kind: 'ladder',
        group: l.group,
        icon: l.icon,
        title: l.title(t),
        detail: l.detail(t),
        current: v,
        target: t,
        unlocked,
        tier: Math.min(5, n + 1),
        earnedAt: hit?.at ?? null,
        videoId: hit?.videoId ?? null,
        unit: l.unit,
      });
    });
  }
  for (const o of ONCE) {
    const r = o.check(i);
    const unlocked = r.current >= o.target;
    out.push({
      id: o.family,
      family: o.family,
      kind: 'once',
      group: o.group,
      icon: o.icon,
      title: o.title,
      detail: o.detail,
      current: Math.round(r.current * 10) / 10,
      target: o.target,
      unlocked,
      tier: 3,
      earnedAt: unlocked ? r.at : null,
      videoId: unlocked ? (r.videoId ?? null) : null,
      secret: o.secret,
      unit: o.unit,
    });
  }
  if (i.plays.length || i.videos.length) out.push(...monthlies(i));
  return out;
}

export type AchSummary = {
  earned: number;
  total: number;
  /** Points: a bronze step is 1, diamond 5; one-offs and months 3. */
  points: number;
  /** Closest to done first. */
  next: Achievement[];
  /** Newest first (the ones with a known date). */
  recent: Achievement[];
};

export function summarize(list: Achievement[], max = 4): AchSummary {
  const done = list.filter((a) => a.unlocked);
  return {
    earned: done.length,
    total: list.length,
    points: done.reduce((s, a) => s + a.tier, 0),
    next: list
      .filter((a) => !a.unlocked && a.current > 0 && !a.secret)
      .sort((a, b) => b.current / b.target - a.current / a.target)
      .slice(0, max),
    recent: done
      .filter((a) => a.earnedAt !== null)
      .sort((a, b) => b.earnedAt! - a.earnedAt!)
      .slice(0, max),
  };
}

export const TIER_NAMES = ['', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
