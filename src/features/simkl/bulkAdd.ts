/**
 * Adding many titles to a list at once: a pasted list of names (one per line,
 * from Notes, a website or a spreadsheet) is cleaned up, and each name is
 * matched to the best Simkl search result. Pure: no React, no native modules
 * (tested in Node).
 */

import type { CatalogTitle } from './logic';

export type WantedTitle = { line: string; name: string; year: number | null };

/**
 * One title per line. Bullets, numbering ("1.", "12)"), checkboxes and a
 * trailing "- 9/10" are dropped; a year in brackets is kept apart to help the
 * match. Commas also split a single line of names. Repeats go.
 */
export function parseTitleLines(text: string): WantedTitle[] {
  const raw = text.split(/\r?\n/);
  const lines = raw.length === 1 && raw[0].includes(',') ? raw[0].split(',') : raw;
  const seen = new Set<string>();
  const out: WantedTitle[] = [];
  for (const line of lines) {
    let name = line
      .replace(/^\s*(?:[-*•·–—]+|\[[ xX✓]?\]|☐|☑|✅|\d{1,4}\s*[.)\]])\s*/, '')
      .replace(/\s+[-–—|]\s*\d{1,2}(?:[.,]\d)?\s*\/\s*10\s*$/, '')
      .trim();
    let year: number | null = null;
    const y = /\s*[([]\s*((?:19|20)\d{2})\s*[)\]]\s*$/.exec(name);
    if (y) {
      year = Number(y[1]);
      name = name.slice(0, y.index).trim();
    }
    if (!name) continue;
    const key = `${normTitle(name)}|${year ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ line: line.trim(), name, year });
  }
  return out;
}

/** Lower case, no punctuation or extra spaces, "&" as "and" ("Re:Zero" and "re zero" match). */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Spaces and punctuation (letters of every language are kept).
    .replace(/[\s\-_.,:;!?'"`’‘“”()[\]{}|\\/<>*+=~#@$%^…·・：！？、。「」『』]+/g, ' ')
    .trim();
}

/**
 * The search result that is this title: the same name (and year, when given)
 * first, then the same name, then the first result when it starts with the
 * name. null when nothing is close enough to add without asking.
 */
export function pickMatch(wanted: WantedTitle, results: CatalogTitle[]): CatalogTitle | null {
  if (!results.length) return null;
  const n = normTitle(wanted.name);
  const same = results.filter((r) => normTitle(r.title) === n);
  if (wanted.year) {
    const both = same.find((r) => r.year === wanted.year) ?? results.find((r) => r.year === wanted.year && normTitle(r.title).startsWith(n));
    if (both) return both;
  }
  if (same.length) return same[0];
  const first = results[0];
  const f = normTitle(first.title);
  if (n.length >= 3 && (f.startsWith(n) || n.startsWith(f))) return first;
  return null;
}

/** A Google search for the title, with its kind and year so the right one comes first. */
export function googleUrl(title: { title: string; year: number | null; type: CatalogTitle['type'] }): string {
  const kind = title.type === 'anime' ? 'anime' : title.type === 'show' ? 'TV series' : 'movie';
  const q = [title.title, title.year, kind].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
