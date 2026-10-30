/**
 * Suwayomi (Tachidesk) server, through its GraphQL API (/api/graphql). The
 * server runs the extensions installed on it; each of its sources becomes a
 * source here, plus "Library" for what is in the server's own library.
 * Logins: none, or the server's basic-auth user name and password.
 */

import type { Http, ImageRef, ListPage, MangaSource, SourceChapter, SourceDetails, SourceSeries } from './types.ts';
import { num, resolveUrl, str, time } from './types.ts';

export type SuwayomiServer = { id: string; name: string; url: string; auth: Record<string, string> };

type GqlManga = { id: number; title: string; thumbnailUrl?: string | null; author?: string | null; artist?: string | null; description?: string | null; genre?: string[]; status?: string; realUrl?: string | null };
type GqlChapter = { id: number; name: string; chapterNumber: number; scanlator?: string | null; uploadDate?: string | number; sourceOrder: number; pageCount?: number; realUrl?: string | null };
export type GqlSource = { id: string; name: string; lang: string; isNsfw: boolean; supportsLatest: boolean; displayName?: string };

const MANGA_FIELDS = 'id title thumbnailUrl author artist description genre status realUrl';

export function suwayomiBase(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/api\/graphql$/, '');
}

async function gql<T>(http: Http, server: SuwayomiServer, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = (await http.json(`${suwayomiBase(server.url)}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...server.auth },
    body: JSON.stringify({ query, variables }),
  })) as { data?: T; errors?: { message?: string }[] };
  if (res.errors?.length) throw new Error(`Suwayomi: ${suwayomiError(res.errors.map((e) => e.message ?? '').join('; '))}`);
  if (!res.data) throw new Error('Suwayomi gave no answer');
  return res.data;
}

/**
 * A server error as one readable line: the server sends Java stack traces.
 * The usual ones say what to do about them.
 */
export function suwayomiError(message: string): string {
  const line = (message.split('\n')[0] ?? '').replace(/^Exception while fetching data \([^)]*\)\s*:\s*/i, '').trim();
  if (/^Source not installed/i.test(line)) return 'the extension this title comes from is not installed on the server. Install it in Suwayomi (Browse, Extensions).';
  if (/cloudflare/i.test(line)) return 'the site is behind Cloudflare. Turn on FlareSolverr in Suwayomi’s settings.';
  if (/HTTP error 5\d\d/i.test(line)) return `the site is down right now (${line.match(/\d{3}/)?.[0]}). Try again later.`;
  if (/^Chapter not found/i.test(line)) return 'the server does not have this chapter’s files.';
  return line.length > 200 ? `${line.slice(0, 200)}…` : line || 'no answer';
}

/** The server's list is out of date with the site: asking it to refresh the title fixes it. */
export const isStaleChapterList = (e: unknown) => /Refresh the chapter list|Collection is empty/i.test(String(e));

/** Makes the server fetch the title's chapter list from the site again. Chapter ids can change. */
export async function suwayomiRefreshChapters(http: Http, server: SuwayomiServer, mangaId: number): Promise<GqlLibraryChapter[]> {
  const data = await gql<{ fetchChapters: { chapters: LibraryChapterRow[] } }>(
    http,
    server,
    'mutation($id: Int!) { fetchChapters(input: { mangaId: $id }) { chapters { id chapterNumber url sourceOrder } } }',
    { id: mangaId }
  );
  return libraryChapters(data.fetchChapters.chapters);
}

const STATUS: Record<string, string> = { ONGOING: 'ongoing', COMPLETED: 'completed', ON_HIATUS: 'hiatus', CANCELLED: 'cancelled', PUBLISHING_FINISHED: 'completed' };

export function suwayomiSeries(m: GqlManga, server: SuwayomiServer): SourceSeries {
  const thumb = str(m.thumbnailUrl);
  const cover: ImageRef | null = thumb ? { uri: resolveUrl(`${suwayomiBase(server.url)}/`, thumb), headers: server.auth } : null;
  return { key: String(m.id), title: m.title || 'Untitled', cover, author: str(m.author) };
}

/** Suwayomi lists chapters newest first (sourceOrder 0 = newest on most sources): reverse to reading order. */
export function suwayomiChapters(list: GqlChapter[]): SourceChapter[] {
  return [...list]
    .sort((a, b) => b.sourceOrder - a.sourceOrder)
    .map((c) => {
      const n = num(c.chapterNumber);
      return {
        key: String(c.id),
        number: n !== null && n >= 0 ? n : null,
        volume: null,
        title: str(c.name),
        scanlator: str(c.scanlator),
        uploadedAt: time(c.uploadDate),
        pageCount: c.pageCount && c.pageCount > 0 ? c.pageCount : null,
        externalUrl: null,
        lang: null,
      };
    });
}

/** The sources a Suwayomi server has (its installed extensions). */
export async function suwayomiSources(http: Http, server: SuwayomiServer): Promise<GqlSource[]> {
  const data = await gql<{ sources: { nodes: GqlSource[] } }>(http, server, 'query { sources { nodes { id name lang isNsfw supportsLatest displayName } } }');
  return data.sources.nodes.filter((s) => s.id !== '0');
}

export type GqlLibraryChapter = { id: number; number: number | null; url: string | null; order: number };

type LibraryChapterRow = { id: number; chapterNumber?: number | null; url?: string | null; sourceOrder?: number | null };

/** Chapters in reading order (Suwayomi's sourceOrder counts from the newest). */
function libraryChapters(rows: LibraryChapterRow[]): GqlLibraryChapter[] {
  return [...rows]
    .sort((a, b) => (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0))
    .map((c, i) => ({ id: c.id, number: num(c.chapterNumber), url: str(c.url), order: i }));
}
export type GqlLibraryTitle = { id: number; url: string | null; title: string; chapters: GqlLibraryChapter[] };

/**
 * A server's whole library with the chapters it already stores, in one
 * request. Nothing is asked of any source, so this answers for 700 titles in
 * about the time one search takes — and it keeps working when the sites are
 * slow or down.
 */
export async function suwayomiLibrary(http: Http, server: SuwayomiServer): Promise<GqlLibraryTitle[]> {
  type Row = { id: number; title: string; url?: string | null; chapters: { nodes: LibraryChapterRow[] } };
  const data = await gql<{ mangas: { nodes: Row[] } }>(
    http,
    server,
    'query { mangas(condition: { inLibrary: true }) { nodes { id title url chapters { nodes { id chapterNumber url sourceOrder } } } } }'
  );
  return data.mangas.nodes.map((m) => ({
    id: m.id,
    url: str(m.url),
    title: m.title || 'Untitled',
    chapters: libraryChapters(m.chapters.nodes),
  }));
}

/** The chapters the server already stores for one title (nothing is asked of the site). */
export async function suwayomiTitleChapters(http: Http, server: SuwayomiServer, mangaId: number): Promise<GqlLibraryChapter[]> {
  const data = await gql<{ manga: { chapters: { nodes: LibraryChapterRow[] } } }>(
    http,
    server,
    'query($id: Int!) { manga(id: $id) { chapters { nodes { id chapterNumber url sourceOrder } } } }',
    { id: mangaId }
  );
  return libraryChapters(data.manga.chapters.nodes);
}

/** One Suwayomi source (an extension on the server), or its library when `source` is null. */
export function suwayomiSource(http: Http, server: SuwayomiServer, source: GqlSource | null): MangaSource {
  const fetchList = async (type: 'SEARCH' | 'POPULAR' | 'LATEST', page: number, query?: string): Promise<ListPage> => {
    if (!source) {
      const data = await gql<{ mangas: { nodes: GqlManga[] } }>(http, server, `query { mangas(condition: { inLibrary: true }) { nodes { ${MANGA_FIELDS} } } }`);
      const all = data.mangas.nodes.filter((m) => !query || m.title.toLowerCase().includes(query.toLowerCase()));
      return { items: page === 1 ? all.map((m) => suwayomiSeries(m, server)) : [], hasMore: false };
    }
    const data = await gql<{ fetchSourceManga: { mangas: GqlManga[]; hasNextPage: boolean } }>(
      http,
      server,
      `mutation($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String) {
        fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query }) { hasNextPage mangas { ${MANGA_FIELDS} } }
      }`,
      { source: source.id, type, page, query: query ?? null }
    );
    return { items: data.fetchSourceManga.mangas.map((m) => suwayomiSeries(m, server)), hasMore: data.fetchSourceManga.hasNextPage };
  };
  return {
    id: `server:${server.id}:${source ? source.id : 'library'}`,
    name: source ? `${source.displayName || source.name}` : `${server.name} · Library`,
    lang: source?.lang ?? 'multi',
    kind: 'server',
    nsfw: source?.isNsfw ?? false,
    hint: source ? `On ${server.name} (Suwayomi)` : 'What is in your Suwayomi library',
    canLatest: source?.supportsLatest ?? false,
    search: (query, page) => fetchList('SEARCH', page, query),
    popular: (page) => fetchList('POPULAR', page),
    latest: (page) => fetchList('LATEST', page),
    details: async (key): Promise<SourceDetails> => {
      const data = await gql<{ fetchManga: { manga: GqlManga } }>(http, server, `mutation($id: Int!) { fetchManga(input: { id: $id }) { manga { ${MANGA_FIELDS} } } }`, { id: Number(key) });
      const m = data.fetchManga.manga;
      return {
        ...suwayomiSeries(m, server),
        altTitles: [],
        artist: str(m.artist),
        description: str(m.description),
        genres: m.genre ?? [],
        pubStatus: m.status ? (STATUS[m.status] ?? null) : null,
        kind: (m.genre ?? []).some((g) => /webtoon|long strip|manhwa|manhua/i.test(g)) ? 'manhwa' : null,
        webUrl: str(m.realUrl),
      };
    },
    chapters: async (key) => {
      const data = await gql<{ fetchChapters: { chapters: GqlChapter[] } }>(
        http,
        server,
        'mutation($id: Int!) { fetchChapters(input: { mangaId: $id }) { chapters { id name chapterNumber scanlator uploadDate sourceOrder pageCount realUrl } } }',
        { id: Number(key) }
      );
      return suwayomiChapters(data.fetchChapters.chapters);
    },
    pages: async (chapterKey) => {
      const data = await gql<{ fetchChapterPages: { pages: string[] } }>(http, server, 'mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }', { id: Number(chapterKey) });
      return data.fetchChapterPages.pages.map((p) => ({ uri: resolveUrl(`${suwayomiBase(server.url)}/`, p), headers: server.auth }));
    },
  };
}
