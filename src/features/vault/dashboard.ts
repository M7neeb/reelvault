/**
 * The Videos dashboard for a period (this week, this month, this year, all
 * time): watch time against the period before, a chart of every day / month,
 * when you watch, what you watched most, and how complete your library is.
 * Pure, so it is tested in Node.
 */

import { friendlyName } from './names.ts';

export type DashPeriod = 'week' | 'month' | 'year' | 'all';

export type DashVideo = {
  id: string;
  title: string | null;
  filename: string;
  createdAt: number;
  importedAt: number;
  durationMs: number | null;
  rating: number;
  tagNames: string[];
};

export type DashPlay = { videoId: string; startedAt: number; watchedMs: number };

export type DashBucket = { key: number; label: string; ms: number; plays: number; current: boolean };

export type DashTop = { id: string; label: string; ms: number; plays: number; share: number };

export type PeriodDash = {
  period: DashPeriod;
  start: number;
  end: number;
  label: string;
  watchedMs: number;
  /** The same length of time just before (null for all time). */
  prevMs: number | null;
  /** Change against the period before, e.g. 0.35 = +35 % (null when there is nothing to compare). */
  change: number | null;
  plays: number;
  videos: number;
  activeDays: number;
  /** Average length of one sitting. */
  avgSittingMs: number;
  buckets: DashBucket[];
  /** Minutes by hour of day (0..23) and by weekday (Monday first). */
  hours: number[];
  weekdays: number[];
  peakHour: number | null;
  peakWeekday: number | null;
  top: DashTop[];
  topTags: { tag: string; ms: number; share: number }[];
  newVideos: number;
};

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function periodRange(period: DashPeriod, now: number, earliest: number): { start: number; end: number; prevStart: number | null; label: string } {
  const d = new Date(now);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  switch (period) {
    case 'week': {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
      return { start, end, prevStart: start - 7 * DAY, label: 'Last 7 days' };
    }
    case 'month': {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29).getTime();
      return { start, end, prevStart: start - 30 * DAY, label: 'Last 30 days' };
    }
    case 'year': {
      const start = new Date(d.getFullYear(), d.getMonth() - 11, 1).getTime();
      return { start, end, prevStart: new Date(d.getFullYear() - 1, d.getMonth() - 11, 1).getTime(), label: 'Last 12 months' };
    }
    default:
      return { start: Math.min(sod(earliest), end - DAY), end, prevStart: null, label: 'All time' };
  }
}

function buckets(period: DashPeriod, start: number, end: number, now: number): DashBucket[] {
  const out: DashBucket[] = [];
  if (period === 'week' || period === 'month') {
    for (let t = start; t < end; ) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      out.push({
        key: t,
        label: period === 'week' ? d.toLocaleDateString(undefined, { weekday: 'narrow' }) : String(d.getDate()),
        ms: 0,
        plays: 0,
        current: now >= t && now < next,
      });
      t = next;
    }
    return out;
  }
  // Months; all time with more than two years becomes years.
  const first = new Date(start);
  const months = (new Date(end - 1).getFullYear() - first.getFullYear()) * 12 + new Date(end - 1).getMonth() - first.getMonth() + 1;
  if (period === 'all' && months > 24) {
    for (let y = first.getFullYear(); y <= new Date(end - 1).getFullYear(); y++) {
      out.push({ key: new Date(y, 0, 1).getTime(), label: String(y).slice(2), ms: 0, plays: 0, current: new Date(now).getFullYear() === y });
    }
    return out;
  }
  for (let m = 0; m < months; m++) {
    const d = new Date(first.getFullYear(), first.getMonth() + m, 1);
    const n = new Date(now);
    out.push({
      key: d.getTime(),
      label: d.toLocaleDateString(undefined, { month: 'narrow' }),
      ms: 0,
      plays: 0,
      current: n.getFullYear() === d.getFullYear() && n.getMonth() === d.getMonth(),
    });
  }
  return out;
}

export function periodDashboard(period: DashPeriod, videos: DashVideo[], plays: DashPlay[], now: number): PeriodDash {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const own = plays.filter((p) => byId.has(p.videoId));
  const earliest = Math.min(now, ...own.map((p) => p.startedAt), ...videos.map((v) => v.importedAt));
  const r = periodRange(period, now, earliest);
  const inR = own.filter((p) => p.startedAt >= r.start && p.startedAt < r.end);
  const prev = r.prevStart === null ? null : own.filter((p) => p.startedAt >= r.prevStart! && p.startedAt < r.start);

  const bs = buckets(period, r.start, r.end, now);
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  const per = new Map<string, { ms: number; plays: number }>();
  const tags = new Map<string, number>();
  const days = new Set<number>();
  for (const p of inR) {
    // The last bucket that starts at or before the play.
    let b = bs.length - 1;
    while (b > 0 && bs[b].key > p.startedAt) b--;
    if (bs[b]) {
      bs[b].ms += p.watchedMs;
      bs[b].plays++;
    }
    const d = new Date(p.startedAt);
    hours[d.getHours()] += p.watchedMs / 60000;
    weekdays[(d.getDay() + 6) % 7] += p.watchedMs / 60000;
    const s = per.get(p.videoId) ?? { ms: 0, plays: 0 };
    s.ms += p.watchedMs;
    s.plays++;
    per.set(p.videoId, s);
    for (const t of byId.get(p.videoId)!.tagNames) tags.set(t, (tags.get(t) ?? 0) + p.watchedMs);
    days.add(sod(p.startedAt));
  }
  const watchedMs = inR.reduce((a, p) => a + p.watchedMs, 0);
  const prevMs = prev ? prev.reduce((a, p) => a + p.watchedMs, 0) : null;
  const peak = (list: number[]) => {
    const max = Math.max(...list);
    return max > 0 ? list.indexOf(max) : null;
  };
  return {
    period,
    start: r.start,
    end: r.end,
    label: r.label,
    watchedMs,
    prevMs,
    change: prevMs && prevMs > 0 ? (watchedMs - prevMs) / prevMs : null,
    plays: inR.length,
    videos: per.size,
    activeDays: days.size,
    avgSittingMs: inR.length ? watchedMs / inR.length : 0,
    buckets: bs,
    hours,
    weekdays,
    peakHour: peak(hours),
    peakWeekday: peak(weekdays),
    top: [...per.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, 5)
      .map(([id, s]) => ({ id, label: friendlyName(byId.get(id)!), ms: s.ms, plays: s.plays, share: watchedMs ? s.ms / watchedMs : 0 })),
    topTags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, ms]) => ({ tag, ms, share: watchedMs ? ms / watchedMs : 0 })),
    newVideos: videos.filter((v) => v.importedAt >= r.start && v.importedAt < r.end).length,
  };
}

export type LibraryHealth = {
  total: number;
  rated: number;
  tagged: number;
  watched: number;
  /** The median rating (whole library), or null. */
  median: number | null;
};

export function libraryHealth(videos: DashVideo[], plays: DashPlay[]): LibraryHealth {
  const watched = new Set(plays.map((p) => p.videoId));
  const ratings = videos
    .filter((v) => v.rating > 0)
    .map((v) => v.rating)
    .sort((a, b) => a - b);
  const mid = ratings.length / 2;
  return {
    total: videos.length,
    rated: ratings.length,
    tagged: videos.filter((v) => v.tagNames.length > 0).length,
    watched: videos.filter((v) => watched.has(v.id)).length,
    median: ratings.length ? (ratings.length % 2 ? ratings[Math.floor(mid)] : (ratings[mid - 1] + ratings[mid]) / 2) : null,
  };
}

/** "Evenings" for 18-22 h and friends: when you mostly watch, in words. */
export function daypart(hour: number | null): { label: string; icon: string } | null {
  if (hour === null) return null;
  if (hour < 5) return { label: 'Late at night', icon: 'moon' };
  if (hour < 12) return { label: 'In the morning', icon: 'sun' };
  if (hour < 17) return { label: 'In the afternoon', icon: 'clock' };
  if (hour < 22) return { label: 'In the evening', icon: 'film' };
  return { label: 'Late at night', icon: 'moon' };
}

/** "+35 %", "−12 %", "new". */
export function fmtChange(change: number | null, prevMs: number | null, nowMs: number): string | null {
  if (change === null) return prevMs === 0 && nowMs > 0 ? 'New' : null;
  const pct = Math.round(change * 100);
  if (pct === 0) return 'Same as before';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`;
}

export type YearOverYear = {
  /** This year and last, month by month (January to this month). */
  months: { label: string; now: number; then: number; current: boolean }[];
  /** This month so far, and the same days a year ago. */
  month: { now: number; then: number; label: string };
  /** The year so far, and the same stretch last year. */
  ytd: { now: number; then: number };
  /** The top video of this month, and of the same month last year. */
  topNow: string | null;
  topThen: string | null;
};

/** This year against last year: the month so far, the year so far, and every month side by side. */
export function yearOverYear(plays: DashPlay[], now: number, known?: Set<string>): YearOverYear {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth();
  const ps = known ? plays.filter((x) => known.has(x.videoId)) : plays;
  const sum = (a: number, b: number) => ps.filter((x) => x.startedAt >= a && x.startedAt < b).reduce((t, x) => t + x.watchedMs, 0);
  const top = (a: number, b: number) => {
    const per = new Map<string, number>();
    for (const x of ps) if (x.startedAt >= a && x.startedAt < b) per.set(x.videoId, (per.get(x.videoId) ?? 0) + x.watchedMs);
    return [...per.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
  };
  // The same moment a year ago (29 Feb falls back to 28 Feb).
  const ago = new Date(y - 1, m, Math.min(d.getDate(), new Date(y - 1, m + 1, 0).getDate()), d.getHours(), d.getMinutes()).getTime();
  const months = Array.from({ length: m + 1 }, (_, i) => ({
    label: new Date(y, i, 1).toLocaleDateString('en-GB', { month: 'narrow' }),
    now: sum(new Date(y, i, 1).getTime(), i === m ? now + 1 : new Date(y, i + 1, 1).getTime()),
    then: sum(new Date(y - 1, i, 1).getTime(), new Date(y - 1, i + 1, 1).getTime()),
    current: i === m,
  }));
  return {
    months,
    month: { now: sum(new Date(y, m, 1).getTime(), now + 1), then: sum(new Date(y - 1, m, 1).getTime(), ago + 1), label: new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'long' }) },
    ytd: { now: sum(new Date(y, 0, 1).getTime(), now + 1), then: sum(new Date(y - 1, 0, 1).getTime(), ago + 1) },
    topNow: top(new Date(y, m, 1).getTime(), now + 1),
    topThen: top(new Date(y - 1, m, 1).getTime(), new Date(y - 1, m + 1, 1).getTime()),
  };
}
