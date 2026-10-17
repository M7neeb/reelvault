/**
 * Writes to Simkl, each followed by the same change in the local copy, so the
 * screen is right straight away and the next sync has nothing to undo.
 * Catalog reads (details, episodes, search, trending, calendar) are cached.
 */

import { simklRequest } from './api';
import {
  parseCatalog,
  parseEpisodes,
  parseRelated,
  trailerUrl,
  type CatalogEpisode,
  type CatalogTitle,
  type SimklItem,
  type SimklStatus,
  type SimklType,
} from './logic';
import { cacheGet, cachePut, deleteSimklItems, markEpisodesLocal, patchSimklItem, upsertSimklItems } from './repo';

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

/** null clears the rating. */
export async function setRating(item: Pick<SimklItem, 'simklId' | 'type'>, rating: number | null): Promise<void> {
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
  await patchSimklItem(item.simklId, { rating, ratedAt: rating === null ? null : new Date().toISOString() });
}

/** Episodes as Simkl wants them: seasons for shows, flat numbers for anime. */
function episodeBody(item: Pick<SimklItem, 'simklId' | 'type'>, episodes: { season: number; episode: number }[], watchedAt?: string) {
  if (item.type === 'anime') {
    return { anime: [{ ids: { simkl: item.simklId }, episodes: episodes.map((e) => ({ number: e.episode, watched_at: watchedAt })) }] };
  }
  const seasons = new Map<number, number[]>();
  for (const e of episodes) seasons.set(e.season, [...(seasons.get(e.season) ?? []), e.episode]);
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
  // next_to_watch is Simkl's to compute; the next sync brings it. Clear it when it was just watched.
  await patchSimklItem(item.simklId, {
    watchedEpisodes: count,
    lastWatchedAt: watched ? now : item.lastWatchedAt,
    ...(watched ? { nextToWatch: null } : {}),
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
  related: CatalogTitle[];
};

const detailPath = (type: SimklType) => (type === 'movie' ? 'movies' : type === 'anime' ? 'anime' : 'tv');

/** The detail record, cached for a day (catalog calls carry no user token). */
export function loadDetail(type: SimklType, id: number): Promise<SimklDetail> {
  return cached(`detail2:${type}:${id}`, 24 * HOUR, async () => {
    const d = await simklRequest<any>(`/${detailPath(type)}/${id}`);
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
      related: [...parseRelated(d?.users_recommendations, type), ...parseRelated(d?.similar, type)]
        .filter((r, i, all) => all.findIndex((x) => x.simklId === r.simklId) === i)
        .slice(0, 15),
    };
  });
}

export function loadEpisodes(type: SimklType, id: number): Promise<CatalogEpisode[]> {
  if (type === 'movie') return Promise.resolve([]);
  return cached(`episodes:${type}:${id}`, 12 * HOUR, async () =>
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
