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
};
