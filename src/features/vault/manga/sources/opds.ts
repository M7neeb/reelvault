/**
 * OPDS 1.2 catalogs: what Komga, Kavita and many comic servers offer. The
 * catalog's folders are browsed as folders; a feed of books is a series and
 * its books are the chapters. Pages are read with the Page Streaming
 * Extension (OPDS-PSE), which Komga and Kavita support. A book a server only
 * offers as a file download waits for the downloads update.
 */

import { findAll, findFirst, parseXml, textOf, type XmlElement } from '../../audio/xml.ts';
import { parseChapterName } from '../mangaLogic.ts';
import type { Http, ImageRef, ListPage, MangaSource, SourceChapter, SourceDetails, SourceSeries } from './types.ts';
import { resolveUrl, str, time } from './types.ts';

const PSE = 'http://vaemendis.net/opds-pse/stream';
const THUMB = ['http://opds-spec.org/image/thumbnail', 'http://opds-spec.org/thumbnail', 'x-stanza-cover-image-thumbnail'];
const IMAGE = ['http://opds-spec.org/image', 'http://opds-spec.org/cover', 'x-stanza-cover-image'];

export type OpdsEntry = {
  id: string;
  title: string;
  author: string | null;
  summary: string | null;
  updated: number | null;
  thumb: string | null;
  image: string | null;
  /** A feed this entry opens: books (acquisition) or more folders (navigation). */
  feed: { href: string; books: boolean } | null;
  /** Page streaming: the address with {pageNumber}, and how many pages. */
  pse: { href: string; count: number } | null;
  /** A file to download (.cbz, .pdf...). */
  file: string | null;
};

export type OpdsFeed = { title: string; subtitle: string | null; entries: OpdsEntry[]; next: string | null; search: string | null; searchType: string | null };

const links = (el: XmlElement) => findAll(el, 'link').filter((l) => l !== el);

/** One Atom feed, every href made absolute against `url`. */
export function parseOpdsFeed(xml: string, url: string): OpdsFeed {
  const root = parseXml(xml);
  const feed = findFirst(root, 'feed');
  if (!feed) throw new Error('This address is not an OPDS catalog (no Atom feed)');
  const abs = (h: string | undefined) => (h ? resolveUrl(url, h) : null);
  const entries: OpdsEntry[] = [];
  for (const e of feed.children) {
    if (typeof e === 'string' || e.name !== 'entry') continue;
    let thumb: string | null = null;
    let image: string | null = null;
    let feedLink: OpdsEntry['feed'] = null;
    let pse: OpdsEntry['pse'] = null;
    let file: string | null = null;
    for (const l of links(e)) {
      const rel = l.attrs.rel ?? '';
      const type = (l.attrs.type ?? '').toLowerCase();
      const href = abs(l.attrs.href);
      if (!href) continue;
      if (THUMB.includes(rel)) thumb = thumb ?? href;
      else if (IMAGE.includes(rel)) image = image ?? href;
      else if (rel === PSE) pse = { href, count: Number(l.attrs['pse:count'] ?? l.attrs.count ?? 0) || 0 };
      else if (rel.startsWith('http://opds-spec.org/acquisition')) file = file ?? href;
      else if (type.includes('atom+xml') && (rel === 'subsection' || rel === '' || rel === 'alternate' || rel.startsWith('http://opds-spec.org/'))) {
        if (!feedLink) feedLink = { href, books: type.includes('kind=acquisition') };
      }
    }
    entries.push({
      id: textOf(findFirst(e, 'id')) || `${entries.length}`,
      title: textOf(findFirst(e, 'title')) || 'Untitled',
      author: str(textOf(findFirst(findFirst(e, 'author') ?? e, 'name'))),
      summary: str(textOf(findFirst(e, 'summary'))) ?? str(textOf(findFirst(e, 'content'))),
      updated: time(textOf(findFirst(e, 'updated'))),
      thumb,
      image,
      feed: feedLink,
      pse,
      file,
    });
  }
  let next: string | null = null;
  let search: string | null = null;
  let searchType: string | null = null;
  for (const l of feed.children) {
    if (typeof l === 'string' || l.name !== 'link') continue;
    if (l.attrs.rel === 'next') next = abs(l.attrs.href);
    if (l.attrs.rel === 'search') {
      search = abs(l.attrs.href);
      searchType = (l.attrs.type ?? '').toLowerCase();
    }
  }
  return { title: textOf(findFirst(feed, 'title')) || 'Catalog', subtitle: str(textOf(findFirst(feed, 'subtitle'))), entries, next, search, searchType };
}

/** The search address from an OpenSearch description, with {searchTerms} in it. */
export function parseOpenSearch(xml: string, url: string): string | null {
  const root = parseXml(xml);
  const urls = findAll(root, 'url');
  const pick = urls.find((u) => (u.attrs.type ?? '').includes('atom')) ?? urls[0];
  return pick?.attrs.template ? resolveUrl(url, pick.attrs.template) : null;
}

/** A book the list shows as a title of its own (a one-chapter series): its facts travel in the key. */
type BookKey = { t: string; p: OpdsEntry['pse']; f: string | null; c: string | null; a: string | null; s: string | null };

export function opdsSeries(e: OpdsEntry, auth: Record<string, string>): SourceSeries {
  const img = e.thumb ?? e.image;
  const cover: ImageRef | null = img ? { uri: img, headers: auth } : null;
  if (e.feed && !e.pse) return { key: `feed:${e.feed.href}`, title: e.title, cover, author: e.author, folder: !e.feed.books };
  const book: BookKey = { t: e.title, p: e.pse, f: e.file, c: img, a: e.author, s: e.summary };
  return { key: `book:${JSON.stringify(book)}`, title: e.title, cover, author: e.author };
}

export function opdsChapter(e: OpdsEntry): SourceChapter {
  const p = parseChapterName(e.title);
  return {
    key: e.pse ? `pse:${JSON.stringify(e.pse)}` : `file:${e.file ?? ''}`,
    number: p.number,
    volume: p.volume,
    title: p.number === null ? e.title : p.title,
    scanlator: null,
    uploadedAt: e.updated,
    pageCount: e.pse?.count || null,
    externalUrl: null,
    lang: null,
  };
}

/** The page addresses of a streamed book (pages count from 0). */
export function psePages(pse: { href: string; count: number }, auth: Record<string, string>): ImageRef[] {
  return Array.from({ length: pse.count }, (_, i) => ({ uri: pse.href.replace(/\{pageNumber\}/g, String(i)).replace(/\{maxWidth\}/g, '1600'), headers: auth }));
}

export type OpdsServer = { id: string; name: string; url: string; auth: Record<string, string> };

export function opdsSource(http: Http, server: OpdsServer): MangaSource {
  const get = async (url: string) => parseOpdsFeed(await http.text(url, { headers: { Accept: 'application/atom+xml, application/xml, text/xml', ...server.auth } }), url);
  // The address of page N of a feed is only known by following "next" links: remember them.
  const nextOf = new Map<string, string>();
  const pageUrl = async (start: string, page: number): Promise<string | null> => {
    let url: string | null = start;
    for (let i = 1; i < page && url; i++) {
      const key: string = `${url}#next`;
      if (!nextOf.has(key)) nextOf.set(key, (await get(url)).next ?? '');
      url = nextOf.get(key) || null;
    }
    return url;
  };
  const listOf = async (start: string, page: number): Promise<ListPage> => {
    const url = await pageUrl(start, page);
    if (!url) return { items: [], hasMore: false };
    const feed = await get(url);
    if (feed.next) nextOf.set(`${url}#next`, feed.next);
    return { items: feed.entries.map((e) => opdsSeries(e, server.auth)), hasMore: !!feed.next };
  };
  let searchTemplate: string | null | undefined;
  return {
    id: `server:${server.id}`,
    name: server.name,
    lang: 'multi',
    kind: 'server',
    nsfw: false,
    hint: 'Your server (OPDS)',
    canLatest: false,
    popular: (page) => listOf(server.url, page),
    folder: (key, page) => listOf(key.replace(/^feed:/, ''), page),
    search: async (query, page) => {
      if (searchTemplate === undefined) {
        const root = await get(server.url);
        searchTemplate = null;
        if (root.search) {
          if (root.searchType?.includes('opensearchdescription')) {
            searchTemplate = parseOpenSearch(await http.text(root.search, { headers: server.auth }), root.search);
          } else searchTemplate = root.search;
        }
      }
      if (!searchTemplate) throw new Error('This server has no search; browse its folders instead');
      return listOf(searchTemplate.replace(/\{searchTerms\}/g, encodeURIComponent(query)), page);
    },
    details: async (key): Promise<SourceDetails> => {
      if (key.startsWith('book:')) {
        const b = JSON.parse(key.slice(5)) as BookKey;
        return { key, title: b.t, cover: b.c ? { uri: b.c, headers: server.auth } : null, author: b.a, altTitles: [], artist: null, description: b.s, genres: [], pubStatus: null, kind: null, webUrl: null };
      }
      const feed = await get(key.replace(/^feed:/, ''));
      const first = feed.entries[0];
      const img = first?.thumb ?? first?.image ?? null;
      return {
        key,
        title: feed.title,
        cover: img ? { uri: img, headers: server.auth } : null,
        author: first?.author ?? null,
        altTitles: [],
        artist: null,
        description: feed.subtitle ?? first?.summary ?? null,
        genres: [],
        pubStatus: null,
        kind: null,
        webUrl: null,
      };
    },
    chapters: async (key) => {
      if (key.startsWith('book:')) {
        const b = JSON.parse(key.slice(5)) as BookKey;
        return [opdsChapter({ id: key, title: b.t, author: b.a, summary: b.s, updated: null, thumb: b.c, image: null, feed: null, pse: b.p, file: b.f })];
      }
      const out: SourceChapter[] = [];
      let url: string | null = key.replace(/^feed:/, '');
      for (let i = 0; url && i < 100; i++) {
        const feed = await get(url);
        out.push(...feed.entries.filter((e) => e.pse || e.file).map(opdsChapter));
        url = feed.next;
      }
      return out;
    },
    pages: async (chapterKey) => {
      if (chapterKey.startsWith('pse:')) return psePages(JSON.parse(chapterKey.slice(4)), server.auth);
      throw new Error('This server offers this book only as a download. Downloading comes in the next update.');
    },
  };
}
