/**
 * Albums and folders. A video can be in any number of albums; a folder groups
 * albums and smart filters. Private albums only hold private videos.
 */

import { getDb } from '@/db';

import { addTagToVideo } from './tags';

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

export type AlbumRow = {
  id: number;
  name: string;
  folder_id: number | null;
  is_private: number;
  pinned: number;
  exclude_uncategorized: number;
  last_used_at: number | null;
};

export type FolderRow = { id: number; name: string };

export async function listAlbums(): Promise<AlbumRow[]> {
  const db = await getDb();
  return db.getAllAsync<AlbumRow>(
    `SELECT id, name, folder_id, is_private, pinned, exclude_uncategorized, last_used_at
       FROM albums ORDER BY pinned DESC, sort_order, name COLLATE NOCASE;`
  );
}

export async function listFolders(): Promise<FolderRow[]> {
  const db = await getDb();
  return db.getAllAsync<FolderRow>('SELECT id, name FROM folders ORDER BY sort_order, name COLLATE NOCASE;');
}

/** video id -> the albums it is in. */
export async function albumMembership(): Promise<Record<string, number[]>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ album_id: number; video_id: string }>(
    'SELECT album_id, video_id FROM album_videos;'
  );
  const map: Record<string, number[]> = {};
  for (const r of rows) (map[r.video_id] ??= []).push(r.album_id);
  return map;
}

export async function createAlbum(name: string, opts: { folderId?: number | null; isPrivate?: boolean } = {}) {
  const db = await getDb();
  const res = await db.runAsync(
    'INSERT INTO albums (name, folder_id, is_private, created_at) VALUES (?, ?, ?, ?);',
    [name.trim(), opts.folderId ?? null, opts.isPrivate ? 1 : 0, Date.now()]
  );
  return res.lastInsertRowId;
}

export async function updateAlbum(
  id: number,
  patch: Partial<{ name: string; folderId: number | null; pinned: boolean; excludeUncategorized: boolean }>
): Promise<void> {
  const db = await getDb();
  if (patch.name !== undefined) await db.runAsync('UPDATE albums SET name = ? WHERE id = ?;', [patch.name.trim(), id]);
  if (patch.folderId !== undefined) await db.runAsync('UPDATE albums SET folder_id = ? WHERE id = ?;', [patch.folderId, id]);
  if (patch.pinned !== undefined) await db.runAsync('UPDATE albums SET pinned = ? WHERE id = ?;', [patch.pinned ? 1 : 0, id]);
  if (patch.excludeUncategorized !== undefined) {
    await db.runAsync('UPDATE albums SET exclude_uncategorized = ? WHERE id = ?;', [
      patch.excludeUncategorized ? 1 : 0,
      id,
    ]);
  }
}

/** Deletes the album only; its videos stay in the library. */
export async function deleteAlbum(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM albums WHERE id = ?;', [id]);
}

/**
 * Add videos to albums. Adding to a private album makes the videos private,
 * so they disappear from the normal library at the same moment.
 */
export async function addToAlbums(videoIds: string[], albumIds: number[]): Promise<void> {
  if (!videoIds.length || !albumIds.length) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const albumId of albumIds) {
      for (const videoId of videoIds) {
        await db.runAsync(
          'INSERT OR IGNORE INTO album_videos (album_id, video_id, added_at) VALUES (?, ?, ?);',
          [albumId, videoId, now]
        );
      }
      await db.runAsync('UPDATE albums SET last_used_at = ? WHERE id = ?;', [now, albumId]);
    }
    const privateAlbums = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM albums WHERE is_private = 1 AND id IN (${marks(albumIds.length)});`,
      albumIds
    );
    if (privateAlbums.length) {
      await db.runAsync(`UPDATE videos SET is_private = 1 WHERE id IN (${marks(videoIds.length)});`, videoIds);
    }
  });
}

export async function removeFromAlbum(videoIds: string[], albumId: number): Promise<void> {
  if (!videoIds.length) return;
  const db = await getDb();
  await db.runAsync(`DELETE FROM album_videos WHERE album_id = ? AND video_id IN (${marks(videoIds.length)});`, [
    albumId,
    ...videoIds,
  ]);
}

/**
 * Leaving the Private library also means leaving every private album, or a
 * public video would be sitting in a private album.
 */
export async function removeFromPrivateAlbums(videoIds: string[]): Promise<void> {
  if (!videoIds.length) return;
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM album_videos
      WHERE video_id IN (${marks(videoIds.length)})
        AND album_id IN (SELECT id FROM albums WHERE is_private = 1);`,
    videoIds
  );
}

/** HashPhotos' "Add Album Names to Keywords": every video gets its album's name as a keyword. */
export async function albumNameToKeyword(albumId: number): Promise<number> {
  const db = await getDb();
  const album = await db.getFirstAsync<{ name: string }>('SELECT name FROM albums WHERE id = ?;', [albumId]);
  if (!album) return 0;
  const rows = await db.getAllAsync<{ video_id: string }>('SELECT video_id FROM album_videos WHERE album_id = ?;', [
    albumId,
  ]);
  await db.withTransactionAsync(async () => {
    for (const r of rows) await addTagToVideo(r.video_id, album.name);
  });
  return rows.length;
}

export async function createFolder(name: string): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync('INSERT INTO folders (name, created_at) VALUES (?, ?);', [name.trim(), Date.now()]);
  return res.lastInsertRowId;
}

export async function renameFolder(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE folders SET name = ? WHERE id = ?;', [name.trim(), id]);
}

/** Deletes the folder; its albums and smart filters move back to the top level. */
export async function deleteFolder(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM folders WHERE id = ?;', [id]);
}

export async function moveSmartFilterToFolder(filterId: number, folderId: number | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE smart_filters SET folder_id = ? WHERE id = ?;', [folderId, filterId]);
}
