/**
 * Exact ratings, rewatches, the week / month / year review and the detailed
 * stats - all from what is stored on the phone, no native code (tested in Node).
 */

import type { SimklItem, SimklType } from './logic';

// Same as logic.ts episodesLeft; repeated so this file stays type-only-imports (Node tests).
const episodesLeft = (i: SimklItem) => Math.max(0, i.totalEpisodes - i.notAiredEpisodes - i.watchedEpisodes);

/* ------------------------------------------------------------------ ratings */

/** What Simkl gets for an exact rating: a whole number 1..10. */
export function toSimklRating(exact: number): number {
  return Math.min(10, Math.max(1, Math.round(exact)));
}

/** A rating to one decimal, 1.0..10.0. */
export function normaliseExact(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value * 10) / 10));
}

/**
 * The rating to show: the exact one while it still rounds to what Simkl has;
 * if the rating was changed or removed on Simkl since, Simkl's wins.
 */
export function effectiveRating(simkl: number | null, exact: number | null): number | null {
  if (simkl === null) return null;
  if (exact !== null && toSimklRating(exact) === simkl) return exact;
  return simkl;
}

/** 9 → "9", 9.7 → "9.7". */
export function fmtRating(n: number | null): string {
  if (n === null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/* ---------------------------------------------------------------- rewatches */

export type Session = { id: number; simklId: number; number: number; startedAt: string; finishedAt: string | null; remoteId: number | null };
export type Play = { id: number; simklId: number; season: number; episode: number; watchedAt: string; sessionId: number | null };

/** The first rewatch is "#2": the first time through was #1. */
export function nextSessionNumber(sessions: Session[]): number {
  return sessions.reduce((n, s) => Math.max(n, s.number), 1) + 1;
}

export function activeSession(sessions: Session[]): Session | null {
  return [...sessions].sort((a, b) => b.number - a.number).find((s) => s.finishedAt === null) ?? null;
}

/** How many times each episode (or the movie, 0:0) was watched in total: history + plays. */
export function watchCounts(watchedKeys: Set<string>, plays: Play[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const k of watchedKeys) counts.set(k, 1);
  for (const p of plays) {
    const k = `${p.season}:${p.episode}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/* ------------------------------------------------------------------- events */

export type Meta = {
  genres: string[];
  network: string | null;
  country: string | null;
  language: string | null;
  runtime: number | null;
  fanart?: string | null;
};

export type WatchEvent = {
  simklId: number;
  type: SimklType;
  at: number;
  minutes: number;
  rewatch: boolean;
};

/**
 * Every watch with a time: episodes from Simkl's history, completed movies
 * (Simkl keeps only the last watch of a movie), and rewatches logged here.
 */
export function buildEvents(
  items: SimklItem[],
  history: { simklId: number; watchedAt: string | null }[],
  plays: { simklId: number; watchedAt: string }[],
  meta: Map<number, Meta>
): WatchEvent[] {
  const byId = new Map(items.map((i) => [i.simklId, i]));
  const minutesOf = (i: SimklItem) => i.runtime ?? meta.get(i.simklId)?.runtime ?? (i.type === 'movie' ? 110 : i.type === 'anime' ? 24 : 45);
  const out: WatchEvent[] = [];
  const push = (id: number, iso: string | null, rewatch: boolean) => {
    const item = byId.get(id);
    const at = iso ? Date.parse(iso) : NaN;
    if (!item || !Number.isFinite(at)) return;
    out.push({ simklId: id, type: item.type, at, minutes: minutesOf(item), rewatch });
  };
  for (const h of history) push(h.simklId, h.watchedAt, false);
  for (const i of items) if (i.type === 'movie' && i.status === 'completed') push(i.simklId, i.lastWatchedAt, false);
  for (const p of plays) push(p.simklId, p.watchedAt, true);
  return out.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------ periods */

export type PeriodKind = 'week' | 'month' | 'year';
export type Period = { kind: PeriodKind; start: number; end: number; label: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The week (Monday first), month or year that contains `anchor`, in local time. */
export function periodOf(kind: PeriodKind, anchor: number): Period {
  const d = new Date(anchor);
  if (kind === 'year') {
    const start = new Date(d.getFullYear(), 0, 1).getTime();
    return { kind, start, end: new Date(d.getFullYear() + 1, 0, 1).getTime(), label: String(d.getFullYear()) };
  }
  if (kind === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    return { kind, start, end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
  }
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const label =
    monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()}–${sunday.getDate()} ${SHORT[sunday.getMonth()]} ${sunday.getFullYear()}`
      : `${monday.getDate()} ${SHORT[monday.getMonth()]} – ${sunday.getDate()} ${SHORT[sunday.getMonth()]} ${sunday.getFullYear()}`;
  return { kind, start: monday.getTime(), end: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7).getTime(), label };
}

/** The period before (-1) or after (+1). */
export function shiftPeriod(p: Period, delta: number): Period {
  const d = new Date(p.start);
  if (p.kind === 'year') return periodOf('year', new Date(d.getFullYear() + delta, 0, 1).getTime());
  if (p.kind === 'month') return periodOf('month', new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime());
  return periodOf('week', new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * delta).getTime());
}

/* ------------------------------------------------------------------- review */

export type Bucket = { label: string; minutes: number; count: number };
export type Ranked = { key: string; label: string; minutes: number; count: number };

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function rank<T>(rows: T[], keyOf: (r: T) => string[], labelOf: (k: string) => string, minutesOf: (r: T) => number, top: number): Ranked[] {
  const map = new Map<string, Ranked>();
  for (const r of rows) {
    for (const k of keyOf(r)) {
      const cur = map.get(k) ?? { key: k, label: labelOf(k), minutes: 0, count: 0 };
      cur.minutes += minutesOf(r);
      cur.count += 1;
      map.set(k, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes || b.count - a.count).slice(0, top);
}

export type Review = {
  period: Period;
  minutes: number;
  episodes: number;
  movies: number;
  titles: number;
  rewatches: number;
  activeDays: number;
  /** Week: 7 days. Month: one per day. Year: 12 months. */
  buckets: Bucket[];
  topTitles: Ranked[];
  topGenres: Ranked[];
  topNetworks: Ranked[];
  busiestDay: { label: string; minutes: number; count: number } | null;
  biggestBinge: { title: string; label: string; count: number } | null;
  added: number;
  finished: SimklItem[];
  rated: { count: number; average: number | null };
  /** Minutes in the period before, for "+20% vs last month". */
  previousMinutes: number;
};

export function review(
  events: WatchEvent[],
  items: SimklItem[],
  meta: Map<number, Meta>,
  period: Period,
  ratingOf: (i: SimklItem) => number | null = (i) => i.rating
): Review {
  const inP = (t: number) => t >= period.start && t < period.end;
  const ev = events.filter((e) => inP(e.at));
  const prev = shiftPeriod(period, -1);
  const previousMinutes = events.filter((e) => e.at >= prev.start && e.at < prev.end).reduce((s, e) => s + e.minutes, 0);
  const byId = new Map(items.map((i) => [i.simklId, i]));
  const titleOf = (id: string) => byId.get(Number(id))?.title ?? 'Unknown';

  // Buckets
  const buckets: Bucket[] = [];
  const start = new Date(period.start);
  if (period.kind === 'year') {
    for (let m = 0; m < 12; m++) buckets.push({ label: SHORT[m], minutes: 0, count: 0 });
    for (const e of ev) {
      const b = buckets[new Date(e.at).getMonth()];
      b.minutes += e.minutes;
      b.count++;
    }
  } else {
    const days = Math.round((period.end - period.start) / 86_400_000);
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      buckets.push({ label: period.kind === 'week' ? WEEKDAYS[i] : String(d.getDate()), minutes: 0, count: 0 });
    }
    for (const e of ev) {
      const d = new Date(e.at);
      const i = Math.round(
        (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) /
          86_400_000
      );
      if (buckets[i]) {
        buckets[i].minutes += e.minutes;
        buckets[i].count++;
      }
    }
  }

  // Days
  const perDay = new Map<string, { minutes: number; count: number; at: number }>();
  const perDayTitle = new Map<string, { id: number; count: number; at: number }>();
  for (const e of ev) {
    const k = dayKey(e.at);
    const d = perDay.get(k) ?? { minutes: 0, count: 0, at: e.at };
    d.minutes += e.minutes;
    d.count++;
    perDay.set(k, d);
    if (e.type !== 'movie') {
      const kt = `${k}|${e.simklId}`;
      const t = perDayTitle.get(kt) ?? { id: e.simklId, count: 0, at: e.at };
      t.count++;
      perDayTitle.set(kt, t);
    }
  }
  const fmtDayLabel = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const busiest = [...perDay.values()].sort((a, b) => b.minutes - a.minutes)[0];
  const binge = [...perDayTitle.values()].sort((a, b) => b.count - a.count)[0];

  const ratedItems = items.filter((i) => i.ratedAt && inP(Date.parse(i.ratedAt)) && ratingOf(i) !== null);
  const ratedAvg = ratedItems.length ? ratedItems.reduce((s, i) => s + (ratingOf(i) ?? 0), 0) / ratedItems.length : null;

  return {
    period,
    minutes: ev.reduce((s, e) => s + e.minutes, 0),
    episodes: ev.filter((e) => e.type !== 'movie').length,
    movies: ev.filter((e) => e.type === 'movie').length,
    titles: new Set(ev.map((e) => e.simklId)).size,
    rewatches: ev.filter((e) => e.rewatch).length,
    activeDays: perDay.size,
    buckets,
    topTitles: rank(ev, (e) => [String(e.simklId)], titleOf, (e) => e.minutes, 5),
    topGenres: rank(ev, (e) => meta.get(e.simklId)?.genres ?? [], (k) => k, (e) => e.minutes, 5),
    topNetworks: rank(ev, (e) => (meta.get(e.simklId)?.network ? [meta.get(e.simklId)!.network!] : []), (k) => k, (e) => e.minutes, 5),
    busiestDay: busiest ? { label: fmtDayLabel(busiest.at), minutes: busiest.minutes, count: busiest.count } : null,
    biggestBinge: binge && binge.count > 1 ? { title: byId.get(binge.id)?.title ?? 'Unknown', label: fmtDayLabel(binge.at), count: binge.count } : null,
    added: items.filter((i) => i.addedAt && inP(Date.parse(i.addedAt))).length,
    finished: items.filter((i) => i.status === 'completed' && i.lastWatchedAt && inP(Date.parse(i.lastWatchedAt))),
    rated: { count: ratedItems.length, average: ratedAvg === null ? null : Math.round(ratedAvg * 10) / 10 },
    previousMinutes,
  };
}

/* --------------------------------------------------------- all-time details */

export type DetailedStats = {
  minutes: number;
  episodes: number;
  movies: number;
  rewatches: number;
  byType: Record<SimklType, { titles: number; minutes: number; completed: number; watching: number; plan: number }>;
  /** Your ratings, whole-number buckets 1..10 (9.7 counts as 9). */
  ratingHistogram: number[];
  myAverage: number | null;
  /** Average of (your rating - IMDb) over titles that have both: are you harsher or kinder? */
  vsImdb: number | null;
  topGenres: Ranked[];
  topNetworks: Ranked[];
  topCountries: Ranked[];
  decades: Bucket[];
  weekday: Bucket[];
  hours: Bucket[];
  mostRewatched: Ranked[];
  /** Time it would take to watch everything in Plan to Watch, and what is left in Watching. */
  planMinutes: number;
  leftMinutes: number;
  completionRate: number | null;
  metaCoverage: { have: number; total: number };
};

export function detailedStats(
  events: WatchEvent[],
  items: SimklItem[],
  meta: Map<number, Meta>,
  ratingOf: (i: SimklItem) => number | null = (i) => i.rating
): DetailedStats {
  const byId = new Map(items.map((i) => [i.simklId, i]));
  const minutesPerUnit = (i: SimklItem) => i.runtime ?? meta.get(i.simklId)?.runtime ?? (i.type === 'movie' ? 110 : i.type === 'anime' ? 24 : 45);
  const empty = () => ({ titles: 0, minutes: 0, completed: 0, watching: 0, plan: 0 });
  const byType: DetailedStats['byType'] = { movie: empty(), show: empty(), anime: empty() };
  for (const i of items) {
    const t = byType[i.type];
    t.titles++;
    if (i.status === 'completed') t.completed++;
    if (i.status === 'watching') t.watching++;
    if (i.status === 'plantowatch') t.plan++;
  }
  for (const e of events) byType[e.type].minutes += e.minutes;

  const histogram = Array.from({ length: 10 }, () => 0);
  let ratingSum = 0;
  let rated = 0;
  let diffSum = 0;
  let diffN = 0;
  for (const i of items) {
    const r = ratingOf(i);
    if (r === null) continue;
    histogram[Math.min(9, Math.max(0, Math.floor(r) - 1))]++;
    ratingSum += r;
    rated++;
    if (i.imdbRating !== null) {
      diffSum += r - i.imdbRating;
      diffN++;
    }
  }

  const decadeMap = new Map<number, number>();
  for (const i of items) if (i.year) decadeMap.set(Math.floor(i.year / 10) * 10, (decadeMap.get(Math.floor(i.year / 10) * 10) ?? 0) + 1);
  const decades = [...decadeMap.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => ({ label: `${d}s`, minutes: 0, count: n }));

  const weekday: Bucket[] = WEEKDAYS.map((label) => ({ label, minutes: 0, count: 0 }));
  const hours: Bucket[] = Array.from({ length: 24 }, (_, h) => ({ label: String(h), minutes: 0, count: 0 }));
  for (const e of events) {
    const d = new Date(e.at);
    const w = weekday[(d.getDay() + 6) % 7];
    w.minutes += e.minutes;
    w.count++;
    hours[d.getHours()].count++;
    hours[d.getHours()].minutes += e.minutes;
  }

  const notPlan = items.filter((i) => i.status !== 'plantowatch');
  const planMinutes = items
    .filter((i) => i.status === 'plantowatch')
    .reduce((s, i) => s + minutesPerUnit(i) * (i.type === 'movie' ? 1 : Math.max(1, i.totalEpisodes)), 0);
  const leftMinutes = items.filter((i) => i.status === 'watching').reduce((s, i) => s + minutesPerUnit(i) * episodesLeft(i), 0);

  return {
    minutes: events.reduce((s, e) => s + e.minutes, 0),
    episodes: events.filter((e) => e.type !== 'movie').length,
    movies: events.filter((e) => e.type === 'movie').length,
    rewatches: events.filter((e) => e.rewatch).length,
    byType,
    ratingHistogram: histogram,
    myAverage: rated ? Math.round((ratingSum / rated) * 10) / 10 : null,
    vsImdb: diffN ? Math.round((diffSum / diffN) * 10) / 10 : null,
    topGenres: rank(events, (e) => meta.get(e.simklId)?.genres ?? [], (k) => k, (e) => e.minutes, 8),
    topNetworks: rank(events, (e) => (meta.get(e.simklId)?.network ? [meta.get(e.simklId)!.network!] : []), (k) => k, (e) => e.minutes, 6),
    topCountries: rank(events, (e) => (meta.get(e.simklId)?.country ? [meta.get(e.simklId)!.country!] : []), (k) => k, (e) => e.minutes, 6),
    decades,
    weekday,
    hours,
    mostRewatched: rank(
      events.filter((e) => e.rewatch),
      (e) => [String(e.simklId)],
      (k) => byId.get(Number(k))?.title ?? 'Unknown',
      (e) => e.minutes,
      5
    ),
    planMinutes,
    leftMinutes,
    completionRate: notPlan.length ? Math.round((notPlan.filter((i) => i.status === 'completed').length / notPlan.length) * 100) : null,
    metaCoverage: { have: items.filter((i) => meta.has(i.simklId)).length, total: items.length },
  };
}

/** "2 d 3 h", "5 h 20 min", "45 min". */
export function fmtDuration(min: number): string {
  const m = Math.round(min);
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${m % 60} min`;
  return `${m} min`;
}

/** "+20%", "−35%", or null when there is nothing to compare. */
export function fmtChange(now: number, before: number): string | null {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

/* ------------------------------------------------------------- more stats */

export type GenreMonth = { key: string; label: string; total: number; parts: { genre: string; minutes: number }[] };

/**
 * Your genres month by month (the last `months` months): the five you
 * watched most in that time, and Other. A title with several genres shares
 * its minutes between them, so each month adds up to what you watched.
 */
export function genresOverTime(events: WatchEvent[], meta: Map<number, Meta>, now: number, months = 12): { genres: string[]; months: GenreMonth[] } {
  const d = new Date(now);
  const keys = Array.from({ length: months }, (_, i) => new Date(d.getFullYear(), d.getMonth() - (months - 1 - i), 1));
  const start = keys[0].getTime();
  const inWindow = events.filter((e) => e.at >= start && e.at <= now);
  const share = (e: WatchEvent) => {
    const g = meta.get(e.simklId)?.genres ?? [];
    return g.length ? g.map((x) => [x, e.minutes / g.length] as const) : [['Other', e.minutes] as const];
  };
  const totals = new Map<string, number>();
  for (const e of inWindow) for (const [g, m] of share(e)) if (g !== 'Other') totals.set(g, (totals.get(g) ?? 0) + m);
  const genres = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  const out: GenreMonth[] = keys.map((k) => {
    const end = new Date(k.getFullYear(), k.getMonth() + 1, 1).getTime();
    const per = new Map<string, number>();
    for (const e of inWindow)
      if (e.at >= k.getTime() && e.at < end)
        for (const [g, m] of share(e)) {
          const key = genres.includes(g) ? g : 'Other';
          per.set(key, (per.get(key) ?? 0) + m);
        }
    const parts = [...genres, 'Other'].map((g) => ({ genre: g, minutes: Math.round(per.get(g) ?? 0) })).filter((x) => x.minutes > 0);
    return { key: `${k.getFullYear()}-${k.getMonth() + 1}`, label: k.toLocaleDateString('en-GB', { month: 'short' }), total: parts.reduce((a, x) => a + x.minutes, 0), parts };
  });
  return { genres, months: out };
}

/** Shows and anime by the time you spent on them. */
export function hoursPerShow(events: WatchEvent[], items: SimklItem[], top = 10): { simklId: number; title: string; minutes: number; episodes: number }[] {
  const byId = new Map(items.map((i) => [i.simklId, i]));
  const per = new Map<number, { minutes: number; episodes: number }>();
  for (const e of events) {
    if (e.type === 'movie') continue;
    const x = per.get(e.simklId) ?? { minutes: 0, episodes: 0 };
    x.minutes += e.minutes;
    x.episodes++;
    per.set(e.simklId, x);
  }
  return [...per.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, x]) => ({ simklId: id, title: byId.get(id)!.title, ...x }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, top);
}

/** How many shows and anime you finish: of the ones you started, finished, still going, on hold, dropped; how long a finished one takes. */
export function finishing(items: SimklItem[], events: WatchEvent[]): {
  started: number;
  finished: number;
  watching: number;
  hold: number;
  dropped: number;
  rate: number | null;
  avgDays: number | null;
  fastest: { title: string; days: number }[];
} {
  const series = items.filter((i) => i.type !== 'movie' && i.status !== 'plantowatch');
  const span = new Map<number, { first: number; last: number }>();
  for (const e of events) {
    if (e.type === 'movie' || e.rewatch) continue;
    const s = span.get(e.simklId);
    span.set(e.simklId, s ? { first: Math.min(s.first, e.at), last: Math.max(s.last, e.at) } : { first: e.at, last: e.at });
  }
  const done = series.filter((i) => i.status === 'completed');
  const took = done
    .map((i) => {
      const s = span.get(i.simklId);
      return s ? { title: i.title, days: Math.max(1, Math.ceil((s.last - s.first) / 86_400_000)) } : null;
    })
    .filter((x): x is { title: string; days: number } => !!x);
  return {
    started: series.length,
    finished: done.length,
    watching: series.filter((i) => i.status === 'watching').length,
    hold: series.filter((i) => i.status === 'hold').length,
    dropped: series.filter((i) => i.status === 'dropped').length,
    rate: series.length ? Math.round((done.length / series.length) * 100) : null,
    avgDays: took.length ? Math.round(took.reduce((a, x) => a + x.days, 0) / took.length) : null,
    fastest: [...took].sort((a, b) => a.days - b.days).slice(0, 3),
  };
}
