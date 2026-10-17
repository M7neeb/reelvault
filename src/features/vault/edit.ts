/**
 * Trim, crop, resolution and frame rate: the plan the editor builds and the
 * numbers it shows, without any native code (tested in Node). The encoder
 * is modules/reelvault-compress; the native half is `compress.ts`.
 *
 * Sizes are in display orientation (a portrait iPhone video is 1080×1920,
 * not its stored 1920×1080), which is what `width`/`height` hold everywhere.
 */

import type { CompressQuality } from './smaller';

/** A crop as fractions of the displayed frame (0..1). */
export type Crop = { x: number; y: number; w: number; h: number };

export type EditPlan = {
  startMs: number;
  /** null = to the end */
  endMs: number | null;
  crop: Crop | null;
  /** Largest allowed short side in pixels (1080 = "1080p"); null = keep. */
  maxShortSide: number | null;
  /** null = keep the video's own frame rate. */
  fps: number | null;
  /** Trim only, no re-encoding: instant and loses nothing. Ignored when anything else changes. */
  lossless: boolean;
};

export type SourceInfo = {
  width: number | null;
  height: number | null;
  fps: number | null;
  durationMs: number | null;
  sizeBytes: number;
};

export const EMPTY_PLAN: EditPlan = { startMs: 0, endMs: null, crop: null, maxShortSide: null, fps: null, lossless: true };

export const RESOLUTIONS: { key: number | null; label: string }[] = [
  { key: null, label: 'Original' },
  { key: 2160, label: '4K' },
  { key: 1440, label: '1440p' },
  { key: 1080, label: '1080p' },
  { key: 720, label: '720p' },
  { key: 480, label: '480p' },
];

export const FRAME_RATES: { key: number | null; label: string }[] = [
  { key: null, label: 'Original' },
  { key: 60, label: '60' },
  { key: 30, label: '30' },
  { key: 25, label: '25' },
  { key: 24, label: '24' },
];

export const ASPECTS: { key: string; label: string; ratio: number | null }[] = [
  { key: 'original', label: 'Original', ratio: null },
  { key: '1:1', label: 'Square', ratio: 1 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '4:5', label: '4:5', ratio: 4 / 5 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Which part of a free crop frame is being dragged. */
export type CropHandle = 'move' | 'tl' | 'tr' | 'bl' | 'br' | 'l' | 'r' | 't' | 'b';

/**
 * A free crop after dragging one handle by (dx, dy), as fractions of the
 * frame. The frame stays inside the video and never gets smaller than `min`.
 */
export function moveCrop(start: Crop, handle: CropHandle, dx: number, dy: number, min = 0.08): Crop {
  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes('l')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('r')) right = clamp(right + dx, left + min, 1);
  if (handle === 't' || handle === 'tl' || handle === 'tr') top = clamp(top + dy, 0, bottom - min);
  if (handle === 'b' || handle === 'bl' || handle === 'br') bottom = clamp(bottom + dy, top + min, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** A free crop that covers (almost) everything is no crop at all. */
export function freeCropOrNull(c: Crop): Crop | null {
  return c.w > 0.995 && c.h > 0.995 ? null : c;
}

/** Video encoders want even sizes. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * The crop for an aspect ratio, zoomed in (1 = as big as fits) and moved
 * (0..1 along each free direction, 0.5 = centred). null = no crop.
 */
export function cropFor(
  ratio: number | null,
  width: number,
  height: number,
  zoom = 1,
  posX = 0.5,
  posY = 0.5
): Crop | null {
  if (!width || !height) return null;
  const z = clamp(zoom, 1, 4);
  const source = width / height;
  const target = ratio ?? source;
  if (ratio === null && z === 1) return null;
  // Biggest box with the target shape that fits, then zoomed.
  let w = target > source ? 1 : target / source;
  let h = target > source ? source / target : 1;
  w /= z;
  h /= z;
  const x = (1 - w) * clamp(posX, 0, 1);
  const y = (1 - h) * clamp(posY, 0, 1);
  return { x, y, w, h };
}

export function isTrimmed(plan: EditPlan, durationMs: number | null): boolean {
  return plan.startMs > 0 || (plan.endMs !== null && (durationMs === null || plan.endMs < durationMs));
}

/** What the result will look like. */
export function outputOf(plan: EditPlan, src: SourceInfo): { width: number | null; height: number | null; fps: number | null; durationMs: number | null } {
  let width = src.width;
  let height = src.height;
  if (width && height) {
    let w = width;
    let h = height;
    if (plan.crop) {
      w = width * plan.crop.w;
      h = height * plan.crop.h;
    }
    const short = Math.min(w, h);
    const scale = plan.maxShortSide && short > plan.maxShortSide ? plan.maxShortSide / short : 1;
    const changed = plan.crop || scale < 1;
    width = changed ? even(w * scale) : width;
    height = changed ? even(h * scale) : height;
  }
  const fps = plan.fps && src.fps ? Math.min(plan.fps, src.fps) : (src.fps ?? plan.fps);
  const end = plan.endMs ?? src.durationMs;
  const durationMs = end !== null ? Math.max(0, end - plan.startMs) : null;
  return { width, height, fps, durationMs };
}

/** Whether the frames have to be re-encoded (anything but a lossless trim). */
export function needsReencode(plan: EditPlan, src: SourceInfo): boolean {
  if (!plan.lossless) return true;
  if (plan.crop) return true;
  const out = outputOf(plan, src);
  if (out.width !== src.width || out.height !== src.height) return true;
  if (plan.fps && src.fps && plan.fps < src.fps - 0.5) return true;
  return false;
}

/** True when the plan changes nothing at all. */
export function isNoop(plan: EditPlan, src: SourceInfo): boolean {
  return !isTrimmed(plan, src.durationMs) && !needsReencode(plan, src);
}

/**
 * A rough guess of the new file size. Apple's HEVC encoder lands near 0.1 bits
 * per pixel per frame at its highest quality, plus about 160 kbit/s of audio;
 * it never makes a stream bigger than it was.
 */
export function estimateBytes(plan: EditPlan, src: SourceInfo): number | null {
  const out = outputOf(plan, src);
  if (!src.durationMs || !out.durationMs) return null;
  const share = out.durationMs / src.durationMs;
  const asIs = src.sizeBytes * share;
  if (!needsReencode(plan, src)) return Math.round(asIs);
  if (!out.width || !out.height) return null;
  const seconds = out.durationMs / 1000;
  const videoBits = out.width * out.height * (out.fps ?? 30) * 0.1 * seconds;
  const audioBits = 160_000 * seconds;
  return Math.round(Math.min(asIs, (videoBits + audioBits) / 8));
}

/** The old Make Smaller choices, as plans (Settings → "Make imported videos smaller"). */
export function planForQuality(quality: CompressQuality): EditPlan {
  const maxShortSide = quality === '1080p' ? 1080 : quality === '720p' ? 720 : quality === 'small' ? 480 : null;
  return { ...EMPTY_PLAN, maxShortSide, lossless: false };
}

/** What the native encoder gets. */
export function nativeOptions(plan: EditPlan) {
  const crop = plan.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return {
    startMs: plan.startMs,
    endMs: plan.endMs ?? 0,
    cropX: crop.x,
    cropY: crop.y,
    cropW: crop.w,
    cropH: crop.h,
    maxShortSide: plan.maxShortSide ?? 0,
    fps: plan.fps ?? 0,
    passthrough: plan.lossless && !plan.crop && !plan.maxShortSide && !plan.fps,
  };
}

/** "3840×2160 · 30 fps" */
export function fmtFormatLine(width: number | null, height: number | null, fps: number | null): string {
  const parts: string[] = [];
  if (width && height) parts.push(`${width}×${height}`);
  if (fps) parts.push(`${Math.round(fps * 100) / 100} fps`);
  return parts.join(' · ') || 'unknown';
}
