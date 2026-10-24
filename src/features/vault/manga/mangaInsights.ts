/**
 * The Manga section's insights, like the Videos section has: reading in any
 * range (a week, a month, a year) for Wrapped, memories (on this day, a month
 * ago, this week last year, anniversaries, one to come back to), space per
 * title, and the numbers for a Videos + Manga Wrapped. Pure (tested in
 * tests/manga-insights.test.mjs).
 */

import type { MangaRead, MangaSeries } from './mangaLogic.ts';

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export type ReadingRange = {
  start: number;
  end: number;
  ms: number;
  days: number;
  chapters: number;
  pages: number;
  titles: number;
  top: { id: string; ms: number; chapters: number }[];
  /** The day you read the most (time, then chapters). */
  busiestDay: { day: number; ms: number; chapters: number } | null;
  /** The month you read the most (for a year). */
  busiestMonth: { month: number; ms: number } | null;
  /** Time read on each day of the range (for the little bars). */
  perDay: number[];
  hours: number[];
  completed: string[];
  started: string[];
  genre: string | null;
};

/** What you read between start (included) and end (left out). */
export function readingIn(series: MangaSeries[], reads: MangaRead[], start: number, end: number): ReadingRange {
  const live = series.filter((s) => !s.deletedAt);
  const ids = new Set(live.map((s) => s.id));
  const inside = (t: number | null | undefined) => typeof t === 'number' && t >= start && t < end;
  const rs = reads.filter((r) => ids.has(r.seriesId) && inside(r.startedAt) && r.readMs > 0);
  const per = new Map<string, { ms: number; chapters: number }>();
  for (const r of rs) per.set(r.seriesId, { ms: (per.get(r.seriesId)?.ms ?? 0) + r.readMs, chapters: 0 });
  let chapters = 0;
  const dayMs = new Map<number, { ms: number; chapters: number }>();
  for (const r of rs) {
    const d = sod(r.startedAt);
    dayMs.set(d, { ms: (dayMs.get(d)?.ms ?? 0) + r.readMs, chapters: dayMs.get(d)?.chapters ?? 0 });
  }
  for (const s of live) {
    const done = s.chapters.filter((c) => inside(c.readAt));
    chapters += done.length;
    if (done.length) per.set(s.id, { ms: per.get(s.id)?.ms ?? 0, chapters: done.length });
    for (const c of done) {
      const d = sod(c.readAt!);
      dayMs.set(d, { ms: dayMs.get(d)?.ms ?? 0, chapters: (dayMs.get(d)?.chapters ?? 0) + 1 });
    }
  }
  let busiestDay: ReadingRange['busiestDay'] = null;
  for (const [day, v] of dayMs) if (!busiestDay || v.ms > busiestDay.ms || (v.ms === busiestDay.ms && v.chapters > busiestDay.chapters)) busiestDay = { day, ...v };
  const months = Array.from({ length: 12 }, () => 0);
  for (const r of rs) months[new Date(r.startedAt).getMonth()] += r.readMs;
  const bm = months.reduce((b, ms, m) => (ms > b.ms ? { month: m, ms } : b), { month: -1, ms: 0 });
  const nDays = Math.max(1, Math.min(400, Math.round((sod(end - 1) - sod(start)) / DAY) + 1));
  const perDay = Array.from({ length: nDays }, (_, i) => {
    const d = sod(sod(start) + i * DAY + 3_600_000 * 3);
    return dayMs.get(d)?.ms ?? 0;
  });
  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of rs) hours[new Date(r.startedAt).getHours()] += r.readMs;
  const g = new Map<string, number>();
  for (const id of per.keys()) for (const t of live.find((s) => s.id === id)?.tags ?? []) g.set(t, (g.get(t) ?? 0) + 1);
  const firstRead = (s: MangaSeries) => Math.min(...s.chapters.map((c) => c.readAt ?? Infinity), ...reads.filter((r) => r.seriesId === s.id).map((r) => r.startedAt));
  return {
    start,
    end,
    ms: rs.reduce((a, r) => a + r.readMs, 0),
    days: [...dayMs.values()].filter((v) => v.ms > 0 || v.chapters > 0).length,
    chapters,
    pages: rs.reduce((a, r) => a + r.pages, 0),
    titles: per.size,
    top: [...per.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.ms - a.ms || b.chapters - a.chapters)
      .slice(0, 5),
    busiestDay,
    busiestMonth: bm.month >= 0 ? bm : null,
    perDay,
    hours,
    completed: live.filter((s) => s.status === 'completed' && inside(s.finishedAt)).map((s) => s.id),
    started: live.filter((s) => inside(firstRead(s))).map((s) => s.id),
    genre: [...g.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

/* ------------------------------------------------------------------ ranges */

export type ReadRange = { start: number; end: number; label: string; kind: 'week' | 'month' | 'year' | 'custom' };

/** This week first (Monday to now), then the weeks before. */
export function recentWeekRanges(now: number, n: number): ReadRange[] {
  const today = sod(now);
  const monday = sod(today - ((new Date(now).getDay() + 6) % 7) * DAY + 3_600_000);
  const out: ReadRange[] = [];
  for (let i = 0; i < n; i++) {
    const start = sod(monday - i * 7 * DAY + 3_600_000);
    const end = i === 0 ? now + 1 : sod(start + 7 * DAY + 3_600_000);
    const label =
      i === 0
        ? 'This week'
        : i === 1
          ? 'Last week'
          : `${new Date(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(end - DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    out.push({ start, end, label, kind: 'week' });
  }
  return out;
}

/** The months of this year so far, newest first. */
export function monthRangesOf(now: number): ReadRange[] {
  const d = new Date(now);
  const out: ReadRange[] = [];
  for (let m = d.getMonth(); m >= 0; m--) {
    const start = new Date(d.getFullYear(), m, 1).getTime();
    const end = m === d.getMonth() ? now + 1 : new Date(d.getFullYear(), m + 1, 1).getTime();
    out.push({ start, end, label: new Date(start).toLocaleDateString(undefined, { month: 'long' }), kind: 'month' });
  }
  return out;
}

export function yearRangeOf(year: number, now: number): ReadRange {
  const start = new Date(year, 0, 1).getTime();
  const end = Math.min(new Date(year + 1, 0, 1).getTime(), now + 1);
  return { start, end, label: String(year), kind: 'year' };
}

/** The years you read in, newest first. */
export function readingYears(series: MangaSeries[], reads: MangaRead[], now: number): number[] {
  const ys = new Set<number>([new Date(now).getFullYear()]);
  for (const r of reads) if (r.readMs > 0) ys.add(new Date(r.startedAt).getFullYear());
  for (const s of series) for (const c of s.chapters) if (c.readAt) ys.add(new Date(c.readAt).getFullYear());
  return [...ys].filter((y) => y <= new Date(now).getFullYear()).sort((a, b) => b - a);
}

/* ---------------------------------------------------------------- memories */

export type MangaMemory = {
  key: string;
  kind: 'onThisDay' | 'monthAgo' | 'weekLastYear' | 'started' | 'finished' | 'comeBack';
  /** "2 years ago today". */
  kicker: string;
  title: string;
  sub: string;
  seriesIds: string[];
  at: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtMin = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim() : `${Math.max(1, min)} min`;
};

/** What you were reading on days like today, and titles to come back to. */
export function mangaMemories(series: MangaSeries[], reads: MangaRead[], now: number): MangaMemory[] {
  const live = series.filter((s) => !s.deletedAt);
  const byId = new Map(live.map((s) => [s.id, s]));
  const rs = reads.filter((r) => byId.has(r.seriesId) && r.readMs > 0);
  const out: MangaMemory[] = [];
  const today = sod(now);
  const d = new Date(now);

  /** Reads and finished chapters on one day: which titles, how long. */
  const dayOf = (start: number, end: number) => {
    const per = new Map<string, { ms: number; chapters: number }>();
    for (const r of rs) if (r.startedAt >= start && r.startedAt < end) per.set(r.seriesId, { ms: (per.get(r.seriesId)?.ms ?? 0) + r.readMs, chapters: per.get(r.seriesId)?.chapters ?? 0 });
    for (const s of live)
      for (const c of s.chapters)
        if (c.readAt && c.readAt >= start && c.readAt < end) per.set(s.id, { ms: per.get(s.id)?.ms ?? 0, chapters: (per.get(s.id)?.chapters ?? 0) + 1 });
    return [...per.entries()].sort((a, b) => b[1].ms - a[1].ms || b[1].chapters - a[1].chapters);
  };
  const describe = (rows: [string, { ms: number; chapters: number }][]) => {
    const ms = rows.reduce((a, [, v]) => a + v.ms, 0);
    const ch = rows.reduce((a, [, v]) => a + v.chapters, 0);
    return [ch ? plural(ch, 'chapter') : null, ms ? fmtMin(ms) : null, rows.length > 1 ? plural(rows.length, 'title') : null].filter(Boolean).join(' · ');
  };

  // On this day, 1, 2, 3… years ago.
  for (let y = 1; y <= 10; y++) {
    const start = sod(new Date(d.getFullYear() - y, d.getMonth(), d.getDate()).getTime());
    const rows = dayOf(start, start + DAY);
    if (!rows.length) continue;
    const first = byId.get(rows[0][0])!;
    out.push({ key: `day-${y}`, kind: 'onThisDay', kicker: y === 1 ? 'A year ago today' : `${y} years ago today`, title: first.title, sub: describe(rows), seriesIds: rows.map(([id]) => id), at: start });
  }
  // A month ago today.
  {
    const start = sod(new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()).getTime());
    const rows = dayOf(start, start + DAY);
    if (rows.length) out.push({ key: 'month', kind: 'monthAgo', kicker: 'A month ago today', title: byId.get(rows[0][0])!.title, sub: describe(rows), seriesIds: rows.map(([id]) => id), at: start });
  }
  // This week, a year ago.
  {
    const start = sod(new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()).getTime() - 3 * DAY);
    const rows = dayOf(start, start + 7 * DAY);
    if (rows.length > 0 && !out.some((m) => m.key === 'day-1' && m.seriesIds.join() === rows.map(([id]) => id).join()))
      out.push({ key: 'week-1', kind: 'weekLastYear', kicker: 'This week last year', title: byId.get(rows[0][0])!.title, sub: describe(rows), seriesIds: rows.map(([id]) => id), at: start });
  }
  // Anniversaries: the day you started or finished a title (within 3 days of today).
  const near = (t: number) => {
    const a = new Date(t);
    if (a.getFullYear() >= d.getFullYear()) return 0;
    const same = sod(new Date(d.getFullYear(), a.getMonth(), a.getDate()).getTime());
    return Math.abs(same - today) <= 3 * DAY ? d.getFullYear() - a.getFullYear() : 0;
  };
  for (const s of live) {
    const first = Math.min(...s.chapters.map((c) => c.readAt ?? Infinity), ...rs.filter((r) => r.seriesId === s.id).map((r) => r.startedAt));
    if (Number.isFinite(first)) {
      const y = near(first);
      if (y) out.push({ key: `start-${s.id}`, kind: 'started', kicker: y === 1 ? 'You started this a year ago' : `You started this ${y} years ago`, title: s.title, sub: `${plural(s.chapters.filter((c) => c.readAt).length, 'chapter')} read since`, seriesIds: [s.id], at: first });
    }
    if (s.status === 'completed' && s.finishedAt) {
      const y = near(s.finishedAt);
      if (y) out.push({ key: `fin-${s.id}`, kind: 'finished', kicker: y === 1 ? 'Finished a year ago' : `Finished ${y} years ago`, title: s.title, sub: s.rating ? `You gave it ★ ${s.rating}` : 'Time for a reread?', seriesIds: [s.id], at: s.finishedAt });
    }
  }
  // One to come back to: rated well, not opened for half a year.
  const last = (s: MangaSeries) => Math.max(s.lastReadAt ?? 0, ...rs.filter((r) => r.seriesId === s.id).map((r) => r.startedAt), ...s.chapters.map((c) => c.readAt ?? 0));
  const back = live
    .filter((s) => s.rating >= 7 && last(s) > 0 && now - last(s) > 180 * DAY && !s.isPrivate)
    .sort((a, b) => b.rating - a.rating || last(a) - last(b))[0];
  if (back) {
    const months = Math.round((now - last(back)) / (30 * DAY));
    out.push({ key: `back-${back.id}`, kind: 'comeBack', kicker: 'Come back to', title: back.title, sub: `★ ${back.rating} · last read ${months >= 12 ? plural(Math.round(months / 12), 'year') : plural(months, 'month')} ago`, seriesIds: [back.id], at: last(back) });
  }
  return out;
}

/* ----------------------------------------------------------------- storage */

export type MangaSpace = { id: string; bytes: number; downloaded: number; chapters: number; read: number };

/** Space each title takes on the phone, biggest first. */
export function spaceByTitle(series: MangaSeries[]): MangaSpace[] {
  return series
    .filter((s) => !s.deletedAt)
    .map((s) => {
      const on = s.chapters.filter((c) => c.downloaded || c.folder);
      return { id: s.id, bytes: on.reduce((a, c) => a + (c.size || 0), 0), downloaded: on.length, chapters: s.chapters.length, read: on.filter((c) => c.readAt).length };
    })
    .filter((x) => x.downloaded > 0)
    .sort((a, b) => b.bytes - a.bytes || b.downloaded - a.downloaded);
}

/* ------------------------------------------------------- videos + manga */

export type MixPlay = { videoId: string; startedAt: number; watchedMs: number };

export type MixNumbers = {
  watchMs: number;
  readMs: number;
  totalMs: number;
  /** Share of the time spent reading, 0..1. */
  readShare: number;
  videos: number;
  topVideo: { id: string; ms: number; plays: number } | null;
  /** Days you watched or read. */
  days: number;
  /** Days you did both. */
  bothDays: number;
  busiestDay: { day: number; watchMs: number; readMs: number } | null;
  /** Which you did more at each part of the day. */
  morning: 'watch' | 'read' | null;
  night: 'watch' | 'read' | null;
};

/** Watching and reading side by side, for the same range. */
export function mixNumbers(plays: MixPlay[], reading: ReadingRange, reads: MangaRead[]): MixNumbers {
  const { start, end } = reading;
  const ps = plays.filter((x) => x.startedAt >= start && x.startedAt < end && x.watchedMs > 0);
  const rs = reads.filter((r) => r.startedAt >= start && r.startedAt < end && r.readMs > 0);
  const per = new Map<string, { ms: number; plays: number }>();
  for (const x of ps) per.set(x.videoId, { ms: (per.get(x.videoId)?.ms ?? 0) + x.watchedMs, plays: (per.get(x.videoId)?.plays ?? 0) + 1 });
  const top = [...per.entries()].sort((a, b) => b[1].ms - a[1].ms)[0];
  const days = new Map<number, { watchMs: number; readMs: number }>();
  for (const x of ps) {
    const d = sod(x.startedAt);
    days.set(d, { watchMs: (days.get(d)?.watchMs ?? 0) + x.watchedMs, readMs: days.get(d)?.readMs ?? 0 });
  }
  for (const r of rs) {
    const d = sod(r.startedAt);
    days.set(d, { watchMs: days.get(d)?.watchMs ?? 0, readMs: (days.get(d)?.readMs ?? 0) + r.readMs });
  }
  // Days with only finished chapters (no timed session) still count as reading days.
  if (reading.busiestDay && !days.has(reading.busiestDay.day) && reading.busiestDay.chapters) days.set(reading.busiestDay.day, { watchMs: 0, readMs: 0 });
  let busiest: MixNumbers['busiestDay'] = null;
  for (const [day, v] of days) if (!busiest || v.watchMs + v.readMs > busiest.watchMs + busiest.readMs) busiest = { day, ...v };
  const part = (from: number, to: number): 'watch' | 'read' | null => {
    const h = (t: number) => new Date(t).getHours();
    const w = ps.filter((x) => h(x.startedAt) >= from && h(x.startedAt) < to).reduce((a, x) => a + x.watchedMs, 0);
    const r = rs.filter((x) => h(x.startedAt) >= from && h(x.startedAt) < to).reduce((a, x) => a + x.readMs, 0);
    return w === 0 && r === 0 ? null : w >= r ? 'watch' : 'read';
  };
  const watchMs = ps.reduce((a, x) => a + x.watchedMs, 0);
  const readMs = reading.ms;
  return {
    watchMs,
    readMs,
    totalMs: watchMs + readMs,
    readShare: watchMs + readMs ? readMs / (watchMs + readMs) : 0,
    videos: per.size,
    topVideo: top ? { id: top[0], ...top[1] } : null,
    days: [...days.values()].length,
    bothDays: [...days.values()].filter((v) => v.watchMs > 0 && v.readMs > 0).length,
    busiestDay: busiest,
    morning: part(5, 12),
    night: part(20, 24),
  };
}
