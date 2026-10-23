/**
 * MangaDex (api.mangadex.org): search, popular, latest, a title's details,
 * its chapters in your languages (scanlation groups credited) and the pages
 * of a chapter. Chapters hosted elsewhere (official sites) open in the
 * browser. Licensed titles often have no chapters here: MangaDex removes them.
 */

import type { Http, ImageRef, ListPage, MangaSource, SourceChapter, SourceDetails, SourceSeries } from './types.ts';
import { num, str, time } from './types.ts';

const API = 'https://api.mangadex.org';
const COVERS = 'https://uploads.mangadex.org/covers';
const PAGE = 30;

export type MangaDexPrefs = { languages: string[]; adult: boolean };

type Rel = { id: string; type: string; attributes?: Record<string, unknown> };
type Item = { id: string; type: string; attributes: Record<string, unknown>; relationships?: Rel[] };

const q = (params: [string, string | number][]) => params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');

function ratings(adult: boolean): [string, string][] {
  return ['safe', 'suggestive', ...(adult ? ['erotica', 'pornographic'] : [])].map((r) => ['contentRating[]', r]);
}

/** The title in the first of your languages that has one, else English, Japanese romanised, anything. */
function pickTitle(map: unknown, langs: string[]): string | null {
  if (!map || typeof map !== 'object') return null;
  const m = map as Record<string, string>;
  for (const l of [...langs, 'en', 'ja-ro', 'ko-ro', 'zh-ro']) if (str(m[l])) return m[l].trim();
  const first = Object.values(m).find((v) => str(v));
  return first ? first.trim() : null;
}

function coverOf(item: Item, size: 256 | 512): ImageRef | null {
  const rel = item.relationships?.find((r) => r.type === 'cover_art');
  const file = str(rel?.attributes?.fileName);
  return file ? { uri: `${COVERS}/${item.id}/${file}.${size}.jpg` } : null;
}

const people = (item: Item, type: string) =>
  [...new Set((item.relationships ?? []).filter((r) => r.type === type).map((r) => str(r.attributes?.name)).filter((x): x is string => !!x))].join(', ') || null;

export function mangadexSeries(item: Item, langs: string[]): SourceSeries {
  return { key: item.id, title: pickTitle(item.attributes.title, langs) ?? 'Untitled', cover: coverOf(item, 256), author: people(item, 'author') };
}

export function mangadexDetails(item: Item, langs: string[]): SourceDetails {
  const a = item.attributes;
  const tags = Array.isArray(a.tags) ? (a.tags as Item[]).map((t) => pickTitle(t.attributes?.name, ['en'])).filter((x): x is string => !!x) : [];
  const alt = Array.isArray(a.altTitles) ? (a.altTitles as Record<string, string>[]).map((t) => Object.values(t)[0]).filter((x) => str(x)) : [];
  const orig = str(a.originalLanguage);
  const strip = tags.some((t) => /long strip|web comic/i.test(t));
  const kind = strip || orig === 'ko' || orig === 'zh' || orig === 'zh-hk' ? 'manhwa' : orig === 'ja' ? 'manga' : orig ? 'comic' : null;
  return {
    ...mangadexSeries(item, langs),
    cover: coverOf(item, 512),
    altTitles: [...new Set(alt)].slice(0, 8),
    artist: people(item, 'artist'),
    description: pickTitle(a.description, langs),
    genres: tags.filter((t) => !/long strip|web comic|full color|official colored/i.test(t)),
    pubStatus: str(a.status),
    kind,
    webUrl: `https://mangadex.org/title/${item.id}`,
  };
}

export function mangadexChapter(item: Item): SourceChapter {
  const a = item.attributes;
  const group = (item.relationships ?? []).filter((r) => r.type === 'scanlation_group').map((r) => str(r.attributes?.name)).filter(Boolean).join(', ');
  const pages = num(a.pages);
  const external = str(a.externalUrl);
  return {
    key: item.id,
    number: num(a.chapter),
    volume: num(a.volume),
    title: str(a.title),
    scanlator: group || null,
    uploadedAt: time(a.readableAt) ?? time(a.publishAt),
    pageCount: pages,
    externalUrl: external && !pages ? external : null,
    lang: str(a.translatedLanguage),
  };
}

/** One chapter per number (the first group that put it up), in your first language when there are several. */
export function onePerNumber(list: SourceChapter[], langs: string[]): SourceChapter[] {
  const rank = (c: SourceChapter) => (c.lang ? Math.max(0, langs.indexOf(c.lang)) : 0);
  const best = new Map<string, SourceChapter>();
  const out: SourceChapter[] = [];
  for (const c of list) {
    if (c.number === null) {
      out.push(c);
      continue;
    }
    const k = `${c.volume ?? ''}:${c.number}`;
    const had = best.get(k);
    if (!had || rank(c) < rank(had) || (rank(c) === rank(had) && had.externalUrl && !c.externalUrl)) best.set(k, c);
  }
  out.push(...best.values());
  return out.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || (a.volume ?? 0) - (b.volume ?? 0));
}

export function mangadexSource(http: Http, prefs: MangaDexPrefs): MangaSource {
  const langs = prefs.languages.length ? prefs.languages : ['en'];
  const list = async (order: [string, string], page: number, extra: [string, string][] = []): Promise<ListPage> => {
    const params: [string, string | number][] = [
      ['limit', PAGE],
      ['offset', (page - 1) * PAGE],
      ['includes[]', 'cover_art'],
      ['includes[]', 'author'],
      order,
      ...ratings(prefs.adult),
      ...langs.map((l) => ['availableTranslatedLanguage[]', l] as [string, string]),
      ...extra,
    ];
    const res = (await http.json(`${API}/manga?${q(params)}`)) as { data?: Item[]; total?: number; offset?: number };
    const items = (res.data ?? []).map((i) => mangadexSeries(i, langs));
    return { items, hasMore: (res.offset ?? 0) + items.length < (res.total ?? 0) };
  };
  return {
    id: 'mangadex',
    name: 'MangaDex',
    lang: langs.length > 1 ? 'multi' : langs[0],
    kind: 'builtin',
    nsfw: false,
    hint: 'Fan translations, credited to their groups',
    canLatest: true,
    search: (query, page) => list(['order[relevance]', 'desc'], page, [['title', query]]),
    popular: (page) => list(['order[followedCount]', 'desc'], page),
    latest: (page) => list(['order[latestUploadedChapter]', 'desc'], page),
    details: async (key) => {
      const res = (await http.json(`${API}/manga/${encodeURIComponent(key)}?${q([['includes[]', 'cover_art'], ['includes[]', 'author'], ['includes[]', 'artist']])}`)) as { data: Item };
      return mangadexDetails(res.data, langs);
    },
    chapters: async (key) => {
      const all: SourceChapter[] = [];
      for (let offset = 0; offset < 10_000; offset += 500) {
        const params: [string, string | number][] = [
          ['limit', 500],
          ['offset', offset],
          ['includes[]', 'scanlation_group'],
          ['order[volume]', 'asc'],
          ['order[chapter]', 'asc'],
          ...langs.map((l) => ['translatedLanguage[]', l] as [string, string]),
          ...ratings(true),
        ];
        const res = (await http.json(`${API}/manga/${encodeURIComponent(key)}/feed?${q(params)}`)) as { data?: Item[]; total?: number };
        const got = (res.data ?? []).map(mangadexChapter);
        all.push(...got);
        if (!got.length || offset + 500 >= (res.total ?? 0)) break;
      }
      return onePerNumber(all, langs);
    },
    pages: async (chapterKey) => {
      const res = (await http.json(`${API}/at-home/server/${encodeURIComponent(chapterKey)}`)) as { baseUrl?: string; chapter?: { hash?: string; data?: string[] } };
      const base = str(res.baseUrl);
      const hash = str(res.chapter?.hash);
      if (!base || !hash) throw new Error('MangaDex did not give the pages of this chapter');
      return (res.chapter?.data ?? []).map((f) => ({ uri: `${base}/data/${hash}/${f}` }));
    },
  };
}
