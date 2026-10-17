/**
 * Schema v9 storage for the Overview: what is kept after a video is removed
 * for good, and series (videos that belong together). Pure logic lives in
 * overview.ts; this file only reads and writes.
 */

import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';

import { getDb } from '@/db';

import type { OvMember, OvSeries, OvStatus, OvVideo } from './overview';
import { getSetting } from './library';
import { coverFileName, thumbsDir } from './storage';
import { tagsForVideo } from './tags';
import type { Video } from './types';

const keptDir = () => new Directory(thumbsDir, 'kept');
const seriesDir = () => new Directory(thumbsDir, 'series');

function ensure(dir: Directory): Directory {
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function removeFile(dir: Directory, name: string | null): void {
  if (!name) return;
  try {
    const f = new File(dir, name);
    if (f.exists) f.delete();
  } catch (e) {
    console.log(`[OVERVIEW] file not removed: ${String(e)}`);
  }
}

/* --------------------------------------------------------------------- kept */

/**
 * Called just before a video is removed for good: its rating, status,
 * keywords, notes and a copy of its cover stay, so the Overview keeps it.
 * `onlyRated` keeps only videos you rated, set a status on, or put in a series.
 */
export async function keepInfo(video: Video, onlyRated: boolean): Promise<void> {
  const db = await getDb();
  if (onlyRated && video.rating <= 0 && !video.status) {
    const inSeries = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM vault_series_items WHERE video_id = ?;', [video.id]);
    if (!inSeries?.n) return;
  }
  let thumb: string | null = null;
  try {
    const cover = new File(thumbsDir, coverFileName(video.id, video.coverAt));
    if (cover.exists) {
      thumb = `${video.id}.jpg`;
      const target = new File(ensure(keptDir()), thumb);
      if (target.exists) target.delete();
      await cover.copy(target);
    }
  } catch (e) {
    thumb = null;
    console.log(`[KEPT] cover not copied: ${String(e)}`);
  }
  const tags = (await tagsForVideo(video.id)).map((t) => t.name);
  await db.runAsync(
    `INSERT OR REPLACE INTO vault_kept
       (video_id, title, filename, size, duration_ms, rating, status, notes, tags, is_private, thumb, created_at, imported_at, removed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
    [
      video.id,
      video.title,
      video.filename,
      video.size,
      video.durationMs,
      video.rating,
      video.status,
      video.notes,
      JSON.stringify(tags),
      video.isPrivate ? 1 : 0,
      thumb,
      video.createdAt,
      video.importedAt,
      Date.now(),
    ]
  );
  console.log(`[KEPT] info kept for ${video.filename}`);
}

type KeptRow = {
  video_id: string;
  title: string | null;
  filename: string;
  size: number;
  duration_ms: number | null;
  rating: number;
  status: string | null;
  notes: string | null;
  tags: string | null;
  is_private: number;
  thumb: string | null;
  created_at: number;
  imported_at: number;
  removed_at: number;
};

function parseTags(json: string | null): string[] {
  try {
    const t = JSON.parse(json ?? '[]');
    return Array.isArray(t) ? t.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function listKept(): Promise<OvVideo[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<KeptRow>('SELECT * FROM vault_kept ORDER BY removed_at DESC;');
  return rows.map((r) => ({
    id: r.video_id,
    title: r.title,
    filename: r.filename,
    durationMs: r.duration_ms,
    sizeBytes: r.size,
    rating: r.rating,
    status: (r.status as OvStatus | null) ?? null,
    notes: r.notes,
    tagNames: parseTags(r.tags),
    thumb: r.thumb ? new File(keptDir(), r.thumb).uri : null,
    createdAt: r.created_at,
    importedAt: r.imported_at,
    where: 'kept' as const,
    removedAt: r.removed_at,
    isPrivate: r.is_private === 1,
  }));
}

export async function updateKept(id: string, change: { title?: string | null; notes?: string | null; rating?: number; status?: OvStatus | null }): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, col] of [
    ['title', 'title'],
    ['notes', 'notes'],
    ['rating', 'rating'],
    ['status', 'status'],
  ] as const) {
    if (k in change) {
      sets.push(`${col} = ?`);
      const v = change[k];
      args.push(typeof v === 'string' ? v.trim() || null : (v ?? (k === 'rating' ? 0 : null)));
    }
  }
  if (!sets.length) return;
  await db.runAsync(`UPDATE vault_kept SET ${sets.join(', ')} WHERE video_id = ?;`, [...args, id]);
}

/** Settings → Personalise → "Keep info of unrated videos too" (on unless turned off). */
export async function keepUnrated(): Promise<boolean> {
  try {
    const prefs = JSON.parse((await getSetting('vault.prefs')) ?? '{}');
    return prefs?.keepUnrated !== false;
  } catch {
    return true;
  }
}

/** A kept video gets a picture picked from Files / Photos. false = cancelled. */
export async function pickKeptCover(id: string): Promise<boolean> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets?.[0]) return false;
  const db = await getDb();
  const old = await db.getFirstAsync<{ thumb: string | null }>('SELECT thumb FROM vault_kept WHERE video_id = ?;', [id]);
  const name = `${id}-${Date.now()}.jpg`;
  await new File(picked.assets[0].uri).copy(new File(ensure(keptDir()), name));
  await db.runAsync('UPDATE vault_kept SET thumb = ? WHERE video_id = ?;', [name, id]);
  removeFile(keptDir(), old?.thumb ?? null);
  return true;
}

/** Forget kept videos completely: the info, the picture, and their place in a series. */
export async function forgetKept(ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) {
    const row = await db.getFirstAsync<{ thumb: string | null }>('SELECT thumb FROM vault_kept WHERE video_id = ?;', [id]);
    removeFile(keptDir(), row?.thumb ?? null);
    await db.runAsync('DELETE FROM vault_kept WHERE video_id = ?;', [id]);
    await db.runAsync('DELETE FROM vault_series_items WHERE video_id = ?;', [id]);
  }
  console.log(`[KEPT] forgot ${ids.length}`);
}

/* ------------------------------------------------------------------- series */

type SeriesRow = {
  id: string;
  name: string;
  description: string | null;
  cover: string | null;
  rating: number;
  status: string | null;
  created_at: number;
  updated_at: number;
};

export async function listSeries(): Promise<OvSeries[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SeriesRow>('SELECT * FROM vault_series ORDER BY name COLLATE NOCASE;');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    cover: r.cover ? new File(seriesDir(), r.cover).uri : null,
    rating: r.rating,
    status: (r.status as OvStatus | null) ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function listMembers(): Promise<OvMember[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ video_id: string; series_id: string; position: number; label: string | null }>(
    'SELECT * FROM vault_series_items ORDER BY series_id, position;'
  );
  return rows.map((r) => ({ videoId: r.video_id, seriesId: r.series_id, position: r.position, label: r.label }));
}

async function touch(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE vault_series SET updated_at = ? WHERE id = ?;', [Date.now(), id]);
}

/** A new series from these videos, in this order. Videos leave any series they were in. */
export async function createSeries(name: string, videoIds: string[]): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = Date.now();
  await db.runAsync('INSERT INTO vault_series (id, name, created_at, updated_at) VALUES (?,?,?,?);', [id, name.trim() || 'New series', now, now]);
  await addToSeries(id, videoIds);
  console.log(`[SERIES] created "${name}" with ${videoIds.length}`);
  return id;
}

/** Adds videos at the end of the series (moving them out of another one). */
export async function addToSeries(seriesId: string, videoIds: string[]): Promise<void> {
  const db = await getDb();
  const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(position) AS m FROM vault_series_items WHERE series_id = ?;', [seriesId]);
  let pos = (max?.m ?? 0) + 1;
  for (const v of videoIds) {
    const existing = await db.getFirstAsync<{ series_id: string }>('SELECT series_id FROM vault_series_items WHERE video_id = ?;', [v]);
    if (existing?.series_id === seriesId) continue;
    await db.runAsync('INSERT OR REPLACE INTO vault_series_items (video_id, series_id, position, label) VALUES (?,?,?,NULL);', [v, seriesId, pos++]);
  }
  await touch(seriesId);
}

/** Takes videos out of their series; they show as single videos again. */
export async function removeFromSeries(videoIds: string[]): Promise<void> {
  const db = await getDb();
  for (const v of videoIds) await db.runAsync('DELETE FROM vault_series_items WHERE video_id = ?;', [v]);
}

export async function reorderSeries(seriesId: string, order: string[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < order.length; i++) {
      await db.runAsync('UPDATE vault_series_items SET position = ? WHERE video_id = ? AND series_id = ?;', [i + 1, order[i], seriesId]);
    }
  });
  await touch(seriesId);
}

export async function setEpisodeLabel(videoId: string, label: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE vault_series_items SET label = ? WHERE video_id = ?;', [label?.trim() || null, videoId]);
}

export async function updateSeries(
  id: string,
  change: { name?: string; description?: string | null; rating?: number; status?: OvStatus | null }
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (change.name !== undefined) {
    sets.push('name = ?');
    args.push(change.name.trim() || 'Untitled series');
  }
  if ('description' in change) {
    sets.push('description = ?');
    args.push(change.description?.trim() || null);
  }
  if (change.rating !== undefined) {
    sets.push('rating = ?');
    args.push(change.rating);
  }
  if ('status' in change) {
    sets.push('status = ?');
    args.push(change.status ?? null);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(Date.now());
  await db.runAsync(`UPDATE vault_series SET ${sets.join(', ')} WHERE id = ?;`, [...args, id]);
}

/**
 * The series picture: a photo picked from Files / Photos ('photo'), a copy
 * of an image already in the app (an episode's cover), or null = back to the
 * first episode's cover. false = the picker was cancelled.
 */
export async function setSeriesCover(id: string, from: 'photo' | { uri: string } | null): Promise<boolean> {
  const db = await getDb();
  const old = await db.getFirstAsync<{ cover: string | null }>('SELECT cover FROM vault_series WHERE id = ?;', [id]);
  let name: string | null = null;
  if (from) {
    let source: string;
    if (from === 'photo') {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0]) return false;
      source = picked.assets[0].uri;
    } else {
      source = from.uri;
    }
    name = `${id}-${Date.now()}.jpg`;
    await new File(source).copy(new File(ensure(seriesDir()), name));
  }
  await db.runAsync('UPDATE vault_series SET cover = ?, updated_at = ? WHERE id = ?;', [name, Date.now(), id]);
  removeFile(seriesDir(), old?.cover ?? null);
  return true;
}

/** Deletes the series itself. Its videos stay and show as single videos again. */
export async function deleteSeries(id: string): Promise<void> {
  const db = await getDb();
  const old = await db.getFirstAsync<{ cover: string | null }>('SELECT cover FROM vault_series WHERE id = ?;', [id]);
  await db.runAsync('DELETE FROM vault_series_items WHERE series_id = ?;', [id]);
  await db.runAsync('DELETE FROM vault_series WHERE id = ?;', [id]);
  removeFile(seriesDir(), old?.cover ?? null);
  console.log('[SERIES] deleted');
}
