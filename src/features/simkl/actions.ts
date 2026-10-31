/**
 * Writes to Simkl, each followed by the same change in the local copy, so the
 * screen is right straight away and the next sync has nothing to undo.
 * Catalog reads (details, episodes, search, trending, calendar) are cached.
 */

import * as SecureStore from 'expo-secure-store';

import { simklRequest } from './api';
import { combineRatings, OMDB, omdbKeyProblem, omdbSeasons, parseOmdbSeason, parseTvmazeEpisodes, TVMAZE, type EpisodeRatings, type SourceEpisode } from './episodeRatings';
import { franchiseQuery, parseFranchises, simklTypeOf, WIKIDATA_SPARQL, type Franchise, type FranchiseEntry, type FranchiseItem } from './franchise';
import {
  episodeCode,
  nextUnwatched,
  parseCatalog,
  watchedKey,
  parseEpisodes,
  parsePlayback,
  type PausedItem,
  parseRelated,
  trailerUrl,
  type CatalogEpisode,
  type CatalogTitle,
  type SimklItem,
  type SimklStatus,
  type SimklType,
} from './logic';
import { cacheGet, cachePut, deleteSimklItems, listSimklItems, markEpisodesLocal, patchSimklItem, upsertSimklItems, watchedEpisodes as watchedEpisodesOf } from './repo';
import {
  addPlays,
  createSession,
  deleteSession,
  finishSession,
  metaMap,
  removeLatestPlays,
  saveMeta,
  sessionsFor,
  setExactRating,
  setSessionRemote,
} from './history';
import { nextSessionNumber, normaliseExact, toSimklRating, type Session } from './insights';
import { getSetting, setSetting } from '@/features/vault/library';

/** Adds to a list in a map in place (copying the list each time gets slow with thousands of items). */
function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

const HOUR = 3600 * 1000;

/** The request body groups by type; anime goes in `anime`, shows in `shows`. */
const bucket = (type: SimklType) => (type === 'movie' ? 'movies' : type === 'anime' ? 'anime' : 'shows');

export async function setStatus(item: Pick<SimklItem, 'simklId' | 'type'>, status: SimklStatus): Promise<void> {
  await simklRequest('/sync/add-to-list', {
    method: 'POST',
    auth: true,
    body: { [bucket(item.type)]: [{ to: status, ids: { simkl: item.simklId } }] },
  });
  await patchSimklItem(item.simklId, { status });
}

/**
 * null clears the rating. Exact ratings (9.7) are kept here; Simkl only takes
 * whole numbers, so it gets the rounded one.
 */
export async function setRating(item: Pick<SimklItem, 'simklId' | 'type'>, value: number | null): Promise<void> {
  const exact = value === null ? null : normaliseExact(value);
  const rating = exact === null ? null : toSimklRating(exact);
  if (rating === null) {
    await simklRequest('/sync/ratings/remove', {
      method: 'POST',
      auth: true,
      body: { [bucket(item.type)]: [{ ids: { simkl: item.simklId } }] },
    });
  } else {
    await simklRequest('/sync/ratings', {
      method: 'POST',
      auth: true,
      body: { [bucket(item.type)]: [{ rating, ids: { simkl: item.simklId } }] },
    });
  }
  await setExactRating(item.simklId, exact);
  await patchSimklItem(item.simklId, { rating, ratedAt: rating === null ? null : new Date().toISOString() });
}

/** Episodes as Simkl wants them: seasons for shows, flat numbers for anime. */
function episodeBody(item: Pick<SimklItem, 'simklId' | 'type'>, episodes: { season: number; episode: number }[], watchedAt?: string) {
  if (item.type === 'anime') {
    return { anime: [{ ids: { simkl: item.simklId }, episodes: episodes.map((e) => ({ number: e.episode, watched_at: watchedAt })) }] };
  }
  const seasons = new Map<number, number[]>();
  for (const e of episodes) pushTo(seasons, e.season, e.episode);
  return {
    shows: [
      {
        ids: { simkl: item.simklId },
        seasons: [...seasons.entries()].map(([number, eps]) => ({
          number,
          episodes: eps.map((n) => ({ number: n, watched_at: watchedAt })),
        })),
      },
    ],
  };
}

export async function setEpisodesWatched(
  item: SimklItem,
  episodes: { season: number; episode: number }[],
  watched: boolean
): Promise<void> {
  if (!episodes.length) return;
  const now = new Date().toISOString();
  await simklRequest(watched ? '/sync/history' : '/sync/history/remove', {
    method: 'POST',
    auth: true,
    body: episodeBody(item, episodes, watched ? now : undefined),
  });
  await markEpisodesLocal(item.simklId, episodes, watched);
  const count = Math.max(0, item.watchedEpisodes + (watched ? episodes.length : -episodes.length));
  // next_to_watch is Simkl's to compute and the next sync brings it; until then, work it out
  // from the (cached) episode list so "up next" never goes blank.
  let nextToWatch: string | null | undefined = watched ? null : undefined;
  try {
    const [list, seen] = await Promise.all([loadEpisodes(item.type, item.simklId), watchedEpisodesOf(item.simklId)]);
    const next = nextUnwatched(list, new Set(seen.map((w) => watchedKey(w.season, w.episode))));
    if (list.length) nextToWatch = next ? episodeCode(item.type, next.season, next.episode) : null;
  } catch {
    // No episode list right now: the next sync fills it in.
  }
  await patchSimklItem(item.simklId, {
    watchedEpisodes: count,
    lastWatchedAt: watched ? now : item.lastWatchedAt,
    ...(nextToWatch !== undefined ? { nextToWatch } : {}),
  });
}

/** A movie watched now (also files it under Completed). */
export async function markMovieWatched(item: Pick<SimklItem, 'simklId' | 'type'>): Promise<void> {
  const now = new Date().toISOString();
  await simklRequest('/sync/history', { method: 'POST', auth: true, body: { movies: [{ ids: { simkl: item.simklId }, watched_at: now }] } });
  await patchSimklItem(item.simklId, { status: 'completed', lastWatchedAt: now });
}

/** From search / trending into the library. */
export async function addToLibrary(title: CatalogTitle, status: SimklStatus): Promise<void> {
  await simklRequest('/sync/add-to-list', {
    method: 'POST',
    auth: true,
    body: { [bucket(title.type)]: [{ to: status, ids: { simkl: title.simklId } }] },
  });
  await upsertSimklItems([
    {
      simklId: title.simklId,
      type: title.type,
      title: title.title,
      year: title.year,
      poster: title.poster,
      slug: title.slug,
      runtime: null,
      status,
      rating: null,
      ratedAt: null,
      addedAt: new Date().toISOString(),
      lastWatchedAt: null,
      watchedEpisodes: 0,
      totalEpisodes: 0,
      notAiredEpisodes: 0,
      nextToWatch: null,
      animeType: null,
      memo: null,
      nextTitle: null,
      nextDate: null,
      simklRating: title.simklRating ?? null,
      simklVotes: null,
      imdbRating: title.imdbRating ?? null,
      imdbVotes: null,
      malRating: null,
      rank: title.rank ?? null,
    },
  ]);
}

/** Out of every list, with its watch history (Simkl has no plain "remove from list"). */
export async function removeFromLibrary(item: Pick<SimklItem, 'simklId' | 'type'>): Promise<void> {
  await simklRequest('/sync/history/remove', {
    method: 'POST',
    auth: true,
    body: { [bucket(item.type)]: [{ ids: { simkl: item.simklId } }] },
  });
  await deleteSimklItems([item.simklId]);
}

/* ---------------------------------------------------------------- rewatches */

const PLAN_KEY = 'simkl.plan';
const REWATCH_SYNC_KEY = 'simkl.rewatchesOnSimkl';

export type SimklPlan = 'free' | 'pro' | 'vip' | 'unknown';

/** The account plan, read from /users/settings once and cached (Simkl's advice). */
export async function cachedPlan(): Promise<SimklPlan> {
  const v = await getSetting(PLAN_KEY);
  return v === 'free' || v === 'pro' || v === 'vip' ? v : 'unknown';
}

export async function refreshPlan(): Promise<SimklPlan> {
  const s = await simklRequest<any>('/users/settings', { auth: true });
  const type = s?.account?.type;
  const plan: SimklPlan = type === 'free' || type === 'pro' || type === 'vip' ? type : 'unknown';
  await setSetting(PLAN_KEY, plan);
  return plan;
}

/** "Also save rewatches on Simkl" - off by default, PRO / VIP only (Simkl's rules). */
export async function rewatchesOnSimkl(): Promise<boolean> {
  return (await getSetting(REWATCH_SYNC_KEY)) === '1' && ['pro', 'vip'].includes(await cachedPlan());
}

export async function setRewatchesOnSimkl(on: boolean): Promise<{ ok: boolean; plan: SimklPlan }> {
  if (!on) {
    await setSetting(REWATCH_SYNC_KEY, '0');
    return { ok: true, plan: await cachedPlan() };
  }
  const plan = await refreshPlan().catch(() => cachedPlan());
  if (plan !== 'pro' && plan !== 'vip') return { ok: false, plan };
  await setSetting(REWATCH_SYNC_KEY, '1');
  return { ok: true, plan };
}

/** Finds `rewatch_id` / `rewatch_status` anywhere in a history response. */
function rewatchResult(json: any): { id: number | null; status: string | null } {
  let id: number | null = null;
  let status: string | null = null;
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.rewatch_id === 'number' && id === null) id = v.rewatch_id;
    if (typeof v.rewatch_status === 'string' && status === null) status = v.rewatch_status;
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(json);
  return { id, status };
}

/** The Simkl half of a rewatch: only with the switch on, pinned to the session's rewatch_id. */
async function sendRewatch(item: Pick<SimklItem, 'simklId' | 'type'>, body: any, session: Session | null): Promise<boolean> {
  if (!(await rewatchesOnSimkl())) return false;
  try {
    const key = bucket(item.type);
    if (session?.remoteId && body[key]?.[0]) body[key][0].rewatch_id = session.remoteId;
    const res = await simklRequest('/sync/history', { method: 'POST', auth: true, query: { allow_rewatch: 'yes' }, body });
    const r = rewatchResult(res);
    if (session && r.id && !session.remoteId) await setSessionRemote(session.id, r.id);
    // rewatch_id alone is not success (Simkl's docs): the status says if it was kept.
    return r.status === 'active' || r.status === 'completed';
  } catch (e) {
    console.log(`[SIMKL] rewatch not saved on Simkl: ${String(e)}`);
    return false;
  }
}

/** Start rewatching a whole show / anime: "Rewatch #2". */
export async function startRewatch(item: SimklItem): Promise<Session> {
  const sessions = await sessionsFor(item.simklId);
  const open = sessions.find((s) => s.finishedAt === null);
  if (open) await finishSession(open.id, true);
  const number = nextSessionNumber(sessions);
  const id = await createSession(item.simklId, number);
  const session = (await sessionsFor(item.simklId)).find((s) => s.id === id)!;
  await sendRewatch(item, { [bucket(item.type)]: [{ ids: { simkl: item.simklId }, is_rewatch: true, rewatch_status: 'active' }] }, session);
  return (await sessionsFor(item.simklId)).find((s) => s.id === id)!;
}

export async function endRewatch(item: SimklItem, session: Session, finished: boolean): Promise<void> {
  await finishSession(session.id, finished);
  if (session.remoteId) {
    await sendRewatch(
      item,
      { [bucket(item.type)]: [{ ids: { simkl: item.simklId }, rewatch_status: finished ? 'closed' : 'active' }] },
      session
    );
  }
}

/** Delete a rewatch from ReelVault (Simkl keeps its own copy, if it had one). */
export const deleteRewatch = (session: Session) => deleteSession(session.id);

/**
 * Watched again: episodes inside a session, or one-off rewatches of single
 * episodes / a movie (season 0, episode 0) outside one.
 */
export async function logRewatch(
  item: SimklItem,
  episodes: { season: number; episode: number }[],
  session: Session | null,
  watched = true
): Promise<void> {
  if (!watched) {
    await removeLatestPlays(item.simklId, episodes, session?.id ?? null);
    return;
  }
  const now = new Date().toISOString();
  const body =
    item.type === 'movie'
      ? { movies: [{ ids: { simkl: item.simklId }, watched_at: now }] }
      : episodeBody(item, episodes, now);
  const onSimkl = await sendRewatch(item, body, session);
  await addPlays(item.simklId, item.type === 'movie' ? [{ season: 0, episode: 0 }] : episodes, session?.id ?? null, onSimkl);
  await patchSimklItem(item.simklId, { lastWatchedAt: now });
}

/* ------------------------------------------------------------------ catalog */

async function cached<T>(key: string, maxAgeMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key, maxAgeMs);
  if (hit !== null) return hit;
  const value = await load();
  await cachePut(key, value);
  return value;
}

export type SimklDetail = {
  overview: string | null;
  genres: string[];
  network: string | null;
  certification: string | null;
  runtime: number | null;
  status: string | null;
  fanart: string | null;
  poster: string | null;
  year: number | null;
  totalEpisodes: number | null;
  simklRating: number | null;
  simklVotes: number | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  malRating: number | null;
  malVotes: number | null;
  rank: number | null;
  firstAired: string | null;
  /** "2015-2019" for shows, else null. */
  years: string | null;
  language: string | null;
  country: string | null;
  trailer: string | null;
  imdb: string | null;
  related: CatalogTitle[];
};

const detailPath = (type: SimklType) => (type === 'movie' ? 'movies' : type === 'anime' ? 'anime' : 'tv');

/** The detail record, cached for a day (catalog calls carry no user token). */
export function loadDetail(type: SimklType, id: number): Promise<SimklDetail> {
  return cached(`detail4:${type}:${id}`, 24 * HOUR, async () => {
    const d = await simklRequest<any>(`/${detailPath(type)}/${id}`);
    await saveMeta(id, {
      genres: Array.isArray(d?.genres) ? d.genres : [],
      network: typeof d?.network === 'string' ? d.network : null,
      country: typeof d?.country === 'string' ? d.country.toUpperCase() : null,
      language: typeof d?.original_language === 'string' ? d.original_language.toUpperCase() : null,
      runtime: typeof d?.runtime === 'number' ? d.runtime : null,
      fanart: typeof d?.fanart === 'string' ? d.fanart : null,
    }).catch(() => undefined);
    return {
      overview: d?.overview ?? null,
      genres: Array.isArray(d?.genres) ? d.genres : [],
      network: d?.network ?? null,
      certification: d?.certification ?? null,
      runtime: typeof d?.runtime === 'number' ? d.runtime : null,
      status: d?.status ?? null,
      fanart: d?.fanart ?? null,
      poster: d?.poster ?? null,
      year: typeof d?.year === 'number' ? d.year : null,
      totalEpisodes: typeof d?.total_episodes === 'number' ? d.total_episodes : null,
      simklRating: d?.ratings?.simkl?.rating ?? null,
      simklVotes: d?.ratings?.simkl?.votes ?? null,
      imdbRating: d?.ratings?.imdb?.rating ?? null,
      imdbVotes: d?.ratings?.imdb?.votes ?? null,
      malRating: d?.ratings?.mal?.rating ?? null,
      malVotes: d?.ratings?.mal?.votes ?? null,
      rank: typeof d?.rank === 'number' ? d.rank : null,
      firstAired: d?.first_aired ?? d?.released ?? null,
      years: typeof d?.year_start_end === 'string' ? d.year_start_end : null,
      language: typeof d?.original_language === 'string' ? d.original_language.toUpperCase() : null,
      country: typeof d?.country === 'string' ? d.country.toUpperCase() : null,
      trailer: trailerUrl(d?.trailers),
      imdb: typeof d?.ids?.imdb === 'string' ? d.ids.imdb : null,
      related: [...parseRelated(d?.users_recommendations, type), ...parseRelated(d?.similar, type)]
        .filter((r, i, all) => all.findIndex((x) => x.simklId === r.simklId) === i)
        .slice(0, 15),
    };
  });
}

export function loadEpisodes(type: SimklType, id: number): Promise<CatalogEpisode[]> {
  if (type === 'movie') return Promise.resolve([]);
  // "episodes2": the rows now carry finale markers and runtimes.
  return cached(`episodes2:${type}:${id}`, 12 * HOUR, async () =>
    parseEpisodes(await simklRequest(`/${type === 'anime' ? 'anime' : 'tv'}/episodes/${id}`), type)
  );
}

export function searchSimkl(type: SimklType, q: string): Promise<CatalogTitle[]> {
  const path = type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : 'tv';
  return cached(`search:${path}:${q.trim().toLowerCase()}`, 6 * HOUR, async () =>
    // New (AUTH V2) client ids must send the user token on search ("user_token_required").
    parseCatalog(await simklRequest(`/search/${path}`, { auth: true, query: { q: q.trim(), limit: 30 } }), type)
  );
}

export type Timeframe = 'today' | 'week' | 'month';

/** The CDN files (no quota). Titles must say "Simkl" on screen (API rule 6). */
export function loadTrending(type: SimklType, timeframe: Timeframe): Promise<CatalogTitle[]> {
  const path = type === 'movie' ? 'movies' : type === 'anime' ? 'anime' : 'tv';
  return cached(`trending:${path}:${timeframe}`, 6 * HOUR, async () =>
    parseCatalog(
      await simklRequest(`https://data.simkl.in/discover/trending/${path}/${timeframe}_100.json`, { absolute: true }),
      type
    )
  );
}

export function loadCalendar(type: SimklType): Promise<CatalogTitle[]> {
  const file = type === 'movie' ? 'movie_release' : type === 'anime' ? 'anime' : 'tv';
  return cached(`calendar:${file}`, 6 * HOUR, async () =>
    parseCatalog(await simklRequest(`https://data.simkl.in/calendar/v2/${file}.json`, { absolute: true }), type)
  );
}

/**
 * Stats need genres and networks, which only detail pages have. Fetch the
 * missing ones one after another (detail pages are cached by Simkl's CDN), only
 * when you ask for it on the Stats screen.
 */
export async function fillMissingMeta(onProgress: (done: number, total: number) => void, limit = 400): Promise<number> {
  const have = await metaMap();
  const missing = (await listSimklItems()).filter((i) => !have.has(i.simklId)).slice(0, limit);
  let done = 0;
  for (const i of missing) {
    try {
      await loadDetail(i.type, i.simklId);
    } catch (e) {
      console.log(`[SIMKL] detail ${i.simklId} failed: ${String(e)}`);
    }
    done++;
    onProgress(done, missing.length);
  }
  return done;
}

/**
 * The Up Next cards want each title's wide picture, which only its detail page
 * has. After a sync, fetch it for what you are watching (a few at a time).
 */
/** When each title's details were last asked for (this session): a title without any is not asked again for a day. */
const artTried = new Map<string, number>();

export async function prefetchArt(limit = 24): Promise<number> {
  const have = await metaMap();
  const want = (await listSimklItems())
    .filter((i) => !have.has(i.simklId) && (i.status === 'watching' || (i.type === 'movie' && i.status === 'plantowatch')))
    .sort((a, b) => Date.parse(b.lastWatchedAt ?? b.addedAt ?? '') - Date.parse(a.lastWatchedAt ?? a.addedAt ?? ''))
    .slice(0, limit);
  // Count only the ones that now have their details (titles Simkl has none for are tried once a day, not every time).
  let saved = 0;
  for (const i of want) {
    const k = `simkl.artTried.${i.simklId}`;
    if (artTried.get(k) && Date.now() - artTried.get(k)! < 86_400_000) continue;
    artTried.set(k, Date.now());
    if (await loadDetail(i.type, i.simklId).then(() => true).catch(() => false)) saved++;
  }
  return saved;
}

/* ------------------------------------------------------- continue watching */

/** Movies and episodes you stopped halfway (Simkl keeps one per title). */
export async function loadPlayback(): Promise<PausedItem[]> {
  return parsePlayback(await simklRequest('/sync/playback', { auth: true }));
}

/** Forget a paused spot. */
export async function deletePlayback(id: number): Promise<void> {
  await simklRequest(`/sync/playback/${id}`, { method: 'DELETE', auth: true });
}

/* ---------------------------------------------------------------- scrobble */

export type ScrobbleTarget = { simklId: number; type: SimklType; season: number | null; episode: number | null };

/**
 * Tell Simkl you are watching one of your own videos (it shows as "watching
 * now" on your profile). `stop` at 80 % or more adds it to your history;
 * below that Simkl keeps it as paused. Returns 'watched' when it was logged.
 */
export async function scrobble(
  t: ScrobbleTarget,
  action: 'start' | 'pause' | 'stop',
  progress: number
): Promise<'watched' | 'paused' | 'playing' | 'already'> {
  const media =
    t.type === 'movie'
      ? { movie: { ids: { simkl: t.simklId } } }
      : {
          [t.type === 'anime' ? 'anime' : 'show']: { ids: { simkl: t.simklId } },
          episode: { season: t.season ?? 1, number: t.episode ?? 1 },
        };
  try {
    const r = await simklRequest<any>(`/scrobble/${action}`, {
      method: 'POST',
      auth: true,
      body: { ...media, progress: Math.max(0, Math.min(100, Math.round(progress))) },
    });
    if (action !== 'stop') return action === 'start' ? 'playing' : 'paused';
    return r?.action === 'scrobble' || progress >= 80 ? 'watched' : 'paused';
  } catch (e: any) {
    // 409: the same thing was logged in the last hour - not an error for the viewer.
    if (e?.status === 409) return 'already';
    throw e;
  }
}


/* ---------------------------------------------------------------- franchise */

/** The series this title belongs to (Wikidata), biggest first. Cached for a week. */
export async function loadFranchises(type: SimklType, id: number): Promise<Franchise[]> {
  const d = await loadDetail(type, id);
  if (!d.imdb) return [];
  const imdb = d.imdb;
  return cached(`franchise:${imdb}`, 7 * 24 * HOUR, async () => {
    const res = await fetch(`${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(franchiseQuery(imdb))}`, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'ReelVault/1.4 (personal iPhone app)' },
    });
    if (!res.ok) throw new Error(`Wikidata ${res.status}`);
    return parseFranchises(await res.json()).slice(0, 6);
  });
}

/** Each entry's Simkl title (by IMDb id), one lookup at a time, cached for a month. */
export async function matchFranchise(entries: FranchiseEntry[]): Promise<FranchiseItem[]> {
  const out: FranchiseItem[] = [];
  for (const e of entries) {
    try {
      const hit = await cached(`simklid:${e.imdb}`, 30 * 24 * HOUR, async () => {
        const r = await simklRequest<any[]>('/search/id', { query: { imdb: e.imdb } });
        const first = Array.isArray(r) ? r[0] : null;
        return first
          ? { simklId: Number(first.ids?.simkl) || null, type: simklTypeOf(first.type), poster: first.poster ?? null, year: first.year ?? null }
          : null;
      });
      out.push({ ...e, simklId: hit?.simklId ?? null, type: hit?.type ?? null, poster: hit?.poster ?? null, year: hit?.year ?? null });
    } catch {
      out.push({ ...e, simklId: null, type: null, poster: null, year: null });
    }
  }
  return out;
}

/* ---------------------------------------------------------- episode ratings */

const OMDB_KEY = 'omdb_api_key';
const SECURE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

async function omdbKey(): Promise<string | null> {
  return (await SecureStore.getItemAsync(OMDB_KEY, SECURE_OPTS).catch(() => null)) || null;
}

/** Whether an OMDb key is saved (the key itself never leaves this file). */
export async function hasOmdbKey(): Promise<boolean> {
  return (await omdbKey()) !== null;
}

/** Checks the key with OMDb, then saves it. '' removes it. Returns the problem, or null when saved. */
export async function saveOmdbKey(raw: string): Promise<string | null> {
  const key = raw.trim();
  if (!key) {
    await SecureStore.deleteItemAsync(OMDB_KEY, SECURE_OPTS).catch(() => undefined);
    return null;
  }
  if (!/^[A-Za-z0-9]{6,16}$/.test(key)) return 'That does not look like an OMDb key (8 letters and numbers, from the email OMDb sent).';
  const res = await fetch(`${OMDB}?apikey=${encodeURIComponent(key)}&i=tt0903747`).catch(() => null);
  if (!res) return 'Could not reach OMDb. Check the connection and try again.';
  const json = await res.json().catch(() => null);
  const problem = omdbKeyProblem(json);
  if (problem) return /activated/i.test(problem) ? 'This key is not activated yet: open the link in the email from OMDb first.' : `OMDb says: ${problem}`;
  if (json?.Response !== 'True') return 'OMDb did not accept the key. Try again in a minute.';
  await SecureStore.setItemAsync(OMDB_KEY, key, SECURE_OPTS);
  return null;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Every season from OMDb, four at a time. */
async function omdbEpisodes(imdb: string, key: string): Promise<SourceEpisode[]> {
  const base = `${OMDB}?apikey=${encodeURIComponent(key)}&i=${imdb}`;
  const head = await getJson(base);
  const problem = omdbKeyProblem(head);
  if (problem) throw new Error(problem);
  // "Request limit reached!" (1,000 a day on the free key): try again later, keep nothing.
  if (head?.Response !== 'True' && /limit/i.test(String(head?.Error ?? ''))) throw new Error(String(head.Error));
  const seasons = Math.min(omdbSeasons(head), 60);
  const out: SourceEpisode[] = [];
  for (let s = 1; s <= seasons; s += 4) {
    const batch = Array.from({ length: Math.min(4, seasons - s + 1) }, (_, i) => s + i);
    const got = await Promise.all(batch.map(async (n) => parseOmdbSeason(await getJson(`${base}&Season=${n}`), n)));
    out.push(...got.flat());
  }
  return out;
}

async function tvmazeEpisodes(imdb: string): Promise<SourceEpisode[]> {
  const show = await getJson(`${TVMAZE}/lookup/shows?imdb=${imdb}`);
  if (typeof show?.id !== 'number') return [];
  return parseTvmazeEpisodes(await getJson(`${TVMAZE}/shows/${show.id}/episodes`));
}

/**
 * Ratings for a show's episodes: IMDb (with your OMDb key), TVmaze for the
 * rest. Kept for three days; a failed lookup is not kept, so it is tried again.
 */
export async function loadEpisodeRatings(type: SimklType, id: number, episodes: CatalogEpisode[]): Promise<EpisodeRatings> {
  if (type === 'movie' || !episodes.length) return {};
  const imdb = (await loadDetail(type, id)).imdb;
  if (!imdb || !/^tt\d+$/.test(imdb)) return {};
  const key = await omdbKey();
  const found = await cached(`epratings1:${type}:${id}:${key ? 'imdb' : 'tvmaze'}`, 72 * HOUR, async () => {
    const [fromImdb, fromTvmaze] = await Promise.allSettled([key ? omdbEpisodes(imdb, key) : Promise.resolve([]), tvmazeEpisodes(imdb)]);
    if (fromImdb.status === 'rejected' && fromTvmaze.status === 'rejected') throw fromImdb.reason;
    return {
      imdb: fromImdb.status === 'fulfilled' ? fromImdb.value : [],
      tvmaze: fromTvmaze.status === 'fulfilled' ? fromTvmaze.value : [],
    };
  });
  return combineRatings(episodes, type, found.imdb, found.tvmaze);
}
