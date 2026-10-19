
/** Adds to a list in a map in place (copying the list each time gets slow with thousands of items). */
function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
/**
 * Simkl rules without any native code (tested in Node): turning API responses
 * into local rows, deciding what a sync must fetch, poster and page URLs,
 * Up Next, stats. Field names follow api.simkl.org (snake_case in, camelCase out).
 *
 * Own videos and Simkl titles never mix: nothing here knows about the vault.
 */

export type SimklType = 'movie' | 'show' | 'anime';
export type SimklStatus = 'watching' | 'plantowatch' | 'hold' | 'completed' | 'dropped';

export const SIMKL_TYPES: { key: SimklType; label: string; plural: string; path: 'movies' | 'shows' | 'anime' }[] = [
  { key: 'movie', label: 'Movie', plural: 'Movies', path: 'movies' },
  { key: 'show', label: 'Show', plural: 'Shows', path: 'shows' },
  { key: 'anime', label: 'Anime', plural: 'Anime', path: 'anime' },
];

export const STATUS_LABELS: Record<SimklStatus, string> = {
  watching: 'Watching',
  plantowatch: 'Plan to Watch',
  hold: 'On Hold',
  completed: 'Completed',
  dropped: 'Dropped',
};

/** Movies have no Watching or On Hold (api.simkl.org → Watchlist statuses). */
export function statusesFor(type: SimklType): SimklStatus[] {
  return type === 'movie'
    ? ['plantowatch', 'completed', 'dropped']
    : ['watching', 'plantowatch', 'hold', 'completed', 'dropped'];
}

/** One title in the user's Simkl library, as stored locally. */
export type SimklItem = {
  simklId: number;
  type: SimklType;
  title: string;
  year: number | null;
  poster: string | null;
  slug: string | null;
  runtime: number | null;
  status: SimklStatus;
  /** 1..10, or null */
  rating: number | null;
  ratedAt: string | null;
  addedAt: string | null;
  lastWatchedAt: string | null;
  watchedEpisodes: number;
  totalEpisodes: number;
  notAiredEpisodes: number;
  /** "S02E04" for shows, "E12" style for anime; null = caught up (or a movie). */
  nextToWatch: string | null;
  animeType: string | null;
  memo: string | null;
  /** From `next_watch_info`: the next episode's title and air date. */
  nextTitle: string | null;
  nextDate: string | null;
  /** Community ratings (`/ratings/all`), filled in after a sync. */
  simklRating: number | null;
  simklVotes: number | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  malRating: number | null;
  /** Simkl catalog rank (1 = best). */
  rank: number | null;
  /** The wide picture, once the title's detail page has been loaded. */
  fanart?: string | null;
};

export type WatchedEpisode = { season: number; episode: number; watchedAt: string | null };

const STATUSES = new Set<SimklStatus>(['watching', 'plantowatch', 'hold', 'completed', 'dropped']);

/** Older client ids still see `notinteresting` where newer ones see `dropped`. */
export function normaliseStatus(s: unknown): SimklStatus | null {
  if (s === 'notinteresting') return 'dropped';
  return typeof s === 'string' && STATUSES.has(s as SimklStatus) ? (s as SimklStatus) : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);

/** One `/sync/all-items` entry → a local row (+ its watched episodes, when the response had them). */
export function parseEntry(raw: any, type: SimklType): { item: SimklItem; episodes: WatchedEpisode[] | null } | null {
  const media = raw?.movie ?? raw?.show ?? raw?.anime;
  const id = num(media?.ids?.simkl ?? media?.ids?.simkl_id);
  const status = normaliseStatus(raw?.status);
  if (!media || id === null || !status) return null;
  const rating = num(raw.user_rating);
  const memo = raw.memo && typeof raw.memo === 'object' ? str(raw.memo.text) : null;
  const item: SimklItem = {
    simklId: id,
    type,
    title: str(media.title) ?? 'Untitled',
    year: num(media.year),
    poster: str(media.poster),
    slug: str(media.ids?.slug),
    runtime: num(media.runtime),
    status,
    rating: rating && rating >= 1 && rating <= 10 ? rating : null,
    ratedAt: str(raw.user_rated_at),
    addedAt: str(raw.added_to_watchlist_at),
    lastWatchedAt: str(raw.last_watched_at),
    watchedEpisodes: num(raw.watched_episodes_count) ?? 0,
    totalEpisodes: num(raw.total_episodes_count) ?? 0,
    notAiredEpisodes: num(raw.not_aired_episodes_count) ?? 0,
    nextToWatch: str(raw.next_to_watch),
    animeType: str(raw.anime_type),
    memo,
    nextTitle: str(raw.next_to_watch_info?.title),
    nextDate: str(raw.next_to_watch_info?.date),
    simklRating: null,
    simklVotes: null,
    imdbRating: null,
    imdbVotes: null,
    malRating: null,
    rank: null,
  };
  let episodes: WatchedEpisode[] | null = null;
  if (Array.isArray(raw.seasons)) {
    episodes = [];
    for (const season of raw.seasons) {
      // Anime is one canonical season; Simkl may send number 1 or leave it out.
      const sn = num(season?.number) ?? 1;
      for (const ep of Array.isArray(season?.episodes) ? season.episodes : []) {
        const en = num(ep?.number);
        if (en !== null) episodes.push({ season: sn, episode: en, watchedAt: str(ep.watched_at) });
      }
    }
  }
  return { item, episodes };
}

/** A whole `/sync/all-items` (or `/sync/ratings`) response. */
export function parseAllItems(json: any): { items: SimklItem[]; episodes: Map<number, WatchedEpisode[]> } {
  const items: SimklItem[] = [];
  const episodes = new Map<number, WatchedEpisode[]>();
  const groups: [string, SimklType][] = [
    ['movies', 'movie'],
    ['shows', 'show'],
    ['anime', 'anime'],
  ];
  for (const [key, type] of groups) {
    const list = Array.isArray(json?.[key]) ? json[key] : [];
    for (const raw of list) {
      const parsed = parseEntry(raw, type);
      if (!parsed) continue;
      items.push(parsed.item);
      if (parsed.episodes) episodes.set(parsed.item.simklId, parsed.episodes);
    }
  }
  return { items, episodes };
}

/** Ids only (`extended=simkl_ids_only`), for finding what was removed. */
export function parseIds(json: any): Set<number> {
  const ids = new Set<number>();
  for (const key of ['movies', 'shows', 'anime']) {
    for (const raw of Array.isArray(json?.[key]) ? json[key] : []) {
      const media = raw?.movie ?? raw?.show ?? raw?.anime;
      const id = num(media?.ids?.simkl ?? media?.ids?.simkl_id);
      if (id !== null) ids.add(id);
    }
  }
  return ids;
}

export type CommunityRatings = Pick<
  SimklItem,
  'simklRating' | 'simklVotes' | 'imdbRating' | 'imdbVotes' | 'malRating' | 'rank'
>;

/** `/ratings/all?user_watchlist=1&fields=simkl,ext,rank` → ratings by Simkl id. */
export function parseCommunityRatings(json: any): Map<number, CommunityRatings> {
  const out = new Map<number, CommunityRatings>();
  for (const r of Array.isArray(json) ? json : []) {
    const id = num(r?.id);
    if (id === null) continue;
    out.set(id, {
      simklRating: num(r?.simkl?.rating),
      simklVotes: num(r?.simkl?.votes),
      imdbRating: num(r?.imdb?.rating),
      imdbVotes: num(r?.imdb?.votes),
      malRating: num(r?.mal?.rating),
      rank: num(r?.rank),
    });
  }
  return out;
}

/* --------------------------------------------------------------------- sync */

export type Activities = Record<string, any>;

export type SyncPlan =
  | { kind: 'full' }
  | { kind: 'nothing' }
  | { kind: 'delta'; dateFrom: string; removals: boolean; ratings: boolean };

const BLOCKS = ['tv_shows', 'anime', 'movies'];

/**
 * What to fetch, given the saved snapshot and the fresh `/sync/activities`:
 * nothing when `all` is unchanged, otherwise a `date_from` delta, plus the id
 * list when something was removed and the ratings delta when a rating changed.
 */
export function planSync(saved: Activities | null, fresh: Activities): SyncPlan {
  if (!saved || typeof saved.all !== 'string') return { kind: 'full' };
  if (saved.all === fresh.all) return { kind: 'nothing' };
  const moved = (block: string, key: string) => (fresh?.[block]?.[key] ?? null) !== (saved?.[block]?.[key] ?? null);
  return {
    kind: 'delta',
    dateFrom: saved.all,
    removals: BLOCKS.some((b) => moved(b, 'removed_from_list')),
    ratings: BLOCKS.some((b) => moved(b, 'rated_at')),
  };
}

/** Sync on open / pull-to-refresh, at most every 15 minutes (Simkl's rule) unless forced. */
export const MIN_SYNC_GAP_MS = 15 * 60 * 1000;
export function shouldSync(lastSyncAt: number | null, now: number, force: boolean): boolean {
  if (force) return lastSyncAt === null || now - lastSyncAt > 10_000;
  return lastSyncAt === null || now - lastSyncAt >= MIN_SYNC_GAP_MS;
}

/** Retry wait for 429 / 5xx: doubles, capped at 60 s, honouring Retry-After. */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const header = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(header) && header >= 0) return Math.min(60_000, header * 1000);
  return Math.min(60_000, 1000 * 2 ** attempt);
}

/* ------------------------------------------------------------ links, images */

const IMG = 'https://wsrv.nl/?url=https://simkl.in';
export const POSTER_PLACEHOLDER = `${IMG}/poster_no_pic_c.png`;

/** `_ca` for grids, `_m` for the detail screen, `_cm` for dense lists. */
export function posterUrl(path: string | null, size: '_ca' | '_m' | '_c' | '_cm' | '_w' = '_ca'): string {
  return path ? `${IMG}/posters/${path}${size}.webp&q=90` : POSTER_PLACEHOLDER;
}

export function fanartUrl(path: string | null): string | null {
  return path ? `${IMG}/fanart/${path}_medium.webp&q=90` : null;
}

export function episodeImageUrl(path: string | null): string | null {
  return path ? `${IMG}/episodes/${path}_w.webp&q=90` : null;
}

/** The item's own Simkl page - shown as "View on Simkl" everywhere (API rule 1). */
export function simklUrl(type: SimklType, id: number, slug: string | null): string {
  const section = type === 'movie' ? 'movies' : type === 'anime' ? 'anime' : 'tv';
  return `https://simkl.com/${section}/${id}/${slug ?? ''}`;
}

/* ----------------------------------------------------------------- episodes */

/** "S02E04" → {2, 4}; anime "E12" or "12" → {1, 12}. */
export function parseEpisodeCode(code: string | null): { season: number; episode: number } | null {
  if (!code) return null;
  const se = /^S(\d+)E(\d+)$/i.exec(code.trim());
  if (se) return { season: Number(se[1]), episode: Number(se[2]) };
  const e = /^E?(\d+)$/i.exec(code.trim());
  if (e) return { season: 1, episode: Number(e[1]) };
  return null;
}

export function episodeCode(type: SimklType, season: number, episode: number): string {
  return type === 'anime' ? `E${episode}` : `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

export type CatalogEpisode = {
  season: number;
  episode: number;
  title: string | null;
  aired: boolean;
  date: string | null;
  img: string | null;
  special: boolean;
};

/** `/tv/episodes/{id}` or `/anime/episodes/{id}` → rows, specials last. */
export function parseEpisodes(json: any, type: SimklType): CatalogEpisode[] {
  const rows: CatalogEpisode[] = [];
  for (const e of Array.isArray(json) ? json : []) {
    const special = e?.type === 'special';
    const episode = num(e?.episode);
    if (episode === null) continue;
    rows.push({
      season: special ? 0 : type === 'anime' ? 1 : (num(e?.season) ?? 1),
      episode,
      title: str(e?.title),
      aired: e?.aired !== false,
      date: str(e?.date),
      img: str(e?.img),
      special,
    });
  }
  return rows.sort((a, b) => Number(a.special) - Number(b.special) || a.season - b.season || a.episode - b.episode);
}

export function groupBySeason(episodes: CatalogEpisode[]): { season: number; label: string; episodes: CatalogEpisode[] }[] {
  const map = new Map<number, CatalogEpisode[]>();
  for (const e of episodes) pushTo(map, e.season, e);
  return [...map.entries()].map(([season, eps]) => ({
    season,
    label: season === 0 ? 'Specials' : eps[0] && episodes.every((x) => x.season <= 1) ? 'Episodes' : `Season ${season}`,
    episodes: eps,
  }));
}

export const watchedKey = (season: number, episode: number) => `${season}:${episode}`;

/* ------------------------------------------------------------- lists, stats */

/** Watching, with something left to see (caught-up shows hide - Simkl's own rule). */
export function upNext(items: SimklItem[]): SimklItem[] {
  return items
    .filter((i) => i.type !== 'movie' && i.status === 'watching' && i.nextToWatch !== null)
    .sort((a, b) => (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? ''));
}

/** The tabs above a list, like the Simkl app (Aired / Seen / A-Z / Rank...). */
export type SimklSort = 'aired' | 'seen' | 'added' | 'title' | 'year' | 'rank' | 'imdb' | 'mine';

const ALL_SORTS: Record<SimklSort, string> = {
  aired: 'Aired',
  seen: 'Seen',
  added: 'Added',
  title: 'A–Z',
  year: 'Year',
  rank: 'Rank',
  imdb: 'IMDb',
  mine: 'My rating',
};

export function sortsFor(type: SimklType): { key: SimklSort; label: string }[] {
  const keys: SimklSort[] =
    type === 'movie'
      ? ['seen', 'added', 'year', 'title', 'rank', 'imdb', 'mine']
      : ['aired', 'seen', 'added', 'title', 'rank', 'imdb', 'mine'];
  return keys.map((key) => ({ key, label: ALL_SORTS[key] }));
}

const desc = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');
const nullLast = (a: number | null, b: number | null, dir: 1 | -1) =>
  a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : (a - b) * dir;

export function sortItems(items: SimklItem[], sort: SimklSort): SimklItem[] {
  const by: Record<SimklSort, (a: SimklItem, b: SimklItem) => number> = {
    // Something to watch first, newest aired next episode first.
    aired: (a, b) =>
      Number(a.nextToWatch === null) - Number(b.nextToWatch === null) ||
      desc(a.nextDate, b.nextDate) ||
      desc(a.lastWatchedAt, b.lastWatchedAt),
    seen: (a, b) => desc(a.lastWatchedAt ?? a.addedAt, b.lastWatchedAt ?? b.addedAt),
    added: (a, b) => desc(a.addedAt, b.addedAt),
    title: (a, b) => a.title.localeCompare(b.title),
    year: (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title),
    rank: (a, b) => nullLast(a.rank, b.rank, 1) || a.title.localeCompare(b.title),
    imdb: (a, b) =>
      nullLast(a.imdbRating ?? a.malRating, b.imdbRating ?? b.malRating, -1) || a.title.localeCompare(b.title),
    mine: (a, b) => nullLast(a.rating, b.rating, -1) || a.title.localeCompare(b.title),
  };
  return [...items].sort(by[sort]);
}

/** Aired episodes not watched yet ("12 ep left"). */
export function episodesLeft(i: SimklItem): number {
  return Math.max(0, i.totalEpisodes - i.notAiredEpisodes - i.watchedEpisodes);
}

/** 476419 → "476K", 2287000 → "2.3M". */
export function fmtVotes(n: number | null): string {
  if (n === null) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/** "in 2 d 4 h", "in 35 min", "aired" - for countdowns. */
export function countdown(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'aired';
  const min = Math.round(ms / 60000);
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `in ${h} h ${min % 60} min`;
  return `in ${Math.floor(h / 24)} d ${h % 24} h`;
}

export function filterItems(items: SimklItem[], opts: { type: SimklType; status: SimklStatus | 'all'; query?: string }): SimklItem[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return items.filter(
    (i) => i.type === opts.type && (opts.status === 'all' || i.status === opts.status) && (!q || i.title.toLowerCase().includes(q))
  );
}

export type SimklStats = {
  total: number;
  byStatus: Record<SimklStatus, number>;
  rated: number;
  averageRating: number | null;
  episodesWatched: number;
  /** Rough: movie runtime for completed movies + episode runtime × watched episodes. */
  minutesWatched: number;
};

export function statsFor(items: SimklItem[]): SimklStats {
  const byStatus: Record<SimklStatus, number> = { watching: 0, plantowatch: 0, hold: 0, completed: 0, dropped: 0 };
  let rated = 0;
  let ratingSum = 0;
  let episodes = 0;
  let minutes = 0;
  for (const i of items) {
    byStatus[i.status]++;
    if (i.rating) {
      rated++;
      ratingSum += i.rating;
    }
    if (i.type === 'movie') {
      if (i.status === 'completed') minutes += i.runtime ?? 0;
    } else {
      episodes += i.watchedEpisodes;
      minutes += (i.runtime ?? 0) * i.watchedEpisodes;
    }
  }
  return {
    total: items.length,
    byStatus,
    rated,
    averageRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : null,
    episodesWatched: episodes,
    minutesWatched: minutes,
  };
}

/* ------------------------------------------------------------------ history */

const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Episodes watched per day for the last `weeks` weeks, Monday-first columns
 * (a GitHub-style heatmap), plus the current and the longest daily streak.
 */
export function watchHeatmap(watchedAt: (string | null)[], now: number, weeks = 16) {
  const counts = new Map<string, number>();
  for (const w of watchedAt) {
    const t = w ? Date.parse(w) : NaN;
    if (Number.isFinite(t)) counts.set(dayOf(t), (counts.get(dayOf(t)) ?? 0) + 1);
  }
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const weekday = (today.getDay() + 6) % 7; // Monday = 0
  const start = today.getTime() - (weekday + (weeks - 1) * 7) * 86_400_000;
  const columns: { day: string; count: number; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: { day: string; count: number; future: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const t = start + (w * 7 + d) * 86_400_000;
      col.push({ day: dayOf(t), count: counts.get(dayOf(t)) ?? 0, future: t > today.getTime() });
    }
    columns.push(col);
  }
  let current = 0;
  for (let t = today.getTime(); counts.get(dayOf(t)); t -= 86_400_000) current++;
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of [...counts.keys()].sort()) {
    const t = Date.parse(`${d}T12:00:00`);
    run = prev !== null && Math.round((t - prev) / 86_400_000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  return { columns, current, longest, max: Math.max(0, ...counts.values()) };
}

/** The library as CSV (Simkl's own export is VIP-only; this is what is on the phone). */
export function libraryCsv(items: SimklItem[]): string {
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = [
    'type', 'title', 'year', 'status', 'my_rating', 'watched_episodes', 'total_episodes',
    'last_watched_at', 'imdb', 'simkl_id', 'simkl_url',
  ];
  const rows = items.map((i) =>
    [
      i.type, i.title, i.year, i.status, i.rating, i.watchedEpisodes, i.totalEpisodes,
      i.lastWatchedAt, i.imdbRating, i.simklId, simklUrl(i.type, i.simklId, i.slug),
    ]
      .map(esc)
      .join(',')
  );
  return [head.join(','), ...rows].join('\n');
}

/* ------------------------------------------------------------------ catalog */

/** A title from search, trending or the calendar (not necessarily in the library). */
export type CatalogTitle = {
  simklId: number;
  type: SimklType;
  title: string;
  year: number | null;
  poster: string | null;
  slug: string | null;
  /** For calendar rows: the episode and its date. */
  date?: string | null;
  episodeLabel?: string | null;
  rank?: number | null;
  simklRating?: number | null;
  imdbRating?: number | null;
};

/** `/search/{type}`, trending and calendar rows all share this rough shape. */
export function parseCatalog(json: any, type: SimklType): CatalogTitle[] {
  const out: CatalogTitle[] = [];
  for (const r of Array.isArray(json) ? json : []) {
    const id = num(r?.ids?.simkl_id ?? r?.ids?.simkl);
    if (id === null) continue;
    const ep = r?.episode;
    out.push({
      simklId: id,
      type,
      title: str(r?.title) ?? 'Untitled',
      year: num(r?.year) ?? (str(r?.release_date) ? Number(String(r.release_date).slice(0, 4)) || null : null),
      poster: str(r?.poster),
      slug: str(r?.ids?.slug),
      date: str(r?.date) ?? str(r?.release_date),
      episodeLabel: ep && num(ep.episode) !== null ? episodeCode(type, num(ep.season) ?? 1, num(ep.episode) ?? 0) : null,
      rank: num(r?.rank),
      simklRating: num(r?.ratings?.simkl?.rating),
      imdbRating: num(r?.ratings?.imdb?.rating),
    });
  }
  return out;
}

/** `users_recommendations` / `similar` on a detail record → catalog rows. */
export function parseRelated(list: any, fallback: SimklType): CatalogTitle[] {
  const out: CatalogTitle[] = [];
  for (const r of Array.isArray(list) ? list : []) {
    const id = num(r?.ids?.simkl ?? r?.ids?.simkl_id);
    if (id === null) continue;
    const t = r?.type === 'movie' ? 'movie' : r?.type === 'anime' ? 'anime' : r?.type === 'tv' || r?.type === 'show' ? 'show' : fallback;
    out.push({ simklId: id, type: t, title: str(r?.title) ?? 'Untitled', year: num(r?.year), poster: str(r?.poster), slug: str(r?.ids?.slug) });
  }
  return out;
}

/** The first YouTube trailer, as a link. */
export function trailerUrl(trailers: any): string | null {
  for (const t of Array.isArray(trailers) ? trailers : []) {
    if (typeof t?.youtube === 'string' && t.youtube) return `https://www.youtube.com/watch?v=${t.youtube}`;
  }
  return null;
}

/** Calendar rows for titles in the library only, soonest first, from `now` on. */
export function myCalendar(rows: CatalogTitle[], libraryIds: Set<number>, now: number): CatalogTitle[] {
  return rows
    .filter((r) => libraryIds.has(r.simklId) && r.date && Date.parse(r.date) >= now - 12 * 3600 * 1000)
    .sort((a, b) => Date.parse(a.date ?? '') - Date.parse(b.date ?? ''));
}

/* ------------------------------------------------------------- home screen */

const HOME_DAY = 86_400_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** What you follow: watching, plan to watch, on hold (movies: plan to watch). */
export function followedIds(items: SimklItem[]): Set<number> {
  return new Set(items.filter((i) => (i.type === 'movie' ? i.status === 'plantowatch' : i.status !== 'completed' && i.status !== 'dropped')).map((i) => i.simklId));
}

/** The next seven days for the home screen's calendar, each day with what airs for titles you follow. */
export function weekAhead(rows: CatalogTitle[], following: Set<number>, now: number): { day: number; rows: CatalogTitle[] }[] {
  const start = startOfDay(now);
  const mine = rows.filter((r) => following.has(r.simklId) && r.date && !Number.isNaN(Date.parse(r.date)));
  return Array.from({ length: 7 }, (_, i) => {
    const day = startOfDay(start + i * HOME_DAY + 2 * 3_600_000);
    return { day, rows: mine.filter((r) => startOfDay(Date.parse(r.date!)) === day).sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!)) };
  });
}

export type NewThing = { simklId: number; type: SimklType; title: string; poster: string | null; label: string | null; date: string };

/**
 * New this week for what you follow: episodes that came out in the last
 * seven days and you haven't watched yet, and releases from the calendar.
 * Newest first, one per title.
 */
export function newThisWeek(items: SimklItem[], rows: CatalogTitle[], following: Set<number>, now: number): NewThing[] {
  const from = now - 7 * HOME_DAY;
  const inWeek = (d: string | null | undefined) => {
    const t = d ? Date.parse(d) : NaN;
    return !Number.isNaN(t) && t >= from && t <= now;
  };
  const out = new Map<number, NewThing>();
  for (const i of items)
    if (following.has(i.simklId) && i.nextToWatch && inWeek(i.nextDate))
      out.set(i.simklId, { simklId: i.simklId, type: i.type, title: i.title, poster: i.poster, label: i.nextToWatch, date: i.nextDate! });
  for (const r of rows)
    if (following.has(r.simklId) && !out.has(r.simklId) && inWeek(r.date))
      out.set(r.simklId, { simklId: r.simklId, type: r.type, title: r.title, poster: r.poster, label: r.episodeLabel ?? null, date: r.date! });
  return [...out.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
