/**
 * Custom covers (HashPhotos' "Set as Thumbnail"): a frame from the video, or
 * any photo picked from Files / Photos. Each new cover gets a new file name
 * (thumbs/<id>-<time>.jpg) so the grid never shows a cached old one. The
 * frame made at import (thumbs/<id>.jpg) is kept, so Reset can go back to it.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File } from 'expo-file-system';

import { setCoverAt } from './repo';
import { coverFileName, thumbsDir } from './storage';
import type { Video } from './types';

async function useCoverFile(video: Video, sourceUri: string): Promise<void> {
  const coverAt = Date.now();
  await new File(sourceUri).copy(new File(thumbsDir, coverFileName(video.id, coverAt)));
  await setCoverAt(video.id, coverAt);
  removeOldCustom(video);
  console.log(`[COVER] new cover for ${video.filename}`);
}

function removeOldCustom(video: Video): void {
  if (!video.coverAt) return;
  try {
    const old = new File(thumbsDir, coverFileName(video.id, video.coverAt));
    if (old.exists) old.delete();
  } catch (e) {
    console.log(`[COVER] old cover not removed: ${String(e)}`);
  }
}

/** The frame at `timeMs` becomes the cover. */
export async function setCoverFromFrame(video: Video, timeMs: number): Promise<void> {
  const frame = await VideoThumbnails.getThumbnailAsync(video.uri, { time: Math.max(0, Math.round(timeMs)), quality: 0.8 });
  await useCoverFile(video, frame.uri);
}

/** A picked photo becomes the cover. Returns false when the picker was cancelled. */
export async function setCoverFromPhoto(video: Video): Promise<boolean> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets?.[0]) return false;
  await useCoverFile(video, picked.assets[0].uri);
  return true;
}

/** Back to the frame made at import. */
export async function resetCover(video: Video): Promise<void> {
  await setCoverAt(video.id, null);
  removeOldCustom(video);
}
