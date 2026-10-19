/**
 * The rows on the library's home (above the grid): recently added, your best,
 * never watched, more of the keyword you watch most, and today's picks (a
 * handful that changes every day). Pure: no React, no database.
 */

export type HomeVideo = { id: string; importedAt: number; createdAt: number; rating: number; tagNames: string[] };
export type HomePlay = { videoId: string; startedAt: number; watchedMs: number };

export type HomeRow<T> = { key: string; title: string; detail: string; videos: T[] };

/** A number from 0 to 1 that is the same all day and different the next. */
function daily(seed: number, i: number): number {
  const x = Math.sin(seed * 9301 + i * 49297) * 233280;
  return x - Math.floor(x);
}

export function homeRows<T extends HomeVideo>(videos: T[], plays: HomePlay[], now: number, max = 12): HomeRow<T>[] {
  if (videos.length < 4) return [];
  const playCount = new Map<string, number>();
  const lastAt = new Map<string, number>();
  for (const p of plays) {
    playCount.set(p.videoId, (playCount.get(p.videoId) ?? 0) + 1);
    lastAt.set(p.videoId, Math.max(lastAt.get(p.videoId) ?? 0, p.startedAt));
  }
  const rows: HomeRow<T>[] = [];

  const recent = [...videos].sort((a, b) => b.importedAt - a.importedAt).slice(0, max);
  rows.push({ key: 'recent', title: 'Recently added', detail: `${recent.length}`, videos: recent });

  const best = videos.filter((v) => v.rating >= 8).sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt).slice(0, max);
  if (best.length >= 3) rows.push({ key: 'best', title: 'Your best', detail: 'Rated 8 and up', videos: best });

  const never = videos.filter((v) => !playCount.has(v.id)).sort((a, b) => b.importedAt - a.importedAt).slice(0, max);
  if (never.length >= 2) rows.push({ key: 'never', title: 'Never watched', detail: `${videos.filter((v) => !playCount.has(v.id)).length} in all`, videos: never });

  // The keyword you spend the most time with: its videos you have seen least lately.
  const tagTime = new Map<string, number>();
  const byId = new Map(videos.map((v) => [v.id, v]));
  for (const p of plays) for (const t of byId.get(p.videoId)?.tagNames ?? []) tagTime.set(t, (tagTime.get(t) ?? 0) + p.watchedMs);
  const topTag = [...tagTime.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topTag) {
    const more = videos
      .filter((v) => v.tagNames.includes(topTag))
      .sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0))
      .slice(0, max);
    if (more.length >= 3) rows.push({ key: 'tag', title: `More #${topTag}`, detail: 'The keyword you watch most', videos: more });
  }

  // Today's picks: the same all day, a new handful tomorrow.
  const day = Math.floor(now / 86_400_000);
  const picks = [...videos]
    .map((v, i) => ({ v, r: daily(day, i) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, Math.min(8, max))
    .map((x) => x.v);
  rows.push({ key: 'today', title: "Today's picks", detail: 'A new handful every day', videos: picks });

  return rows;
}
