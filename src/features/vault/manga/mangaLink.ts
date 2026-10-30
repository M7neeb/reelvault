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

/** A chapter as the server has it (url: its page on the source; order: its place in reading order). */
export type LibraryChapter = { id: number; number: number | null; url?: string | null; order?: number };
/** A title as the server has it: its id there, the path on its source, its chapters. */
export type LibraryTitle = { id: number; url: string | null; title: string; chapters: LibraryChapter[] };
/** Your series, as far as matching cares. */
export type LinkableSeries = { id: string; title: string; sourceKey: string | null; chapters: LinkableChapter[] };
/** Your chapter: url is the page it came from (a backup keeps it), position its place in reading order. */
export type LinkableChapter = { id: string; number: number | null; url?: string | null; position?: number };

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

/**
 * Your chapters paired with the server's. In order of trust:
 * 1. the same page on the source (backups and the server keep the source's own path);
 * 2. the same chapter number (no number, -1 on the server, is no number);
 * 3. what is left over, when both sides have the same count and nothing tells
 *    them apart (one-shots, chapters without numbers): in reading order.
 * Each server chapter is used once; a second copy of a number (another
 * scanlator) is never taken for a different chapter.
 */
export function planChapters(local: LinkableChapter[], remote: LibraryChapter[]): { chapterId: string; sourceKey: number }[] {
  const realNumber = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) || n < 0 ? null : n);
  const used = new Set<number>();
  const pairs = new Map<string, number>();
  const byPath = new Map<string, LibraryChapter>();
  for (const r of remote) {
    const p = sourcePath(r.url);
    if (p && !byPath.has(p)) byPath.set(p, r);
  }
  for (const c of local) {
    const p = sourcePath(c.url);
    const r = p ? byPath.get(p) : undefined;
    if (r && !used.has(r.id)) {
      used.add(r.id);
      pairs.set(c.id, r.id);
    }
  }
  const byNumber = new Map<number, LibraryChapter>();
  const numbers = new Set<number>();
  for (const r of remote) {
    const n = realNumber(r.number);
    if (n === null) continue;
    numbers.add(n);
    // Two copies of one chapter (scanlators): the first is the one the list starts with.
    if (!byNumber.has(n) && !used.has(r.id)) byNumber.set(n, r);
  }
  for (const c of local) {
    if (pairs.has(c.id)) continue;
    const n = realNumber(c.number);
    const r = n === null ? undefined : byNumber.get(n);
    if (r && !used.has(r.id)) {
      used.add(r.id);
      pairs.set(c.id, r.id);
    }
  }
  // Leftovers: only when nothing else can tell them apart.
  const takenNumbers = new Set<number>();
  for (const c of local) {
    const n = realNumber(c.number);
    if (pairs.has(c.id) && n !== null) takenNumbers.add(n);
  }
  const restL = local
    .map((c, i) => ({ c, at: c.position ?? i }))
    .filter((x) => !pairs.has(x.c.id))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.c);
  const restR = remote
    .map((r, i) => ({ r, at: r.order ?? i }))
    .filter((x) => !used.has(x.r.id) && !(realNumber(x.r.number) !== null && takenNumbers.has(realNumber(x.r.number)!)))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.r);
  const unnumbered = restL.every((c) => realNumber(c.number) === null) && restR.every((r) => realNumber(r.number) === null);
  if (restL.length && restL.length === restR.length && (restL.length === 1 || unnumbered)) {
    restL.forEach((c, i) => pairs.set(c.id, restR[i].id));
  }
  return local.filter((c) => pairs.has(c.id)).map((c) => ({ chapterId: c.id, sourceKey: pairs.get(c.id)! }));
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
