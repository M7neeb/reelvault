/**
 * Bring your history in from IMDb or Letterboxd: read their CSV exports and
 * turn them into Simkl requests. Pure (no network, no files), so it is tested
 * in Node. importer.ts sends the batches.
 *
 * IMDb: Your ratings → watched + rated; a list or watchlist export → Plan to Watch.
 *   Matched by IMDb id (tt…), so it is exact.
 * Letterboxd (Settings → Import & Export → Export your data):
 *   watched.csv / diary.csv → watched; ratings.csv → rated (½ stars → 1-10);
 *   watchlist.csv → Plan to Watch. Matched by title and year.
 */

export type ImportSource =
  | 'imdb-ratings'
  | 'imdb-list'
  | 'letterboxd-watched'
  | 'letterboxd-diary'
  | 'letterboxd-ratings'
  | 'letterboxd-watchlist';

export const SOURCE_LABELS: Record<ImportSource, string> = {
  'imdb-ratings': 'IMDb ratings',
  'imdb-list': 'IMDb list / watchlist',
  'letterboxd-watched': 'Letterboxd watched',
  'letterboxd-diary': 'Letterboxd diary',
  'letterboxd-ratings': 'Letterboxd ratings',
  'letterboxd-watchlist': 'Letterboxd watchlist',
};

type Ids = { imdb?: string };
export type ImportEntry = { title: string; year?: number; ids?: Ids; watched_at?: string; rating?: number; rated_at?: string; to?: string };
export type Bucket = 'movies' | 'shows';

export type ImportPlan = {
  source: ImportSource;
  /** POST /sync/history */
  history: Record<Bucket, ImportEntry[]>;
  /** POST /sync/ratings */
  ratings: Record<Bucket, ImportEntry[]>;
  /** POST /sync/add-to-list (Plan to Watch) */
  plan: Record<Bucket, ImportEntry[]>;
  /** Rows that cannot be sent (episodes, games, no title). */
  skipped: number;
  total: number;
};

/* ---------------------------------------------------------------------- CSV */

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** Rows as objects keyed by the header line. */
export function csvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const [head, ...rest] = parseCsv(text);
  const headers = (head ?? []).map((h) => h.trim());
  return {
    headers,
    records: rest.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))),
  };
}

/** Letterboxd's watchlist.csv has the same columns as watched.csv, so the file name tells them apart. */
export function detectSource(headers: string[], fileName = ''): ImportSource | null {
  const h = new Set(headers.map((x) => x.toLowerCase()));
  if (h.has('const') && h.has('title type')) return h.has('your rating') && !h.has('position') ? 'imdb-ratings' : 'imdb-list';
  if (h.has('letterboxd uri') && h.has('name')) {
    if (h.has('watched date')) return 'letterboxd-diary';
    if (h.has('rating')) return 'letterboxd-ratings';
    return /watchlist/i.test(fileName) ? 'letterboxd-watchlist' : 'letterboxd-watched';
  }
  return null;
}

/* ----------------------------------------------------------------- mapping */

const MOVIE_TYPES = new Set(['movie', 'tv movie', 'short', 'video', 'tv special', 'tvmovie', 'tvspecial', 'tvshort']);
const SHOW_TYPES = new Set(['tv series', 'tv mini series', 'tvseries', 'tvminiseries']);

function imdbBucket(titleType: string): Bucket | null {
  const t = titleType.toLowerCase();
  if (MOVIE_TYPES.has(t)) return 'movies';
  if (SHOW_TYPES.has(t)) return 'shows';
  return null;
}

/** "2024-03-09" (or a full timestamp) → ISO at noon UTC, so the day survives time zones. */
export function isoDay(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`;
}

const year = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 1800 && n < 2200 ? n : undefined;
};

/** Letterboxd ½-5 stars → Simkl 1-10. */
export function starsToTen(v: string | undefined): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(1, Math.min(10, Math.round(n * 2)));
}

/** IMDb's 1-10. */
function tenScale(v: string | undefined): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : undefined;
}

const empty = (): Record<Bucket, ImportEntry[]> => ({ movies: [], shows: [] });

export function planImport(text: string, fileName = ''): ImportPlan | null {
  const { headers, records } = csvRecords(text);
  const source = detectSource(headers, fileName);
  if (!source) return null;
  const out: ImportPlan = { source, history: empty(), ratings: empty(), plan: empty(), skipped: 0, total: records.length };
  // Diary exports repeat a film for every rewatch; the first watch is enough for history.
  const seen = new Set<string>();

  for (const r of records) {
    if (source.startsWith('imdb')) {
      const bucket = imdbBucket(r['Title Type'] ?? '');
      const id = r['Const'];
      if (!bucket || !/^tt\d+$/.test(id ?? '') || !r['Title']) {
        out.skipped++;
        continue;
      }
      const base: ImportEntry = { title: r['Title'], year: year(r['Year']), ids: { imdb: id } };
      if (source === 'imdb-ratings') {
        const rating = tenScale(r['Your Rating']);
        const when = isoDay(r['Date Rated']);
        // Movies count as watched; a rated show only gets the rating (we do not know which episodes).
        if (bucket === 'movies') out.history.movies.push({ ...base, watched_at: when });
        if (rating) out.ratings[bucket].push({ ...base, rating, rated_at: when });
      } else {
        out.plan[bucket].push({ ...base, to: 'plantowatch' });
      }
      continue;
    }

    const name = r['Name'];
    if (!name) {
      out.skipped++;
      continue;
    }
    const base: ImportEntry = { title: name, year: year(r['Year']) };
    const key = `${name}|${base.year ?? ''}`;
    if (source === 'letterboxd-watchlist') {
      out.plan.movies.push({ ...base, to: 'plantowatch' });
      continue;
    }
    const when = isoDay(r['Watched Date'] || r['Date']);
    if (!seen.has(key)) {
      seen.add(key);
      out.history.movies.push({ ...base, watched_at: when });
    }
    const rating = starsToTen(r['Rating']);
    if (rating && (source === 'letterboxd-ratings' || source === 'letterboxd-diary')) {
      // Diary: the latest row wins (exports are oldest first).
      const list = out.ratings.movies;
      const at = list.findIndex((e) => e.title === name && e.year === base.year);
      const entry = { ...base, rating, rated_at: isoDay(r['Date']) };
      if (at >= 0) list[at] = entry;
      else list.push(entry);
    }
  }
  return out;
}

/** Split a list into request-sized pieces. */
export function chunk<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type ImportResult = {
  source: ImportSource;
  watched: number;
  rated: number;
  planned: number;
  skipped: number;
  /** Titles Simkl could not match. */
  notFound: string[];
};

/** "Added 412 watched, 380 ratings · 6 not found". */
export function describeImport(r: ImportResult): string {
  const parts = [
    r.watched && `${r.watched} watched`,
    r.rated && `${r.rated} ratings`,
    r.planned && `${r.planned} to Plan to Watch`,
  ].filter(Boolean);
  const tail = [r.notFound.length && `${r.notFound.length} not found`, r.skipped && `${r.skipped} skipped`].filter(Boolean);
  return `${parts.length ? `Added ${parts.join(', ')}` : 'Nothing new to add'}${tail.length ? ` · ${tail.join(', ')}` : ''}`;
}

/** Counts from a Simkl write response: how many went in, and which titles were not matched. */
export function readWriteResponse(json: any): { added: number; notFound: string[] } {
  const a = json?.added ?? {};
  const added = ['movies', 'shows', 'anime'].reduce((n, k) => n + (typeof a[k] === 'number' ? a[k] : 0), 0);
  const nf = json?.not_found ?? {};
  const notFound: string[] = [];
  for (const k of ['movies', 'shows', 'anime']) {
    for (const e of Array.isArray(nf[k]) ? nf[k] : []) notFound.push(e?.title ? `${e.title}${e.year ? ` (${e.year})` : ''}` : (e?.ids?.imdb ?? '?'));
  }
  return { added, notFound };
}
