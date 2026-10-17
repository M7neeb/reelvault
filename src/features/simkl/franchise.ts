/**
 * Franchise watch order ("Marvel Cinematic Universe", "The Dark Knight
 * Trilogy"...), from Wikidata: free, no key, and it knows which film belongs
 * to which series and, often, its number in it. Pure (query text + parsing),
 * so it is tested in Node; actions.ts fetches and matches each entry to Simkl.
 */

import type { SimklType } from './logic';

export type FranchiseEntry = {
  /** Wikidata id (Q…). */
  qid: string;
  title: string;
  imdb: string;
  /** Earliest release date, ISO, or null. */
  date: string | null;
  /** The series' own number for it ("6"), when Wikidata has one. */
  ordinal: number | null;
};

export type Franchise = { qid: string; name: string; entries: FranchiseEntry[] };

/** Filled in by the matcher: the Simkl title for an entry, when there is one. */
export type FranchiseItem = FranchiseEntry & { simklId: number | null; type: SimklType | null; poster: string | null; year: number | null };

export const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

/** Every series the title is "part of" (P179), with all their members. */
export function franchiseQuery(imdb: string): string {
  if (!/^tt\d+$/.test(imdb)) throw new Error('not an IMDb id');
  return `SELECT ?series ?seriesLabel ?m ?mLabel ?imdb ?date ?ord WHERE {
  ?film wdt:P345 "${imdb}".
  ?film wdt:P179 ?series.
  ?m p:P179 ?st. ?st ps:P179 ?series.
  OPTIONAL { ?st pq:P1545 ?ord. }
  ?m wdt:P345 ?imdb.
  OPTIONAL { ?m wdt:P577 ?date. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

const qidOf = (uri: string) => uri.split('/').pop() ?? uri;

/**
 * SPARQL rows → one Franchise per series, biggest first (the title's own
 * small series - "The Avengers" - comes after the big one it is part of only
 * when it is bigger). Duplicates (several release dates) are folded.
 */
export function parseFranchises(json: any): Franchise[] {
  const rows: any[] = json?.results?.bindings ?? [];
  const bySeries = new Map<string, { name: string; members: Map<string, FranchiseEntry> }>();
  for (const r of rows) {
    const sq = r.series?.value;
    const mq = r.m?.value;
    const imdb = r.imdb?.value;
    if (!sq || !mq || !imdb || !/^tt\d+$/.test(imdb)) continue;
    const s = bySeries.get(sq) ?? { name: r.seriesLabel?.value ?? qidOf(sq), members: new Map() };
    const id = qidOf(mq);
    const date = typeof r.date?.value === 'string' ? r.date.value.slice(0, 10) : null;
    const ordRaw = r.ord?.value;
    const ord = ordRaw !== undefined && /^\d+(\.\d+)?$/.test(ordRaw) ? Number(ordRaw) : null;
    const prev = s.members.get(id);
    const title = r.mLabel?.value && !/^Q\d+$/.test(r.mLabel.value) ? r.mLabel.value : (prev?.title ?? imdb);
    s.members.set(id, {
      qid: id,
      title,
      imdb,
      date: prev?.date && date ? (prev.date < date ? prev.date : date) : (prev?.date ?? date),
      ordinal: prev?.ordinal ?? ord,
    });
    bySeries.set(sq, s);
  }
  return [...bySeries.entries()]
    .map(([sq, s]) => ({ qid: qidOf(sq), name: s.name, entries: sortRelease([...s.members.values()]) }))
    .filter((f) => f.entries.length >= 2)
    .sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name));
}

/** Release order; titles without a date go last. */
export function sortRelease<T extends FranchiseEntry>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.title.localeCompare(b.title));
}

/** The series' own numbering where it has one (story order for some), then release order. */
export function sortOrdinal<T extends FranchiseEntry>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) || (a.date ?? '9999').localeCompare(b.date ?? '9999')
  );
}

/** Enough entries carry a number for "series order" to mean something. */
export const hasOrdinals = (f: Franchise) => f.entries.filter((e) => e.ordinal !== null).length >= Math.max(2, f.entries.length * 0.6);

/** Simkl's `/search/id` type → ours. */
export function simklTypeOf(t: unknown): SimklType | null {
  return t === 'movie' ? 'movie' : t === 'anime' ? 'anime' : t === 'tv' || t === 'show' ? 'show' : null;
}
