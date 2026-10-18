/**
 * Export / import the library-info backup (see backupFormat.ts). The file is
 * handed to the share sheet ("Save to Files"), and read back with the picker.
 * Private videos are left out of the export: the file leaves the app.
 */

import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

import { getDb } from '@/db';


import { addToAlbums, createAlbum, createFolder, listAlbums, listFolders } from './albums';
import { BACKUP_KIND, BACKUP_VERSION, matchBackup, mergePrefs, parseBackup, seriesEpisodes, type Backup, type BackupSeries } from './backupFormat';
import { getSetting, saveSmartFilter, setSetting, setTagPinned } from './library';
import { addToSeries, createSeries, listSeries, setEpisodeLabel, updateSeries } from './overviewStore';
import type { OvStatus } from './overview';
import { shareFile } from './share';
import { addTagToVideo, listTags } from './tags';

const PREFS_KEY = 'vault.prefs';

type VideoRow = {
  in_tray: number;
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
    `SELECT id, content_key, filename, size, title, notes, rating, status, flag, created_at, in_tray
       FROM videos WHERE deleted_at IS NULL AND is_private = 0;`
  );
  // v2: history, bookmarks, where to continue, Simkl links, settings.
  const playRows = await db.getAllAsync<{ video_id: string; started_at: number; watched_ms: number }>('SELECT video_id, started_at, watched_ms FROM vault_plays ORDER BY started_at;');
  const markRows = await db.getAllAsync<{ video_id: string; at_ms: number; label: string | null; created_at: number }>('SELECT video_id, at_ms, label, created_at FROM vault_bookmarks;');
  const resumeRows = await db.getAllAsync<{ video_id: string; position_ms: number; saved_at: number }>('SELECT video_id, position_ms, saved_at FROM vault_resume;');
  const linkRows = await db.getAllAsync<Record<string, unknown> & { video_id: string }>('SELECT * FROM vault_simkl_links;');
  const by = <T extends { video_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.video_id, [...(m.get(r.video_id) ?? []), r]);
    return m;
  };
  const playsBy = by(playRows);
  const marksBy = by(markRows);
  const resumeBy = new Map(resumeRows.map((r) => [r.video_id, r]));
  const linkBy = new Map(linkRows.map((r) => [r.video_id, r]));
  let prefs: Record<string, unknown> | null = null;
  try {
    prefs = JSON.parse((await getSetting(PREFS_KEY)) ?? 'null');
  } catch {
    prefs = null;
  }
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
  const kept = await db.getAllAsync<{
    video_id: string;
    title: string | null;
    filename: string;
    size: number;
    duration_ms: number | null;
    rating: number;
    status: string | null;
    notes: string | null;
    tags: string | null;
    created_at: number;
    imported_at: number;
    removed_at: number;
  }>('SELECT * FROM vault_kept WHERE is_private = 0;');
  const seriesRows = await db.getAllAsync<{ id: string; name: string; description: string | null; rating: number; status: string | null }>(
    'SELECT id, name, description, rating, status FROM vault_series;'
  );
  const seriesItems = await db.getAllAsync<{ video_id: string; series_id: string; label: string | null }>(
    'SELECT video_id, series_id, label FROM vault_series_items ORDER BY series_id, position;'
  );
  const videoIndex = new Map(videos.map((v, i) => [v.id, i]));
  const keptIds = new Set(kept.map((k) => k.video_id));
  const keywordsOf = (json: string | null): string[] => {
    try {
      const t = JSON.parse(json ?? '[]');
      return Array.isArray(t) ? t.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };

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
      id: v.id,
      inTray: v.in_tray === 1,
      plays: (playsBy.get(v.id) ?? []).map((x): [number, number] => [x.started_at, x.watched_ms]),
      bookmarks: (marksBy.get(v.id) ?? []).map((m) => ({ atMs: m.at_ms, label: m.label, createdAt: m.created_at })),
      resume: resumeBy.has(v.id) ? { positionMs: resumeBy.get(v.id)!.position_ms, savedAt: resumeBy.get(v.id)!.saved_at } : null,
      link: linkBy.has(v.id) ? (({ video_id: _drop, ...rest }) => rest)(linkBy.get(v.id)!) : null,
    })),
    prefs,
    albums: albums.map((a) => ({ name: a.name, folder: folderName(a.folder_id), pinned: a.pinned === 1 })),
    folders: folders.map((f) => f.name),
    smartFilters: smart.map((s) => ({
      name: s.name,
      rule: JSON.parse(s.rule_json),
      folder: folderName(s.folder_id),
    })),
    pinnedKeywords: tags.filter((t) => t.pinned === 1).map((t) => t.name),
    kept: kept.map((k) => ({
      id: k.video_id,
      title: k.title,
      filename: k.filename,
      size: k.size,
      durationMs: k.duration_ms,
      rating: k.rating,
      status: k.status,
      notes: k.notes,
      keywords: keywordsOf(k.tags),
      createdAt: k.created_at,
      importedAt: k.imported_at,
      removedAt: k.removed_at,
    })),
    // Private videos are not in the file, so they are left out of series too.
    series: seriesRows.map((s) => ({
      name: s.name,
      description: s.description,
      rating: s.rating,
      status: s.status,
      episodes: seriesItems
        .filter((i) => i.series_id === s.id)
        .flatMap((i): BackupSeries['episodes'] =>
          videoIndex.has(i.video_id)
            ? [{ video: videoIndex.get(i.video_id)!, label: i.label }]
            : keptIds.has(i.video_id)
              ? [{ kept: i.video_id, label: i.label }]
              : []
        ),
    })),
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
export async function importLibraryInfo(): Promise<{ matched: number; total: number; plays: number } | null> {
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

  let playsAdded = 0;
  const idMap = new Map<string, string>();
  for (const [index, videoId] of matches) {
    const v = backup.videos[index];
    await db.runAsync(
      'UPDATE videos SET title = ?, notes = ?, rating = ?, status = ?, flag = ?, created_at = ? WHERE id = ?;',
      [v.title, v.notes, v.rating ?? 0, v.status, v.flag ?? 0, v.createdAt, videoId]
    );
    for (const k of v.keywords ?? []) await addTagToVideo(videoId, k);
    const ids = (v.albums ?? []).map((n) => albumIds.get(n)).filter((id): id is number => id !== undefined);
    if (ids.length) await addToAlbums([videoId], ids);
    if (v.inTray) await db.runAsync('UPDATE videos SET in_tray = 1 WHERE id = ?;', [videoId]);

    // v2: plays and bookmarks that aren't here yet, the newer continue point, the Simkl link.
    const havePlays = new Set((await db.getAllAsync<{ started_at: number }>('SELECT started_at FROM vault_plays WHERE video_id = ?;', [videoId])).map((r) => r.started_at));
    for (const [at, ms] of v.plays ?? []) {
      if (typeof at !== 'number' || havePlays.has(at)) continue;
      await db.runAsync('INSERT INTO vault_plays (video_id, started_at, watched_ms) VALUES (?, ?, ?);', [videoId, at, Math.max(0, Math.round(ms ?? 0))]);
      playsAdded++;
    }
    const haveMarks = new Set((await db.getAllAsync<{ at_ms: number }>('SELECT at_ms FROM vault_bookmarks WHERE video_id = ?;', [videoId])).map((r) => r.at_ms));
    for (const b of v.bookmarks ?? []) {
      if (typeof b?.atMs !== 'number' || haveMarks.has(b.atMs)) continue;
      await db.runAsync('INSERT INTO vault_bookmarks (video_id, at_ms, label, created_at) VALUES (?, ?, ?, ?);', [videoId, b.atMs, b.label ?? null, b.createdAt ?? Date.now()]);
    }
    if (v.resume && typeof v.resume.positionMs === 'number') {
      await db.runAsync(
        `INSERT INTO vault_resume (video_id, position_ms, saved_at) VALUES (?, ?, ?)
           ON CONFLICT(video_id) DO UPDATE SET position_ms = excluded.position_ms, saved_at = excluded.saved_at WHERE excluded.saved_at > vault_resume.saved_at;`,
        [videoId, v.resume.positionMs, v.resume.savedAt ?? Date.now()]
      );
    }
    const l = v.link as { simkl_id?: unknown; type?: unknown; title?: unknown; year?: unknown; poster?: unknown; season?: unknown; episode?: unknown; linked_at?: unknown; logged_at?: unknown } | null | undefined;
    if (l && typeof l.simkl_id === 'number' && typeof l.type === 'string' && typeof l.title === 'string') {
      await db.runAsync(
        `INSERT OR IGNORE INTO vault_simkl_links (video_id, simkl_id, type, title, year, poster, season, episode, linked_at, logged_at)
         VALUES (?,?,?,?,?,?,?,?,?,?);`,
        [videoId, l.simkl_id, l.type, l.title, (l.year as number) ?? null, (l.poster as string) ?? null, (l.season as number) ?? null, (l.episode as number) ?? null, (l.linked_at as string) ?? new Date().toISOString(), (l.logged_at as string) ?? null]
      );
    }
    if (v.id) idMap.set(v.id, videoId);
  }

  // v2: settings, joined with what is on the phone.
  if (backup.prefs) {
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse((await getSetting(PREFS_KEY)) ?? '{}') ?? {};
    } catch {
      current = {};
    }
    await setSetting(PREFS_KEY, JSON.stringify(mergePrefs(current, backup.prefs, idMap)));
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

  // Removed videos' info (never over what is already kept), then series by name.
  for (const k of backup.kept) {
    await db.runAsync(
      `INSERT OR IGNORE INTO vault_kept
         (video_id, title, filename, size, duration_ms, rating, status, notes, tags, is_private, thumb, created_at, imported_at, removed_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,NULL,?,?,?);`,
      [k.id, k.title, k.filename, k.size ?? 0, k.durationMs ?? null, k.rating ?? 0, k.status, k.notes, JSON.stringify(k.keywords ?? []), k.createdAt ?? 0, k.importedAt ?? 0, k.removedAt ?? Date.now()]
    );
  }
  const existingSeries = new Map((await listSeries()).map((s) => [s.name, s.id]));
  for (const { series, episodes } of seriesEpisodes(backup, matches)) {
    const ids = episodes.map((e) => e.videoId);
    let id = existingSeries.get(series.name);
    if (id) await addToSeries(id, ids);
    else id = await createSeries(series.name, ids);
    await updateSeries(id, { description: series.description, rating: series.rating, status: (series.status as OvStatus | null) ?? null });
    for (const e of episodes) if (e.label) await setEpisodeLabel(e.videoId, e.label);
  }

  return { matched: matches.size, total: backup.videos.length, plays: playsAdded };
}
