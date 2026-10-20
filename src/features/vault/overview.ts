/**
 * The Videos tab's Overview mode: your videos as titles you rate and track,
 * like the Movies / Shows / Anime tabs. Videos grouped into a series show as
 * one title with episodes (the series has its own rating, every episode its
 * own); videos removed for good stay here with their rating and info. Pure
 * (no database, no files), so it is tested in Node.
 */

// The .ts extension lets Node run this file directly in the tests.
import { friendlyName } from './names.ts';

/** Adds to a list in a map in place (copying the list each time gets slow with thousands of items). */
function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export type OvStatus = 'plantowatch' | 'watching' | 'completed' | 'hold' | 'dropped';

type Thumb = number | string | { uri: string };

/** A video as the Overview sees it: in the library, in Recently Deleted, or kept after it was removed for good. */
export type OvVideo = {
  id: string;
  title: string | null;
  filename: string;
  durationMs: number | null;
  sizeBytes: number;
  rating: number;
  status: OvStatus | null;
  notes: string | null;
  tagNames: string[];
  thumb: Thumb | null;
  createdAt: number;
  importedAt: number;
  where: 'library' | 'trash' | 'kept';
  /** When it was removed for good (kept only). */
  removedAt: number | null;
  isPrivate: boolean;
};

export type OvSeries = {
  id: string;
  name: string;
  description: string | null;
  /** A picture you chose; null = the first episode's cover. */
  cover: Thumb | null;
  rating: number;
  status: OvStatus | null;
  createdAt: number;
  updatedAt: number;
};

export type OvMember = { videoId: string; seriesId: string; position: number; label: string | null };

export type OvPlay = { videoId: string; startedAt: number; watchedMs: number };

export type OvEpisode = {
  video: OvVideo;
  number: number;
  name: string;
  plays: number;
  watchedMs: number;
  lastWatchedAt: number | null;
  watched: boolean;
};

export type OvEntry = {
  /** 's:<series id>' or 'v:<video id>' */
  key: string;
  kind: 'series' | 'single';
  /** The series id, or the video id. */
  id: string;
  title: string;
  description: string | null;
  cover: Thumb | null;
  /** Your rating of the whole title; 0 = none. */
  rating: number;
  /** Average of the rated episodes (series only). */
  episodeAvg: number | null;
  status: OvStatus;
  /** false = the status is worked out from what you watched. */
  statusSet: boolean;
  episodes: OvEpisode[];
  watchedCount: number;
  plays: number;
  watchedMs: number;
  totalMs: number;
  lastWatchedAt: number | null;
  addedAt: number;
  tags: string[];
  /** Every video in it was removed for good; only the info is left. */
  gone: boolean;
  /** The first episode not watched yet. */
  next: OvEpisode | null;
};

export const OV_STATUS_LABELS: Record<OvStatus, string> = {
  watching: 'Watching',
  plantowatch: 'Plan to Watch',
  completed: 'Watched',
  hold: 'On Hold',
  dropped: 'Dropped',
};

export type OvFilter = 'all' | OvStatus | 'unrated' | 'series' | 'removed';

export const OV_FILTERS: { key: OvFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'watching', label: 'Watching' },
  { key: 'plantowatch', label: 'Plan to Watch' },
  { key: 'completed', label: 'Watched' },
  { key: 'hold', label: 'On Hold' },
  { key: 'dropped', label: 'Dropped' },
  { key: 'unrated', label: 'Not rated' },
  { key: 'series', label: 'Series' },
  { key: 'removed', label: 'Removed' },
];

export type OvSort = 'recent' | 'added' | 'rating' | 'name' | 'plays' | 'length';

export const OV_SORTS: { key: OvSort; label: string }[] = [
  { key: 'recent', label: 'Last watched' },
  { key: 'added', label: 'Added' },
  { key: 'rating', label: 'My rating' },
  { key: 'name', label: 'Name' },
  { key: 'plays', label: 'Most watched' },
  { key: 'length', label: 'Length' },
];

export const videoName = (v: Pick<OvVideo, 'title' | 'filename'> & { createdAt?: number }) => friendlyName(v);

/**
 * Watched = you set it to Watched. Playing it, however much, never marks it:
 * everything starts as To Watch until you say you've finished it.
 */
export function isWatched(v: OvVideo, _watchedMs?: number, _plays?: number): boolean {
  return v.status === 'completed';
}

function episodeOf(v: OvVideo, number: number, label: string | null, byVideo: Map<string, OvPlay[]>): OvEpisode {
  const plays = byVideo.get(v.id) ?? [];
  const watchedMs = plays.reduce((s, p) => s + p.watchedMs, 0);
  const last = plays.length ? Math.max(...plays.map((p) => p.startedAt)) : null;
  return {
    video: v,
    number,
    name: label?.trim() || videoName(v),
    plays: plays.length,
    watchedMs,
    lastWatchedAt: last,
    watched: isWatched(v, watchedMs, plays.length),
  };
}

function topTags(eps: OvEpisode[], max = 6): string[] {
  const n = new Map<string, number>();
  for (const e of eps) for (const t of e.video.tagNames) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

function sum<T>(list: T[], f: (x: T) => number): number {
  return list.reduce((s, x) => s + f(x), 0);
}

function derivedStatus(eps: OvEpisode[]): OvStatus {
  const watched = eps.filter((e) => e.watched).length;
  if (eps.length > 0 && watched === eps.length) return 'completed';
  // Watching: some episodes of a series marked Watched (playing alone never moves it).
  if (watched > 0) return 'watching';
  return 'plantowatch';
}

function entryFrom(
  base: { key: string; kind: OvEntry['kind']; id: string; title: string; description: string | null; cover: Thumb | null; rating: number; status: OvStatus | null; addedAt?: number },
  eps: OvEpisode[]
): OvEntry {
  const rated = eps.filter((e) => e.video.rating > 0);
  const lasts = eps.map((e) => e.lastWatchedAt).filter((x): x is number => x !== null);
  return {
    ...base,
    cover: base.cover ?? eps.find((e) => e.video.thumb)?.video.thumb ?? null,
    episodeAvg: base.kind === 'series' && rated.length ? Math.round((sum(rated, (e) => e.video.rating) / rated.length) * 10) / 10 : null,
    status: base.status ?? derivedStatus(eps),
    statusSet: base.status !== null,
    episodes: eps,
    watchedCount: eps.filter((e) => e.watched).length,
    plays: sum(eps, (e) => e.plays),
    watchedMs: sum(eps, (e) => e.watchedMs),
    totalMs: sum(eps, (e) => e.video.durationMs ?? 0),
    lastWatchedAt: lasts.length ? Math.max(...lasts) : null,
    addedAt: eps.length ? Math.min(...eps.map((e) => e.video.importedAt)) : (base.addedAt ?? 0),
    tags: topTags(eps),
    gone: eps.length > 0 && eps.every((e) => e.video.where === 'kept'),
    next: eps.find((e) => !e.watched) ?? null,
  };
}

/**
 * Every title in the Overview: one per series, and one per video that is not
 * in a series. Private videos are left out unless `includePrivate`.
 */
export function buildOverview(
  videos: OvVideo[],
  series: OvSeries[],
  members: OvMember[],
  plays: OvPlay[],
  opts: { includePrivate?: boolean } = {}
): OvEntry[] {
  const visible = videos.filter((v) => opts.includePrivate || !v.isPrivate);
  const byId = new Map(visible.map((v) => [v.id, v]));
  const byVideo = new Map<string, OvPlay[]>();
  for (const p of plays) pushTo(byVideo, p.videoId, p);

  const grouped = new Set<string>();
  const out: OvEntry[] = [];
  for (const s of series) {
    const mine = members
      .filter((m) => m.seriesId === s.id)
      .sort((a, b) => a.position - b.position)
      .filter((m) => byId.has(m.videoId));
    for (const m of members) if (m.seriesId === s.id) grouped.add(m.videoId);
    const eps = mine.map((m, i) => episodeOf(byId.get(m.videoId)!, i + 1, m.label, byVideo));
    out.push(
      entryFrom(
        { key: `s:${s.id}`, kind: 'series', id: s.id, title: s.name, description: s.description, cover: s.cover, rating: s.rating, status: s.status, addedAt: s.createdAt },
        eps
      )
    );
  }
  for (const v of visible) {
    if (grouped.has(v.id)) continue;
    const ep = episodeOf(v, 1, null, byVideo);
    out.push(
      entryFrom(
        { key: `v:${v.id}`, kind: 'single', id: v.id, title: ep.name, description: v.notes, cover: v.thumb, rating: v.rating, status: v.status },
        [ep]
      )
    );
  }
  return out;
}

export function matchesFilter(e: OvEntry, f: OvFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'unrated':
      return e.rating <= 0;
    case 'series':
      return e.kind === 'series';
    case 'removed':
      return e.episodes.some((x) => x.video.where === 'kept');
    default:
      return e.status === f;
  }
}

export function filterCounts(entries: OvEntry[]): Record<OvFilter, number> {
  const out = {} as Record<OvFilter, number>;
  for (const f of OV_FILTERS) out[f.key] = entries.filter((e) => matchesFilter(e, f.key)).length;
  return out;
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Search by title, episode names, keywords and description. */
export function matchesQuery(e: OvEntry, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = [e.title, e.description ?? '', ...e.tags, ...e.episodes.map((x) => `${x.name} ${x.video.filename}`)].map(fold).join('\n');
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** "Episode 2" before "Episode 10". */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function sortEntries(entries: OvEntry[], sort: OvSort): OvEntry[] {
  const list = [...entries];
  const byName = (a: OvEntry, b: OvEntry) => naturalCompare(a.title, b.title);
  switch (sort) {
    case 'added':
      return list.sort((a, b) => b.addedAt - a.addedAt || byName(a, b));
    case 'rating':
      return list.sort((a, b) => b.rating - a.rating || (b.episodeAvg ?? 0) - (a.episodeAvg ?? 0) || byName(a, b));
    case 'name':
      return list.sort(byName);
    case 'plays':
      return list.sort((a, b) => b.plays - a.plays || b.watchedMs - a.watchedMs || byName(a, b));
    case 'length':
      return list.sort((a, b) => b.totalMs - a.totalMs || byName(a, b));
    default:
      return list.sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0) || b.addedAt - a.addedAt || byName(a, b));
  }
}

/**
 * What Play starts: the next episode not watched yet that is still in the
 * library (removed ones are skipped), else the first one in the library.
 */
export function playable(e: OvEntry): OvEpisode | null {
  const from = e.next ? e.episodes.indexOf(e.next) : 0;
  const live = (x: OvEpisode) => x.video.where === 'library';
  return e.episodes.slice(from).find(live) ?? e.episodes.find(live) ?? null;
}

/** Series you are in the middle of, the one watched last first. */
export function continueSeries(entries: OvEntry[]): OvEntry[] {
  return entries
    .filter((e) => e.kind === 'series' && e.next && e.status !== 'dropped' && e.status !== 'completed' && e.watchedCount > 0)
    .sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0));
}

export function topRated(entries: OvEntry[], max = 15): OvEntry[] {
  return entries
    .filter((e) => e.rating > 0)
    .sort((a, b) => b.rating - a.rating || (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0))
    .slice(0, max);
}

export type OvStats = { titles: number; series: number; rated: number; avgRating: number | null; watchedMs: number; removed: number };

export function overviewStats(entries: OvEntry[]): OvStats {
  const rated = entries.filter((e) => e.rating > 0);
  return {
    titles: entries.length,
    series: entries.filter((e) => e.kind === 'series').length,
    rated: rated.length,
    avgRating: rated.length ? Math.round((sum(rated, (e) => e.rating) / rated.length) * 10) / 10 : null,
    watchedMs: sum(entries, (e) => e.watchedMs),
    removed: entries.filter((e) => e.gone).length,
  };
}

/* ------------------------------------------------------------ making series */

const EPISODE_MARK =
  /(?:[\s._\-–—:#(\[]*(?:s\d{1,2}\s*e\d{1,3}|season\s*\d+\s*episode\s*\d+|episode\s*\d+|ep\.?\s*\d+|e\d{1,3}|part\s*\d+|pt\.?\s*\d+|teil\s*\d+|folge\s*\d+|chapter\s*\d+|vol\.?\s*\d+|\d+(?:\s*(?:of|von|\/)\s*\d+)?)[)\]]*)+\s*$/i;

/** "Lecture 03.mp4" and "lecture_4" → "lecture" (what a series of them is called). */
export function seriesBase(name: string): string {
  const plain = name.replace(/\.[a-z0-9]{2,4}$/i, '').trim();
  const stripped = plain.replace(EPISODE_MARK, '').replace(/[\s._\-–—:#]+$/, '').trim();
  return stripped.toLowerCase().replace(/[\s._]+/g, ' ');
}

/** A good name for a new series: the shared start of the names, tidied up. */
export function guessSeriesName(names: string[]): string {
  if (!names.length) return '';
  const plain = names.map((n) => n.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ').trim());
  let prefix = plain[0];
  for (const n of plain.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i].toLowerCase() === n[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  const cleaned = prefix
    .replace(EPISODE_MARK, '')
    .replace(/[\s.\-–—:#(\[]+$/, '')
    .replace(/\s+(?:part|pt|ep|episode|teil|folge|chapter|vol|season)\.?$/i, '')
    .trim();
  if (cleaned.length >= 2) return cleaned === cleaned.toLowerCase() ? cleaned[0].toUpperCase() + cleaned.slice(1) : cleaned;
  return plain.length === 1 ? plain[0] : '';
}

/** Order for new episodes: by name, so "Part 2" comes before "Part 10"; then oldest first. */
export function episodeOrder<T extends Pick<OvVideo, 'title' | 'filename' | 'createdAt'>>(videos: T[]): T[] {
  return [...videos].sort((a, b) => naturalCompare(videoName(a), videoName(b)) || a.createdAt - b.createdAt);
}

/**
 * Videos that look like they belong together (same name apart from a
 * number) and are not in a series yet. Biggest groups first.
 */
export function suggestSeries(videos: OvVideo[], members: OvMember[], max = 6): { name: string; videoIds: string[] }[] {
  const taken = new Set(members.map((m) => m.videoId));
  const groups = new Map<string, OvVideo[]>();
  for (const v of videos) {
    if (taken.has(v.id) || v.isPrivate || v.where === 'trash') continue;
    const name = videoName(v);
    const base = seriesBase(name);
    // Only names that actually had a number taken off; a plain "Holiday" twice is not a series.
    if (base.length < 2 || base === name.toLowerCase().replace(/[\s._]+/g, ' ')) continue;
    pushTo(groups, base, v);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
    .map((g) => {
      const ordered = episodeOrder(g);
      return { name: guessSeriesName(ordered.map(videoName)) || videoName(ordered[0]), videoIds: ordered.map((v) => v.id) };
    });
}

/** Move one episode up (-1) or down (+1); returns the new order of video ids. */
export function moveEpisode(order: string[], videoId: string, dir: -1 | 1): string[] {
  const i = order.indexOf(videoId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** For the Overview header: how your titles split by status, your ratings 1–10, a title to spotlight, what is planned. */
export function overviewInsights(entries: OvEntry[]) {
  const live = entries.filter((e) => !e.gone);
  const statuses = (['watching', 'plantowatch', 'completed', 'hold', 'dropped'] as OvStatus[]).map((s) => ({ key: s, label: OV_STATUS_LABELS[s], count: live.filter((e) => e.status === s).length }));
  const ratings = Array.from({ length: 10 }, (_, i) => ({ score: i + 1, count: entries.filter((e) => e.rating > 0 && Math.min(10, Math.max(1, Math.round(e.rating))) === i + 1).length }));
  const withCover = live.filter((e) => e.cover);
  const spotlight =
    [...withCover].filter((e) => e.status === 'watching' && e.next).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0))[0] ??
    [...withCover].filter((e) => e.rating > 0).sort((a, b) => b.rating - a.rating || (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0))[0] ??
    withCover[0] ??
    null;
  const planned = live.filter((e) => e.status === 'plantowatch').sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
  const ratedShare = entries.length ? entries.filter((e) => e.rating > 0).length / entries.length : 0;
  return { statuses, ratings, spotlight, planned, ratedShare };
}
