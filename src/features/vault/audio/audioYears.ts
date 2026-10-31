/**
 * Your listening year by year, for the Audio Wrapped posters: time, titles,
 * days and your top three, newest year first (this year always included).
 * Pure (tested in tests/audio-years.test.mjs).
 */

import type { AudioPlay } from './audioLogic.ts';

export type ListeningYear = { year: number; ms: number; titles: number; days: number; top: string[] };

export function listeningYears(plays: AudioPlay[], now: number): ListeningYear[] {
  const thisYear = new Date(now).getFullYear();
  const by = new Map<number, { ms: number; per: Map<string, number>; days: Set<string> }>([[thisYear, { ms: 0, per: new Map(), days: new Set() }]]);
  for (const p of plays) {
    if (!(p.listenedMs > 0) || p.startedAt > now) continue;
    const d = new Date(p.startedAt);
    const y = d.getFullYear();
    let e = by.get(y);
    if (!e) {
      e = { ms: 0, per: new Map(), days: new Set() };
      by.set(y, e);
    }
    e.ms += p.listenedMs;
    e.per.set(p.itemId, (e.per.get(p.itemId) ?? 0) + p.listenedMs);
    e.days.add(`${d.getMonth()}-${d.getDate()}`);
  }
  return [...by.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, e]) => ({
      year,
      ms: e.ms,
      titles: e.per.size,
      days: e.days.size,
      top: [...e.per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id),
    }));
}
