/**
 * Streak freezes: a missed day doesn't break your streak if you have a freeze
 * banked. You start with one, earn another for every week (Monday to Sunday)
 * with something watched on at least five days, and hold two at most. When
 * the app opens and the days since you last watched are a gap a banked freeze
 * can cover, the freezes are spent on them and the streak carries on.
 * Pure: no React, no database.
 */

export type Freezes = { banked: number; used: number[]; lastEarnedWeek: number | null };

export const MAX_FREEZES = 2;
const DAY = 86_400_000;

export const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const mondayOf = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
};
const addDays = (t: number, n: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};

/**
 * Earn freezes for finished weeks, then spend them on the gap before today if
 * they cover all of it. `watchTimes` are play start times. Returns the same
 * object when nothing changed.
 */
export function settleFreezes(watchTimes: number[], f: Freezes, now: number): Freezes {
  const days = new Set(watchTimes.map(sod));
  let banked = f.banked;
  let lastEarned = f.lastEarnedWeek;
  const thisWeek = mondayOf(now);
  // Finished weeks since the last one counted (at most the last eight).
  let w = lastEarned !== null ? addDays(lastEarned, 7) : addDays(thisWeek, -7 * 8);
  for (; w < thisWeek; w = addDays(w, 7)) {
    let n = 0;
    for (let i = 0; i < 7; i++) if (days.has(addDays(w, i))) n++;
    if (n >= 5) banked = Math.min(MAX_FREEZES, banked + 1);
    lastEarned = w;
  }

  const used = [...f.used];
  const covered = (d: number) => days.has(d) || used.includes(d);
  const today = sod(now);
  // The last covered day before today; the days after it up to yesterday are the gap.
  let last = addDays(today, -1);
  let gap: number[] = [];
  for (let i = 0; i < 60 && !covered(last); i++) {
    gap.push(last);
    last = addDays(last, -1);
  }
  if (!covered(last)) gap = [];
  if (gap.length && gap.length <= banked) {
    used.push(...gap);
    banked -= gap.length;
  }

  if (banked === f.banked && lastEarned === f.lastEarnedWeek && used.length === f.used.length) return f;
  return { banked, used: used.sort((a, b) => a - b).slice(-120), lastEarnedWeek: lastEarned };
}

/** Frozen days as times that streak counters can treat like a day with watching (noon of each). */
export const frozenTimes = (f: Freezes | undefined) => (f?.used ?? []).map((d) => d + DAY / 2);
