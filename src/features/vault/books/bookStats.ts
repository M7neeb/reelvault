/**
 * Numbers about your reading in Books: this week by day, streaks, what you
 * read most and when, each year at a glance, and the figures behind a Books
 * Wrapped for any stretch of time. Built from the sittings in book_reads.
 * Pure: no React, no native modules (tested in Node).
 */

import type { BookItem, BookRead } from './bookLogic.ts';

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const dayKey = (t: number) => sod(t);

/** "45 min", "3 h 5 min", "12 h". */
export function fmtTime(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return ms > 0 ? 'under a minute' : '0 min';
  if (min < 60) return `${min} min`;
  if (min >= 600) return `${Math.round(min / 60)} h`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A day counts towards a streak with at least a minute of reading. */
const MIN_DAY_MS = 60_000;

function msByDay(reads: BookRead[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of reads) out.set(dayKey(r.startedAt), (out.get(dayKey(r.startedAt)) ?? 0) + r.ms);
  return out;
}

/** The current run of reading days (today may still be empty) and the best run ever. */
export function streaks(reads: BookRead[], now: number): { current: number; best: number } {
  const days = [...msByDay(reads).entries()].filter(([, ms]) => ms >= MIN_DAY_MS).map(([d]) => d).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    // Days are local midnights; 20-28 h apart covers clock changes.
    run = prev !== null && d - prev > 20 * 3_600_000 && d - prev < 28 * 3_600_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const set = new Set(days);
  let current = 0;
  let d = sod(now);
  if (!set.has(d)) d = sod(d - DAY / 2);
  while (set.has(d)) {
    current++;
    d = sod(d - DAY / 2);
  }
  return { current, best };
}

const ranked = (m: Map<string, number>, n: number) =>
  [...m.entries()]
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, ms]) => ({ id, ms }));

export type BookStats = {
  todayMs: number;
  weekMs: number;
  /** Monday to Sunday of this week. */
  week: { label: string; ms: number; today: boolean }[];
  totalMs: number;
  sessions: number;
  averageSessionMs: number;
  streak: number;
  bestStreak: number;
  top: { id: string; ms: number }[];
  /** Reading time by hour of the day. */
  hours: number[];
  finished: number;
  reading: number;
  notStarted: number;
};

export function bookStats(books: BookItem[], reads: BookRead[], now: number): BookStats {
  const ids = new Set(books.map((b) => b.id));
  const rs = reads.filter((r) => ids.has(r.bookId) && r.ms > 0);
  const today = sod(now);
  const monday = sod(today - ((new Date(now).getDay() + 6) % 7) * DAY + 3_600_000);
  const byDay = msByDay(rs);
  const week = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => {
    const d = sod(monday + i * DAY + 3_600_000);
    return { label, ms: byDay.get(d) ?? 0, today: d === today };
  });
  const hours = new Array(24).fill(0);
  const per = new Map<string, number>();
  for (const r of rs) {
    hours[new Date(r.startedAt).getHours()] += r.ms;
    per.set(r.bookId, (per.get(r.bookId) ?? 0) + r.ms);
  }
  const totalMs = rs.reduce((a, r) => a + r.ms, 0);
  const st = streaks(rs, now);
  return {
    todayMs: byDay.get(today) ?? 0,
    weekMs: week.reduce((a, d) => a + d.ms, 0),
    week,
    totalMs,
    sessions: rs.length,
    averageSessionMs: rs.length ? totalMs / rs.length : 0,
    streak: st.current,
    bestStreak: st.best,
    top: ranked(per, 5),
    hours,
    finished: books.filter((b) => b.finishedAt).length,
    reading: books.filter((b) => !b.finishedAt && b.lastReadAt).length,
    notStarted: books.filter((b) => !b.finishedAt && !b.lastReadAt).length,
  };
}

/* ---------------------------------------------------------------- years */

export type BookYear = { year: number; ms: number; books: number; days: number; finished: number; top: string[] };

/** Every year you read or finished something in, newest first. */
export function bookYears(books: BookItem[], reads: BookRead[], now: number): BookYear[] {
  const ids = new Set(books.map((b) => b.id));
  const years = new Set<number>([new Date(now).getFullYear()]);
  for (const r of reads) if (ids.has(r.bookId) && r.ms > 0) years.add(new Date(r.startedAt).getFullYear());
  for (const b of books) if (b.finishedAt) years.add(new Date(b.finishedAt).getFullYear());
  return [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const start = new Date(year, 0, 1).getTime();
      const end = new Date(year + 1, 0, 1).getTime();
      const rs = reads.filter((r) => ids.has(r.bookId) && r.startedAt >= start && r.startedAt < end && r.ms > 0);
      const per = new Map<string, number>();
      for (const r of rs) per.set(r.bookId, (per.get(r.bookId) ?? 0) + r.ms);
      return {
        year,
        ms: rs.reduce((a, r) => a + r.ms, 0),
        books: per.size,
        days: new Set(rs.map((r) => dayKey(r.startedAt))).size,
        finished: books.filter((b) => b.finishedAt && b.finishedAt >= start && b.finishedAt < end).length,
        top: ranked(per, 3).map((t) => t.id),
      };
    })
    .filter((y, i) => i === 0 || y.ms > 0 || y.finished > 0);
}

/* -------------------------------------------------------------- Wrapped */

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
const partOf = (h: number): PartOfDay => (h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night');

export type BookWrap = {
  ms: number;
  days: number;
  sessions: number;
  averageSessionMs: number;
  /** The longest single sitting. */
  longest: { bookId: string; ms: number; at: number } | null;
  /** Books by time, with how much of each you got through in this stretch (0..1). */
  top: { id: string; ms: number; gained: number }[];
  finished: { id: string; at: number }[];
  /** Books opened for the first time in this stretch. */
  started: string[];
  /** Whole books' worth of reading: the share of each book you got through, added up. */
  booksWorth: number;
  busiestDay: { at: number; ms: number } | null;
  bestStreak: number;
  partOfDay: PartOfDay | null;
  /** Reading by part of day, morning to night. */
  parts: Record<PartOfDay, number>;
  /** Reading by hour of the day, and the busiest hour. */
  hours: number[];
  peakHour: number | null;
  /** By month (a year or longer) or by day (shorter). */
  bars: { label: string; ms: number }[];
  /** The same length of time before, to compare. */
  prevMs: number;
};

export function bookWrapped(books: BookItem[], reads: BookRead[], start: number, end: number, prevStart?: number): BookWrap {
  const ids = new Set(books.map((b) => b.id));
  const mine = reads.filter((r) => ids.has(r.bookId) && r.ms > 0);
  const rs = mine.filter((r) => r.startedAt >= start && r.startedAt < end);
  const ms = rs.reduce((a, r) => a + r.ms, 0);
  const per = new Map<string, number>();
  const gained = new Map<string, number>();
  const parts: Record<PartOfDay, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let longest: BookWrap['longest'] = null;
  const hours = new Array(24).fill(0);
  for (const r of rs) {
    hours[new Date(r.startedAt).getHours()] += r.ms;
    per.set(r.bookId, (per.get(r.bookId) ?? 0) + r.ms);
    gained.set(r.bookId, (gained.get(r.bookId) ?? 0) + Math.max(0, r.to - r.from));
    parts[partOf(new Date(r.startedAt).getHours())] += r.ms;
    if (!longest || r.ms > longest.ms) longest = { bookId: r.bookId, ms: r.ms, at: r.startedAt };
  }
  const byDay = msByDay(rs);
  let busiestDay: BookWrap['busiestDay'] = null;
  for (const [at, v] of byDay) if (!busiestDay || v > busiestDay.ms) busiestDay = { at, ms: v };
  const firstRead = new Map<string, number>();
  for (const r of mine) if (!firstRead.has(r.bookId) || r.startedAt < firstRead.get(r.bookId)!) firstRead.set(r.bookId, r.startedAt);
  const partOfDay = ms ? (Object.entries(parts).sort((a, b) => b[1] - a[1])[0][0] as PartOfDay) : null;

  const bars: BookWrap['bars'] = [];
  if (end - start > 45 * DAY) {
    const d = new Date(start);
    for (let m = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); m < end; ) {
      const next = new Date(new Date(m).getFullYear(), new Date(m).getMonth() + 1, 1).getTime();
      bars.push({ label: new Date(m).toLocaleDateString('en', { month: 'short' }), ms: rs.filter((r) => r.startedAt >= m && r.startedAt < next).reduce((a, r) => a + r.ms, 0) });
      m = next;
    }
  } else {
    for (let d = sod(start); d < end; d = sod(d + DAY + 3_600_000)) bars.push({ label: new Date(d).toLocaleDateString('en', { weekday: 'narrow' }), ms: byDay.get(d) ?? 0 });
  }

  const prevMs = prevStart !== undefined ? mine.filter((r) => r.startedAt >= prevStart && r.startedAt < start).reduce((a, r) => a + r.ms, 0) : 0;
  return {
    ms,
    days: [...byDay.values()].filter((v) => v > 0).length,
    sessions: rs.length,
    averageSessionMs: rs.length ? ms / rs.length : 0,
    longest,
    top: ranked(per, 5).map((t) => ({ ...t, gained: Math.min(1, gained.get(t.id) ?? 0) })),
    finished: books
      .filter((b) => b.finishedAt && b.finishedAt >= start && b.finishedAt < end)
      .map((b) => ({ id: b.id, at: b.finishedAt! }))
      .sort((a, b) => a.at - b.at),
    started: [...firstRead.entries()].filter(([, at]) => at >= start && at < end).sort((a, b) => a[1] - b[1]).map(([id]) => id),
    booksWorth: Math.round([...gained.values()].reduce((a, g) => a + Math.min(1, g), 0) * 10) / 10,
    busiestDay,
    bestStreak: streaks(rs, end - 1).best,
    partOfDay,
    parts,
    hours,
    peakHour: ms ? hours.indexOf(Math.max(...hours)) : null,
    bars,
    prevMs,
  };
}

/** What kind of reader the numbers say you are, in a few words. */
export function readerKind(w: BookWrap): { name: string; line: string } {
  if (!w.ms) return { name: 'Just starting', line: 'The first page is the hardest one.' };
  if (w.partOfDay === 'night' && w.parts.night >= w.ms * 0.4) return { name: 'Night reader', line: 'Most of your pages were turned after ten at night.' };
  if (w.averageSessionMs >= 45 * 60_000) return { name: 'Deep diver', line: 'When you sit down with a book, you stay for a while.' };
  if (w.days >= 20 && w.averageSessionMs < 20 * 60_000) return { name: 'Little and often', line: 'Short sittings, nearly every day. It adds up.' };
  if (w.finished.length >= 3) return { name: 'Finisher', line: 'You see books through to the last page.' };
  if (w.partOfDay === 'morning') return { name: 'Morning reader', line: 'Your reading happens before the day gets going.' };
  return { name: 'Steady reader', line: 'A page here, a chapter there, and the book keeps moving.' };
}
