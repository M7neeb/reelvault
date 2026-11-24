// Picking a video's cover by itself: the frame that looks best (sharp, well lit, colourful, a
// face when there is one) instead of the frame one second in, which is often black, blurred or
// mid-fade. Pure: runs in the tests.

export type FrameLook = {
  atMs: number;
  /** Mean grey, 0 (black) to 1 (white). */
  brightness: number;
  contrast: number;
  sharpness: number;
  colorfulness: number;
  faces: number;
  /** The biggest face's share of the picture. */
  faceArea: number;
  /** 0 to 1: eyes open, in focus, facing the camera. */
  faceQuality: number;
};

/** Where to look, as fractions of the video (not the very start or end: fades, titles, credits). */
export const COVER_FRACTIONS = [0.08, 0.16, 0.25, 0.34, 0.43, 0.52, 0.61, 0.7, 0.79, 0.88] as const;

/** Videos shorter than this keep the frame they have. */
export const MIN_AUTO_COVER_MS = 2500;

/** Where the cover made at import comes from (import.ts takes the frame at 1 s). */
export const importFrameMs = (durationMs: number): number => Math.min(1000, durationMs / 2);

/** A new frame has to beat the one in place by this much, so a fine cover is not swapped for a coin toss. */
const BETTER_BY = 0.06;

/** How good a frame would be as a cover; below 0 it should never be one (black, white, unreadable). */
export function frameScore(f: FrameLook): number {
  const b = f.brightness;
  if (!Number.isFinite(b) || b < 0.07 || b > 0.94) return -1;
  // Best around middle grey, falling off towards very dark or very bright.
  const exposure = 1 - Math.min(1, Math.abs(b - 0.48) / 0.42) ** 2;
  const flat = f.contrast < 0.06 ? 0.25 : 0;
  let score = 0.3 * clamp(f.sharpness) + 0.2 * clamp(f.contrast) + 0.15 * clamp(f.colorfulness) + 0.2 * exposure - flat;
  if (f.faces > 0) {
    // A face people can see beats scenery; a tiny face in a crowd counts for less.
    const size = Math.min(1, f.faceArea / 0.08);
    score += 0.1 + 0.15 * clamp(f.faceQuality) + 0.1 * size;
  }
  return score;
}

/**
 * The frame to use as the cover, or null to keep the current one: when nothing is usable, or
 * the best is not clearly better than `current` (the import frame, when it could be measured).
 */
export function pickCover(frames: readonly FrameLook[], current: FrameLook | null): FrameLook | null {
  let best: FrameLook | null = null;
  let bestScore = 0;
  for (const f of frames) {
    const s = frameScore(f);
    if (s > bestScore) {
      best = f;
      bestScore = s;
    }
  }
  if (!best) return null;
  if (current) {
    const now = frameScore(current);
    if (bestScore < now + BETTER_BY) return null;
  }
  return best;
}

/**
 * A rougher measure for app builds without the frame scorer: only the picture's average and
 * most vivid colour are known, so brightness and colour decide (sharpness and contrast count
 * as middling, the same for every frame).
 */
export function lookFromColors(atMs: number, average: string, dominant: string): FrameLook | null {
  const avg = rgb(average);
  if (!avg) return null;
  const dom = rgb(dominant) ?? avg;
  const brightness = 0.299 * avg[0] + 0.587 * avg[1] + 0.114 * avg[2];
  const hi = Math.max(...dom);
  const lo = Math.min(...dom);
  return { atMs, brightness, contrast: 0.3, sharpness: 0.3, colorfulness: hi > 0 ? (hi - lo) * Math.min(1, hi * 1.5) : 0, faces: 0, faceArea: 0, faceQuality: 0 };
}

/** Videos still on their import frame and not looked at yet, newest first. */
export function needsAutoCover<T extends { id: string; coverAt: number | null; durationMs: number | null; deletedAt: number | null; importedAt: number }>(
  videos: readonly T[],
  done: ReadonlySet<string>
): T[] {
  return videos
    .filter((v) => !v.deletedAt && v.coverAt === null && !done.has(v.id) && (v.durationMs ?? 0) >= MIN_AUTO_COVER_MS)
    .sort((a, b) => b.importedAt - a.importedAt);
}

/** The list of videos already looked at, read back from the settings table. */
export function parseDone(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

const clamp = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

function rgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
