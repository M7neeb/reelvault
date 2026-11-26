/** Creators in the database (video_creators); the rules for names are in creatorLogic.ts. */

import { getDb } from '@/db';

import { normCreator, sameCreator } from './creatorLogic';

/** creator name -> ids of the live videos made by them. */
export async function creatorIndex(): Promise<Record<string, string[]>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string; video_id: string }>(
    `SELECT c.name AS name, c.video_id AS video_id
       FROM video_creators c
       JOIN videos v ON v.id = c.video_id
      WHERE v.deleted_at IS NULL
      ORDER BY c.name COLLATE NOCASE;`
  );
  const map: Record<string, string[]> = {};
  for (const r of rows) (map[r.name] ??= []).push(r.video_id);
  return map;
}

/** The spelling already in use for this creator, so "Berry" and "@berry" stay one. */
async function spelling(name: string): Promise<string | null> {
  const n = normCreator(name);
  if (!n) return null;
  const db = await getDb();
  const names = await db.getAllAsync<{ name: string }>('SELECT DISTINCT name FROM video_creators;');
  return names.find((r) => sameCreator(r.name, n))?.name ?? n;
}

export async function addCreator(ids: string[], name: string): Promise<void> {
  const n = await spelling(name);
  if (!n || !ids.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) await db.runAsync('INSERT OR IGNORE INTO video_creators (video_id, name) VALUES (?, ?);', [id, n]);
  });
}

export async function removeCreator(ids: string[], name: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) await db.runAsync('DELETE FROM video_creators WHERE video_id = ? AND name = ?;', [id, name]);
  });
}

/** Renames everywhere; renaming to a creator that exists merges the two. */
export async function renameCreator(from: string, to: string): Promise<void> {
  const db = await getDb();
  const others = await db.getAllAsync<{ name: string }>('SELECT DISTINCT name FROM video_creators WHERE name <> ?;', [from]);
  const n = normCreator(to);
  if (!n) return;
  const target = others.find((r) => sameCreator(r.name, n))?.name ?? n;
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT OR IGNORE INTO video_creators (video_id, name) SELECT video_id, ? FROM video_creators WHERE name = ?;', [target, from]);
    if (target !== from) await db.runAsync('DELETE FROM video_creators WHERE name = ?;', [from]);
  });
}

export async function deleteCreator(name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM video_creators WHERE name = ?;', [name]);
}
