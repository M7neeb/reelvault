/**
 * The badge road: every badge you earned, in the order you earned them, then
 * where you are now and the next few you are closest to. Pure: no React.
 */

import type { Achievement } from './achievements.ts';

export type RoadStop = {
  a: Achievement;
  state: 'earned' | 'next' | 'ahead';
  /** "Oct 2026" where a new month starts on the road. */
  month: string | null;
};

export function badgeRoad(list: Achievement[], opts: { earnedMax?: number; ahead?: number } = {}): { stops: RoadStop[]; hidden: number; earned: number } {
  const counts = (a: Achievement) => a.kind !== 'weekly' && a.kind !== 'monthly';
  const earned = list.filter((a) => counts(a) && a.unlocked && a.earnedAt !== null).sort((a, b) => a.earnedAt! - b.earnedAt! || a.tier - b.tier);
  const shown = opts.earnedMax ? earned.slice(-opts.earnedMax) : earned;
  const ahead = list
    .filter((a) => counts(a) && !a.unlocked && !a.secret && a.target > 0)
    .sort((a, b) => b.current / b.target - a.current / a.target || a.target - b.target)
    .slice(0, opts.ahead ?? 4);
  let lastMonth = '';
  const stops: RoadStop[] = shown.map((a) => {
    const m = new Date(a.earnedAt!).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    const month = m !== lastMonth ? m : null;
    lastMonth = m;
    return { a, state: 'earned', month };
  });
  ahead.forEach((a, i) => stops.push({ a, state: i === 0 ? 'next' : 'ahead', month: null }));
  return { stops, hidden: earned.length - shown.length, earned: earned.length };
}
