/** The Clips feed: your short videos, newest first or shuffled. Pure, so it runs in Node tests. */

export const CLIP_MAX_MS = 3 * 60_000;

type ClipLike = { id: string; durationMs: number | null; importedAt: number; isPrivate: boolean; deletedAt: number | null };

export function clipsOf<T extends ClipLike>(videos: T[], order: 'newest' | 'shuffle', seed = 1): T[] {
  const clips = videos.filter((v) => !v.isPrivate && !v.deletedAt && v.durationMs !== null && v.durationMs > 0 && v.durationMs <= CLIP_MAX_MS);
  clips.sort((a, b) => b.importedAt - a.importedAt || (a.id < b.id ? -1 : 1));
  if (order === 'newest') return clips;
  // Fisher-Yates with a small seeded random, so the same seed gives the same feed.
  let s = Math.max(1, Math.floor(seed)) % 2147483647;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = clips.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [clips[i], clips[j]] = [clips[j], clips[i]];
  }
  return clips;
}
