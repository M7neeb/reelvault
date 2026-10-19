/**
 * Stills from a video, saved small. A cover is at most 720 px on its long side
 * and a filmstrip frame 240 px (a full-resolution 4K still is 1-3 MB; these are
 * 40-90 KB and 8-15 KB). With the native helper (app 1.9.2+) the frame is
 * written straight to its place; before that, expo-video-thumbnails makes it
 * and the cache copy is moved (not copied) so nothing is left behind.
 */

import { File } from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { ReelVaultMedia } from '../../../modules/reelvault-media';

export const COVER_SIDE = 720;
export const STRIP_SIDE = 240;
const QUALITY = 0.72;

/** Writes the frame at `timeMs` to `dest`. Returns the video's own size (for orientation), or null. */
export async function frameTo(videoUri: string, timeMs: number, dest: File, maxSide: number): Promise<{ width: number; height: number } | null> {
  const time = Math.max(0, Math.round(timeMs));
  if (ReelVaultMedia) {
    try {
      const r = await ReelVaultMedia.frame(videoUri, time, dest.uri, maxSide, QUALITY);
      return { width: r.videoWidth || r.width, height: r.videoHeight || r.height };
    } catch (e) {
      console.log(`[FRAME] native frame failed, using the fallback: ${String(e)}`);
    }
  }
  const shot = await VideoThumbnails.getThumbnailAsync(videoUri, { time, quality: 0.6 });
  if (dest.exists) dest.delete();
  new File(shot.uri).move(dest);
  return { width: shot.width, height: shot.height };
}

/** Makes a picture (a cover chosen from Photos) cover-sized. Does nothing without the native helper. */
export async function shrinkPicture(file: File, maxSide = COVER_SIDE): Promise<void> {
  if (!ReelVaultMedia) return;
  try {
    await ReelVaultMedia.shrinkImage(file.uri, maxSide, QUALITY);
  } catch (e) {
    console.log(`[FRAME] could not shrink ${file.uri}: ${String(e)}`);
  }
}
