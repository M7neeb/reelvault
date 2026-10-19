import { Directory, File } from 'expo-file-system';

import { keepInfo, keepUnrated } from './overviewStore';
import { purgeCutoff } from './ui/logic';
import { deletedBefore, markDeleted, removeRow, restoreVideos } from './repo';
import { coverFileName, thumbsDir } from './storage';
import type { Video } from './types';

/**
 * Delete = move to Recently Deleted. Nothing leaves the disk here; the files
 * stay until the video is purged (by hand, or automatically after 30 days).
 */
export async function trashVideos(videos: Video[]): Promise<void> {
  await markDeleted(
    videos.map((v) => v.id),
    Date.now()
  );
  console.log(`[DELETE] ${videos.length} moved to Recently Deleted`);
}

export async function restore(videos: Video[]): Promise<void> {
  await restoreVideos(videos.map((v) => v.id));
  console.log(`[RESTORE] ${videos.length} restored`);
}

/**
 * Remove a video for good: its file, cover thumbnail, filmstrip folder, then
 * the row. Its rating and info are kept first, for the Overview.
 */
export async function purgeVideo(video: Video, onlyRated?: boolean): Promise<void> {
  try {
    await keepInfo(video, onlyRated ?? !(await keepUnrated()));
  } catch (e) {
    console.log(`[PURGE] info not kept: ${String(e)}`);
  }
  try {
    const source = new File(video.uri);
    if (source.exists) source.delete();
  } catch (e) {
    console.log(`[PURGE] video file failed: ${String(e)}`);
  }
  try {
    for (const name of [coverFileName(video.id), ...(video.coverAt ? [coverFileName(video.id, video.coverAt)] : [])]) {
      const cover = new File(thumbsDir, name);
      if (cover.exists) cover.delete();
    }
  } catch (e) {
    console.log(`[PURGE] cover failed: ${String(e)}`);
  }
  try {
    const strip = new Directory(thumbsDir, video.id);
    if (strip.exists) strip.delete();
  } catch (e) {
    console.log(`[PURGE] filmstrip failed: ${String(e)}`);
  }
  await removeRow(video.id);
  console.log(`[PURGE] ${video.filename}`);
}

export async function purgeVideos(videos: Video[]): Promise<void> {
  const onlyRated = !(await keepUnrated());
  for (const v of videos) await purgeVideo(v, onlyRated);
  console.log(`[PURGE] batch done - ${videos.length} removed for good`);
}

/** Remove everything that has been in Recently Deleted longer than you keep it (30 days unless changed). Runs on app start. */
export async function purgeExpired(now = Date.now(), days = 30): Promise<number> {
  const due = await deletedBefore(purgeCutoff(now, days));
  if (due.length) await purgeVideos(due);
  return due.length;
}
