/**
 * The numbers behind the Simkl Wrapped story and the Simkl dashboard, from
 * what is stored on the phone (Simkl's history plus rewatches logged here).
 * Pure: type-only imports, so it is tested in Node.
 */

import type { Meta, WatchEvent } from './insights';
import type { SimklItem, SimklType } from './logic';

const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

export const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export type WrapRange = { start: number; end: number; label: string; kind: 'year' | 'month' | 'custom' };

export function yearWrapRange(year: number): WrapRange {
  return { start: new Date(year, 0, 1).getTime(), end: new Date(year + 1, 0, 1).getTime(), label: String(year), kind: 'year' };
}

export function monthWrapRange(year: number, month: number): WrapRange {
  return { start: new Date(year, month, 1).getTime(), end: new Date(year, month + 1, 1).getTime(), label: `${MONTHS[month]} ${year}`, kind: 'month' };
}

export type TopTitle = { simklId: number; title: string; poster: string | null; type: SimklType; minutes: number; count: number; rating: number | null };

/** Who the numbers say you are (one, the strongest). */
export type WatcherKind = 'binger' | 'nightOwl' | 'weekender' | 'explorer' | 'loyal' | 'steady' | 'cinephile' | 'otaku';

export const WATCHER: Record<WatcherKind, { name: string; line: string }> = {
  binger: { name: 'The Binger', line: 'One more episode was never just one more.' },
  nightOwl: { name: 'The Night Owl', line: 'Most of it happened after 10 at night.' },
  weekender: { name: 'The Weekender', line: 'Saturdays and Sundays were for watching.' },
  explorer: { name: 'The Explorer', line: 'Always something new: lots of different titles.' },
  loyal: { name: 'The Loyal Fan', line: 'One title had most of your heart.' },
  steady: { name: 'The Steady Watcher', line: 'A little, often: you kept coming back.' },
  cinephile: { name: 'The Cinephile', line: 'Movies over everything.' },
  otaku: { name: 'The Otaku', line: 'Anime ruled your screen.' },
};

export type SimklWrap = {
  range: WrapRange;
  minutes: number;
  episodes: number;
  movies: number;
  titles: number;
  rewatches: number;
  activeDays: number;
  /** Minutes in the same length of time just before, for "+20%". */
  previousMinutes: number;
  byType: { type: SimklType; minutes: number; count: number }[];
  top: TopTitle[];
  topGenres: { genre: string; minutes: number; share: number }[];
  /** Year: one per month. Month: one per day. */
  buckets: { label: string; minutes: number }[];
  busiest: { label: string; minutes: number } | null;
  biggestDay: { day: number; minutes: number; count: number } | null;
  binge: { title: string; poster: string | null; count: number; day: number } | null;
  longestStreak: number;
  favouriteWeekday: { name: string; share: number } | null;
  peakHour: number | null;
  nightShare: number;
  weekendShare: number;
  /** Titles you started in the range (their first watch is in it). */
  discoveries: TopTitle[];
  /** Finished in the range (completed, last watched in it). */
  finished: { simklId: number; title: string; poster: string | null; rating: number | null }[];
  /** Your best rated, among titles watched in the range. */
  bestRated: { simklId: number; title: string; poster: string | null; rating: number }[];
  first: { title: string; at: number } | null;
  last: { title: string; at: number } | null;
  watcher: WatcherKind;
};

/** 1450 → "1,450". */
export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Minutes as words: "38 min", "12 hours", "3.4 days". */
export function fmtMinutesLong(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 72) return `${Math.round(h)} ${Math.round(h) === 1 ? 'hour' : 'hours'}`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}

function longestRun(days: number[]): number {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of sorted) {
    // Days near a clock change are 23 or 25 hours apart.
    run = d - prev <= DAY + 2 * 3_600_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function simklWrap(events: WatchEvent[], items: SimklItem[], meta: Map<number, Meta>, range: WrapRange, ratingOf: (i: SimklItem) => number | null = (i) => i.rating): SimklWrap {
  const byId = new Map(items.map((i) => [i.simklId, i]));
  const inR = (t: number) => t >= range.start && t < range.end;
  const ev = events.filter((e) => inR(e.at) && byId.has(e.simklId));
  const len = range.end - range.start;
  const previousMinutes = events.filter((e) => e.at >= range.start - len && e.at < range.start).reduce((s, e) => s + e.minutes, 0);
  const minutes = ev.reduce((s, e) => s + e.minutes, 0);

  // Per title
  const per = new Map<number, { minutes: number; count: number }>();
  for (const e of ev) {
    const c = per.get(e.simklId) ?? { minutes: 0, count: 0 };
    c.minutes += e.minutes;
    c.count++;
    per.set(e.simklId, c);
  }
  const asTop = (id: number): TopTitle => {
    const i = byId.get(id)!;
    const c = per.get(id) ?? { minutes: 0, count: 0 };
    return { simklId: id, title: i.title, poster: i.poster, type: i.type, minutes: c.minutes, count: c.count, rating: ratingOf(i) };
  };
  const top = [...per.keys()].map(asTop).sort((a, b) => b.minutes - a.minutes || b.count - a.count);

  // By type
  const types: SimklType[] = ['show', 'anime', 'movie'];
  const byType = types
    .map((type) => ({ type, minutes: ev.filter((e) => e.type === type).reduce((s, e) => s + e.minutes, 0), count: ev.filter((e) => e.type === type).length }))
    .filter((t) => t.count > 0);

  // Genres
  const genreMin = new Map<string, number>();
  for (const e of ev) for (const g of meta.get(e.simklId)?.genres ?? []) genreMin.set(g, (genreMin.get(g) ?? 0) + e.minutes);
  const genreTotal = [...genreMin.values()].reduce((a, b) => a + b, 0);
  const topGenres = [...genreMin.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, m]) => ({ genre, minutes: m, share: genreTotal ? m / genreTotal : 0 }));

  // Buckets
  const buckets: { label: string; minutes: number }[] = [];
  if (range.kind === 'year') {
    for (let m = 0; m < 12; m++) buckets.push({ label: MONTHS[m].slice(0, 3), minutes: 0 });
    for (const e of ev) buckets[new Date(e.at).getMonth()].minutes += e.minutes;
  } else {
    const days = Math.max(1, Math.round(len / DAY));
    for (let i = 0; i < days; i++) buckets.push({ label: String(new Date(range.start + i * DAY + 3_600_000).getDate()), minutes: 0 });
    for (const e of ev) {
      const i = Math.floor((sod(e.at) - sod(range.start) + 3_600_000) / DAY);
      if (buckets[i]) buckets[i].minutes += e.minutes;
    }
  }
  const busiestBucket = [...buckets].sort((a, b) => b.minutes - a.minutes)[0];
  const busiest =
    busiestBucket && busiestBucket.minutes > 0
      ? { label: range.kind === 'year' ? MONTHS[buckets.indexOf(busiestBucket)] : `${busiestBucket.label} ${MONTHS[new Date(range.start).getMonth()]}`, minutes: busiestBucket.minutes }
      : null;

  // Days
  const perDay = new Map<number, { minutes: number; count: number }>();
  const perDayTitle = new Map<string, { id: number; day: number; count: number }>();
  for (const e of ev) {
    const d = sod(e.at);
    const c = perDay.get(d) ?? { minutes: 0, count: 0 };
    c.minutes += e.minutes;
    c.count++;
    perDay.set(d, c);
    if (e.type !== 'movie') {
      const k = `${d}|${e.simklId}`;
      const t = perDayTitle.get(k) ?? { id: e.simklId, day: d, count: 0 };
      t.count++;
      perDayTitle.set(k, t);
    }
  }
  const big = [...perDay.entries()].sort((a, b) => b[1].minutes - a[1].minutes)[0];
  const bingeRow = [...perDayTitle.values()].sort((a, b) => b.count - a.count)[0];
  const binge = bingeRow && bingeRow.count >= 3 ? { title: byId.get(bingeRow.id)!.title, poster: byId.get(bingeRow.id)!.poster, count: bingeRow.count, day: bingeRow.day } : null;

  // Habits
  const weekday = Array.from({ length: 7 }, () => 0);
  const hours = Array.from({ length: 24 }, () => 0);
  for (const e of ev) {
    const d = new Date(e.at);
    weekday[d.getDay()] += e.minutes;
    hours[d.getHours()] += e.minutes;
  }
  const wdMax = Math.max(...weekday);
  const favouriteWeekday = minutes > 0 ? { name: WEEKDAY_NAMES[weekday.indexOf(wdMax)], share: wdMax / minutes } : null;
  const hMax = Math.max(...hours);
  const peakHour = minutes > 0 ? hours.indexOf(hMax) : null;
  const night = hours.slice(22).reduce((a, b) => a + b, 0) + hours.slice(0, 4).reduce((a, b) => a + b, 0);
  const nightShare = minutes ? night / minutes : 0;
  const weekendShare = minutes ? (weekday[0] + weekday[6]) / minutes : 0;

  // First watches of a title happen in the range: a discovery.
  const firstAt = new Map<number, number>();
  for (const e of events) if (!firstAt.has(e.simklId) || e.at < firstAt.get(e.simklId)!) firstAt.set(e.simklId, e.at);
  const discoveries = top.filter((t) => inR(firstAt.get(t.simklId) ?? -1));

  const finished = items
    .filter((i) => i.status === 'completed' && i.lastWatchedAt && inR(Date.parse(i.lastWatchedAt)))
    .sort((a, b) => Date.parse(b.lastWatchedAt!) - Date.parse(a.lastWatchedAt!))
    .map((i) => ({ simklId: i.simklId, title: i.title, poster: i.poster, rating: ratingOf(i) }));

  const bestRated = top
    .filter((t) => t.rating !== null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.minutes - a.minutes)
    .slice(0, 3)
    .map((t) => ({ simklId: t.simklId, title: t.title, poster: t.poster, rating: t.rating! }));

  // Who you are: the strongest signal wins.
  const typeShare = (t: SimklType) => (minutes ? (byType.find((x) => x.type === t)?.minutes ?? 0) / minutes : 0);
  const topShare = minutes && top[0] ? top[0].minutes / minutes : 0;
  const scores: [WatcherKind, number][] = [
    ['binger', binge ? Math.min(1, binge.count / 8) : 0],
    ['nightOwl', nightShare >= 0.4 ? nightShare : 0],
    ['weekender', weekendShare >= 0.45 ? weekendShare : 0],
    ['explorer', per.size >= 12 && topShare < 0.2 ? Math.min(1, per.size / 30) : 0],
    ['loyal', topShare >= 0.4 ? topShare : 0],
    ['cinephile', typeShare('movie') >= 0.6 ? typeShare('movie') : 0],
    ['otaku', typeShare('anime') >= 0.6 ? typeShare('anime') : 0],
  ];
  const strongest = scores.sort((a, b) => b[1] - a[1])[0];
  const watcher: WatcherKind = strongest && strongest[1] > 0 ? strongest[0] : 'steady';

  return {
    range,
    minutes,
    episodes: ev.filter((e) => e.type !== 'movie').length,
    movies: ev.filter((e) => e.type === 'movie').length,
    titles: per.size,
    rewatches: ev.filter((e) => e.rewatch).length,
    activeDays: perDay.size,
    previousMinutes,
    byType,
    top: top.slice(0, 5),
    topGenres,
    buckets,
    busiest,
    biggestDay: big ? { day: big[0], minutes: big[1].minutes, count: big[1].count } : null,
    binge,
    longestStreak: longestRun([...perDay.keys()]),
    favouriteWeekday,
    peakHour,
    nightShare,
    weekendShare,
    discoveries: discoveries.slice(0, 6),
    finished,
    bestRated,
    first: ev[0] ? { title: byId.get(ev[0].simklId)!.title, at: ev[0].at } : null,
    last: ev.length ? { title: byId.get(ev[ev.length - 1].simklId)!.title, at: ev[ev.length - 1].at } : null,
    watcher,
  };
}

/** The years (newest first) and, for this year, the months that have something to wrap. */
export function wrapChoices(events: WatchEvent[], now: number): { years: number[]; months: { year: number; month: number }[] } {
  const years = [...new Set(events.map((e) => new Date(e.at).getFullYear()))].sort((a, b) => b - a);
  const keys = new Set(events.map((e) => `${new Date(e.at).getFullYear()}-${new Date(e.at).getMonth()}`));
  const months: { year: number; month: number }[] = [];
  const d = new Date(now);
  for (let i = 0; i < 12; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    if (keys.has(`${m.getFullYear()}-${m.getMonth()}`)) months.push({ year: m.getFullYear(), month: m.getMonth() });
  }
  return { years, months };
}

/** Four titles for "guess your #1": the answer and the next three, in a shuffled order (by seed). */
export function topQuiz(top: TopTitle[], seed: number): { options: TopTitle[]; answer: number } | null {
  if (top.length < 3) return null;
  const options = top.slice(0, 4);
  const order = options.map((o, i) => ({ o, k: Math.sin(seed * 9301 + i * 49297) }));
  order.sort((a, b) => a.k - b.k);
  return { options: order.map((x) => x.o), answer: top[0].simklId };
}

/* --------------------------------------------------------------- dashboard */

export type SimklDash = {
  today: number;
  week: number;
  lastWeek: number;
  /** Mon..Sun minutes this week. */
  weekDays: { label: string; minutes: number; today: boolean }[];
  month: number;
  year: number;
  streak: number;
  bestStreak: number;
  /** Shows and anime you are watching with an episode waiting. */
  upNext: number;
  /** Time to finish what you are watching, and your plan-to-watch list. */
  leftMinutes: number;
  planMinutes: number;
  counts: { watching: number; completed: number; plan: number; hold: number; dropped: number };
  totals: { episodes: number; movies: number; minutes: number };
  /** The next round number for episodes and movies, and how far along. */
  milestones: { label: string; at: number; now: number }[];
  topThisMonth: TopTitle | null;
  /** The last few days you watched something, newest first. */
  recent: { day: number; titles: { simklId: number; title: string; poster: string | null; count: number }[] }[];
};

const NEXT_ROUND = [10, 25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000];
export function nextRound(n: number): number {
  return NEXT_ROUND.find((r) => r > n) ?? Math.ceil((n + 1) / 10000) * 10000;
}

export function simklDash(events: WatchEvent[], items: SimklItem[], meta: Map<number, Meta>, now: number): SimklDash {
  const byId = new Map(items.map((i) => [i.simklId, i]));
  const today = sod(now);
  const dow = (new Date(now).getDay() + 6) % 7;
  const monday = sod(today - dow * DAY + 3_600_000);
  const sum = (a: number, b: number) => events.filter((e) => e.at >= a && e.at < b).reduce((s, e) => s + e.minutes, 0);
  const d = new Date(now);
  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => {
    const start = sod(monday + i * DAY + 3_600_000);
    return { label, minutes: sum(start, sod(start + DAY + 3_600_000)), today: start === today };
  });

  const days = new Set(events.map((e) => sod(e.at)));
  let streak = 0;
  let cur = days.has(today) ? today : sod(today - DAY / 2);
  while (days.has(cur)) {
    streak++;
    cur = sod(cur - DAY / 2);
  }

  const minutesPer = (i: SimklItem) => i.runtime ?? meta.get(i.simklId)?.runtime ?? (i.type === 'movie' ? 110 : i.type === 'anime' ? 24 : 45);
  const left = (i: SimklItem) => Math.max(0, i.totalEpisodes - i.notAiredEpisodes - i.watchedEpisodes);
  const counts = { watching: 0, completed: 0, plan: 0, hold: 0, dropped: 0 };
  let leftMinutes = 0;
  let planMinutes = 0;
  for (const i of items) {
    if (i.status === 'watching') {
      counts.watching++;
      leftMinutes += left(i) * minutesPer(i);
    } else if (i.status === 'completed') counts.completed++;
    else if (i.status === 'plantowatch') {
      counts.plan++;
      planMinutes += i.type === 'movie' ? minutesPer(i) : Math.max(1, i.totalEpisodes - i.notAiredEpisodes) * minutesPer(i);
    } else if (i.status === 'hold') counts.hold++;
    else if (i.status === 'dropped') counts.dropped++;
  }

  const episodes = events.filter((e) => e.type !== 'movie').length;
  const movies = events.filter((e) => e.type === 'movie').length;
  const totalMinutes = events.reduce((s, e) => s + e.minutes, 0);
  const hoursNow = Math.floor(totalMinutes / 60);
  const milestones = [
    { label: 'episodes', at: nextRound(episodes), now: episodes },
    { label: 'movies', at: nextRound(movies), now: movies },
    { label: 'hours', at: nextRound(hoursNow), now: hoursNow },
  ];

  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const monthWrap = simklWrap(events, items, meta, { start: monthStart, end: now + 1, label: '', kind: 'custom' });

  const recentDays = [...days].filter((x) => x <= today).sort((a, b) => b - a).slice(0, 5);
  const recent = recentDays.map((day) => {
    const per = new Map<number, number>();
    for (const e of events) if (sod(e.at) === day) per.set(e.simklId, (per.get(e.simklId) ?? 0) + 1);
    return {
      day,
      titles: [...per.entries()]
        .filter(([id]) => byId.has(id))
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ simklId: id, title: byId.get(id)!.title, poster: byId.get(id)!.poster, count })),
    };
  });

  return {
    today: sum(today, sod(today + DAY + 3_600_000)),
    week: sum(monday, now + 1),
    lastWeek: sum(sod(monday - 7 * DAY + 3_600_000), monday),
    weekDays,
    month: sum(monthStart, now + 1),
    year: sum(new Date(d.getFullYear(), 0, 1).getTime(), now + 1),
    streak,
    bestStreak: longestRun([...days]),
    upNext: items.filter((i) => i.status === 'watching' && i.type !== 'movie' && !!i.nextToWatch).length,
    leftMinutes,
    planMinutes,
    counts,
    totals: { episodes, movies, minutes: totalMinutes },
    milestones,
    topThisMonth: monthWrap.top[0] ?? null,
    recent,
  };
}
