/**
 * The library-info backup file: everything the user added to their videos
 * (ratings, titles, keywords, albums, flags, status, dates, smart filters,
 * series, and the info kept for removed videos) - not the videos themselves.
 * Version 2 adds your watch history, bookmarks, where to continue, Simkl
 * links and your settings (goals, memories, badges seen, pins, the player).
 * Pure functions, no imports; `backup.ts` does the reading and writing.
 *
 * Videos are matched back by their content key (size + hash of both ends),
 * which survives renaming, and by name + size when that is missing.
 */

export const BACKUP_KIND = 'reelvault-library-info';
export const BACKUP_VERSION = 2;

export type BackupVideo = {
  contentKey: string | null;
  filename: string;
  size: number;
  title: string | null;
  notes: string | null;
  rating: number;
  status: string | null;
  flag: number;
  createdAt: number;
  keywords: string[];
  albums: string[];
  /** v2: every play (start time, ms watched). */
  plays?: [number, number][];
  /** v2: bookmarks (position ms, name, made at). */
  bookmarks?: { atMs: number; label: string | null; createdAt: number }[];
  /** v2: "continue another time". */
  resume?: { positionMs: number; savedAt: number } | null;
  /** v2: the Simkl movie or episode it is linked to. */
  link?: Record<string, unknown> | null;
  inTray?: boolean;
  /** v2: the id the video had, so settings that name videos (pins) can find it again. */
  id?: string;
};

/** A video removed for good: only its info is left. */
export type BackupKept = {
  id: string;
  title: string | null;
  filename: string;
  size: number;
  durationMs: number | null;
  rating: number;
  status: string | null;
  notes: string | null;
  keywords: string[];
  createdAt: number;
  importedAt: number;
  removedAt: number;
};

/** An episode points at a video in `videos` (by index) or at a removed one in `kept` (by id). */
export type BackupSeries = {
  name: string;
  description: string | null;
  rating: number;
  status: string | null;
  episodes: { video?: number; kept?: string; label: string | null }[];
};

export type Backup = {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAt: number;
  videos: BackupVideo[];
  albums: { name: string; folder: string | null; pinned: boolean }[];
  folders: string[];
  smartFilters: { name: string; rule: unknown; folder: string | null }[];
  pinnedKeywords: string[];
  kept: BackupKept[];
  series: BackupSeries[];
  /** v2: your settings (vault.prefs), as saved. */
  prefs?: Record<string, unknown> | null;
  /** Overview reviews, rewatches, Plan to Watch order and rating history; series as 'S:<name>'. */
  overview?: unknown;
};

/** Reads a backup file; null when it isn't one. */
export function parseBackup(json: string): Backup | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<Backup>;
  if (b.kind !== BACKUP_KIND || !Array.isArray(b.videos)) return null;
  return {
    kind: BACKUP_KIND,
    version: typeof b.version === 'number' ? b.version : 1,
    exportedAt: typeof b.exportedAt === 'number' ? b.exportedAt : 0,
    videos: b.videos.filter((v) => v && typeof v.filename === 'string'),
    albums: Array.isArray(b.albums) ? b.albums : [],
    folders: Array.isArray(b.folders) ? b.folders.filter((f) => typeof f === 'string') : [],
    smartFilters: Array.isArray(b.smartFilters) ? b.smartFilters : [],
    pinnedKeywords: Array.isArray(b.pinnedKeywords) ? b.pinnedKeywords.filter((k) => typeof k === 'string') : [],
    kept: Array.isArray(b.kept) ? b.kept.filter((k) => k && typeof k.id === 'string' && typeof k.filename === 'string') : [],
    prefs: b.prefs && typeof b.prefs === 'object' && !Array.isArray(b.prefs) ? (b.prefs as Record<string, unknown>) : null,
    overview: b.overview && typeof b.overview === 'object' ? b.overview : null,
    series: Array.isArray(b.series)
      ? b.series
          .filter((x) => x && typeof x.name === 'string' && Array.isArray(x.episodes))
          .map((x) => ({
            name: x.name,
            description: typeof x.description === 'string' ? x.description : null,
            rating: typeof x.rating === 'number' ? x.rating : 0,
            status: typeof x.status === 'string' ? x.status : null,
            episodes: x.episodes.filter((e) => e && (typeof e.video === 'number' || typeof e.kept === 'string')),
          }))
      : [],
  };
}

type Target = { id: string; contentKey: string | null; filename: string; size: number };

/** Which video in the library each backup entry belongs to (backup index -> video id). */
export function matchBackup(backup: Backup, library: Target[]): Map<number, string> {
  const byKey = new Map<string, string>();
  const byNameSize = new Map<string, string>();
  for (const v of library) {
    if (v.contentKey) byKey.set(v.contentKey, v.id);
    byNameSize.set(`${v.filename}|${v.size}`, v.id);
  }
  const out = new Map<number, string>();
  backup.videos.forEach((entry, i) => {
    const id =
      (entry.contentKey ? byKey.get(entry.contentKey) : undefined) ?? byNameSize.get(`${entry.filename}|${entry.size}`);
    if (id) out.set(i, id);
  });
  return out;
}

/**
 * The episodes of each backed-up series as ids in this library: matched
 * videos, and removed videos' kept ids. Episodes that match nothing are left out.
 */
export function seriesEpisodes(
  backup: Backup,
  matches: Map<number, string>
): { series: BackupSeries; episodes: { videoId: string; label: string | null }[] }[] {
  const kept = new Set(backup.kept.map((k) => k.id));
  return backup.series.map((series) => ({
    series,
    episodes: series.episodes.flatMap((e) => {
      const id = typeof e.video === 'number' ? matches.get(e.video) : e.kept && kept.has(e.kept) ? e.kept : undefined;
      return id ? [{ videoId: id, label: e.label ?? null }] : [];
    }),
  }));
}

/**
 * Puts restored settings together with the ones on the phone: lists are
 * joined (favourite memories, hidden ones, seen ones, your own memories,
 * badges seen, events), pinned videos are renamed to their ids in this
 * library, and single settings come from the backup only where the phone
 * still has nothing of its own (an empty list, no goal set yet).
 */
export function mergePrefs(current: Record<string, unknown>, saved: Record<string, unknown>, idMap: Map<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const union = (a: unknown[], b: unknown[], key: (x: unknown) => string = (x) => JSON.stringify(x)) => {
    const seen = new Set(a.map(key));
    return [...a, ...b.filter((x) => !seen.has(key(x)))];
  };
  for (const k of ['memoryFavs', 'memoryHidden', 'memoriesSeen', 'hiddenSuggestions', 'showcase']) {
    out[k] = union(arr(current[k]), arr(saved[k]));
  }
  out.badgesSeen = current.badgesSeen === null && saved.badgesSeen ? saved.badgesSeen : union(arr(current.badgesSeen), arr(saved.badgesSeen));
  out.customMemories = union(arr(current.customMemories), arr(saved.customMemories), (x) => String((x as { id?: unknown })?.id));
  out.events = union(arr(current.events), arr(saved.events)).slice(-3000);
  const pins = arr(saved.pinned)
    .map((id) => (typeof id === 'string' ? idMap.get(id) : undefined))
    .filter((x): x is string => !!x);
  out.pinned = union(arr(current.pinned), pins).slice(0, 60);
  // Singles: only where the phone has nothing of its own yet.
  const blank = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
  for (const k of ['ratingLabels', 'player', 'slideshow', 'freezes', 'weeklyGoalMin', 'albumSort', 'liveSound', 'resumeEnabled', 'holdForSpeed', 'keepUnrated', 'videosMode']) {
    if (blank(current[k]) && !blank(saved[k])) out[k] = saved[k];
  }
  if (current.ratingLabels && typeof current.ratingLabels === 'object' && Object.keys(current.ratingLabels as object).length === 0 && saved.ratingLabels) out.ratingLabels = saved.ratingLabels;
  return out;
}
