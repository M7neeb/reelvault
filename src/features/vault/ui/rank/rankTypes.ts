import type { ThumbSource } from '../types';

export type RankKind = 'video' | 'movie' | 'show' | 'anime';

/** One thing to rank, already resolved for display. */
export type RankCandidate = {
  id: string;
  title: string;
  /** A short line under the title (the date, the year). */
  sub: string | null;
  /** 1..10, or null when not rated. */
  rating: number | null;
  thumb?: ThumbSource | null;
  /** Videos: the file to play, where to start and how long it is. */
  uri?: string | null;
  startMs?: number | null;
  durationMs?: number | null;
  /** Group keys this one belongs to ('tag:Family', 'status:completed'); matched by RankGroup.key. */
  groups: string[];
};

/** A group you can rank on its own: a keyword, an album, a status. */
export type RankGroup = { key: string; label: string };

export const NOUNS: Record<RankKind, { many: string; one: string }> = {
  video: { many: 'videos', one: 'video' },
  movie: { many: 'films', one: 'film' },
  show: { many: 'shows', one: 'show' },
  anime: { many: 'anime', one: 'anime' },
};

export const fmtRating = (r: number) => (Number.isInteger(r) ? `${r}` : r.toFixed(1));
