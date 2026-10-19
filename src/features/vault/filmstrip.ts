import { Directory, File } from 'expo-file-system';

import { frameTo, STRIP_SIDE } from './frames';
import { filmstripDir } from './storage';

/** Enough frames that the scrub preview matches where your finger is (they are small: about 10 KB each). */
export const FRAME_COUNT = 24;

/**
 * Build (or reuse) a row of evenly-spaced stills for the scrubber under the player.
 * Cached in thumbs/<id>/<size>-s<i>.jpg … so it is generated once per video, not per
 * open. The file size is in the name so an edited (trimmed, re-encoded) video gets
 * fresh frames instead of cached old ones. Frames are 240 px; old full-size ones
 * (<size>-f<i>.jpg) are removed when the new set is made.
 */
export async function ensureFilmstrip(video: {
  id: string;
  uri: string;
  durationMs: number | null;
  size: number;
}): Promise<string[]> {
  const dir = filmstripDir(video.id);
  const frames: string[] = [];
  let allCached = true;

  for (let i = 0; i < FRAME_COUNT; i++) {
    const file = new File(dir, `${video.size}-s${i}.jpg`);
    if (file.exists) frames.push(file.uri);
    else {
      allCached = false;
      break;
    }
  }
  if (allCached && frames.length === FRAME_COUNT) return frames;

  if (!dir.exists) dir.create({ intermediates: true });
  // Frames from before (full size, or another file size): gone.
  try {
    for (const f of dir.list()) if (f instanceof File && !f.name.startsWith(`${video.size}-s`)) f.delete();
  } catch (e) {
    console.log(`[FILM] old frames not cleared: ${String(e)}`);
  }

  const duration = video.durationMs ?? 0;
  const out: string[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const destination = new File(dir, `${video.size}-s${i}.jpg`);
    if (!destination.exists) {
      const time = duration > 0 ? Math.floor((duration * (i + 0.5)) / FRAME_COUNT) : i * 1000;
      try {
        await frameTo(video.uri, time, destination, STRIP_SIDE);
      } catch (e) {
        console.log(`[FILM] frame ${i} failed: ${String(e)}`);
      }
    }
    if (destination.exists) out.push(destination.uri);
  }

  console.log(`[FILM] ${out.length} frames for ${video.id}`);
  return out;
}

export function clearFilmstrip(videoId: string): void {
  try {
    const dir = filmstripDir(videoId);
    if (dir.exists) dir.delete();
  } catch (e) {
    console.log(`[FILM] clear failed: ${String(e)}`);
  }
}

export function filmstripDirRef(videoId: string): Directory {
  return filmstripDir(videoId);
}
