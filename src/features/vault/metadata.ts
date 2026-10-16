import { File, FileMode } from 'expo-file-system';

import { getDb } from '@/db';
import { locateMoov, parseMoov, type Mp4Meta } from './mp4';

/** A `moov` larger than this is not read (it would mean a broken or exotic file). */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;

/**
 * What the video file says about itself (see mp4.ts), or null when it can't
 * be read. Only box headers and the `moov` box are read - never the video data.
 */
export async function readVideoMeta(uri: string): Promise<Mp4Meta | null> {
  try {
    const file = new File(uri);
    const size = file.size;
    if (!size) return null;
    const handle = file.open(FileMode.ReadOnly);
    try {
      const read = (offset: number, length: number) => {
        handle.offset = offset;
        return handle.readBytes(length);
      };
      const moov = locateMoov(read, size);
      if (!moov || moov.size > MAX_MOOV_BYTES) return null;
      return parseMoov(read(moov.offset, moov.size));
    } finally {
      handle.close();
    }
  } catch (e) {
    console.log(`[META] could not read ${uri}: ${String(e)}`);
    return null;
  }
}

/**
 * Store the metadata and, when the file knows when it was filmed, use that as
 * the video's date (it was the import time until now).
 */
export async function saveVideoMeta(videoId: string, meta: Mp4Meta): Promise<void> {
  const db = await getDb();
  if (meta.createdAt) {
    await db.runAsync('UPDATE videos SET meta_json = ?, created_at = ? WHERE id = ?;', [
      JSON.stringify(meta),
      meta.createdAt,
      videoId,
    ]);
  } else {
    await db.runAsync('UPDATE videos SET meta_json = ? WHERE id = ?;', [JSON.stringify(meta), videoId]);
  }
}

/** Videos whose file has not been read yet. Used to backfill once. */
export async function videosMissingMeta(): Promise<{ id: string; uri: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; uri: string }>('SELECT id, uri FROM videos WHERE meta_json IS NULL;');
}
