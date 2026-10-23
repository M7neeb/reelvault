/**
 * Reading stats for the Manga dashboard and Reading Wrapped, pure (tested in
 * tests/manga.test.mjs): time read today, this week (day by day) and in
 * total, chapters and pages, streaks, when you read, your most read titles
 * and genres, statuses, and a year's numbers.
 */

import type { MangaRead, MangaSeries, MangaStatus } from './mangaLogic.ts';

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export type MangaStats = {
  totalMs: number;
  todayMs: number;
  weekMs: number;
  week: { label: string; ms: number; today: boolean }[];
  /** Chapters finished (all time, this week). */
  chapters: number;
  chaptersWeek: number;
  pages: number;
  days: number;
  streak: number;
  bestStreak: number;
  hours: number[];
  /** Most read titles by time, then by chapters finished. */
  top: { id: string; ms: number; chapters: number }[];
  genres: { name: string; count: number }[];
  statuses: Record<MangaStatus | 'none', number>;
  averageRating: number | null;
  unread: number;
};

export function mangaStats(series: MangaSeries[], reads: MangaRead[], now: number): MangaStats {
  const live = series.filter((s) => !s.deletedAt);
  const ids = new Set(live.map((s) => s.id));
  const rs = reads.filter((r) => ids.has(r.seriesId) && r.readMs > 0);
  const today = sod(now);
  const dow = (new Date(now).getDay() + 6) % 7;
  const monday = sod(today - dow * DAY + 3_600_000);
  // A day counts when you read in it, or finished a chapter in it.
  const finishedAt = live.flatMap((s) => s.chapters.map((c) => c.readAt).filter((t): t is number => !!t));
  const days = new Set([...rs.map((r) => sod(r.startedAt)), ...finishedAt.map(sod)]);
  let streak = 0;
  let d = days.has(today) ? today : sod(today - DAY / 2);
  while (days.has(d)) {
    streak++;
    d = sod(d - DAY / 2);
  }
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let n = 0; n < sorted.length; n++) {
    run = n && sorted[n] - sorted[n - 1] <= DAY + 3_600_000 * 2 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of rs) hours[new Date(r.startedAt).getHours()] += r.readMs;
  const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, n) => {
    const start = sod(monday + n * DAY + 3_600_000);
    const end = sod(start + DAY + 3_600_000);
    return { label, ms: rs.filter((r) => r.startedAt >= start && r.startedAt < end).reduce((a, r) => a + r.readMs, 0), today: start === today };
  });
  const per = new Map<string, { ms: number; chapters: number }>();
  for (const r of rs) per.set(r.seriesId, { ms: (per.get(r.seriesId)?.ms ?? 0) + r.readMs, chapters: per.get(r.seriesId)?.chapters ?? 0 });
  for (const s of live) {
    const n = s.chapters.filter((c) => c.readAt).length;
    if (n) per.set(s.id, { ms: per.get(s.id)?.ms ?? 0, chapters: n });
  }
  const top = [...per.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.ms - a.ms || b.chapters - a.chapters)
    .slice(0, 5);
  const g = new Map<string, number>();
  for (const s of live) if (s.chapters.some((c) => c.readAt)) for (const t of s.tags) g.set(t, (g.get(t) ?? 0) + 1);
  const statuses: MangaStats['statuses'] = { reading: 0, planned: 0, completed: 0, onHold: 0, dropped: 0, none: 0 };
  for (const s of live) statuses[s.status ?? 'none']++;
  const rated = live.filter((s) => s.rating > 0);
  return {
    totalMs: rs.reduce((a, r) => a + r.readMs, 0),
    todayMs: rs.filter((r) => r.startedAt >= today).reduce((a, r) => a + r.readMs, 0),
    weekMs: rs.filter((r) => r.startedAt >= monday).reduce((a, r) => a + r.readMs, 0),
    week,
    chapters: finishedAt.length,
    chaptersWeek: finishedAt.filter((t) => t >= monday).length,
    pages: rs.reduce((a, r) => a + r.pages, 0),
    days: days.size,
    streak,
    bestStreak: best,
    hours,
    top,
    genres: [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    statuses,
    averageRating: rated.length ? Math.round((rated.reduce((a, s) => a + s.rating, 0) / rated.length) * 10) / 10 : null,
    unread: live.reduce((a, s) => a + s.chapters.filter((c) => !c.readAt).length, 0),
  };
}

export type ReadingYear = {
  year: number;
  ms: number;
  days: number;
  chapters: number;
  pages: number;
  titles: number;
  top: { id: string; ms: number; chapters: number }[];
  busiestMonth: { month: number; ms: number } | null;
  completed: string[];
  started: string[];
  genre: string | null;
};

/** A year of reading, for Reading Wrapped. */
export function readingYear(series: MangaSeries[], reads: MangaRead[], year: number): ReadingYear {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const live = series.filter((s) => !s.deletedAt);
  const ids = new Set(live.map((s) => s.id));
  const rs = reads.filter((r) => ids.has(r.seriesId) && r.startedAt >= start && r.startedAt < end && r.readMs > 0);
  const inYear = (t: number | null) => !!t && t >= start && t < end;
  const per = new Map<string, { ms: number; chapters: number }>();
  for (const r of rs) per.set(r.seriesId, { ms: (per.get(r.seriesId)?.ms ?? 0) + r.readMs, chapters: 0 });
  let chapters = 0;
  for (const s of live) {
    const n = s.chapters.filter((c) => inYear(c.readAt)).length;
    chapters += n;
    if (n) per.set(s.id, { ms: per.get(s.id)?.ms ?? 0, chapters: n });
  }
  const months = Array.from({ length: 12 }, () => 0);
  for (const r of rs) months[new Date(r.startedAt).getMonth()] += r.readMs;
  const bm = months.reduce((b, ms, m) => (ms > b.ms ? { month: m, ms } : b), { month: -1, ms: 0 });
  const g = new Map<string, number>();
  for (const id of per.keys()) for (const t of live.find((s) => s.id === id)?.tags ?? []) g.set(t, (g.get(t) ?? 0) + 1);
  const firstRead = (s: MangaSeries) => Math.min(...s.chapters.map((c) => c.readAt ?? Infinity), ...reads.filter((r) => r.seriesId === s.id).map((r) => r.startedAt));
  return {
    year,
    ms: rs.reduce((a, r) => a + r.readMs, 0),
    days: new Set([...rs.map((r) => sod(r.startedAt)), ...live.flatMap((s) => s.chapters.filter((c) => inYear(c.readAt)).map((c) => sod(c.readAt!)))]).size,
    chapters,
    pages: rs.reduce((a, r) => a + r.pages, 0),
    titles: per.size,
    top: [...per.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.ms - a.ms || b.chapters - a.chapters)
      .slice(0, 5),
    busiestMonth: bm.month >= 0 ? bm : null,
    completed: live.filter((s) => s.status === 'completed' && inYear(s.finishedAt)).map((s) => s.id),
    started: live.filter((s) => inYear(firstRead(s))).map((s) => s.id),
    genre: [...g.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}
