/**
 * Made-up Simkl library for the browser preview. Neutral placeholder titles,
 * no real accounts, no network (posters fall back to Simkl's placeholder).
 */

import { buildEvents, type Meta, type Play, type Session } from '../insights';
import type { CatalogEpisode, CatalogTitle, SimklItem, SimklType } from '../logic';
import { DEFAULT_REMINDERS } from '../reminders';
import type { SimklActions, SimklDetailInfo } from './types';

const base = {
  poster: null,
  slug: null,
  ratedAt: null,
  animeType: null,
  memo: null,
  notAiredEpisodes: 0,
  nextTitle: null,
  nextDate: null,
  simklRating: null,
  simklVotes: null,
  imdbRating: null,
  imdbVotes: null,
  malRating: null,
  rank: null,
};

/** Made-up community ratings per id: [simkl, imdb, mal, rank]. */
const RATINGS: Record<number, [number, number | null, number | null, number]> = {
  101: [8.4, 8.5, null, 442],
  102: [7.6, 7.8, null, 2210],
  103: [8.0, 8.2, null, 913],
  104: [7.1, 7.3, null, 5120],
  105: [6.9, 7.0, null, 6800],
  106: [6.2, 6.4, null, 9900],
  201: [7.9, 7.7, null, 1300],
  202: [7.2, 7.0, null, 4100],
  203: [8.8, 8.6, null, 120],
  301: [8.7, null, 8.6, 310],
  302: [8.1, 7.9, 8.3, 880],
};

const day = (n: number) => new Date(Date.UTC(2026, 9, 17 - n, 20)).toISOString();

const RAW: SimklItem[] = [
  { ...base, simklId: 101, type: 'show', title: 'Harbour Lights', year: 2024, runtime: 50, status: 'watching', rating: 9, addedAt: day(90), lastWatchedAt: day(1), watchedEpisodes: 11, totalEpisodes: 18, nextToWatch: 'S02E04', notAiredEpisodes: 2 },
  { ...base, simklId: 102, type: 'show', title: 'The Long Field', year: 2021, runtime: 42, status: 'watching', rating: null, addedAt: day(60), lastWatchedAt: day(3), watchedEpisodes: 3, totalEpisodes: 10, nextToWatch: 'S01E04' },
  { ...base, simklId: 103, type: 'show', title: 'Copper Street', year: 2019, runtime: 30, status: 'completed', rating: 7, addedAt: day(300), lastWatchedAt: day(40), watchedEpisodes: 24, totalEpisodes: 24, nextToWatch: null },
  { ...base, simklId: 104, type: 'show', title: 'Night Ferry', year: 2025, runtime: 55, status: 'plantowatch', rating: null, addedAt: day(5), lastWatchedAt: null, watchedEpisodes: 0, totalEpisodes: 8, nextToWatch: 'S01E01' },
  { ...base, simklId: 105, type: 'show', title: 'Quiet Valley', year: 2018, runtime: 45, status: 'hold', rating: 6, addedAt: day(200), lastWatchedAt: day(100), watchedEpisodes: 14, totalEpisodes: 30, nextToWatch: 'S02E05' },
  { ...base, simklId: 106, type: 'show', title: 'Paper Moons', year: 2016, runtime: 25, status: 'dropped', rating: 4, addedAt: day(400), lastWatchedAt: day(380), watchedEpisodes: 2, totalEpisodes: 12, nextToWatch: 'S01E03' },
  { ...base, simklId: 201, type: 'movie', title: 'Glass Orchard', year: 2023, runtime: 118, status: 'completed', rating: 8, addedAt: day(30), lastWatchedAt: day(20), watchedEpisodes: 0, totalEpisodes: 0, nextToWatch: null },
  { ...base, simklId: 202, type: 'movie', title: 'Low Tide', year: 2020, runtime: 101, status: 'plantowatch', rating: null, addedAt: day(2), lastWatchedAt: null, watchedEpisodes: 0, totalEpisodes: 0, nextToWatch: null },
  { ...base, simklId: 203, type: 'movie', title: 'Signal Hill', year: 2012, runtime: 124, status: 'completed', rating: 10, addedAt: day(500), lastWatchedAt: day(400), watchedEpisodes: 0, totalEpisodes: 0, nextToWatch: null },
  { ...base, simklId: 301, type: 'anime', title: 'Starlit Workshop', year: 2025, runtime: 24, status: 'watching', rating: 9, addedAt: day(20), lastWatchedAt: day(0), watchedEpisodes: 7, totalEpisodes: 12, nextToWatch: 'E8', animeType: 'tv' },
  { ...base, simklId: 302, type: 'anime', title: 'Blade of Spring', year: 2022, runtime: 24, status: 'completed', rating: 8, addedAt: day(150), lastWatchedAt: day(100), watchedEpisodes: 24, totalEpisodes: 24, nextToWatch: null, animeType: 'tv' },
];

const NEXT: Record<number, [string, number]> = {
  101: ['The Lighthouse Keeper', 3],
  102: ['Second Harvest', 9],
  105: ['Low Water', 140],
  301: ['A New Commission', 0],
};

export const FIXTURE_SIMKL: SimklItem[] = RAW.map((i) => {
  const [simklRating, imdbRating, malRating, rank] = RATINGS[i.simklId] ?? [null, null, null, null];
  const next = NEXT[i.simklId];
  return {
    ...i,
    simklRating,
    imdbRating,
    malRating,
    rank,
    simklVotes: 5779,
    imdbVotes: 476419,
    nextTitle: next?.[0] ?? null,
    nextDate: next ? day(next[1]) : null,
    memo: i.simklId === 101 ? 'Recommended by Sam - watch with subtitles.' : null,
  };
});

const DETAIL: SimklDetailInfo = {
  overview:
    'A placeholder description for the preview. On the phone this is the summary Simkl has for the title, with its genres, network and ratings above it.',
  genres: ['Drama', 'Mystery'],
  network: 'Placeholder TV',
  certification: 'TV-14',
  runtime: 50,
  status: 'airing',
  fanart: null,
  poster: null,
  year: 2024,
  totalEpisodes: 18,
  simklRating: 8.4,
  simklVotes: 5779,
  imdbRating: 8.5,
  imdbVotes: 476419,
  malRating: null,
  malVotes: null,
  rank: 442,
  firstAired: '2024-03-01',
  years: '2024-2026',
  language: 'EN',
  country: 'US',
  trailer: 'https://www.youtube.com/',
  related: [
    { simklId: 911, type: 'show', title: 'Amber Coast', year: 2023, poster: null, slug: null },
    { simklId: 912, type: 'show', title: 'Northern Rooms', year: 2022, poster: null, slug: null },
    { simklId: 913, type: 'show', title: 'Ninth Bell', year: 2020, poster: null, slug: null },
    { simklId: 914, type: 'show', title: 'Open Water', year: 2019, poster: null, slug: null },
  ],
};

function episodes(type: SimklType): CatalogEpisode[] {
  const rows: CatalogEpisode[] = [];
  const seasons = type === 'anime' ? [[1, 12]] : [[1, 10], [2, 8]];
  for (const [s, n] of seasons) {
    for (let e = 1; e <= n; e++) {
      const aired = !(s === 2 && e > 6) && !(type === 'anime' && e > 10);
      rows.push({ season: s, episode: e, title: `Episode ${e}`, aired, date: day(aired ? 30 - e : -7 * (e - 6)), img: null, special: false });
    }
  }
  return rows;
}

const catalog = (type: SimklType): CatalogTitle[] =>
  ['Amber Coast', 'Northern Rooms', 'Harbour Lights', 'Ninth Bell', 'Open Water', 'Clockwork Sea'].map((title, i) => ({
    simklId: type === 'show' && i === 2 ? 101 : 900 + i,
    type,
    title,
    year: 2026 - i,
    poster: null,
    slug: null,
  }));

const calendar = (type: SimklType): CatalogTitle[] => [
  { simklId: type === 'anime' ? 301 : 101, type, title: type === 'anime' ? 'Starlit Workshop' : 'Harbour Lights', year: 2024, poster: null, slug: null, date: new Date(Date.now() + 86_400_000).toISOString(), episodeLabel: type === 'anime' ? 'E11' : 'S02E07' },
  { simklId: 104, type, title: 'Night Ferry', year: 2025, poster: null, slug: null, date: new Date(Date.now() + 4 * 86_400_000).toISOString(), episodeLabel: 'S01E01' },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GENRES: Record<number, string[]> = {
  101: ['Drama', 'Mystery'],
  102: ['Drama'],
  103: ['Comedy'],
  105: ['Crime', 'Drama'],
  106: ['Comedy'],
  201: ['Drama', 'Romance'],
  203: ['Thriller', 'Mystery'],
  301: ['Fantasy', 'Adventure'],
  302: ['Action', 'Fantasy'],
};
const NETWORKS: Record<number, string> = { 101: 'Placeholder TV', 102: 'North One', 103: 'Placeholder TV', 105: 'Channel 9', 301: 'Studio Lark', 302: 'Studio Lark' };

function fixtureMeta(): Map<number, Meta> {
  const m = new Map<number, Meta>();
  for (const [id, genres] of Object.entries(GENRES)) {
    m.set(Number(id), { genres, network: NETWORKS[Number(id)] ?? null, country: Number(id) >= 300 ? 'JP' : 'US', language: null, runtime: null });
  }
  return m;
}

/** A believable spread of watches over the last few months (evenings, more at weekends). */
function fixtureHistory(items: SimklItem[]): { simklId: number; watchedAt: string }[] {
  const out: { simklId: number; watchedAt: string }[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (const i of items) {
    if (i.type === 'movie') continue;
    for (let e = 0; e < i.watchedEpisodes; e++) {
      const daysAgo = Math.floor(rand() * 150);
      const d = new Date(Date.now() - daysAgo * 86_400_000);
      d.setHours(18 + Math.floor(rand() * 5), Math.floor(rand() * 60));
      out.push({ simklId: i.simklId, watchedAt: d.toISOString() });
    }
  }
  return out;
}

const SESSIONS: Session[] = [{ id: 1, simklId: 103, number: 2, startedAt: day(12), finishedAt: null, remoteId: null }];
const PLAYS: Play[] = [
  { id: 1, simklId: 103, season: 1, episode: 1, watchedAt: day(12), sessionId: 1 },
  { id: 2, simklId: 103, season: 1, episode: 2, watchedAt: day(10), sessionId: 1 },
  { id: 3, simklId: 103, season: 1, episode: 3, watchedAt: day(4), sessionId: 1 },
  { id: 4, simklId: 203, season: 0, episode: 0, watchedAt: day(30), sessionId: null },
];

/** Fake actions that change nothing (the preview has no account). */
export function fixtureSimklActions(onChange: (items: SimklItem[]) => void, items: SimklItem[]): SimklActions {
  const patch = async (id: number, p: Partial<SimklItem>) => onChange(items.map((i) => (i.simklId === id ? { ...i, ...p } : i)));
  return {
    connect: async (onCode) => {
      onCode({ code: 'ABCD-1234', url: 'https://simkl.com/pin' });
      await wait(60_000);
      return false;
    },
    cancelConnect: () => {},
    disconnect: async () => {},
    sync: async () => {},
    setStatus: (item, status) => patch(item.simklId, { status }),
    setRating: (item, rating) => patch(item.simklId, { rating }),
    setEpisodes: async () => {},
    markMovieWatched: (item) => patch(item.simklId, { status: 'completed' }),
    addToLibrary: async () => {},
    remove: async () => {},
    loadDetail: async () => DETAIL,
    loadEpisodes: async (type) => episodes(type),
    loadWatched: async (id) =>
      id === 101
        ? [...Array.from({ length: 10 }, (_, i) => ({ season: 1, episode: i + 1, watchedAt: null })), { season: 2, episode: 1, watchedAt: null }, { season: 2, episode: 2, watchedAt: null }, { season: 2, episode: 3, watchedAt: null }]
        : Array.from({ length: 7 }, (_, i) => ({ season: 1, episode: i + 1, watchedAt: null })),
    search: async (type) => catalog(type),
    trending: async (type) => catalog(type),
    calendar: async (type) => calendar(type),
    watchTimes: async () =>
      Array.from({ length: 70 }, (_, i) => new Date(Date.now() - ((i * 37) % 110) * 86_400_000).toISOString()),
    exportCsv: async () => {},
    loadInsights: async () => {
      const meta = fixtureMeta();
      return { events: buildEvents(items, fixtureHistory(items), PLAYS, meta), meta };
    },
    fillMeta: async (onProgress) => {
      for (let i = 1; i <= 3; i++) {
        await wait(150);
        onProgress(i, 3);
      }
      return 3;
    },
    loadSessions: async (id) => SESSIONS.filter((s) => s.simklId === id),
    loadPlays: async (id) => PLAYS.filter((p) => p.simklId === id),
    startRewatch: async (item) => ({ id: 9, simklId: item.simklId, number: 2, startedAt: new Date().toISOString(), finishedAt: null, remoteId: null }),
    endRewatch: async () => {},
    deleteRewatch: async () => {},
    logRewatch: async () => {},
    getRewatchSync: async () => ({ on: false, plan: 'free' }),
    setRewatchSync: async () => ({ ok: false, plan: 'free' }),
    getReminders: async () => ({ ...DEFAULT_REMINDERS, enabled: true }),
    setReminders: async () => true,
    openUrl: () => {},
  };
}
