/**
 * Getting things out of ReelVault: the iOS share sheet (Save Video, Save to
 * Files, AirDrop, other apps), a still frame from a video, and a duplicate
 * copy inside the vault.
 */

import { Share } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File, Paths } from 'expo-file-system';

import { ReelVaultMedia } from '../../../modules/reelvault-media';
import { audioChanged } from './audio/audioEvents';
import { importAudio } from './audio/audioImport';

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

/** Whether this app build can save a video's sound (build 18 and later). */
export const canSaveSound = (): boolean => !!ReelVaultMedia?.exportAudio;

/** A file name made from the video's title or file name. */
export function soundName(video: Pick<Video, 'title' | 'filename'>): string {
  const base = (video.title?.trim() || video.filename.replace(/\.[^.]+$/, ''))
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base || 'Sound'}.m4a`;
}

/** The video's sound as a new item in the Audio section; false when it was already there. */
export async function saveSoundToAudio(video: Video): Promise<boolean> {
  if (!ReelVaultMedia?.exportAudio) throw new Error('This needs the newest app build');
  const name = soundName(video);
  const out = new File(Paths.cache, `${Crypto.randomUUID()}-${name}`);
  try {
    const r = await ReelVaultMedia.exportAudio(video.uri, out.uri, 0, 0);
    const summary = await importAudio([{ uri: out.uri, name, size: r.size }]);
    if (summary.failed.length) throw new Error(summary.failed[0].reason);
    audioChanged();
    return summary.imported > 0;
  } finally {
    try {
      if (out.exists) out.delete();
    } catch {
      // already moved into the Audio section
    }
  }
}

export type VideoChapter = { title: string; startMs: number };

/** Chapter markers stored in the file (MP4 / MOV); empty when there are none or on older builds. */
export async function videoChapters(video: Video): Promise<VideoChapter[]> {
  if (!ReelVaultMedia?.chapters) return [];
  const list = await ReelVaultMedia.chapters(video.uri).catch(() => []);
  return list.filter((c) => Number.isFinite(c.startMs)).map((c) => ({ title: c.title, startMs: Math.max(0, c.startMs) }));
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
