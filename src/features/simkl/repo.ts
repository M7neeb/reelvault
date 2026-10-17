/**
 * Local copy of the Simkl library (SQLite, schema v5). The app reads only from
 * here; sync.ts keeps it in step with Simkl.
 */

import { getDb } from '@/db';
import { effectiveRating } from './insights';
import type { CommunityRatings, SimklItem, SimklStatus, SimklType, WatchedEpisode } from './logic';

type Row = {
  simkl_id: number;
  type: string;
  title: string;
  year: number | null;
  poster: string | null;
  slug: string | null;
  runtime: number | null;
  status: string;
  rating: number | null;
  rated_at: string | null;
  added_at: string | null;
  last_watched_at: string | null;
  watched_episodes: number;
  total_episodes: number;
  not_aired: number;
  next_to_watch: string | null;
  anime_type: string | null;
  memo: string | null;
  next_title: string | null;
  next_date: string | null;
  simkl_rating: number | null;
  simkl_votes: number | null;
  imdb_rating: number | null;
  imdb_votes: number | null;
  mal_rating: number | null;
  rank: number | null;
};

const toItem = (r: Row): SimklItem => ({
  simklId: r.simkl_id,
  type: r.type as SimklType,
  title: r.title,
  year: r.year,
  poster: r.poster,
  slug: r.slug,
  runtime: r.runtime,
  status: r.status as SimklStatus,
  rating: r.rating,
  ratedAt: r.rated_at,
  addedAt: r.added_at,
  lastWatchedAt: r.last_watched_at,
  watchedEpisodes: r.watched_episodes,
  totalEpisodes: r.total_episodes,
  notAiredEpisodes: r.not_aired,
  nextToWatch: r.next_to_watch,
  animeType: r.anime_type,
  memo: r.memo,
  nextTitle: r.next_title,
  nextDate: r.next_date,
  simklRating: r.simkl_rating,
  simklVotes: r.simkl_votes,
  imdbRating: r.imdb_rating,
  imdbVotes: r.imdb_votes,
  malRating: r.mal_rating,
  rank: r.rank,
});

export async function listSimklItems(): Promise<SimklItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row & { exact: number | null; fanart: string | null }>(
    `SELECT i.*, r.rating AS exact, m.fanart AS fanart FROM simkl_items i
       LEFT JOIN simkl_my_ratings r ON r.simkl_id = i.simkl_id
       LEFT JOIN simkl_meta m ON m.simkl_id = i.simkl_id;`
  );
  return rows.map((r) => ({ ...toItem(r), rating: effectiveRating(r.rating, r.exact), fanart: r.fanart }));
}

/**
 * Insert or update. An UPDATE (not REPLACE) on conflict, because REPLACE deletes
 * the row first and the cascade would wipe its watched episodes.
 */
export async function upsertSimklItems(items: SimklItem[]): Promise<void> {
  if (!items.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const i of items) {
      await db.runAsync(
        `INSERT INTO simkl_items
           (simkl_id, type, title, year, poster, slug, runtime, status, rating, rated_at, added_at,
            last_watched_at, watched_episodes, total_episodes, not_aired, next_to_watch, anime_type, memo,
            next_title, next_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(simkl_id) DO UPDATE SET
           type = excluded.type, title = excluded.title, year = excluded.year, poster = excluded.poster,
           slug = excluded.slug, runtime = excluded.runtime, status = excluded.status, rating = excluded.rating,
           rated_at = excluded.rated_at, added_at = excluded.added_at, last_watched_at = excluded.last_watched_at,
           watched_episodes = excluded.watched_episodes, total_episodes = excluded.total_episodes,
           not_aired = excluded.not_aired, next_to_watch = excluded.next_to_watch,
           anime_type = excluded.anime_type, memo = excluded.memo,
           next_title = excluded.next_title, next_date = excluded.next_date;`,
        [
          i.simklId,
          i.type,
          i.title,
          i.year,
          i.poster,
          i.slug,
          i.runtime,
          i.status,
          i.rating,
          i.ratedAt,
          i.addedAt,
          i.lastWatchedAt,
          i.watchedEpisodes,
          i.totalEpisodes,
          i.notAiredEpisodes,
          i.nextToWatch,
          i.animeType,
          i.memo,
          i.nextTitle,
          i.nextDate,
        ]
      );
    }
  });
}

/** Community ratings for the whole library, after a sync. */
export async function saveCommunityRatings(ratings: Map<number, CommunityRatings>): Promise<void> {
  if (!ratings.size) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [id, r] of ratings) {
      await db.runAsync(
        `UPDATE simkl_items SET simkl_rating = ?, simkl_votes = ?, imdb_rating = ?, imdb_votes = ?,
           mal_rating = ?, rank = ? WHERE simkl_id = ?;`,
        [r.simklRating, r.simklVotes, r.imdbRating, r.imdbVotes, r.malRating, r.rank, id]
      );
    }
  });
}

/** Every recorded watch time, for the Stats heatmap. */
export async function allWatchTimes(): Promise<(string | null)[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ t: string | null }>(
    `SELECT watched_at AS t FROM simkl_episodes
     UNION ALL SELECT last_watched_at AS t FROM simkl_items WHERE type = 'movie' AND last_watched_at IS NOT NULL;`
  );
  return rows.map((r) => r.t);
}

/** Small local edits after a write succeeded (status, rating, counters). */
export async function patchSimklItem(id: number, patch: Partial<SimklItem>): Promise<void> {
  const map: Record<string, keyof SimklItem> = {
    status: 'status',
    rating: 'rating',
    rated_at: 'ratedAt',
    last_watched_at: 'lastWatchedAt',
    watched_episodes: 'watchedEpisodes',
    next_to_watch: 'nextToWatch',
  };
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [col, key] of Object.entries(map)) {
    if (key in patch) {
      sets.push(`${col} = ?`);
      values.push((patch[key] as string | number | null | undefined) ?? null);
    }
  }
  if (!sets.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE simkl_items SET ${sets.join(', ')} WHERE simkl_id = ?;`, [...values, id]);
}

export async function deleteSimklItems(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) await db.runAsync('DELETE FROM simkl_items WHERE simkl_id = ?;', [id]);
  });
}

export async function clearSimklLibrary(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM simkl_episodes; DELETE FROM simkl_items; DELETE FROM simkl_cache;');
}

/* ----------------------------------------------------------------- episodes */

/** Replaces what we know about one title's watched episodes. */
export async function setWatchedEpisodes(id: number, episodes: WatchedEpisode[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM simkl_episodes WHERE simkl_id = ?;', [id]);
    for (const e of episodes) {
      await db.runAsync(
        'INSERT OR IGNORE INTO simkl_episodes (simkl_id, season, episode, watched_at) VALUES (?,?,?,?);',
        [id, e.season, e.episode, e.watchedAt]
      );
    }
  });
}

export async function markEpisodesLocal(id: number, episodes: { season: number; episode: number }[], watched: boolean): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const e of episodes) {
      if (watched) {
        await db.runAsync(
          'INSERT OR IGNORE INTO simkl_episodes (simkl_id, season, episode, watched_at) VALUES (?,?,?,?);',
          [id, e.season, e.episode, now]
        );
      } else {
        await db.runAsync('DELETE FROM simkl_episodes WHERE simkl_id = ? AND season = ? AND episode = ?;', [id, e.season, e.episode]);
      }
    }
  });
}

export async function watchedEpisodes(id: number): Promise<WatchedEpisode[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ season: number; episode: number; watched_at: string | null }>(
    'SELECT season, episode, watched_at FROM simkl_episodes WHERE simkl_id = ? ORDER BY season, episode;',
    [id]
  );
  return rows.map((r) => ({ season: r.season, episode: r.episode, watchedAt: r.watched_at }));
}

/* -------------------------------------------------------------------- cache */

export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string; fetched_at: number }>(
    'SELECT json, fetched_at FROM simkl_cache WHERE key = ?;',
    [key]
  );
  if (!row || Date.now() - row.fetched_at > maxAgeMs) return null;
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return null;
  }
}

export async function cachePut(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO simkl_cache (key, json, fetched_at) VALUES (?,?,?);', [
    key,
    JSON.stringify(value),
    Date.now(),
  ]);
}
