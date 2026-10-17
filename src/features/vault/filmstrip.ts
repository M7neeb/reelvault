import { Directory, File } from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { filmstripDir } from './storage';

const FRAME_COUNT = 8;

/**
 * Build (or reuse) a row of evenly-spaced stills for the scrubber under the player.
 * Cached in thumbs/<id>/<size>-f0.jpg … so it is generated once per video, not per
 * open. The file size is in the name so an edited (trimmed, re-encoded) video gets
 * fresh frames instead of cached old ones.
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
    const file = new File(dir, `${video.size}-f${i}.jpg`);
    if (file.exists) frames.push(file.uri);
    else {
      allCached = false;
      break;
    }
  }
  if (allCached && frames.length === FRAME_COUNT) return frames;

  if (!dir.exists) dir.create({ intermediates: true });

  const duration = video.durationMs ?? 0;
  const out: string[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const destination = new File(dir, `${video.size}-f${i}.jpg`);
    if (!destination.exists) {
      const time = duration > 0 ? Math.floor((duration * (i + 0.5)) / FRAME_COUNT) : i * 1000;
      try {
        const shot = await VideoThumbnails.getThumbnailAsync(video.uri, { time });
        await new File(shot.uri).copy(destination);
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
