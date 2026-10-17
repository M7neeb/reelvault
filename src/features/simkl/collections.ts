/**
 * Schema v7 storage (native half): your own lists of titles, and the links
 * from your videos to a Simkl movie or episode.
 */

import { getDb } from '@/db';

import type { CatalogTitle, SimklType } from './logic';

export type SimklList = {
  id: number;
  name: string;
  icon: string | null;
  createdAt: string;
  count: number;
  /** The first few posters, for the list's cover. */
  covers: { poster: string | null; title: string }[];
  /** Every title id in the list (for "in 2 lists" and the add sheet). */
  ids: number[];
};

export type ListEntry = CatalogTitle & { addedAt: string };

export type VideoLink = {
  videoId: string;
  simklId: number;
  type: SimklType;
  title: string;
  year: number | null;
  poster: string | null;
  /** Shows and anime: the episode this video is. */
  season: number | null;
  episode: number | null;
  linkedAt: string;
  loggedAt: string | null;
};

/* -------------------------------------------------------------------- lists */

export async function allLists(): Promise<SimklList[]> {
  const db = await getDb();
  const lists = await db.getAllAsync<{ id: number; name: string; icon: string | null; created_at: string }>(
    'SELECT id, name, icon, created_at FROM simkl_lists ORDER BY position, id;'
  );
  const entries = await db.getAllAsync<{ list_id: number; simkl_id: number; poster: string | null; title: string }>(
    'SELECT list_id, simkl_id, poster, title FROM simkl_list_items ORDER BY added_at DESC;'
  );
  return lists.map((l) => {
    const mine = entries.filter((e) => e.list_id === l.id);
    return {
      id: l.id,
      name: l.name,
      icon: l.icon,
      createdAt: l.created_at,
      count: mine.length,
      covers: mine.slice(0, 3).map((e) => ({ poster: e.poster, title: e.title })),
      ids: mine.map((e) => e.simkl_id),
    };
  });
}

export async function createList(name: string, icon: string | null): Promise<number> {
  const db = await getDb();
  const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(position) AS m FROM simkl_lists;');
  const r = await db.runAsync('INSERT INTO simkl_lists (name, icon, created_at, position) VALUES (?,?,?,?);', [
    name.trim(),
    icon,
    new Date().toISOString(),
    (max?.m ?? 0) + 1,
  ]);
  return r.lastInsertRowId;
}

export async function updateList(id: number, name: string, icon: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE simkl_lists SET name = ?, icon = ? WHERE id = ?;', [name.trim(), icon, id]);
}

/** Only the list goes; the titles stay in your library. */
export async function deleteList(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM simkl_list_items WHERE list_id = ?;', [id]);
  await db.runAsync('DELETE FROM simkl_lists WHERE id = ?;', [id]);
}

export async function listEntries(id: number): Promise<ListEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    simkl_id: number;
    type: SimklType;
    title: string;
    year: number | null;
    poster: string | null;
    slug: string | null;
    added_at: string;
  }>('SELECT simkl_id, type, title, year, poster, slug, added_at FROM simkl_list_items WHERE list_id = ? ORDER BY added_at DESC;', [id]);
  return rows.map((r) => ({
    simklId: r.simkl_id,
    type: r.type,
    title: r.title,
    year: r.year,
    poster: r.poster,
    slug: r.slug,
    addedAt: r.added_at,
  }));
}

export async function setInList(listId: number, title: CatalogTitle, on: boolean): Promise<void> {
  const db = await getDb();
  if (!on) {
    await db.runAsync('DELETE FROM simkl_list_items WHERE list_id = ? AND simkl_id = ?;', [listId, title.simklId]);
    return;
  }
  await db.runAsync(
    `INSERT OR IGNORE INTO simkl_list_items (list_id, simkl_id, type, title, year, poster, slug, added_at)
     VALUES (?,?,?,?,?,?,?,?);`,
    [listId, title.simklId, title.type, title.title, title.year, title.poster, title.slug, new Date().toISOString()]
  );
}

/* -------------------------------------------------------------- video links */

type LinkRow = {
  video_id: string;
  simkl_id: number;
  type: SimklType;
  title: string;
  year: number | null;
  poster: string | null;
  season: number | null;
  episode: number | null;
  linked_at: string;
  logged_at: string | null;
};

const toLink = (r: LinkRow): VideoLink => ({
  videoId: r.video_id,
  simklId: r.simkl_id,
  type: r.type,
  title: r.title,
  year: r.year,
  poster: r.poster,
  season: r.season,
  episode: r.episode,
  linkedAt: r.linked_at,
  loggedAt: r.logged_at,
});

export async function allLinks(): Promise<Map<string, VideoLink>> {
  const db = await getDb();
  const rows = await db.getAllAsync<LinkRow>('SELECT * FROM vault_simkl_links;');
  return new Map(rows.map((r) => [r.video_id, toLink(r)]));
}

export async function setLink(videoId: string, link: Omit<VideoLink, 'videoId' | 'linkedAt' | 'loggedAt'> | null): Promise<void> {
  const db = await getDb();
  if (!link) {
    await db.runAsync('DELETE FROM vault_simkl_links WHERE video_id = ?;', [videoId]);
    return;
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO vault_simkl_links (video_id, simkl_id, type, title, year, poster, season, episode, linked_at, logged_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL);`,
    [videoId, link.simklId, link.type, link.title, link.year, link.poster, link.season, link.episode, new Date().toISOString()]
  );
}

export async function markLinkLogged(videoId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE vault_simkl_links SET logged_at = ? WHERE video_id = ?;', [new Date().toISOString(), videoId]);
}
