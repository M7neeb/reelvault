/**
 * Schema v8 storage: every time you watch one of your videos, bookmarks
 * inside videos, and "continue another time" points.
 */

import { getDb } from '@/db';

import type { VaultPlay } from './stats';

export type Bookmark = { id: number; videoId: string; atMs: number; label: string | null; createdAt: number };

/* -------------------------------------------------------------------- plays */

/** Short peeks (under 3 s) are not counted. */
export async function recordPlay(videoId: string, startedAt: number, watchedMs: number): Promise<void> {
  if (watchedMs < 3000) return;
  const db = await getDb();
  await db.runAsync('INSERT INTO vault_plays (video_id, started_at, watched_ms) VALUES (?,?,?);', [videoId, startedAt, Math.round(watchedMs)]);
}

export async function allVaultPlays(): Promise<VaultPlay[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ video_id: string; started_at: number; watched_ms: number }>(
    'SELECT video_id, started_at, watched_ms FROM vault_plays ORDER BY started_at;'
  );
  return rows.map((r) => ({ videoId: r.video_id, startedAt: r.started_at, watchedMs: r.watched_ms }));
}

/** Removes plays of one video that started between `from` and `to` (one sitting in the history). */
export async function deletePlays(videoId: string, from: number, to: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM vault_plays WHERE video_id = ? AND started_at >= ? AND started_at <= ?;', [videoId, Math.floor(from), Math.ceil(to)]);
}

/* ---------------------------------------------------------------- bookmarks */

export async function bookmarksFor(videoId: string): Promise<Bookmark[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; video_id: string; at_ms: number; label: string | null; created_at: number }>(
    'SELECT * FROM vault_bookmarks WHERE video_id = ? ORDER BY at_ms;',
    [videoId]
  );
  return rows.map((r) => ({ id: r.id, videoId: r.video_id, atMs: r.at_ms, label: r.label, createdAt: r.created_at }));
}

export async function addBookmark(videoId: string, atMs: number, label: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO vault_bookmarks (video_id, at_ms, label, created_at) VALUES (?,?,?,?);', [
    videoId,
    Math.round(atMs),
    label?.trim() || null,
    Date.now(),
  ]);
}

export async function renameBookmark(id: number, label: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE vault_bookmarks SET label = ? WHERE id = ?;', [label?.trim() || null, id]);
}

export async function deleteBookmark(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM vault_bookmarks WHERE id = ?;', [id]);
}

export async function bookmarkCount(): Promise<number> {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM vault_bookmarks;'))?.n ?? 0;
}

/* ------------------------------------------------------------------- resume */

export async function resumePoints(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ video_id: string; position_ms: number }>('SELECT video_id, position_ms FROM vault_resume;');
  return new Map(rows.map((r) => [r.video_id, r.position_ms]));
}

/** null clears it (played to the end, or "start over"). */
export async function setResumePoint(videoId: string, positionMs: number | null): Promise<void> {
  const db = await getDb();
  if (positionMs === null) await db.runAsync('DELETE FROM vault_resume WHERE video_id = ?;', [videoId]);
  else
    await db.runAsync('INSERT OR REPLACE INTO vault_resume (video_id, position_ms, saved_at) VALUES (?,?,?);', [
      videoId,
      Math.round(positionMs),
      Date.now(),
    ]);
}
