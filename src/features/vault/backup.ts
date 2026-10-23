/**
 * Export / import the library-info backup (see backupFormat.ts). The file is
 * handed to the share sheet ("Save to Files"), and read back with the picker.
 * Private videos are left out of the export: the file leaves the app.
 */

import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { getDb } from '@/db';


import { addToAlbums, createAlbum, createFolder, listAlbums, listFolders } from './albums';
import { BACKUP_KIND, BACKUP_VERSION, matchAudio, matchBackup, mergePrefs, parseBackup, seriesEpisodes, type Backup, type BackupAudio, type BackupMangaTitle, type BackupSeries } from './backupFormat';
import { normTitle } from './manga/mangaLogic';
import {
  addMangaTag,
  addRead,
  allReads,
  getSeries as getMangaSeries,
  insertChapter,
  insertSeries,
  listManga,
  saveProgress as saveMangaProgress,
  setChaptersRead,
  updateSeries as updateMangaSeries,
} from './manga/mangaStore';
import { getSetting, saveSmartFilter, setSetting, setTagPinned } from './library';
import { mergeOvExtra, OV_EXTRA_KEY, ovExtraForBackup, parseOvExtra } from './ovExtra';
import { addToSeries, createSeries, listSeries, setEpisodeLabel, updateSeries } from './overviewStore';
import type { OvStatus } from './overview';
import { shareFile } from './share';
import { addTagToVideo, listTags } from './tags';

/** Adds to a list in a map in place (copying the list each time gets slow with thousands of items). */
function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

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

/** Everything the backup file holds, as JSON, and how many videos it covers. */
async function buildBackup(): Promise<{ json: string; videos: number }> {
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
    for (const r of rows) pushTo(m, r.video_id, r);
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
  const overview = ovExtraForBackup(
    parseOvExtra(await getSetting(OV_EXTRA_KEY)),
    new Map(seriesRows.map((s) => [s.id, s.name])),
    (k) => videoIndex.has(k.slice(2)) || kept.some((x) => x.video_id === k.slice(2))
  );
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
    for (const r of rows) pushTo(m, r.video_id, r.name);
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
    overview,
    audio: await audioForBackup(),
    manga: await mangaForBackup(),
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

  return { json: JSON.stringify(backup), videos: videos.length };
}

export async function exportLibraryInfo(): Promise<number> {
  const { json, videos } = await buildBackup();
  const day = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `ReelVault library info ${day}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  await shareFile(file.uri);
  return videos;
}

/* -------------------------------------------------------- automatic backups */

const AUTO_KEY = 'vault.lastAutoBackup';
const KEEP_AUTO = 4;
const WEEK = 7 * 86_400_000;
/** Inside the app's Documents: also reachable from a PC in the Apple Devices app (Files tab). */
export const backupsDir = () => new Directory(Paths.document, 'Backups');

export type AutoBackup = { name: string; uri: string; at: number; size: number };

/** The automatic backups on the phone, newest first. */
export function listAutoBackups(): AutoBackup[] {
  const dir = backupsDir();
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((f): f is File => f instanceof File && f.name.endsWith('.json'))
    .map((f) => {
      const m = /(\d{4})-(\d{2})-(\d{2})/.exec(f.name);
      return { name: f.name, uri: f.uri, at: m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : 0, size: f.size ?? 0 };
    })
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

/** Once a week (or now, when `force`): a copy of all your info, keeping the last four. */
export async function autoBackup(force = false): Promise<AutoBackup | null> {
  const last = Number((await getSetting(AUTO_KEY)) ?? 0);
  if (!force && Date.now() - last < WEEK) return null;
  const { json, videos } = await buildBackup();
  if (!videos && !force) return null;
  const dir = backupsDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = new File(dir, `ReelVault info ${day}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  for (const old of listAutoBackups().slice(KEEP_AUTO)) {
    try {
      new File(old.uri).delete();
    } catch {
      // already gone
    }
  }
  await setSetting(AUTO_KEY, String(Date.now()));
  console.log(`[BACKUP] automatic backup of ${videos} videos`);
  return listAutoBackups()[0] ?? null;
}

/**
 * Applies a backup on top of the library. Nothing is deleted; matching videos
 * get the saved info. Without `uri` it asks for a file.
 */
export async function importLibraryInfo(uri?: string): Promise<{ matched: number; total: number; plays: number } | null> {
  let source = uri;
  if (!source) {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.length) return null;
    source = picked.assets[0].uri;
  }
  const backup = parseBackup(await new File(source).text());
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

  // Overview reviews, rewatches, order and rating history, on this phone's ids.
  if (backup.overview) {
    const seriesId = new Map((await listSeries()).map((x) => [x.name, x.id]));
    const incoming = parseOvExtra(JSON.stringify(backup.overview));
    const mapKey = (k: string): string | null => {
      if (k.startsWith('S:')) {
        const id = seriesId.get(k.slice(2));
        return id ? `s:${id}` : null;
      }
      if (k.startsWith('v:')) return `v:${idMap.get(k.slice(2)) ?? k.slice(2)}`;
      return null;
    };
    const current = parseOvExtra(await getSetting(OV_EXTRA_KEY));
    await setSetting(OV_EXTRA_KEY, JSON.stringify(mergeOvExtra(current, incoming, mapKey)));
  }

  // The Audio section.
  if (backup.audio?.length) playsAdded += await restoreAudio(backup.audio);
  // The Manga section.
  if (backup.manga?.length) await restoreManga(backup.manga);

  return { matched: matches.size, total: backup.videos.length, plays: playsAdded };
}

/* ------------------------------------------------------------------ audio */

type AudioRow = {
  id: string;
  content_key: string | null;
  filename: string;
  size: number;
  title: string | null;
  author: string | null;
  narrator: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  notes: string | null;
  rating: number;
  status: string | null;
  position_track: number;
  position_ms: number;
  speed: number | null;
  last_played_at: number | null;
  finished_at: number | null;
};

async function audioForBackup(): Promise<BackupAudio[]> {
  const db = await getDb();
  let rows: AudioRow[] = [];
  try {
    rows = await db.getAllAsync<AudioRow>('SELECT * FROM audio_items WHERE deleted_at IS NULL AND is_private = 0;');
  } catch {
    return [];
  }
  const tags = await db.getAllAsync<{ item_id: string; name: string }>('SELECT item_id, name FROM audio_tags;');
  const plays = await db.getAllAsync<{ item_id: string; started_at: number; listened_ms: number }>('SELECT item_id, started_at, listened_ms FROM audio_plays;');
  const marks = await db.getAllAsync<{ item_id: string; track: number; at_ms: number; label: string | null; created_at: number }>('SELECT item_id, track, at_ms, label, created_at FROM audio_bookmarks;');
  return rows.map((r) => ({
    contentKey: r.content_key,
    filename: r.filename,
    size: r.size,
    title: r.title,
    author: r.author,
    narrator: r.narrator,
    album: r.album,
    genre: r.genre,
    year: r.year,
    notes: r.notes,
    rating: r.rating,
    status: r.status,
    keywords: tags.filter((t) => t.item_id === r.id).map((t) => t.name),
    positionTrack: r.position_track,
    positionMs: r.position_ms,
    speed: r.speed,
    lastPlayedAt: r.last_played_at,
    finishedAt: r.finished_at,
    plays: plays.filter((x) => x.item_id === r.id).map((x): [number, number] => [x.started_at, x.listened_ms]),
    bookmarks: marks.filter((m) => m.item_id === r.id).map((m) => ({ track: m.track, atMs: m.at_ms, label: m.label, createdAt: m.created_at })),
  }));
}

/** Puts backed-up audio info back on the items you have now; returns how many listens were added. */
async function restoreAudio(entries: BackupAudio[]): Promise<number> {
  const db = await getDb();
  const library = await db.getAllAsync<{ id: string; content_key: string | null; filename: string; size: number; last_played_at: number | null }>(
    'SELECT id, content_key, filename, size, last_played_at FROM audio_items WHERE deleted_at IS NULL;'
  );
  const matches = matchAudio(entries, library.map((v) => ({ id: v.id, contentKey: v.content_key, filename: v.filename, size: v.size })));
  let added = 0;
  for (const [i, id] of matches) {
    const a = entries[i];
    const now = library.find((x) => x.id === id);
    await db.runAsync(
      `UPDATE audio_items SET title = COALESCE(?, title), author = COALESCE(?, author), narrator = COALESCE(?, narrator), album = COALESCE(?, album),
         genre = COALESCE(?, genre), year = COALESCE(?, year), notes = COALESCE(?, notes), rating = ?, status = ?, speed = COALESCE(?, speed),
         finished_at = COALESCE(?, finished_at)
       WHERE id = ?;`,
      [a.title, a.author, a.narrator, a.album, a.genre, a.year, a.notes, a.rating ?? 0, a.status, a.speed, a.finishedAt, id]
    );
    // Where you were: the backup's, when it is newer than what this phone has.
    if ((a.lastPlayedAt ?? 0) > (now?.last_played_at ?? 0)) {
      await db.runAsync('UPDATE audio_items SET position_track = ?, position_ms = ?, last_played_at = ? WHERE id = ?;', [a.positionTrack ?? 0, a.positionMs ?? 0, a.lastPlayedAt, id]);
    }
    for (const k of a.keywords) await db.runAsync('INSERT OR IGNORE INTO audio_tags (item_id, name) VALUES (?, ?);', [id, k]);
    const have = new Set((await db.getAllAsync<{ started_at: number }>('SELECT started_at FROM audio_plays WHERE item_id = ?;', [id])).map((x) => x.started_at));
    for (const [at, ms] of a.plays) {
      if (have.has(at)) continue;
      await db.runAsync('INSERT INTO audio_plays (item_id, started_at, listened_ms) VALUES (?, ?, ?);', [id, at, ms]);
      added++;
    }
    const marks = new Set(
      (await db.getAllAsync<{ track: number; at_ms: number }>('SELECT track, at_ms FROM audio_bookmarks WHERE item_id = ?;', [id])).map((m) => `${m.track}:${m.at_ms}`)
    );
    for (const m of a.bookmarks) {
      if (marks.has(`${m.track}:${m.atMs}`)) continue;
      await db.runAsync('INSERT INTO audio_bookmarks (item_id, track, at_ms, label, created_at) VALUES (?, ?, ?, ?, ?);', [id, m.track ?? 0, m.atMs, m.label, m.createdAt ?? Date.now()]);
    }
  }
  return added;
}

/* ------------------------------------------------------------------ manga */

async function mangaForBackup(): Promise<BackupMangaTitle[]> {
  let all: Awaited<ReturnType<typeof listManga>> = [];
  try {
    all = await listManga();
  } catch {
    return [];
  }
  const reads = await allReads().catch(() => []);
  return all
    .filter((s) => !s.deletedAt && !s.isPrivate)
    .map((s) => ({
      title: s.title,
      altTitle: s.altTitle,
      author: s.author,
      artist: s.artist,
      description: s.description,
      kind: s.kind,
      pubStatus: s.pubStatus,
      status: s.status,
      rating: s.rating,
      notes: s.notes,
      readingMode: s.readingMode,
      sourceId: s.sourceId,
      sourceKey: s.sourceKey,
      sourceUrl: s.sourceUrl,
      keywords: s.tags,
      createdAt: s.createdAt,
      lastReadAt: s.lastReadAt,
      finishedAt: s.finishedAt,
      chapters: s.chapters.map((c) => ({
        key: c.sourceKey,
        number: c.number,
        volume: c.volume,
        title: c.title ?? c.filename,
        scanlator: c.scanlator,
        uploadedAt: c.uploadedAt,
        externalUrl: c.sourceUrl,
        readAt: c.readAt,
        lastPage: c.lastPage,
      })),
      reads: reads.filter((r) => r.seriesId === s.id).map((r): [number, number, number] => [r.startedAt, r.readMs, r.pages]),
    }));
}

/**
 * Puts manga info back: titles you have (same source title, or the same
 * name) get their rating, status, notes, keywords, read marks and reading
 * sessions; titles from a source you don't have are added again with their
 * chapters (online, ready to download). Titles made from your own files need
 * those files: their info waits until you add them again.
 */
async function restoreManga(entries: BackupMangaTitle[]): Promise<void> {
  const library = await listManga();
  const live = library.filter((s) => !s.deletedAt);
  const known = new Set((await allReads().catch(() => [])).map((r) => `${r.seriesId}:${r.startedAt}`));
  for (const e of entries) {
    let s = live.find((x) => e.sourceId && x.sourceId === e.sourceId && x.sourceKey === e.sourceKey) ?? live.find((x) => normTitle(x.title) === normTitle(e.title));
    if (!s && e.sourceId && e.sourceKey) {
      const id = Crypto.randomUUID();
      await insertSeries({
        id,
        folder: `manga/${id}`,
        title: e.title,
        altTitle: e.altTitle,
        author: e.author,
        artist: e.artist,
        description: e.description,
        kind: (e.kind as 'manga' | 'manhwa' | 'comic' | null) ?? null,
        pubStatus: e.pubStatus,
        status: (e.status as never) ?? null,
        rating: e.rating,
        notes: e.notes,
        cover: null,
        isPrivate: false,
        readingMode: (e.readingMode as never) ?? null,
        sourceId: e.sourceId,
        sourceKey: e.sourceKey,
        sourceUrl: e.sourceUrl,
        createdAt: e.createdAt || Date.now(),
        importedAt: Date.now(),
        lastReadAt: e.lastReadAt,
        finishedAt: e.finishedAt,
        deletedAt: null,
      });
      for (const [i, c] of e.chapters.entries()) {
        if (!c.key) continue;
        await insertChapter({
          id: Crypto.randomUUID(),
          seriesId: id,
          folder: null,
          number: c.number,
          volume: c.volume,
          title: c.title,
          filename: null,
          pages: [],
          pageCount: 0,
          size: 0,
          contentKey: null,
          sourceKey: c.key,
          sourceUrl: c.externalUrl,
          scanlator: c.scanlator,
          uploadedAt: c.uploadedAt,
          addedAt: Date.now(),
          readAt: c.readAt,
          lastPage: c.lastPage || 0,
          downloaded: false,
          position: i,
        });
      }
      s = (await getMangaSeries(id)) ?? undefined;
    } else if (s) {
      await updateMangaSeries([s.id], {
        rating: e.rating || s.rating,
        status: (e.status as never) ?? s.status,
        notes: e.notes ?? s.notes,
        readingMode: (e.readingMode as never) ?? s.readingMode,
        lastReadAt: Math.max(s.lastReadAt ?? 0, e.lastReadAt ?? 0) || null,
      });
      // Read marks: a chapter with the same source key, else the same number.
      for (const c of e.chapters) {
        if (!c.readAt && !c.lastPage) continue;
        const hit = s.chapters.find((x) => (c.key && x.sourceKey === c.key) || (c.number !== null && x.number === c.number && (x.volume ?? null) === (c.volume ?? null)));
        if (!hit) continue;
        if (c.readAt && !hit.readAt) await setChaptersRead([hit.id], true, c.readAt);
        else if (c.lastPage > hit.lastPage && !hit.readAt) await saveMangaProgress(s.id, hit.id, c.lastPage, false, s.lastReadAt ?? Date.now());
      }
    }
    if (!s) continue;
    for (const k of e.keywords) await addMangaTag(s.id, k);
    for (const [startedAt, readMs, pages] of e.reads) {
      if (known.has(`${s.id}:${startedAt}`)) continue;
      await addRead({ seriesId: s.id, chapterId: null, startedAt, readMs, pages: pages || 0 });
    }
  }
}
