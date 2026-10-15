import { getDb } from '@/db';
import type { Video } from './types';

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
  };
}

export async function insertVideo(v: Video): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO videos
       (id, uri, filename, size, duration_ms, width, height, rating, title, notes, created_at, imported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?);`,
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
    `SELECT * FROM videos ORDER BY ${ORDER_BY[sort]};`
  );
  return rows.map(toVideo);
}

export async function setRating(videoId: string, rating: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE videos SET rating = ? WHERE id = ?;', [rating, videoId]);
}

export async function setDuration(videoId: string, durationMs: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE videos SET duration_ms = ? WHERE id = ?;', [durationMs, videoId]);
}

/** Videos imported before duration capture existed. Used to backfill. */
export async function videosMissingDuration(): Promise<{ id: string; uri: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; uri: string }>(
    'SELECT id, uri FROM videos WHERE duration_ms IS NULL;'
  );
}

/** How many tags each video has — drives the 🏷 badge on a tile. */
export async function tagCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ video_id: string; n: number }>(
    'SELECT video_id, COUNT(*) AS n FROM video_tags GROUP BY video_id;'
  );
  const map: Record<string, number> = {};
  for (const r of rows) map[r.video_id] = r.n;
  return map;
}

/** tag name → the ids of the videos carrying it. Powers the sidebar + smart filters. */
export async function tagIndex(): Promise<Record<string, string[]>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string; video_id: string }>(
    `SELECT t.name AS name, vt.video_id AS video_id
       FROM video_tags vt JOIN tags t ON t.id = vt.tag_id;`
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
        WHERE v.id IN (SELECT video_id FROM videos_fts WHERE videos_fts MATCH ?)
           OR EXISTS (
                SELECT 1 FROM video_tags vt
                  JOIN tags t ON t.id = vt.tag_id
                 WHERE vt.video_id = v.id AND t.name LIKE ?
              )
        ORDER BY v.imported_at DESC;`,
      [ftsQuery(q), `%${q}%`]
    );
    return rows.map(toVideo);
  } catch (e) {
    console.log(`[SEARCH] FTS failed (${String(e)}) — LIKE fallback`);
    const rows = await db.getAllAsync<Row>(
      `SELECT * FROM videos WHERE filename LIKE ? ORDER BY imported_at DESC;`,
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
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM videos;`);
  return row?.n ?? 0;
}
