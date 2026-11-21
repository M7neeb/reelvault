// The slideshow's settings and the plan for a show: which videos, in what order, how much of
// each, and where a new day starts. Pure: runs in the tests and the preview.

export type SlideshowOptions = {
  order: 'shown' | 'shuffle' | 'oldest' | 'newest' | 'best';
  /** Which videos: every one, only favourites (rated 8 or more), or only rated ones. */
  pick: 'all' | 'favourites' | 'rated';
  /** Seconds of each video; 0 = the whole video. Ignored when `fitMin` is set. */
  clipSec: number;
  /** Make the whole show last about this many minutes (each video gets an equal part); 0 = off. */
  fitMin: number;
  transition: 'fade' | 'dip' | 'zoom' | 'slide' | 'rise' | 'none';
  /** The video's name and date over it. */
  titles: boolean;
  /** A bigger date when a new day starts. */
  dayTitles: boolean;
  /** Shown over the first video, like the title of a film ("Summer at the lake"). */
  title: string;
  sound: boolean;
  /** An item from your Audio library playing under the show, or null. */
  music: string | null;
  /** 0.5, 1, 1.5 or 2. */
  speed: number;
  /** Fill the screen (crop the edges) instead of showing the whole picture. */
  fill: boolean;
  /** A slow zoom over each video. */
  drift: boolean;
  repeat: boolean;
  /** Stop after this many minutes (falling asleep to it); 0 = off. */
  stopAfterMin: number;
};

export const DEFAULT_SLIDESHOW: SlideshowOptions = {
  order: 'shown',
  pick: 'all',
  clipSec: 0,
  fitMin: 0,
  transition: 'fade',
  titles: true,
  dayTitles: false,
  title: '',
  sound: true,
  music: null,
  speed: 1,
  fill: false,
  drift: false,
  repeat: false,
  stopAfterMin: 0,
};

export const CLIP_SECONDS = [0, 5, 10, 20, 30, 60] as const;
export const FIT_MINUTES = [0, 1, 3, 5, 10] as const;
export const SPEEDS = [0.5, 1, 1.5, 2] as const;
export const STOP_AFTER = [0, 15, 30, 60] as const;
export const FAVOURITE = 8;
/** No video is shown shorter than this, however short the show should be. */
export const MIN_CLIP_MS = 3000;
const MAX_CLIP_MS = 60_000;
const TITLE_MAX = 60;

/** Saved settings read back; anything unknown or from an older app falls back to the default. */
export function parseSlideshow(r: unknown): SlideshowOptions {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const d = DEFAULT_SLIDESHOW;
  const one = <T>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    order: one(o.order, ['shown', 'shuffle', 'oldest', 'newest', 'best'] as const, d.order),
    pick: one(o.pick, ['all', 'favourites', 'rated'] as const, d.pick),
    clipSec: one(o.clipSec, CLIP_SECONDS, d.clipSec as (typeof CLIP_SECONDS)[number]),
    fitMin: one(o.fitMin, FIT_MINUTES, d.fitMin as (typeof FIT_MINUTES)[number]),
    transition: one(o.transition, ['fade', 'dip', 'zoom', 'slide', 'rise', 'none'] as const, d.transition),
    titles: bool(o.titles, d.titles),
    dayTitles: bool(o.dayTitles, d.dayTitles),
    title: typeof o.title === 'string' ? o.title.slice(0, TITLE_MAX) : d.title,
    sound: bool(o.sound, d.sound),
    music: typeof o.music === 'string' && o.music ? o.music : null,
    speed: one(o.speed, SPEEDS, d.speed as (typeof SPEEDS)[number]),
    fill: bool(o.fill, d.fill),
    drift: bool(o.drift, d.drift),
    repeat: bool(o.repeat, d.repeat),
    stopAfterMin: one(o.stopAfterMin, STOP_AFTER, d.stopAfterMin as (typeof STOP_AFTER)[number]),
  };
}

export type ShowItem = { id: string; createdAt: number; rating: number; durationMs: number | null };

function shuffled<T>(list: T[], random: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The videos that make the cut for `pick`. */
export function pickFor<T extends ShowItem>(items: readonly T[], pick: SlideshowOptions['pick']): T[] {
  if (pick === 'favourites') return items.filter((v) => v.rating >= FAVOURITE);
  if (pick === 'rated') return items.filter((v) => v.rating > 0);
  return [...items];
}

export type ShowPlan<T> = {
  list: T[];
  /** Ms of each video; 0 = whole videos. */
  clipMs: number;
  /** About how long the show runs on the clock, in ms, at its speed (whole videos with no length count as nothing). */
  totalMs: number;
  /** Videos left out to keep the show to its length. */
  leftOut: number;
};

/**
 * The show: the picked videos in order (starting from the one you tapped when "as shown"), and how
 * much of each plays (`clipMs` is in the video's own time). With a set length, each video gets an
 * equal part of the clock (3 s to 1 min); when even 3 s each would run over, the show keeps as many
 * as fit.
 */
export function planShow<T extends ShowItem>(items: readonly T[], start: number, o: SlideshowOptions, random: () => number = Math.random): ShowPlan<T> {
  const picked = pickFor(items, o.pick);
  const startId = items[start]?.id;
  let list: T[];
  switch (o.order) {
    case 'shuffle':
      list = shuffled(picked, random);
      break;
    case 'oldest':
      list = [...picked].sort((a, b) => a.createdAt - b.createdAt);
      break;
    case 'newest':
      list = [...picked].sort((a, b) => b.createdAt - a.createdAt);
      break;
    case 'best':
      list = [...picked].sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt);
      break;
    default: {
      const at = Math.max(0, picked.findIndex((v) => v.id === startId));
      list = [...picked.slice(at), ...picked.slice(0, at)];
    }
  }
  let clipMs = o.clipSec * 1000;
  let leftOut = 0;
  if (o.fitMin > 0 && list.length) {
    const budget = o.fitMin * 60_000;
    const fits = Math.max(1, Math.floor(budget / MIN_CLIP_MS));
    if (list.length > fits) {
      leftOut = list.length - fits;
      list = list.slice(0, fits);
    }
    // Each video's share of the clock; at 2x speed that is twice as much of the video.
    clipMs = Math.round(Math.min(MAX_CLIP_MS, Math.max(MIN_CLIP_MS, Math.floor(budget / list.length))) * o.speed);
  }
  const mediaMs = list.reduce((a, v) => a + (clipMs ? Math.min(clipMs, v.durationMs ?? clipMs) : (v.durationMs ?? 0)), 0);
  const totalMs = Math.round(mediaMs / o.speed);
  return { list, clipMs, totalMs, leftOut };
}

/** Where a video starts and stops in the show (ms): the whole video, or a part around `highlight`. */
export function clipWindow(durationMs: number | null, clipMs: number, highlight: (d: number, clip: number) => number): { start: number; end: number } {
  const d = durationMs ?? 0;
  if (!clipMs || !d || d <= clipMs + 1500) return { start: 0, end: d || Infinity };
  const start = Math.max(0, Math.min(d - clipMs, highlight(d, clipMs)));
  return { start, end: start + clipMs };
}

/** Whether video `i` is the first of its day in the show (the first video always is). */
export function startsDay(list: readonly { createdAt: number }[], i: number): boolean {
  if (i <= 0) return i === 0 && list.length > 0;
  const a = new Date(list[i - 1].createdAt);
  const b = new Date(list[i].createdAt);
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate();
}

/** "about 3 min", "about 1 h 5 min", "under a minute". */
export function showLength(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `about ${m} min`;
  return m % 60 ? `about ${Math.floor(m / 60)} h ${m % 60} min` : `about ${m / 60} h`;
}
