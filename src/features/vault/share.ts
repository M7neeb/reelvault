/**
 * Getting things out of ReelVault: the iOS share sheet (Save Video, Save to
 * Files, AirDrop, other apps), a still frame from a video, and a duplicate
 * copy inside the vault.
 */

import { Share } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File } from 'expo-file-system';

import { insertVideo } from './repo';
import { coverFileName, thumbsDir, videosDir } from './storage';
import type { Video } from './types';

/** Opens the share sheet for one file. Resolves when the sheet closes. */
export async function shareFile(uri: string): Promise<void> {
  await Share.share({ url: uri });
}

/** HashPhotos' "Extract Image from Video": the frame at `timeMs`, full quality, then the share sheet. */
export async function extractFrame(video: Video, timeMs: number): Promise<void> {
  const frame = await VideoThumbnails.getThumbnailAsync(video.uri, { time: Math.max(0, Math.round(timeMs)), quality: 1 });
  await shareFile(frame.uri);
  // The full-size still was only for sharing: don't keep it in the cache.
  try {
    new File(frame.uri).delete();
  } catch {
    // already gone
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : 'mp4';
}

/** A second, independent copy of the video inside ReelVault (same rating, title and date). */
export async function duplicateVideo(video: Video): Promise<void> {
  const id = Crypto.randomUUID();
  const destination = new File(videosDir, `${id}.${extOf(video.filename)}`);
  await new File(video.uri).copy(destination);
  try {
    const cover = new File(thumbsDir, `${video.id}.jpg`);
    if (cover.exists) await cover.copy(new File(thumbsDir, `${id}.jpg`));
    if (video.coverAt) {
      const custom = new File(thumbsDir, coverFileName(video.id, video.coverAt));
      if (custom.exists) await custom.copy(new File(thumbsDir, coverFileName(id, video.coverAt)));
    }
  } catch (e) {
    console.log(`[DUPLICATE] cover not copied: ${String(e)}`);
  }
  const dot = video.filename.lastIndexOf('.');
  const filename = dot > 0 ? `${video.filename.slice(0, dot)} copy${video.filename.slice(dot)}` : `${video.filename} copy`;
  await insertVideo({
    ...video,
    id,
    uri: destination.uri,
    filename,
    importedAt: Date.now(),
    deletedAt: null,
    inTray: false,
  });
  console.log(`[DUPLICATE] ${video.filename} -> ${filename}`);
}
