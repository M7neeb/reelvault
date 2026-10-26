/**
 * Ratings for single episodes, shown on the episode pictures. Simkl only has
 * a rating for the whole show, so they come from elsewhere:
 * - IMDb, through OMDb (needs your own free key from omdbapi.com);
 * - TVmaze (no key), for episodes IMDb has no rating for or when there is no key.
 * Pure (tested in tests/episode-ratings.test.mjs); the fetching is in actions.ts.
 */

import { watchedKey, type CatalogEpisode, type SimklType } from './logic.ts';

export type RatingSource = 'imdb' | 'tvmaze';
/** One episode as a source lists it (rating null = not rated yet; kept so anime order stays right). */
export type SourceEpisode = { season: number; episode: number; rating: number | null; date?: string | null };
export type EpisodeRating = { rating: number; source: RatingSource };
/** Keyed like watchedKey ("season:episode"). */
export type EpisodeRatings = Record<string, EpisodeRating>;

export const OMDB = 'https://www.omdbapi.com/';
export const TVMAZE = 'https://api.tvmaze.com';

const rating = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(x) && x > 0 && x <= 10 ? Math.round(x * 10) / 10 : null;
};
const whole = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(x) && x > 0 ? x : null;
};

/** OMDb's answer for `?i=tt…&Season=N`. */
export function parseOmdbSeason(json: any, season: number): SourceEpisode[] {
  if (json?.Response !== 'True' || !Array.isArray(json?.Episodes)) return [];
  const out: SourceEpisode[] = [];
  for (const e of json.Episodes) {
    const episode = whole(e?.Episode);
    const r = rating(e?.imdbRating);
    if (episode !== null) out.push({ season, episode, rating: r, date: typeof e?.Released === 'string' ? e.Released : null });
  }
  return out;
}

/** How many seasons OMDb knows, from `?i=tt…` (0 when it is not a series). */
export function omdbSeasons(json: any): number {
  return json?.Response === 'True' ? (whole(json?.totalSeasons) ?? 0) : 0;
}

/** OMDb's own words for a bad key ("Invalid API key!", "No API key provided."). */
export function omdbKeyProblem(json: any): string | null {
  const err = typeof json?.Error === 'string' ? json.Error : '';
  return /api key/i.test(err) ? err : null;
}

/** TVmaze's `/shows/{id}/episodes`: specials are left out (they have no number). */
export function parseTvmazeEpisodes(json: any): SourceEpisode[] {
  const out: SourceEpisode[] = [];
  for (const e of Array.isArray(json) ? json : []) {
    const season = whole(e?.season);
    const episode = whole(e?.number);
    const r = rating(e?.rating?.average);
    if (season !== null && episode !== null && e?.type !== 'significant_special')
      out.push({ season, episode, rating: r, date: typeof e?.airdate === 'string' ? e.airdate : null });
  }
  return out;
}

/** Midnight UTC of a "2013-04-07…" date, or null. */
const dayOf = (v: unknown): number | null => {
  const m = typeof v === 'string' ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const DAY = 24 * 3600 * 1000;

/**
 * Puts a source's ratings on Simkl's episodes. Shows match by season and
 * episode. Anime does not: Simkl often lists each season as its own title
 * (numbered 1, 2, 3…), while IMDb and TVmaze keep one series split into
 * seasons. So anime episodes match by the day they aired (a day either way,
 * for time zones; two on one day go in order). Without dates, only when both
 * lists have the same number of episodes: then the nth is the nth.
 */
export function matchRatings(episodes: CatalogEpisode[], found: SourceEpisode[], type: SimklType): Record<string, number> {
  const out: Record<string, number> = {};
  const mine = episodes.filter((e) => !e.special);
  const put = (e: CatalogEpisode, r: number | null | undefined) => {
    if (r != null) out[watchedKey(e.season, e.episode)] = r;
  };
  if (type !== 'anime') {
    const byKey = new Map(found.map((f) => [watchedKey(f.season, f.episode), f.rating]));
    for (const e of mine) put(e, byKey.get(watchedKey(e.season, e.episode)));
    return out;
  }
  const ordered = [...found].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const dated = ordered.filter((f) => dayOf(f.date) !== null);
  if (dated.length && mine.some((e) => dayOf(e.date) !== null)) {
    const sameDay = new Map<number, CatalogEpisode[]>();
    for (const e of mine) {
      const d = dayOf(e.date);
      if (d !== null) sameDay.set(d, [...(sameDay.get(d) ?? []), e]);
    }
    for (const [d, eps] of sameDay) {
      const near = dated.filter((f) => Math.abs(dayOf(f.date)! - d) <= DAY);
      // Two of the same day in one list, one in the other: no way to tell which.
      if (near.length !== eps.length) continue;
      eps.forEach((e, i) => put(e, near[i].rating));
    }
    return out;
  }
  if (ordered.length === mine.length) mine.forEach((e, i) => put(e, ordered[i].rating));
  return out;
}

/** IMDb first; TVmaze fills the episodes IMDb has no rating for. */
export function combineRatings(
  episodes: CatalogEpisode[],
  type: SimklType,
  imdb: SourceEpisode[],
  tvmaze: SourceEpisode[]
): EpisodeRatings {
  const out: EpisodeRatings = {};
  for (const [k, r] of Object.entries(matchRatings(episodes, tvmaze, type))) out[k] = { rating: r, source: 'tvmaze' };
  for (const [k, r] of Object.entries(matchRatings(episodes, imdb, type))) out[k] = { rating: r, source: 'imdb' };
  return out;
}

/** "9.0" - always one decimal, like IMDb. */
export const fmtEpisodeRating = (r: number) => r.toFixed(1);
