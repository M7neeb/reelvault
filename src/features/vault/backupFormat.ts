/**
 * The library-info backup file: everything the user added to their videos
 * (ratings, titles, keywords, albums, flags, status, dates, smart filters) -
 * not the videos themselves. Pure functions, no imports; `backup.ts` does the
 * reading and writing.
 *
 * Videos are matched back by their content key (size + hash of both ends),
 * which survives renaming, and by name + size when that is missing.
 */

export const BACKUP_KIND = 'reelvault-library-info';
export const BACKUP_VERSION = 1;

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
