/** Watch status. The same values Simkl uses, so the whole app shares one vocabulary. */
export type WatchStatus = 'plantowatch' | 'watching' | 'completed' | 'hold' | 'dropped';

/** A video in the vault. Mirrors the `videos` table. */
export type Video = {
  id: string;
  uri: string;
  filename: string;
  size: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** 0 = unrated, otherwise 1..10 */
  rating: number;
  title: string | null;
  notes: string | null;
  /** the video's own timestamp (ms since epoch) */
  createdAt: number;
  /** when ReelVault imported it (ms since epoch) */
  importedAt: number;
  status: WatchStatus | null;
  /** set while the video sits in Recently Deleted (ms since epoch) */
  deletedAt: number | null;
  isPrivate: boolean;
  /** size + hash of the first and last 1 MB; equal keys mean duplicates */
  contentKey: string | null;
};
