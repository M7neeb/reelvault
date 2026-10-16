/**
 * The rules for "Make Smaller", without any native code (tested in Node).
 * The native half is `compress.ts`; the encoder is modules/reelvault-compress.
 */

import type { Mp4Meta } from './mp4';

export type CompressQuality = 'same' | '1080p' | '720p' | 'small';

export const QUALITIES: { key: CompressQuality; label: string; hint: string }[] = [
  { key: 'same', label: 'Same size', hint: 'Keeps the resolution, re-encodes as HEVC. Best for older H.264 videos.' },
  { key: '1080p', label: '1080p', hint: 'HEVC at up to 1920×1080. Big savings on 4K videos, still sharp on a phone.' },
  { key: '720p', label: '720p', hint: 'Up to 1280×720. Much smaller, a little soft on a big screen.' },
  { key: 'small', label: 'Smallest', hint: 'Low resolution. For clips where only the content matters.' },
];

/** A result is only kept when it saves at least this share of the original. */
export const MIN_SAVING = 0.1;

export function worthKeeping(before: number, after: number): boolean {
  return after > 0 && before > 0 && after <= before * (1 - MIN_SAVING);
}

/** Space the export needs while it runs: the new file can be about as big as the old one. */
export function spaceNeeded(sizeBytes: number): number {
  return sizeBytes + 200 * 1024 * 1024;
}

/**
 * The re-encoded file's own metadata, with what it lost filled in from the
 * original (the exporter may drop the device, location or filming date).
 */
export function mergeMeta(original: Mp4Meta | null, next: Mp4Meta | null): Mp4Meta | null {
  if (!original) return next;
  if (!next) return original;
  return {
    ...next,
    createdAt: original.createdAt ?? next.createdAt,
    location: original.location ?? next.location,
    make: original.make ?? next.make,
    model: original.model ?? next.model,
    software: original.software ?? next.software,
  };
}

export function parseQuality(value: string | null): CompressQuality | null {
  return value === 'same' || value === '1080p' || value === '720p' || value === 'small' ? value : null;
}
