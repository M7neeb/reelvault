/**
 * Matching the titles ReelVault holds to the same titles in a Suwayomi
 * server's library. Pure (tested in tests/manga-link.test.mjs).
 *
 * A title is the same title when it points at the same page on the same
 * extension: Tachimanga, Tachiyomi and Suwayomi all keep the source's own
 * path for a title, so two rows for one series share that path exactly. The
 * title is only the fallback for the rare row whose path was rewritten (a
 * source that moved its pages), and chapters are matched by their number.
 *
 * Linking this way needs nothing from the sites: the server already has the
 * library, so one request is enough for all of it.
 */

import { normTitle } from './mangaLogic.ts';

/** A chapter as the server has it. */
export type LibraryChapter = { id: number; number: number | null };
/** A title as the server has it: its id there, the path on its source, its chapters. */
export type LibraryTitle = { id: number; url: string | null; title: string; chapters: LibraryChapter[] };
/** Your series, as far as matching cares. */
export type LinkableSeries = { id: string; title: string; sourceKey: string | null; chapters: { id: string; number: number | null }[] };

export type LinkPlan = {
  seriesId: string;
  /** The title's id on the server. */
  mangaId: number;
  how: 'url' | 'title';
  /** Your chapters, each with the id the server knows it by. */
  chapters: { chapterId: string; sourceKey: number }[];
};

/**
 * A page address reduced to what can be compared: no scheme, host, query or
 * fragment, one form of slashes, no trailing slash, decoded, lower case.
 * "/comics/album/X" and "https://comics.8muses.com/comics/album/X/" are the
 * same page, and this says so.
 */
export function sourcePath(url: string | null | undefined): string | null {
  if (!url) return null;
  let s = String(url).trim();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  s = s.split('#')[0].split('?')[0];
  try {
    s = decodeURIComponent(s);
  } catch {
    // A stray "%" in the path: compare it as it is.
  }
  s = s.replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\/+$/, '');
  return s && s !== '/' ? s.toLowerCase() : null;
}

/** Your chapters paired with the server's, by chapter number (the only thing both sides agree on). */
export function planChapters(local: { id: string; number: number | null }[], remote: LibraryChapter[]): { chapterId: string; sourceKey: number }[] {
  const byNumber = new Map<number, LibraryChapter>();
  for (const c of remote) {
    // Two copies of one chapter (scanlators): the first is the one the list starts with.
    if (c.number !== null && !byNumber.has(c.number)) byNumber.set(c.number, c);
  }
  const out: { chapterId: string; sourceKey: number }[] = [];
  for (const c of local) {
    if (c.number === null) continue;
    const r = byNumber.get(c.number);
    if (r) out.push({ chapterId: c.id, sourceKey: r.id });
  }
  return out;
}

/**
 * Which of your series is which title on the server. Each title is used once:
 * a path match wins over a title match, and nothing is linked twice.
 */
export function planLinks(series: LinkableSeries[], library: LibraryTitle[]): LinkPlan[] {
  const byPath = new Map<string, LibraryTitle>();
  const byTitle = new Map<string, LibraryTitle>();
  for (const t of library) {
    const p = sourcePath(t.url);
    if (p && !byPath.has(p)) byPath.set(p, t);
    const n = normTitle(t.title);
    if (n && !byTitle.has(n)) byTitle.set(n, t);
  }
  const used = new Set<number>();
  const taken = new Set<string>();
  const hits: { series: LinkableSeries; title: LibraryTitle; how: 'url' | 'title' }[] = [];
  for (const s of series) {
    const p = sourcePath(s.sourceKey);
    const hit = p ? byPath.get(p) : undefined;
    if (!hit || used.has(hit.id)) continue;
    used.add(hit.id);
    taken.add(s.id);
    hits.push({ series: s, title: hit, how: 'url' });
  }
  for (const s of series) {
    if (taken.has(s.id)) continue;
    const n = normTitle(s.title);
    const hit = n ? byTitle.get(n) : undefined;
    if (!hit || used.has(hit.id)) continue;
    used.add(hit.id);
    hits.push({ series: s, title: hit, how: 'title' });
  }
  return hits.map((h) => ({ seriesId: h.series.id, mangaId: h.title.id, how: h.how, chapters: planChapters(h.series.chapters, h.title.chapters) }));
}
