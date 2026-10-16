/**
 * Export / import the library-info backup (see backupFormat.ts). The file is
 * handed to the share sheet ("Save to Files"), and read back with the picker.
 * Private videos are left out of the export: the file leaves the app.
 */

import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

import { getDb } from '@/db';

import { addToAlbums, createAlbum, createFolder, listAlbums, listFolders } from './albums';
import { BACKUP_KIND, BACKUP_VERSION, matchBackup, parseBackup, type Backup } from './backupFormat';
import { saveSmartFilter, setTagPinned } from './library';
import { shareFile } from './share';
import { addTagToVideo, listTags } from './tags';

type VideoRow = {
  id: string;
  content_key: string | null;
  filename: string;
  size: number;
  title: string | null;
  notes: string | null;
  rating: number;
  status: string | null;
  flag: number;
  created_at: number;
};

export async function exportLibraryInfo(): Promise<number> {
  const db = await getDb();
  const videos = await db.getAllAsync<VideoRow>(
    `SELECT id, content_key, filename, size, title, notes, rating, status, flag, created_at
       FROM videos WHERE deleted_at IS NULL AND is_private = 0;`
  );
  const tagRows = await db.getAllAsync<{ video_id: string; name: string }>(
    'SELECT vt.video_id, t.name FROM video_tags vt JOIN tags t ON t.id = vt.tag_id;'
  );
  const albumRows = await db.getAllAsync<{ video_id: string; name: string }>(
    `SELECT av.video_id, a.name FROM album_videos av JOIN albums a ON a.id = av.album_id WHERE a.is_private = 0;`
  );
  const folders = await listFolders();
  const folderName = (id: number | null) => folders.find((f) => f.id === id)?.name ?? null;
  const albums = (await listAlbums()).filter((a) => a.is_private === 0);
  const smart = await db.getAllAsync<{ name: string; rule_json: string; folder_id: number | null }>(
    'SELECT name, rule_json, folder_id FROM smart_filters;'
  );
  const tags = await listTags();

  const group = (rows: { video_id: string; name: string }[]) => {
    const m = new Map<string, string[]>();
    for (const r of rows) m.set(r.video_id, [...(m.get(r.video_id) ?? []), r.name]);
    return m;
  };
  const tagsBy = group(tagRows);
  const albumsBy = group(albumRows);

  const backup: Backup = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    videos: videos.map((v) => ({
      contentKey: v.content_key,
      filename: v.filename,
      size: v.size,
      title: v.title,
      notes: v.notes,
      rating: v.rating,
      status: v.status,
      flag: v.flag,
      createdAt: v.created_at,
      keywords: tagsBy.get(v.id) ?? [],
      albums: albumsBy.get(v.id) ?? [],
    })),
    albums: albums.map((a) => ({ name: a.name, folder: folderName(a.folder_id), pinned: a.pinned === 1 })),
    folders: folders.map((f) => f.name),
    smartFilters: smart.map((s) => ({
      name: s.name,
      rule: JSON.parse(s.rule_json),
      folder: folderName(s.folder_id),
    })),
    pinnedKeywords: tags.filter((t) => t.pinned === 1).map((t) => t.name),
  };

  const day = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `ReelVault library info ${day}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(backup, null, 1));
  await shareFile(file.uri);
  return videos.length;
}

/** Applies a backup on top of the library. Nothing is deleted; matching videos get the saved info. */
export async function importLibraryInfo(): Promise<{ matched: number; total: number } | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.length) return null;
  const backup = parseBackup(await new File(picked.assets[0].uri).text());
  if (!backup) throw new Error('This is not a ReelVault library-info file.');

  const db = await getDb();
  const library = await db.getAllAsync<{ id: string; content_key: string | null; filename: string; size: number }>(
    'SELECT id, content_key, filename, size FROM videos;'
  );
  const matches = matchBackup(
    backup,
    library.map((v) => ({ id: v.id, contentKey: v.content_key, filename: v.filename, size: v.size }))
  );

  // Folders and albums by name, created when missing.
  const folderIds = new Map((await listFolders()).map((f) => [f.name, f.id]));
  for (const name of backup.folders) if (!folderIds.has(name)) folderIds.set(name, await createFolder(name));
  const albumIds = new Map((await listAlbums()).filter((a) => a.is_private === 0).map((a) => [a.name, a.id]));
  for (const a of backup.albums) {
    if (!albumIds.has(a.name)) {
      albumIds.set(a.name, await createAlbum(a.name, { folderId: a.folder ? folderIds.get(a.folder) ?? null : null }));
    }
  }

  for (const [index, videoId] of matches) {
    const v = backup.videos[index];
    await db.runAsync(
      'UPDATE videos SET title = ?, notes = ?, rating = ?, status = ?, flag = ?, created_at = ? WHERE id = ?;',
      [v.title, v.notes, v.rating ?? 0, v.status, v.flag ?? 0, v.createdAt, videoId]
    );
    for (const k of v.keywords ?? []) await addTagToVideo(videoId, k);
    const ids = (v.albums ?? []).map((n) => albumIds.get(n)).filter((id): id is number => id !== undefined);
    if (ids.length) await addToAlbums([videoId], ids);
  }

  const existingFilters = new Set(
    (await db.getAllAsync<{ name: string }>('SELECT name FROM smart_filters;')).map((r) => r.name)
  );
  for (const s of backup.smartFilters) {
    if (!existingFilters.has(s.name)) await saveSmartFilter({ name: s.name, ruleJson: JSON.stringify(s.rule) });
  }
  const tags = await listTags();
  for (const name of backup.pinnedKeywords) {
    const t = tags.find((x) => x.name === name);
    if (t) await setTagPinned(t.id, true);
  }

  return { matched: matches.size, total: backup.videos.length };
}
