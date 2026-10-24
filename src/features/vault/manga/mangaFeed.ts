/**
 * Updates and History, like the big manga apps have:
 * - Updates: chapters that arrived after you added a title (new releases
 *   from its source), newest first, grouped by day.
 * - History: the chapters you read, most recent first, grouped by day; one
 *   line per title per day.
 * Private and deleted titles are left out. Pure: no React, no database.
 */

import type { MangaChapter, MangaSeries } from './mangaLogic.ts';

type Series = Pick<MangaSeries, 'id' | 'title' | 'isPrivate' | 'deletedAt' | 'importedAt'> & { chapters: MangaChapter[] };

export type FeedRow = { seriesId: string; title: string; chapter: MangaChapter; at: number };
export type FeedDay = { key: string; label: string; rows: FeedRow[] };

const DAY = 86_400_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "Today", "Yesterday", "Monday" (this week), else "12 Oct" (and the year when it isn't this one). */
export function dayLabel(t: number, now: number): string {
  const diff = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = new Date(t);
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

function byDay(rows: FeedRow[], now: number): FeedDay[] {
  const out: FeedDay[] = [];
  for (const r of rows) {
    const key = String(startOfDay(r.at));
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else out.push({ key, label: dayLabel(r.at, now), rows: [r] });
  }
  return out;
}

const visible = (s: Series) => !s.isPrivate && !s.deletedAt;

/** New chapters (arrived at least a minute after the title was added), newest first. */
export function updatesFeed(series: Series[], now: number, days = 90): FeedDay[] {
  const from = now - days * DAY;
  const rows: FeedRow[] = [];
  for (const s of series.filter(visible))
    for (const c of s.chapters) if (c.addedAt > s.importedAt + 60_000 && c.addedAt >= from) rows.push({ seriesId: s.id, title: s.title, chapter: c, at: c.addedAt });
  return byDay(rows.sort((a, b) => b.at - a.at || (b.chapter.number ?? 0) - (a.chapter.number ?? 0)), now);
}

/** What you read, newest first: per title per day, the last chapter you finished that day. */
export function historyFeed(series: Series[], now: number, limit = 200): FeedDay[] {
  const rows: FeedRow[] = [];
  for (const s of series.filter(visible)) {
    const perDay = new Map<number, MangaChapter>();
    for (const c of s.chapters) {
      if (c.readAt === null) continue;
      const d = startOfDay(c.readAt);
      const cur = perDay.get(d);
      if (!cur || (cur.readAt ?? 0) < c.readAt) perDay.set(d, c);
    }
    for (const c of perDay.values()) rows.push({ seriesId: s.id, title: s.title, chapter: c, at: c.readAt! });
  }
  return byDay(rows.sort((a, b) => b.at - a.at).slice(0, limit), now);
}

/** How many new chapters you haven't read yet (for the menu badge). */
export function unreadUpdates(days: FeedDay[]): number {
  return days.reduce((a, d) => a + d.rows.filter((r) => !r.chapter.readAt).length, 0);
}
