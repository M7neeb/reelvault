/**
 * Reading goals and the quotes page: the rules that need no phone.
 * A daily goal in minutes, a goal of books for the year, and your highlights
 * from every book as one list. Pure: no React, no native modules.
 */

import { displayTitle, type BookItem, type BookMark, type BookRead } from './bookLogic.ts';

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** 0 switches a goal off. `remindAt`: hour of the evening reminder, 0 = none. */
export type BookGoals = { dailyMin: number; yearBooks: number; remindAt: number };
export const NO_GOALS: BookGoals = { dailyMin: 0, yearBooks: 0, remindAt: 0 };
export const REMIND_HOURS = [0, 18, 19, 20, 21, 22];
export const DAILY_STEPS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
export const MAX_YEAR_BOOKS = 200;

export function parseGoals(json: string | null): BookGoals {
  try {
    const g = json ? JSON.parse(json) : {};
    const year = Math.floor(Number(g?.yearBooks));
    return {
      dailyMin: DAILY_STEPS.includes(g?.dailyMin) ? g.dailyMin : 0,
      yearBooks: Number.isFinite(year) ? Math.min(MAX_YEAR_BOOKS, Math.max(0, year)) : 0,
      remindAt: REMIND_HOURS.includes(g?.remindAt) ? g.remindAt : 0,
    };
  } catch {
    return NO_GOALS;
  }
}

/** The next daily goal up or down the steps. */
export function stepDaily(now: number, dir: 1 | -1): number {
  const at = DAILY_STEPS.indexOf(now);
  return DAILY_STEPS[Math.min(DAILY_STEPS.length - 1, Math.max(0, (at < 0 ? 0 : at) + dir))];
}

export type DayGoal = { min: number; goal: number; ratio: number; met: boolean; line: string };

/** Today against the daily goal. Minutes are rounded down: 19 min 50 s is not 20 yet. */
export function dayGoal(todayMs: number, goalMin: number): DayGoal | null {
  if (goalMin <= 0) return null;
  const min = Math.floor(Math.max(0, todayMs) / 60_000);
  const met = min >= goalMin;
  const left = goalMin - min;
  return {
    min,
    goal: goalMin,
    ratio: Math.min(1, min / goalMin),
    met,
    line: met ? `${min} min today · goal reached` : min === 0 ? `${goalMin} min to read today` : `${min} of ${goalMin} min today · ${left} to go`,
  };
}

/** How many of the last seven days (today included) reached the daily goal. */
export function daysMet(reads: BookRead[], goalMin: number, now: number): number {
  if (goalMin <= 0) return 0;
  const from = sod(now) - 6 * DAY - 3_600_000;
  const per = new Map<number, number>();
  for (const r of reads) if (r.startedAt >= from && r.startedAt <= now) per.set(sod(r.startedAt), (per.get(sod(r.startedAt)) ?? 0) + r.ms);
  return [...per.values()].filter((ms) => Math.floor(ms / 60_000) >= goalMin).length;
}

export type YearGoal = { done: number; goal: number; ratio: number; line: string };

/** Books finished this year against the goal, and whether that is on pace for the day of the year. */
export function yearGoal(books: Pick<BookItem, 'finishedAt'>[], goal: number, now: number): YearGoal | null {
  if (goal <= 0) return null;
  const year = new Date(now).getFullYear();
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const done = books.filter((b) => b.finishedAt && b.finishedAt >= start && b.finishedAt < end).length;
  const due = Math.floor((goal * (now - start)) / (end - start));
  const gap = done - due;
  const n = (k: number) => `${k} ${k === 1 ? 'book' : 'books'}`;
  const line = done >= goal ? 'Goal reached' : gap > 0 ? `${n(gap)} ahead` : gap < 0 ? `${n(-gap)} behind` : 'On pace';
  return { done, goal, ratio: Math.min(1, done / goal), line: `${done} of ${goal} · ${line}` };
}

/* --------------------------------------------------------------- quotes */

export type Quote = { id: number; bookId: string; text: string; note: string | null; title: string; author: string | null; chapter: number; block: number; createdAt: number };

/** Every highlight with its book, newest first. Highlights of books that are gone or hidden are left out. */
export function quotesOf(marks: BookMark[], books: Pick<BookItem, 'id' | 'title' | 'filename' | 'author'>[]): Quote[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const out: Quote[] = [];
  for (const m of marks) {
    const b = byId.get(m.bookId);
    const text = m.text?.trim();
    if (m.kind !== 'highlight' || !b || !text) continue;
    out.push({ id: m.id, bookId: m.bookId, text, note: m.note?.trim() || null, title: displayTitle(b), author: b.author?.trim() || null, chapter: m.chapter, block: m.block, createdAt: m.createdAt });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}

export function matchesQuote(q: Quote, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [q.text, q.note, q.title, q.author].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** One quote for the day: the same all day, a different one tomorrow, every quote before any repeats. */
export function quoteOfDay(quotes: Quote[], now: number): Quote | null {
  if (!quotes.length) return null;
  const byAge = [...quotes].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  const day = Math.floor((sod(now) + 12 * 3_600_000) / DAY);
  return byAge[((day % byAge.length) + byAge.length) % byAge.length];
}

/** Text size for a quote set on a card: short lines large, a long passage still fits. */
export function quoteSize(text: string): { size: number; line: number } {
  const n = text.length;
  const size = n <= 60 ? 30 : n <= 120 ? 26 : n <= 220 ? 22 : n <= 380 ? 19 : n <= 600 ? 16 : 14;
  return { size, line: Math.round(size * 1.38) };
}

/** A highlight with typewriter quote marks and stray edges tidied, for the card. */
export function tidyQuote(text: string): string {
  return text
    .trim()
    .replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '')
    .replace(/\s+/g, ' ');
}

/** What goes to the share sheet when a picture is not possible. */
export function quoteAsText(q: Pick<Quote, 'text' | 'title' | 'author'>): string {
  return `“${tidyQuote(q.text)}”\n${q.author ? `${q.author}, ` : ''}${q.title}`;
}

/** The next reminder hour up or down the list (0 = off). */
export function stepRemind(now: number, dir: 1 | -1): number {
  const at = REMIND_HOURS.indexOf(now);
  return REMIND_HOURS[Math.min(REMIND_HOURS.length - 1, Math.max(0, (at < 0 ? 0 : at) + dir))];
}

/**
 * When to remind you to read, for the next week: at the chosen hour on each day,
 * but not today once the goal is reached or the hour has passed. Planned again
 * whenever your reading changes, so a day you reach the goal drops out.
 */
export function reminderTimes(goals: Pick<BookGoals, 'dailyMin' | 'remindAt'>, metToday: boolean, now: number, days = 7): number[] {
  if (goals.dailyMin <= 0 || goals.remindAt <= 0) return [];
  const d = new Date(now);
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, goals.remindAt, 0).getTime();
    if (i === 0 && (metToday || at <= now)) continue;
    out.push(at);
  }
  return out;
}
