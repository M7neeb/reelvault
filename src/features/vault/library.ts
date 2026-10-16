/**
 * Library-level storage: app settings and smart filters.
 * Bulk edits for many videos at once live here too.
 */

import { getDb } from '@/db';

import { addTagToVideo } from './tags';
import type { WatchStatus } from './types';

/** `?,?,?` for an IN (...) list. */
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/* ----------------------------------------------------------------- settings */

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?;',
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;',
    [key, value]
  );
}

/* ------------------------------------------------------------ smart filters */

export type SmartFilterRow = { id: number; name: string; rule_json: string; folder_id: number | null };

export async function listSmartFilters(): Promise<SmartFilterRow[]> {
  const db = await getDb();
  return db.getAllAsync<SmartFilterRow>(
    'SELECT id, name, rule_json, folder_id FROM smart_filters ORDER BY sort_order, created_at;'
  );
}

export async function saveSmartFilter(f: {
  id?: number;
  name: string;
  ruleJson: string;
}): Promise<void> {
  const db = await getDb();
  if (f.id !== undefined) {
    await db.runAsync('UPDATE smart_filters SET name = ?, rule_json = ? WHERE id = ?;', [
      f.name,
      f.ruleJson,
      f.id,
    ]);
    return;
  }
  await db.runAsync(
    'INSERT INTO smart_filters (name, rule_json, created_at) VALUES (?, ?, ?);',
    [f.name, f.ruleJson, Date.now()]
  );
}

export async function deleteSmartFilter(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM smart_filters WHERE id = ?;', [id]);
}

/* --------------------------------------------------------------- bulk edits */

export async function setRatingMany(ids: string[], rating: number): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE videos SET rating = ? WHERE id IN (${marks(ids.length)});`, [
    rating,
    ...ids,
  ]);
}

export async function setStatusMany(ids: string[], status: WatchStatus | null): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE videos SET status = ? WHERE id IN (${marks(ids.length)});`, [
    status,
    ...ids,
  ]);
}

export async function setPrivateMany(ids: string[], isPrivate: boolean): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE videos SET is_private = ? WHERE id IN (${marks(ids.length)});`, [
    isPrivate ? 1 : 0,
    ...ids,
  ]);
}

export async function addTagMany(ids: string[], name: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) await addTagToVideo(id, name);
  });
}

export async function setFlagMany(ids: string[], flag: -1 | 0 | 1): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE videos SET flag = ? WHERE id IN (${marks(ids.length)});`, [flag, ...ids]);
}

export async function setTrayMany(ids: string[], inTray: boolean): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE videos SET in_tray = ? WHERE id IN (${marks(ids.length)});`, [inTray ? 1 : 0, ...ids]);
}

export async function clearTray(): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE videos SET in_tray = 0 WHERE in_tray = 1;');
}

/** Title and caption ("notes") are searchable: the FTS triggers pick the change up. */
export async function setTextMany(ids: string[], field: 'title' | 'notes', value: string | null): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  const column = field === 'title' ? 'title' : 'notes';
  await db.runAsync(`UPDATE videos SET ${column} = ? WHERE id IN (${marks(ids.length)});`, [
    value && value.trim() ? value.trim() : null,
    ...ids,
  ]);
}

/** HashPhotos' "Adjust Date/Time": set one date for all, or shift each by the same amount. */
export async function adjustDates(ids: string[], change: { setTo?: number; shiftBy?: number }): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  if (change.setTo !== undefined) {
    await db.runAsync(`UPDATE videos SET created_at = ? WHERE id IN (${marks(ids.length)});`, [change.setTo, ...ids]);
  } else if (change.shiftBy) {
    await db.runAsync(`UPDATE videos SET created_at = created_at + ? WHERE id IN (${marks(ids.length)});`, [
      change.shiftBy,
      ...ids,
    ]);
  }
}

export async function setTagPinned(tagId: number, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE tags SET pinned = ? WHERE id = ?;', [pinned ? 1 : 0, tagId]);
}
