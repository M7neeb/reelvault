import { getDb } from '@/db';
import type { Video, WatchStatus } from './types';

type Row = {
  id: string;
  uri: string;
  filename: string;
  size: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  rating: number;
  title: string | null;
  notes: string | null;
  created_at: number;
  imported_at: number;
  status: string | null;
  deleted_at: number | null;
  is_private: number;
  content_key: string | null;
};

function toVideo(r: Row): Video {
  return {
    id: r.id,
    uri: r.uri,
    filename: r.filename,
    size: r.size,
    durationMs: r.duration_ms,
    width: r.width,
    height: r.height,
    rating: r.rating,
    title: r.title,
    notes: r.notes,
    createdAt: r.created_at,
    importedAt: r.imported_at,
    status: (r.status as WatchStatus | null) ?? null,
    deletedAt: r.deleted_at,
    isPrivate: r.is_private === 1,
    contentKey: r.content_key,
  };
}

/** Every normal list leaves out videos sitting in Recently Deleted. */
const LIVE = 'deleted_at IS NULL';

/** `?,?,?` for an IN (...) list. */
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

export async function insertVideo(v: Video): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO videos
       (id, uri, filename, size, duration_ms, width, height, rating, title, notes,
        created_at, imported_at, status, deleted_at, is_private, content_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [
      v.id,
      v.uri,
      v.filename,
      v.size,
      v.durationMs,
      v.width,
      v.height,
      v.rating,
      v.title,
      v.notes,
      v.createdAt,
      v.importedAt,
      v.status,
      v.deletedAt,
      v.isPrivate ? 1 : 0,
      v.contentKey,
    ]
  );
}

export type SortKey = 'recent' | 'oldest' | 'rating' | 'name' | 'size';

const ORDER_BY: Record<SortKey, string> = {
  recent: 'imported_at DESC',
  oldest: 'imported_at ASC',
  rating: 'rating DESC, imported_at DESC',
  name: 'filename COLLATE NOCASE ASC',
  size: 'size DESC',
};

export async function listVideos(sort: SortKey = 'recent'): Promise<Video[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM videos WHERE ${LIVE} ORDER BY ${ORDER_BY[sort]};`
  );
  return rows.map(toVideo);
}

/** Recently Deleted, newest deletion first. */
export async function listDeleted(): Promise<Video[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM videos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC;'
  );
  return rows.map(toVideo);
}

/** Move videos to Recently Deleted. Files stay on disk until purged. */
export async function markDeleted(ids: string[], at: number): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE videos SET deleted_at = ? WHERE id IN (${marks(ids.length)});`, [
    at,
    ...ids,
  ]);
}

/** Bring videos back from Recently Deleted. */
export async function restoreVideos(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE videos SET deleted_at = NULL WHERE id IN (${marks(ids.length)});`, ids);
}

/** Videos deleted before `cutoff` (ms) - due to be removed for good. */
export async function deletedBefore(cutoff: number): Promise<Video[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM videos WHERE deleted_at IS NOT NULL AND deleted_at < ?;',
    [cutoff]
  );
  return rows.map(toVideo);
}

/** Removes the row for good. Only `actions.purgeVideo` calls this, after the files. */
export async function removeRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM videos WHERE id = ?;', [id]);
}

export async function setRating(videoId: string, rating: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE videos SET rating = ? WHERE id = ?;', [rating, videoId]);
}

export async function setDuration(videoId: string, durationMs: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE videos SET duration_ms = ? WHERE id = ?;', [durationMs, videoId]);
}

export async function setContentKey(videoId: string, key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE videos SET content_key = ? WHERE id = ?;', [key, videoId]);
}

/** Videos imported before duration capture existed. Used to backfill. */
export async function videosMissingDuration(): Promise<{ id: string; uri: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; uri: string }>(
    'SELECT id, uri FROM videos WHERE duration_ms IS NULL;'
  );
}

/** Videos imported before duplicate detection existed. Used to backfill. */
export async function videosMissingContentKey(): Promise<{ id: string; uri: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; uri: string }>(
    'SELECT id, uri FROM videos WHERE content_key IS NULL;'
  );
}

/** The live video with this content key, if any - checked before importing a copy. */
export async function findByContentKey(key: string): Promise<Video | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(
    `SELECT * FROM videos WHERE content_key = ? AND ${LIVE} LIMIT 1;`,
    [key]
  );
  return row ? toVideo(row) : null;
}

/** How many tags each video has - drives the # badge on a tile. */
export async function tagCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ video_id: string; n: number }>(
    'SELECT video_id, COUNT(*) AS n FROM video_tags GROUP BY video_id;'
  );
  const map: Record<string, number> = {};
  for (const r of rows) map[r.video_id] = r.n;
  return map;
}

/** tag name -> the ids of the live videos carrying it. Powers the sidebar + smart filters. */
export async function tagIndex(): Promise<Record<string, string[]>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string; video_id: string }>(
    `SELECT t.name AS name, vt.video_id AS video_id
       FROM video_tags vt
       JOIN tags t   ON t.id = vt.tag_id
       JOIN videos v ON v.id = vt.video_id
      WHERE v.deleted_at IS NULL;`
  );
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    if (!map[r.name]) map[r.name] = [];
    map[r.name].push(r.video_id);
  }
  return map;
}

/** Turn a user query into a safe FTS5 expression: every token a quoted prefix. */
function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' AND ');
}

/**
 * Search filenames/titles/notes (FTS5) AND tag names.
 * Falls back to a plain LIKE if the FTS expression is rejected.
 */
export async function searchVideos(query: string): Promise<Video[]> {
  const db = await getDb();
  const q = query.trim();
  if (!q) return listVideos('recent');

  try {
    const rows = await db.getAllAsync<Row>(
      `SELECT DISTINCT v.* FROM videos v
        WHERE v.deleted_at IS NULL
          AND (v.id IN (SELECT video_id FROM videos_fts WHERE videos_fts MATCH ?)
               OR EXISTS (
                    SELECT 1 FROM video_tags vt
                      JOIN tags t ON t.id = vt.tag_id
                     WHERE vt.video_id = v.id AND t.name LIKE ?
                  ))
        ORDER BY v.imported_at DESC;`,
      [ftsQuery(q), `%${q}%`]
    );
    return rows.map(toVideo);
  } catch (e) {
    console.log(`[SEARCH] FTS failed (${String(e)}) - LIKE fallback`);
    const rows = await db.getAllAsync<Row>(
      `SELECT * FROM videos WHERE ${LIVE} AND filename LIKE ? ORDER BY imported_at DESC;`,
      [`%${q}%`]
    );
    return rows.map(toVideo);
  }
}

export async function getVideo(id: string): Promise<Video | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(`SELECT * FROM videos WHERE id = ? LIMIT 1;`, [id]);
  return row ? toVideo(row) : null;
}

export async function countVideos(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM videos WHERE ${LIVE};`
  );
  return row?.n ?? 0;
}
