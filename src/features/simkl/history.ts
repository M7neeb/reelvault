/**
 * Schema v6 storage (native half): exact ratings, rewatch sessions and plays,
 * and the genre / network / country info the stats use.
 */

import { getDb } from '@/db';

import type { Meta, Play, Session } from './insights';

/* ------------------------------------------------------------ exact ratings */

export async function exactRatings(): Promise<Map<number, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ simkl_id: number; rating: number }>('SELECT simkl_id, rating FROM simkl_my_ratings;');
  return new Map(rows.map((r) => [r.simkl_id, r.rating]));
}

/** null (or a whole number, which Simkl already holds) removes the exact one. */
export async function setExactRating(id: number, rating: number | null): Promise<void> {
  const db = await getDb();
  if (rating === null || Number.isInteger(rating)) {
    await db.runAsync('DELETE FROM simkl_my_ratings WHERE simkl_id = ?;', [id]);
  } else {
    await db.runAsync('INSERT OR REPLACE INTO simkl_my_ratings (simkl_id, rating, rated_at) VALUES (?,?,?);', [
      id,
      rating,
      new Date().toISOString(),
    ]);
  }
}

/* ---------------------------------------------------------------- sessions */

type SessionRow = { id: number; simkl_id: number; number: number; started_at: string; finished_at: string | null; remote_id: number | null };
const toSession = (r: SessionRow): Session => ({
  id: r.id,
  simklId: r.simkl_id,
  number: r.number,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  remoteId: r.remote_id,
});

export async function sessionsFor(id: number): Promise<Session[]> {
  const db = await getDb();
  return (await db.getAllAsync<SessionRow>('SELECT * FROM simkl_sessions WHERE simkl_id = ? ORDER BY number;', [id])).map(toSession);
}

export async function createSession(id: number, number: number): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('INSERT INTO simkl_sessions (simkl_id, number, started_at) VALUES (?,?,?);', [
    id,
    number,
    new Date().toISOString(),
  ]);
  return r.lastInsertRowId;
}

export async function finishSession(sessionId: number, finished: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE simkl_sessions SET finished_at = ? WHERE id = ?;', [finished ? new Date().toISOString() : null, sessionId]);
}

export async function deleteSession(sessionId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM simkl_plays WHERE session_id = ?;', [sessionId]);
  await db.runAsync('DELETE FROM simkl_sessions WHERE id = ?;', [sessionId]);
}

export async function setSessionRemote(sessionId: number, remoteId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE simkl_sessions SET remote_id = ? WHERE id = ?;', [remoteId, sessionId]);
}

/* ------------------------------------------------------------------- plays */

type PlayRow = { id: number; simkl_id: number; season: number; episode: number; watched_at: string; session_id: number | null };
const toPlay = (r: PlayRow): Play => ({
  id: r.id,
  simklId: r.simkl_id,
  season: r.season,
  episode: r.episode,
  watchedAt: r.watched_at,
  sessionId: r.session_id,
});

export async function addPlays(
  id: number,
  episodes: { season: number; episode: number }[],
  sessionId: number | null,
  onSimkl: boolean
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const e of episodes) {
      await db.runAsync(
        'INSERT INTO simkl_plays (simkl_id, season, episode, watched_at, session_id, on_simkl) VALUES (?,?,?,?,?,?);',
        [id, e.season, e.episode, now, sessionId, onSimkl ? 1 : 0]
      );
    }
  });
}

/** Undo: the latest play of these episodes in this session (or outside any session). */
export async function removeLatestPlays(id: number, episodes: { season: number; episode: number }[], sessionId: number | null): Promise<void> {
  const db = await getDb();
  for (const e of episodes) {
    await db.runAsync(
      `DELETE FROM simkl_plays WHERE id = (
         SELECT id FROM simkl_plays WHERE simkl_id = ? AND season = ? AND episode = ?
           AND (session_id IS ? OR session_id = ?) ORDER BY watched_at DESC LIMIT 1);`,
      [id, e.season, e.episode, sessionId, sessionId]
    );
  }
}

export async function playsFor(id: number): Promise<Play[]> {
  const db = await getDb();
  return (await db.getAllAsync<PlayRow>('SELECT * FROM simkl_plays WHERE simkl_id = ? ORDER BY watched_at;', [id])).map(toPlay);
}

export async function allPlays(): Promise<{ simklId: number; watchedAt: string }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ simkl_id: number; watched_at: string }>('SELECT simkl_id, watched_at FROM simkl_plays;');
  return rows.map((r) => ({ simklId: r.simkl_id, watchedAt: r.watched_at }));
}

/** Watched episodes from Simkl's history, with their times. */
export async function allHistory(): Promise<{ simklId: number; watchedAt: string | null }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ simkl_id: number; watched_at: string | null }>('SELECT simkl_id, watched_at FROM simkl_episodes;');
  return rows.map((r) => ({ simklId: r.simkl_id, watchedAt: r.watched_at }));
}

/* -------------------------------------------------------------------- meta */

export async function metaMap(): Promise<Map<number, Meta>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    simkl_id: number;
    genres: string | null;
    network: string | null;
    country: string | null;
    language: string | null;
    runtime: number | null;
    fanart: string | null;
  }>('SELECT * FROM simkl_meta;');
  const out = new Map<number, Meta>();
  for (const r of rows) {
    let genres: string[] = [];
    try {
      genres = r.genres ? (JSON.parse(r.genres) as string[]) : [];
    } catch {
      genres = [];
    }
    out.set(r.simkl_id, { genres, network: r.network, country: r.country, language: r.language, runtime: r.runtime });
  }
  return out;
}

export async function saveMeta(id: number, m: Meta): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO simkl_meta (simkl_id, genres, network, country, language, runtime, fanart, fetched_at) VALUES (?,?,?,?,?,?,?,?);',
    [id, JSON.stringify(m.genres), m.network, m.country, m.language, m.runtime, m.fanart ?? null, Date.now()]
  );
}
