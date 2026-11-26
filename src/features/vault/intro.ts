/**
 * Finding the intro: the opening two episodes share (the same title
 * sequence), from picture prints a second apart over each video's first
 * minutes. It may start after a cold open, so the two can be at different
 * places in each video.
 */

import { hamming, telling } from './sceneLogic.ts';

export type Intro = { startSec: number; endSec: number };

/** How far in to look, and how often. */
export const INTRO_LOOK_SEC = 150;
export const INTRO_STEP_SEC = 1;
/** Shorter shared stretches are a logo or a black frame, not an intro. */
const MIN_INTRO_SEC = 6;

/** The seconds to take prints at: every `step` from 0.5 s, within the first `lookSec` (not the last second). */
export function openingSeconds(durationMs: number | null, lookSec = INTRO_LOOK_SEC, step = INTRO_STEP_SEC): number[] {
  if (!durationMs || durationMs < 10_000) return [];
  const d = durationMs / 1000;
  const out: number[] = [];
  for (let t = 0.5; t < Math.min(lookSec, d - 1); t += step) out.push(t);
  return out;
}

const same = (x: string | undefined, y: string | undefined) => !!x && !!y && telling(x) && telling(y) && hamming(x, y) <= 10;

/**
 * The longest stretch the two print lists share, at any place in each:
 * indexes where it starts and how many frames long. One odd or unreadable
 * frame inside it is let through. Null when nothing long enough is shared.
 */
export function sharedRun(a: string[], b: string[], step = INTRO_STEP_SEC): { a: number; b: number; len: number } | null {
  let best: { a: number; b: number; len: number } | null = null;
  for (let shift = -(b.length - 1); shift < a.length; shift++) {
    // a[i] lines up with b[i - shift].
    let start = -1;
    let last = -1;
    let misses = 0;
    for (let i = Math.max(0, shift); i < a.length && i - shift < b.length; i++) {
      if (same(a[i], b[i - shift])) {
        if (start < 0) start = i;
        last = i;
        misses = 0;
      } else if (start >= 0 && ++misses > 1) {
        const len = last - start + 1;
        if (!best || len > best.len) best = { a: start, b: start - shift, len };
        start = -1;
        misses = 0;
      }
    }
    if (start >= 0) {
      const len = last - start + 1;
      if (!best || len > best.len) best = { a: start, b: start - shift, len };
    }
  }
  return best && best.len * step >= MIN_INTRO_SEC ? best : null;
}

/** This video's intro: the longest opening it shares with any of the others (their prints over the same seconds). */
export function introOf(mine: string[], others: string[][], seconds: number[], step = INTRO_STEP_SEC): Intro | null {
  let best: { a: number; len: number } | null = null;
  for (const o of others) {
    const r = sharedRun(mine, o, step);
    if (r && (!best || r.len > best.len || (r.len === best.len && r.a < best.a))) best = r;
  }
  if (!best || !seconds.length) return null;
  const startSec = Math.max(0, seconds[best.a] - step / 2);
  const endSec = seconds[Math.min(seconds.length - 1, best.a + best.len - 1)] + step / 2;
  return { startSec: Math.round(startSec * 2) / 2, endSec: Math.round(endSec * 2) / 2 };
}

/** The others to compare a video with: its neighbours in the list (episodes next to each other share the intro). */
export function partners<T>(list: T[], i: number, n = 2): T[] {
  const out: T[] = [];
  for (let k = 1; k <= n; k++) {
    if (list[i + k] !== undefined) out.push(list[i + k]);
    if (list[i - k] !== undefined) out.push(list[i - k]);
  }
  return out;
}

/** Saved as "12.5,40" (start, end in seconds). */
export const formatIntro = (x: Intro): string => `${x.startSec},${x.endSec}`;
export function parseIntro(s: string | null): Intro | null {
  const m = s?.match(/^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const startSec = Number(m[1]);
  const endSec = Number(m[2]);
  return endSec > startSec ? { startSec, endSec } : null;
}

/** Intros right at the start can be cut off with Trim Start; one after a cold open can't (that would cut the cold open too). */
export const atStart = (x: Intro | null): x is Intro => !!x && x.startSec <= 3;
