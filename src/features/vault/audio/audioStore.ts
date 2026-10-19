/**
 * The Audio section's database: items, keywords, listens and bookmarks
 * (schema v10). Files live in each item's folder (see audioFiles.ts); here
 * only what is known about them.
 */

import { getDb } from '@/db';

import type { AudioChapterRef, AudioItem, AudioPlay, AudioStatus, AudioTrack } from './audioLogic';

type Row = {
  id: string;
  kind: string;
  folder: string;
  filename: string;
  size: number;
  duration_ms: number | null;
  title: string | null;
  author: string | null;
  album: string | null;
  narrator: string | null;
  year: number | null;
  genre: string | null;
  description: string | null;
  notes: string | null;
  rating: number;
  status: string | null;
  cover: string | null;
  tracks_json: string;
  chapters_json: string;
  content_key: string | null;
  is_private: number;
  position_track: number;
  position_ms: number;
  speed: number | null;
  last_played_at: number | null;
  finished_at: number | null;
  created_at: number;
  imported_at: number;
  deleted_at: number | null;
};

const parse = <T>(json: string | null, fallback: T): T => {
  try {
    const v = json ? JSON.parse(json) : fallback;
    return Array.isArray(fallback) && !Array.isArray(v) ? fallback : v;
  } catch {
    return fallback;
  }
};
const STATUSES = new Set(['planned', 'listening', 'finished', 'dropped']);

function toItem(r: Row, tags: string[]): AudioItem {
  return {
    id: r.id,
    kind: r.kind === 'book' ? 'book' : 'audio',
    folder: r.folder,
    filename: r.filename,
    size: r.size,
    durationMs: r.duration_ms,
    title: r.title,
    author: r.author,
    album: r.album,
    narrator: r.narrator,
    year: r.year,
    genre: r.genre,
    description: r.description,
    notes: r.notes,
    rating: r.rating,
    status: r.status && STATUSES.has(r.status) ? (r.status as AudioStatus) : null,
    cover: r.cover,
    tracks: parse<AudioTrack[]>(r.tracks_json, []),
    chapters: parse<AudioChapterRef[]>(r.chapters_json, []),
    contentKey: r.content_key,
    isPrivate: r.is_private === 1,
    positionTrack: r.position_track,
    positionMs: r.position_ms,
    speed: r.speed,
    lastPlayedAt: r.last_played_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
    importedAt: r.imported_at,
    deletedAt: r.deleted_at,
    tags,
  };
}

/** Every item, Recently Deleted included (the UI splits them). */
export async function listAudio(): Promise<AudioItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT * FROM audio_items ORDER BY imported_at DESC;');
  const tagRows = await db.getAllAsync<{ item_id: string; name: string }>('SELECT item_id, name FROM audio_tags ORDER BY name COLLATE NOCASE;');
  const tags = new Map<string, string[]>();
  for (const t of tagRows) tags.set(t.item_id, [...(tags.get(t.item_id) ?? []), t.name]);
  return rows.map((r) => toItem(r, tags.get(r.id) ?? []));
}

export async function getAudio(id: string): Promise<AudioItem | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Row>('SELECT * FROM audio_items WHERE id = ?;', [id]);
  if (!r) return null;
  const tags = await db.getAllAsync<{ name: string }>('SELECT name FROM audio_tags WHERE item_id = ?;', [id]);
  return toItem(r, tags.map((t) => t.name));
}

export async function findAudioByKey(key: string): Promise<AudioItem | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ id: string }>('SELECT id FROM audio_items WHERE content_key = ? AND deleted_at IS NULL LIMIT 1;', [key]);
  return r ? getAudio(r.id) : null;
}

/** Items about as long as `durationMs` (within 2 s): what a new file could be a copy of. */
export async function audioNearLength(durationMs: number): Promise<AudioItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM audio_items WHERE deleted_at IS NULL AND duration_ms BETWEEN ? AND ? LIMIT 100;', [durationMs - 2000, durationMs + 2000]);
  const out: AudioItem[] = [];
  for (const r of rows) {
    const it = await getAudio(r.id);
    if (it) out.push(it);
  }
  return out;
}

export async function insertAudio(i: AudioItem): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO audio_items (id, kind, folder, filename, size, duration_ms, title, author, album, narrator, year, genre, description, notes, rating, status, cover,
       tracks_json, chapters_json, content_key, is_private, position_track, position_ms, speed, last_played_at, finished_at, created_at, imported_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      i.id, i.kind, i.folder, i.filename, i.size, i.durationMs, i.title, i.author, i.album, i.narrator, i.year, i.genre, i.description, i.notes, i.rating, i.status, i.cover,
      JSON.stringify(i.tracks), JSON.stringify(i.chapters), i.contentKey, i.isPrivate ? 1 : 0, i.positionTrack, i.positionMs, i.speed, i.lastPlayedAt, i.finishedAt,
      i.createdAt, i.importedAt, i.deletedAt,
    ]
  );
  for (const t of i.tags) await addAudioTag(i.id, t);
}

/** The fields you can change by hand (and the file facts after a "Replace"). */
export type AudioPatch = Partial<
  Pick<
    AudioItem,
    'title' | 'author' | 'album' | 'narrator' | 'year' | 'genre' | 'description' | 'notes' | 'rating' | 'status' | 'cover' | 'isPrivate' | 'speed' | 'finishedAt' | 'size' | 'durationMs' | 'tracks' | 'chapters' | 'contentKey' | 'filename' | 'kind' | 'folder' | 'positionTrack' | 'positionMs'
  >
>;

const COLUMN: Record<keyof AudioPatch, string> = {
  title: 'title', author: 'author', album: 'album', narrator: 'narrator', year: 'year', genre: 'genre', description: 'description', notes: 'notes', rating: 'rating',
  status: 'status', cover: 'cover', isPrivate: 'is_private', speed: 'speed', finishedAt: 'finished_at', size: 'size', durationMs: 'duration_ms', tracks: 'tracks_json',
  chapters: 'chapters_json', contentKey: 'content_key', filename: 'filename', kind: 'kind', folder: 'folder', positionTrack: 'position_track', positionMs: 'position_ms',
};

export async function updateAudio(ids: string[], patch: AudioPatch): Promise<void> {
  const keys = Object.keys(patch) as (keyof AudioPatch)[];
  if (!keys.length || !ids.length) return;
  const db = await getDb();
  const values = keys.map((k) => {
    const v = patch[k];
    if (k === 'tracks' || k === 'chapters') return JSON.stringify(v ?? []);
    if (k === 'isPrivate') return v ? 1 : 0;
    return (v ?? null) as string | number | null;
  });
  const set = keys.map((k) => `${COLUMN[k]} = ?`).join(', ');
  for (const id of ids) await db.runAsync(`UPDATE audio_items SET ${set} WHERE id = ?;`, [...values, id]);
}

/** Where you are: saved while playing (every few seconds) and when you pause. */
export async function savePosition(id: string, track: number, ms: number, at: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE audio_items SET position_track = ?, position_ms = ?, last_played_at = ?,
       status = CASE WHEN status IS NULL OR status = 'planned' THEN 'listening' ELSE status END
     WHERE id = ?;`,
    [track, Math.max(0, Math.round(ms)), at, id]
  );
}

export async function markFinished(id: string, at: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE audio_items SET status = 'finished', finished_at = ? WHERE id = ?;`, [at, id]);
}

/** Back to the start (Listen again, or Mark as not started). */
export async function resetPosition(id: string, status: AudioStatus | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE audio_items SET position_track = 0, position_ms = 0, status = ?, finished_at = CASE WHEN ? IS NULL THEN NULL ELSE finished_at END WHERE id = ?;', [status, status, id]);
}

export async function trashAudio(ids: string[], at: number): Promise<void> {
  const db = await getDb();
  for (const id of ids) await db.runAsync('UPDATE audio_items SET deleted_at = ? WHERE id = ?;', [at, id]);
}

export async function restoreAudio(ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) await db.runAsync('UPDATE audio_items SET deleted_at = NULL WHERE id = ?;', [id]);
}

/** The rows only; the caller removes the folders. */
export async function deleteAudioRows(ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) {
    await db.runAsync('DELETE FROM audio_items WHERE id = ?;', [id]);
    await db.runAsync('DELETE FROM audio_plays WHERE item_id = ?;', [id]);
  }
}

/** Items in Recently Deleted for longer than `days`. */
export async function expiredAudio(now: number, days: number): Promise<{ id: string; folder: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; folder: string }>('SELECT id, folder FROM audio_items WHERE deleted_at IS NOT NULL AND deleted_at < ?;', [now - days * 86_400_000]);
}

export async function allAudioFolders(): Promise<{ id: string; folder: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; folder: string }>('SELECT id, folder FROM audio_items;');
}

/* -------------------------------------------------------------- keywords */

export async function addAudioTag(id: string, name: string): Promise<void> {
  const n = name.trim().replace(/^#/, '');
  if (!n) return;
  const db = await getDb();
  await db.runAsync('INSERT OR IGNORE INTO audio_tags (item_id, name) VALUES (?, ?);', [id, n]);
}

export async function removeAudioTag(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM audio_tags WHERE item_id = ? AND name = ?;', [id, name]);
}

export async function renameAudioTag(from: string, to: string): Promise<void> {
  const db = await getDb();
  const ids = await db.getAllAsync<{ item_id: string }>('SELECT item_id FROM audio_tags WHERE name = ?;', [from]);
  for (const r of ids) {
    await db.runAsync('DELETE FROM audio_tags WHERE item_id = ? AND name = ?;', [r.item_id, from]);
    await addAudioTag(r.item_id, to);
  }
}

/* ------------------------------------------------------- listens, marks */

export async function addPlay(itemId: string, startedAt: number, listenedMs: number, fromMs: number, toMs: number): Promise<void> {
  if (listenedMs < 3000) return;
  const db = await getDb();
  await db.runAsync('INSERT INTO audio_plays (item_id, started_at, listened_ms, from_ms, to_ms) VALUES (?, ?, ?, ?, ?);', [itemId, startedAt, Math.round(listenedMs), Math.round(fromMs), Math.round(toMs)]);
}

export async function allPlays(): Promise<AudioPlay[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ item_id: string; started_at: number; listened_ms: number }>('SELECT item_id, started_at, listened_ms FROM audio_plays ORDER BY started_at;');
  return rows.map((r) => ({ itemId: r.item_id, startedAt: r.started_at, listenedMs: r.listened_ms }));
}

export type AudioBookmark = { id: number; itemId: string; track: number; atMs: number; label: string | null; createdAt: number };

export async function listBookmarks(itemId: string): Promise<AudioBookmark[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; item_id: string; track: number; at_ms: number; label: string | null; created_at: number }>(
    'SELECT * FROM audio_bookmarks WHERE item_id = ? ORDER BY track, at_ms;',
    [itemId]
  );
  return rows.map((r) => ({ id: r.id, itemId: r.item_id, track: r.track, atMs: r.at_ms, label: r.label, createdAt: r.created_at }));
}

export async function addBookmark(itemId: string, track: number, atMs: number, label: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO audio_bookmarks (item_id, track, at_ms, label, created_at) VALUES (?, ?, ?, ?, ?);', [itemId, track, Math.round(atMs), label, Date.now()]);
}

export async function removeBookmark(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM audio_bookmarks WHERE id = ?;', [id]);
}
