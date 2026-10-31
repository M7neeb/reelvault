/**
 * The numbers on the Wrapped tab, worked out once: this year, all time, the
 * last weeks (this one first), the twelve months of this year (the ones still
 * to come marked as such, the best one marked) and the years before. Pure
 * (tested in tests/manga-wrapped-hub.test.mjs).
 */

import type { MangaRead, MangaSeries } from './mangaLogic.ts';
import { allTimeRange, readingIn, readingYears, recentWeekRanges, yearRangeOf, type ReadingRange, type ReadRange } from './mangaInsights.ts';

export type HubEntry = { range: ReadRange; y: ReadingRange };
export type HubMonth = HubEntry & { month: number; future: boolean };

export type WrappedHub = {
  year: HubEntry;
  all: HubEntry;
  weeks: HubEntry[];
  months: HubMonth[];
  /** The month of this year you read the most (index 0 to 11), or null. */
  bestMonth: number | null;
  /** Years before this one you read in, newest first. */
  pastYears: HubEntry[];
};

/** Time, else five minutes a chapter: how much a range weighs. */
export const weightOf = (y: Pick<ReadingRange, 'ms' | 'chapters'>) => y.ms || y.chapters * 5 * 60_000;

export function wrappedHub(series: MangaSeries[], reads: MangaRead[], now: number, weeks = 8): WrappedHub {
  const entry = (range: ReadRange): HubEntry => ({ range, y: readingIn(series, reads, range.start, range.end) });
  const year = new Date(now).getFullYear();
  const months: HubMonth[] = Array.from({ length: 12 }, (_, m) => {
    const start = new Date(year, m, 1).getTime();
    const end = Math.min(new Date(year, m + 1, 1).getTime(), now + 1);
    const future = start > now;
    const range: ReadRange = { start, end: future ? start : end, label: new Date(start).toLocaleDateString(undefined, { month: 'long' }), kind: 'month' };
    return { ...(future ? { range, y: readingIn(series, [], start, start) } : entry(range)), month: m, future };
  });
  let bestMonth: number | null = null;
  for (const m of months) if (!m.future && weightOf(m.y) > 0 && (bestMonth === null || weightOf(m.y) > weightOf(months[bestMonth].y))) bestMonth = m.month;
  return {
    year: entry(yearRangeOf(year, now)),
    all: entry(allTimeRange(series, reads, now)),
    weeks: recentWeekRanges(now, weeks).map(entry),
    months,
    bestMonth,
    pastYears: readingYears(series, reads, now)
      .filter((y) => y < year)
      .map((y) => entry(yearRangeOf(y, now))),
  };
}
