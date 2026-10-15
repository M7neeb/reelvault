import { Directory, File } from 'expo-file-system';

import { getDb } from '@/db';
import { thumbsDir } from './storage';
import type { Video } from './types';

/** Delete a video's row, its file, its cover thumbnail and its filmstrip folder. */
export async function deleteVideo(video: Video): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM videos WHERE id = ?;', [video.id]);

  try {
    const source = new File(video.uri);
    if (source.exists) source.delete();
  } catch (e) {
    console.log(`[DELETE] video file failed: ${String(e)}`);
  }
  try {
    const cover = new File(thumbsDir, `${video.id}.jpg`);
    if (cover.exists) cover.delete();
  } catch (e) {
    console.log(`[DELETE] cover failed: ${String(e)}`);
  }
  try {
    const strip = new Directory(thumbsDir, video.id);
    if (strip.exists) strip.delete();
  } catch (e) {
    console.log(`[DELETE] filmstrip failed: ${String(e)}`);
  }

  console.log(`[DELETE] ${video.filename}`);
}

/** Batch delete — one log line per video, then a summary. */
export async function deleteVideos(videos: Video[]): Promise<void> {
  for (const v of videos) await deleteVideo(v);
  console.log(`[DELETE] batch done — ${videos.length} removed`);
}
