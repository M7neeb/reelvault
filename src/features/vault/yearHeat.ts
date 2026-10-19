/**
 * A whole year of days for the year heat map: twelve little month calendars
 * (Monday first), every day coloured by how long you watched. The levels
 * follow your own days (quartiles of the days you watched), so one huge day
 * doesn't wash the rest out. Plus the Sunday summary notification's words.
 * Pure: no React, no database.
 */

export type HeatPlay = { videoId: string; startedAt: number; watchedMs: number };

export type YearDay = { day: number; date: number; ms: number; plays: number; level: 0 | 1 | 2 | 3 | 4; future: boolean; top: string | null };

export type YearMonth = { month: number; label: string; ms: number; weeks: (YearDay | null)[][] };

export type YearHeat = {
  year: number;
  months: YearMonth[];
  totalMs: number;
  days: number;
  best: YearDay | null;
  /** Longest run of days in a row with watching, in this year. */
  run: number;
  /** Years that have plays, newest first (for the year chips). */
  years: number[];
};

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function yearHeat(plays: HeatPlay[], year: number, now: number): YearHeat {
  const byDay = new Map<number, { ms: number; plays: number; per: Map<string, number> }>();
  const years = new Set<number>();
  for (const p of plays) {
    const y = new Date(p.startedAt).getFullYear();
    years.add(y);
    if (y !== year) continue;
    const k = sod(p.startedAt);
    const d = byDay.get(k) ?? { ms: 0, plays: 0, per: new Map() };
    d.ms += p.watchedMs;
    d.plays++;
    d.per.set(p.videoId, (d.per.get(p.videoId) ?? 0) + p.watchedMs);
    byDay.set(k, d);
  }
  const watched = [...byDay.values()].map((d) => d.ms).filter((ms) => ms > 0).sort((a, b) => a - b);
  const q = (f: number) => watched[Math.floor(f * (watched.length - 1))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (ms: number): YearDay['level'] => (ms <= 0 ? 0 : ms <= cuts[0] ? 1 : ms <= cuts[1] ? 2 : ms <= cuts[2] ? 3 : 4);
  const today = sod(now);

  let best: YearDay | null = null;
  const months: YearMonth[] = [];
  for (let m = 0; m < 12; m++) {
    const first = new Date(year, m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const count = new Date(year, m + 1, 0).getDate();
    const cells: (YearDay | null)[] = Array.from({ length: lead }, () => null);
    let monthMs = 0;
    for (let d = 1; d <= count; d++) {
      const t = new Date(year, m, d).getTime();
      const x = byDay.get(t);
      const top = x ? [...x.per.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
      const cell: YearDay = { day: t, date: d, ms: x?.ms ?? 0, plays: x?.plays ?? 0, level: level(x?.ms ?? 0), future: t > today, top };
      if (cell.ms > 0 && (!best || cell.ms > best.ms)) best = cell;
      monthMs += cell.ms;
      cells.push(cell);
    }
    while (cells.length % 7) cells.push(null);
    const weeks: (YearDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    months.push({ month: m, label: first.toLocaleDateString('en-GB', { month: 'short' }), ms: monthMs, weeks });
  }

  const days = [...byDay.keys()].sort((a, b) => a - b);
  let run = 0;
  let cur = 0;
  for (let i = 0; i < days.length; i++) {
    cur = i > 0 && Math.round((days[i] - days[i - 1]) / DAY) === 1 ? cur + 1 : 1;
    run = Math.max(run, cur);
  }

  return {
    year,
    months,
    totalMs: [...byDay.values()].reduce((a, d) => a + d.ms, 0),
    days: byDay.size,
    best,
    run,
    years: [...years].sort((a, b) => b - a),
  };
}

/** Days in a row with watching (or a frozen day) up to today; a day not watched yet today doesn't break it. */
export function currentStreak(times: number[], now: number): number {
  const days = new Set(times.map(sod));
  let d = sod(now);
  if (!days.has(d)) d = sod(d - DAY / 2);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = sod(d - DAY / 2);
  }
  return n;
}

/**
 * The Sunday summary: Sunday at 19:00, how much you watched this week, your
 * #1 and your streak (the best run of days in a row this week). Its words are
 * worked out when it is planned (each time the app goes to the background),
 * so they cover everything up to then.
 * Null when nothing was watched this week.
 */
export function weeklySummary(
  plays: HeatPlay[],
  now: number,
  opts: { nameOf: (videoId: string) => string | null; fmt: (ms: number) => string; extraDays?: number[] }
): { at: number; title: string; body: string } | null {
  const d = new Date(now);
  const toSunday = (7 - d.getDay()) % 7;
  let at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + toSunday, 19, 0).getTime();
  if (at <= now) at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + toSunday + 7, 19, 0).getTime();
  const sun = new Date(at);
  const start = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() - 6).getTime();
  const week = plays.filter((p) => p.startedAt >= start && p.startedAt <= now && opts.nameOf(p.videoId) !== null);
  if (!week.length) return null;
  const per = new Map<string, number>();
  for (const p of week) per.set(p.videoId, (per.get(p.videoId) ?? 0) + p.watchedMs);
  const top = [...per.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const ms = week.reduce((a, p) => a + p.watchedMs, 0);
  const dayList = [...new Set([...week.map((p) => p.startedAt), ...(opts.extraDays ?? []).filter((t) => t >= start && t <= now)].map(sod))].sort((a, b) => a - b);
  const days = new Set(week.map((p) => sod(p.startedAt))).size;
  // The best run inside the week: still true on Sunday evening, whenever this was worked out.
  let run = 0;
  let cur = 0;
  for (let i = 0; i < dayList.length; i++) {
    cur = i > 0 && Math.round((dayList[i] - dayList[i - 1]) / DAY) === 1 ? cur + 1 : 1;
    run = Math.max(run, cur);
  }
  const parts = [
    `${opts.fmt(ms)} on ${days} ${days === 1 ? 'day' : 'days'}.`,
    `Your #1: ${opts.nameOf(top)}.`,
    run >= 2 ? `Streak: ${run} days in a row.` : 'Watch a few days in a row next week for a streak.',
  ];
  return { at, title: 'Your week in videos', body: parts.join(' ') };
}
