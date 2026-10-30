/**
 * What a manga source is: somewhere titles, chapters and pages come from.
 * Built-in sources (MangaDex), your own servers (Komga, Kavita and others
 * through OPDS; Suwayomi) and extensions from repos you add all look the same
 * to the rest of the app. Pure types; sources get their network access
 * through an `Http` they are given, so they are tested with a stand-in.
 */

/** A picture somewhere on the network, with the headers it needs (a login, a referer). */
export type ImageRef = { uri: string; headers?: Record<string, string> };

export type HttpInit = { method?: 'GET' | 'POST' | 'PATCH'; headers?: Record<string, string>; body?: string };

export type Http = {
  json: (url: string, init?: HttpInit) => Promise<unknown>;
  text: (url: string, init?: HttpInit) => Promise<string>;
};

/** A title in a list (search results, popular). An OPDS folder is a list of more titles or folders. */
export type SourceSeries = {
  key: string;
  title: string;
  cover: ImageRef | null;
  author?: string | null;
  /** A folder (OPDS navigation): opening it lists more, it isn't a title. */
  folder?: boolean;
};

export type SourceDetails = SourceSeries & {
  altTitles: string[];
  artist: string | null;
  description: string | null;
  genres: string[];
  /** ongoing | completed | hiatus | cancelled, when the source says. */
  pubStatus: string | null;
  /** manga | manhwa | comic, when the source can tell. */
  kind: 'manga' | 'manhwa' | 'comic' | null;
  /** The title's page on the web, for "Open on the website". */
  webUrl: string | null;
};

export type SourceChapter = {
  key: string;
  number: number | null;
  volume: number | null;
  title: string | null;
  scanlator: string | null;
  uploadedAt: number | null;
  pageCount: number | null;
  /** Hosted somewhere else (an official site): opened in the browser, not readable here. */
  externalUrl: string | null;
  lang: string | null;
};

export type ListPage = { items: SourceSeries[]; hasMore: boolean };

export type SourceKind = 'builtin' | 'server' | 'extension';

export type MangaSource = {
  /** Stable id stored on series: "mangadex", "server:<id>", "ext:<id>". */
  id: string;
  name: string;
  /** Main language ("en", "multi"). */
  lang: string;
  kind: SourceKind;
  nsfw: boolean;
  /** One line under the name. */
  hint: string;
  canLatest: boolean;
  search: (query: string, page: number) => Promise<ListPage>;
  popular: (page: number) => Promise<ListPage>;
  latest?: (page: number) => Promise<ListPage>;
  /** OPDS folders. */
  folder?: (key: string, page: number) => Promise<ListPage>;
  details: (key: string) => Promise<SourceDetails>;
  /** In reading order (first to last). */
  chapters: (key: string) => Promise<SourceChapter[]>;
  pages: (chapterKey: string) => Promise<ImageRef[]>;
};

/** What the Browse screens show about a source without calling it. */
export type SourceInfo = Pick<MangaSource, 'id' | 'name' | 'lang' | 'kind' | 'nsfw' | 'hint' | 'canLatest'> & { browsable: boolean };

export const infoOf = (s: MangaSource): SourceInfo => ({
  id: s.id,
  name: s.name,
  lang: s.lang,
  kind: s.kind,
  nsfw: s.nsfw,
  hint: s.hint,
  canLatest: s.canLatest,
  browsable: !!s.folder,
});

/* --------------------------------------------------------------- helpers */

export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
};

export const time = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  }
  return null;
};

/** Resolves `href` against `base` (absolute stays, "/x" goes to the host, "x" next to the base). */
export function resolveUrl(base: string, href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const m = base.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([^?#]*)/i);
  if (!m) return href;
  if (href.startsWith('//')) return `${base.split(':')[0]}:${href}`;
  if (href.startsWith('/')) return m[1] + href;
  const dir = m[2].replace(/[^/]*$/, '');
  const parts = `${dir}${href}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return m[1] + (out.join('/').startsWith('/') ? '' : '/') + out.join('/');
}

/** A Basic login header for a user name and password (both may be empty: no header). */
export function basicAuth(user: string | null | undefined, password: string | null | undefined): Record<string, string> {
  if (!user) return {};
  const raw = `${user}:${password ?? ''}`;
  // UTF-8 bytes of the text (percent-encoding gives them one by one).
  const bytes = (encodeURIComponent(raw).match(/%[0-9A-F]{2}|[^%]/gi) ?? []).map((t) => (t.length === 3 ? parseInt(t.slice(1), 16) : t.charCodeAt(0)));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (b === undefined ? '=' : chars[(n >> 6) & 63]) + (c === undefined ? '=' : chars[n & 63]);
  }
  return { Authorization: `Basic ${out}` };
}
