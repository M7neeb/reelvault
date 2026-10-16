import { getDb } from '@/db';

export type Tag = { id: number; name: string; color: string | null; pinned?: number };

/** Pinned keywords first, then A-Z. */
export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  return db.getAllAsync<Tag>(
    'SELECT id, name, color, pinned FROM tags ORDER BY pinned DESC, name COLLATE NOCASE;'
  );
}

export async function tagsForVideo(videoId: string): Promise<Tag[]> {
  const db = await getDb();
  return db.getAllAsync<Tag>(
    `SELECT t.id, t.name, t.color
       FROM tags t
       JOIN video_tags vt ON vt.tag_id = t.id
      WHERE vt.video_id = ?
      ORDER BY t.name COLLATE NOCASE;`,
    [videoId]
  );
}

/** Creates the tag if new, then links it to the video. Idempotent. */
export async function addTagToVideo(videoId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const db = await getDb();
  await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?);', [trimmed]);
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM tags WHERE name = ?;',
    [trimmed]
  );
  if (row) {
    await db.runAsync(
      'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?);',
      [videoId, row.id]
    );
  }
}

export async function removeTagFromVideo(videoId: string, tagId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?;', [
    videoId,
    tagId,
  ]);
}
