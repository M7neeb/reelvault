/**
 * "Pick for me": one title to start tonight, from Plan to Watch (or what you
 * are watching), within the time you have. Better-rated titles come up more
 * often, but anything can. Pure, so it is tested in Node.
 */

import type { SimklItem, SimklType } from './logic';

export type PickOptions = {
  type: SimklType;
  /** 'plan' = Plan to Watch, 'watching' = continue something, 'any' = both. */
  from: 'plan' | 'watching' | 'any';
  /** Longest runtime you have time for (movies: whole film, shows: one episode); null = any. */
  maxMinutes: number | null;
  /** Titles already offered this time, so "another" never repeats. */
  exclude?: Set<number>;
};

export const TIME_CHOICES: { label: string; minutes: number | null }[] = [
  { label: 'Any length', minutes: null },
  { label: '≤ 30 min', minutes: 30 },
  { label: '≤ 1 h', minutes: 60 },
  { label: '≤ 2 h', minutes: 120 },
];

export function candidates(items: SimklItem[], o: PickOptions): SimklItem[] {
  return items.filter((i) => {
    if (i.type !== o.type || o.exclude?.has(i.simklId)) return false;
    const okList = o.from === 'any' ? i.status === 'plantowatch' || i.status === 'watching' : i.status === (o.from === 'plan' ? 'plantowatch' : 'watching');
    if (!okList) return false;
    if (i.type !== 'movie' && i.status === 'watching' && !i.nextToWatch) return false;
    if (o.maxMinutes !== null && i.runtime && i.runtime > o.maxMinutes) return false;
    return true;
  });
}

/** Weight: 1 plus how far the best known rating is above 5 (IMDb, else Simkl). */
export function weightOf(i: SimklItem): number {
  const r = i.imdbRating ?? i.simklRating ?? 6;
  return 1 + Math.max(0, r - 5) ** 1.5;
}

/** `rand` is injectable for tests; returns null when nothing fits. */
export function pickOne(list: SimklItem[], rand: () => number = Math.random): SimklItem | null {
  if (!list.length) return null;
  const weights = list.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < list.length; i++) {
    x -= weights[i];
    if (x < 0) return list[i];
  }
  return list[list.length - 1];
}
