// Run with `npm test`. Manga sources: MangaDex answers, OPDS catalogs, Suwayomi, extension repos and code, Browse settings.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mangadexChapter, mangadexDetails, mangadexSeries, mangadexSource, onePerNumber } from '../src/features/vault/manga/sources/mangadex.ts';
import { opdsSource, parseOpdsFeed, parseOpenSearch, psePages } from '../src/features/vault/manga/sources/opds.ts';
import { suwayomiChapters, suwayomiSource } from '../src/features/vault/manga/sources/suwayomi.ts';
import { cleanChapters, cleanList, domainAllowed, loadExtension, parseRepo, select } from '../src/features/vault/manga/sources/extensions.ts';
import { normaliseServerUrl, parseBrowsePrefs, updatesFor } from '../src/features/vault/manga/sources/prefs.ts';
import { basicAuth, resolveUrl, time } from '../src/features/vault/manga/sources/types.ts';
import { parseXml } from '../src/features/vault/audio/xml.ts';

/** A stand-in network: answers from a table, remembers what was asked. */
function stubHttp(routes) {
  const asked = [];
  const answer = (url, init) => {
    asked.push({ url, init });
    for (const [match, body] of routes) if (typeof match === 'string' ? url.startsWith(match) : match.test(url)) return typeof body === 'function' ? body(url, init) : body;
    throw new Error(`no route for ${url}`);
  };
  return { asked, http: { json: async (u, i) => answer(u, i), text: async (u, i) => answer(u, i) } };
}

const MD_MANGA = {
  id: 'm1',
  type: 'manga',
  attributes: {
    title: { 'ja-ro': 'Sousou no Frieren' },
    altTitles: [{ en: "Frieren: Beyond Journey's End" }, { ja: '葬送のフリーレン' }],
    description: { en: 'An elf mage outlives her party.' },
    status: 'ongoing',
    originalLanguage: 'ja',
    tags: [{ attributes: { name: { en: 'Fantasy' } } }, { attributes: { name: { en: 'Adventure' } } }],
  },
  relationships: [
    { id: 'a1', type: 'author', attributes: { name: 'Yamada Kanehito' } },
    { id: 'a2', type: 'artist', attributes: { name: 'Abe Tsukasa' } },
    { id: 'c1', type: 'cover_art', attributes: { fileName: 'cover.jpg' } },
  ],
};

test('MangaDex: titles, covers, people, kind and the website link', () => {
  const s = mangadexSeries(MD_MANGA, ['en']);
  assert.equal(s.title, 'Sousou no Frieren');
  assert.equal(s.cover.uri, 'https://uploads.mangadex.org/covers/m1/cover.jpg.256.jpg');
  assert.equal(s.author, 'Yamada Kanehito');
  const d = mangadexDetails(MD_MANGA, ['en']);
  assert.equal(d.artist, 'Abe Tsukasa');
  assert.equal(d.kind, 'manga');
  assert.deepEqual(d.genres, ['Fantasy', 'Adventure']);
  assert.equal(d.description, 'An elf mage outlives her party.');
  assert.equal(d.webUrl, 'https://mangadex.org/title/m1');
  assert.ok(d.altTitles.includes("Frieren: Beyond Journey's End"));
  const strip = mangadexDetails({ ...MD_MANGA, attributes: { ...MD_MANGA.attributes, originalLanguage: 'ko' } }, ['en']);
  assert.equal(strip.kind, 'manhwa');
});

test('MangaDex: chapters credit their group, external ones open the website, one per number in your first language', () => {
  const ch = (id, n, lang, extra = {}) => ({
    id,
    type: 'chapter',
    attributes: { chapter: n, volume: '1', title: null, pages: 20, externalUrl: null, readableAt: '2026-10-23T16:06:06+00:00', translatedLanguage: lang, ...extra },
    relationships: [{ id: 'g', type: 'scanlation_group', attributes: { name: 'Shameless Scumbag' } }],
  });
  const c = mangadexChapter(ch('x', '3', 'en'));
  assert.equal(c.number, 3);
  assert.equal(c.volume, 1);
  assert.equal(c.scanlator, 'Shameless Scumbag');
  assert.equal(c.uploadedAt, Date.parse('2026-10-23T16:06:06+00:00'));
  const ext = mangadexChapter(ch('y', '4', 'en', { pages: 0, externalUrl: 'https://mangaplus.shueisha.co.jp/viewer/1' }));
  assert.equal(ext.externalUrl, 'https://mangaplus.shueisha.co.jp/viewer/1');
  const list = onePerNumber([ch('de3', '3', 'de'), ch('en3', '3', 'en'), ch('en1', '1', 'en'), ch('extra', null, 'en')].map(mangadexChapter), ['en', 'de']);
  assert.deepEqual(list.map((x) => x.key), ['en1', 'en3', 'extra']);
});

test('MangaDex: the requests ask for your languages, safe ratings, and pages come from the at-home server', async () => {
  const { http, asked } = stubHttp([
    ['https://api.mangadex.org/manga?', { data: [MD_MANGA], total: 31, offset: 0 }],
    ['https://api.mangadex.org/manga/m1/feed', { data: [{ id: 'c', type: 'chapter', attributes: { chapter: '1', pages: 2, translatedLanguage: 'en' }, relationships: [] }], total: 1 }],
    ['https://api.mangadex.org/at-home/server/c', { baseUrl: 'https://x.mangadex.network', chapter: { hash: 'h', data: ['1.png', '2.png'] } }],
  ]);
  const src = mangadexSource(http, { languages: ['en'], adult: false });
  const res = await src.search('frieren', 1);
  assert.equal(res.items.length, 1);
  assert.equal(res.hasMore, true);
  const url = decodeURIComponent(asked[0].url);
  assert.match(url, /title=frieren/);
  assert.match(url, /availableTranslatedLanguage\[\]=en/);
  assert.match(url, /contentRating\[\]=suggestive/);
  assert.doesNotMatch(url, /pornographic/);
  assert.equal((await src.chapters('m1')).length, 1);
  assert.deepEqual(await src.pages('c'), [{ uri: 'https://x.mangadex.network/data/h/1.png' }, { uri: 'https://x.mangadex.network/data/h/2.png' }]);
});

const KOMGA_ROOT = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:pse="http://vaemendis.net/opds-pse/ns">
  <title>Komga</title>
  <link rel="search" type="application/opensearchdescription+xml" href="/opds/v1.2/search"/>
  <link rel="next" href="/opds/v1.2/catalog?page=1"/>
  <entry><title>Libraries</title><id>libs</id><link rel="subsection" type="application/atom+xml;profile=opds-catalog;kind=navigation" href="/opds/v1.2/libraries"/></entry>
  <entry><title>Berserk</title><id>s1</id><author><name>Miura</name></author>
    <link rel="http://opds-spec.org/image/thumbnail" type="image/jpeg" href="/opds/v1.2/series/s1/thumbnail"/>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="/opds/v1.2/series/s1"/></entry>
</feed>`;

const KOMGA_SERIES = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:pse="http://vaemendis.net/opds-pse/ns">
  <title>Berserk</title>
  <entry><title>Berserk v01</title><id>b1</id><updated>2026-01-02T00:00:00Z</updated>
    <link rel="http://opds-spec.org/image/thumbnail" href="/opds/v1.2/books/b1/thumbnail"/>
    <link rel="http://opds-spec.org/acquisition" type="application/zip" href="/opds/v1.2/books/b1/file"/>
    <link rel="http://vaemendis.net/opds-pse/stream" type="image/jpeg" pse:count="3" href="/opds/v1.2/books/b1/pages/{pageNumber}?zero_based=true"/></entry>
  <entry><title>Berserk v02</title><id>b2</id>
    <link rel="http://opds-spec.org/acquisition" type="application/zip" href="/opds/v1.2/books/b2/file"/></entry>
</feed>`;

test('OPDS: folders, series, books with page streaming, search and paging', async () => {
  const feed = parseOpdsFeed(KOMGA_ROOT, 'http://pc.local:25600/opds/v1.2/catalog');
  assert.equal(feed.next, 'http://pc.local:25600/opds/v1.2/catalog?page=1');
  assert.equal(feed.search, 'http://pc.local:25600/opds/v1.2/search');
  assert.equal(feed.entries[0].feed.books, false);
  assert.equal(feed.entries[1].feed.books, true);
  assert.equal(feed.entries[1].thumb, 'http://pc.local:25600/opds/v1.2/series/s1/thumbnail');
  const desc = parseOpenSearch('<OpenSearchDescription><Url type="application/atom+xml" template="/opds/v1.2/search?search={searchTerms}"/></OpenSearchDescription>', 'http://pc.local:25600/opds/v1.2/search');
  assert.equal(desc, 'http://pc.local:25600/opds/v1.2/search?search={searchTerms}');

  const auth = basicAuth('me', 'pw');
  const { http, asked } = stubHttp([
    ['http://pc.local:25600/opds/v1.2/catalog', KOMGA_ROOT],
    ['http://pc.local:25600/opds/v1.2/series/s1', KOMGA_SERIES],
    ['http://pc.local:25600/opds/v1.2/search?search=ber', KOMGA_ROOT],
    ['http://pc.local:25600/opds/v1.2/search', '<OpenSearchDescription><Url type="application/atom+xml" template="/opds/v1.2/search?search={searchTerms}"/></OpenSearchDescription>'],
  ]);
  const src = opdsSource(http, { id: 'k', name: 'Komga', url: 'http://pc.local:25600/opds/v1.2/catalog', auth });
  const top = await src.popular(1);
  assert.deepEqual(top.items.map((x) => [x.title, !!x.folder]), [['Libraries', true], ['Berserk', false]]);
  assert.equal(top.hasMore, true);
  assert.equal(top.items[1].cover.headers.Authorization, auth.Authorization);
  assert.equal(asked[0].init.headers.Authorization, auth.Authorization);
  const chapters = await src.chapters(top.items[1].key);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].volume, 1);
  assert.equal(chapters[0].pageCount, 3);
  const pages = await src.pages(chapters[0].key);
  assert.deepEqual(pages.map((p) => p.uri), [0, 1, 2].map((i) => `http://pc.local:25600/opds/v1.2/books/b1/pages/${i}?zero_based=true`));
  await assert.rejects(() => src.pages(chapters[1].key), /download/);
  const found = await src.search('ber', 1);
  assert.equal(found.items.length, 2);
  assert.equal(psePages({ href: 'x/{pageNumber}?w={maxWidth}', count: 1 }, {})[0].uri, 'x/0?w=1600');
});

test('Suwayomi: GraphQL calls, reading order, page addresses on the server', async () => {
  const ordered = suwayomiChapters([
    { id: 3, name: 'Ch. 3', chapterNumber: 3, sourceOrder: 0, uploadDate: '1700000000000' },
    { id: 1, name: 'Ch. 1', chapterNumber: 1, sourceOrder: 2 },
    { id: 2, name: 'Ch. 2', chapterNumber: 2, sourceOrder: 1 },
  ]);
  assert.deepEqual(ordered.map((c) => c.key), ['1', '2', '3']);
  assert.equal(ordered[2].uploadedAt, 1700000000000);
  const { http, asked } = stubHttp([
    [
      'http://pc:4567/api/graphql',
      (_u, init) => {
        const { query } = JSON.parse(init.body);
        if (query.includes('fetchSourceManga')) return { data: { fetchSourceManga: { hasNextPage: true, mangas: [{ id: 7, title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' }] } } };
        if (query.includes('fetchChapterPages')) return { data: { fetchChapterPages: { pages: ['/api/v1/manga/7/chapter/1/page/0'] } } };
        return { errors: [{ message: 'unknown' }] };
      },
    ],
  ]);
  const src = suwayomiSource(http, { id: 's', name: 'PC', url: 'http://pc:4567/', auth: {} }, { id: '123456789012345', name: 'Site', lang: 'en', isNsfw: false, supportsLatest: true });
  const res = await src.popular(1);
  assert.equal(res.items[0].cover.uri, 'http://pc:4567/api/v1/manga/7/thumbnail');
  const vars = JSON.parse(asked[0].init.body).variables;
  assert.deepEqual(vars, { source: '123456789012345', type: 'POPULAR', page: 1, query: null });
  assert.equal((await src.pages('1'))[0].uri, 'http://pc:4567/api/v1/manga/7/chapter/1/page/0');
  await assert.rejects(() => src.details('7'), /Suwayomi: unknown/);
});

test('repos: the index is checked, bad entries left out, code addresses made absolute and https only', () => {
  const repo = parseRepo(
    {
      name: 'My repo',
      extensions: [
        { id: 'good', name: 'Good', version: 3, lang: 'en', file: 'good.js', domains: ['api.good.org', 'bad domain!'] },
        { id: 'Bad Id', name: 'x', file: 'x.js' },
        { id: 'insecure', name: 'Insecure', file: 'http://plain.org/x.js' },
        { id: 'good', name: 'Duplicate', file: 'dup.js' },
      ],
    },
    'https://example.org/repo/index.json'
  );
  assert.equal(repo.name, 'My repo');
  assert.deepEqual(repo.extensions.map((e) => e.id), ['good']);
  assert.equal(repo.extensions[0].url, 'https://example.org/repo/good.js');
  assert.deepEqual(repo.extensions[0].domains, ['api.good.org']);
  assert.throws(() => parseRepo({}, 'https://x.org/index.json'), /not a ReelVault extension repo/);
});

test('extensions: only their own sites, results checked and trimmed, missing parts refused', async () => {
  assert.equal(domainAllowed('https://api.good.org/x', ['good.org']), true);
  assert.equal(domainAllowed('https://evilgood.org/x', ['good.org']), false);
  assert.equal(domainAllowed('http://good.org/x', ['good.org']), false);
  const code = `
    const base = 'https://api.good.org';
    return {
      async popular(page) {
        const r = await api.http.json(base + '/list?page=' + page);
        return { items: r.map((x) => ({ key: x.id, title: x.name, cover: x.img })), hasMore: false };
      },
      async search(q) { return this.popular(1); },
      async details(key) { return { title: 'T ' + key, genres: ['A', 7], kind: 'comic' }; },
      async chapters(key) { return [{ key: key + '-1', number: '1' }, { nokey: true }]; },
      async pages(key) { return ['https://cdn.good.org/1.jpg', 'javascript:alert(1)', { uri: 'https://cdn.good.org/2.jpg', headers: { Referer: base } }]; },
      async sneak() { return typeof fetch + typeof globalThis + typeof require; },
    };`;
  const { http } = stubHttp([['https://api.good.org/list', [{ id: 'a', name: 'Alpha', img: 'https://cdn.good.org/a.jpg' }, { id: '', name: 'no key' }]]]);
  const ext = { id: 'good', name: 'Good', version: 1, lang: 'en', nsfw: false, url: 'https://x/good.js', domains: ['good.org'], description: null };
  const src = loadExtension(code, ext, http);
  assert.equal(src.id, 'ext:good');
  const list = await src.popular(1);
  assert.deepEqual(list.items.map((x) => x.title), ['Alpha']);
  assert.deepEqual(await src.details('k').then((d) => [d.title, d.genres, d.kind]), ['T k', ['A'], 'comic']);
  assert.deepEqual((await src.chapters('k')).map((c) => [c.key, c.number]), [['k-1', 1]]);
  assert.deepEqual((await src.pages('k')).map((p) => p.uri), ['https://cdn.good.org/1.jpg', 'https://cdn.good.org/2.jpg']);
  assert.equal(src.canLatest, false);
  // The globals it could use to go around ReelVault are hidden from it.
  const sneaky = loadExtension(code.replace('async popular', 'async latest() { return { items: [{ key: typeof fetch + typeof globalThis + typeof require, title: "x" }] }; },\n      async popular'), ext, http);
  assert.equal((await sneaky.latest(1)).items[0].key, 'undefinedundefinedundefined');
  // Sites it didn't declare are refused.
  const outside = loadExtension(`return { details: async () => api.http.json('https://other.org/x'), chapters: async () => [], pages: async () => [] };`, ext, http);
  await assert.rejects(() => outside.details('k'), /may only reach good\.org/);
  assert.throws(() => loadExtension('return { search() {} };', ext, http), /not a ReelVault extension/);
  assert.equal(cleanList(null).items.length, 0);
  assert.equal(cleanChapters('nope').length, 0);
});

test('the small HTML selector extensions use', () => {
  const root = parseXml('<div id="list"><div class="item hot"><a href="/m/1" data-x="y">One</a></div><div class="item"><span><a href="/m/2">Two</a></span></div></div><a href="/other">Other</a>');
  assert.deepEqual(select(root, '.item a').map((a) => a.attrs.href), ['/m/1', '/m/2']);
  assert.deepEqual(select(root, '.item > a').map((a) => a.attrs.href), ['/m/1']);
  assert.deepEqual(select(root, 'div.hot a[data-x=y]').map((a) => a.attrs.href), ['/m/1']);
  assert.deepEqual(select(root, '#list a, a[href="/other"]').map((a) => a.attrs.href), ['/m/1', '/m/2', '/other']);
});

test('Browse settings: read safely, server addresses completed, updates found', () => {
  const p = parseBrowsePrefs(JSON.stringify({ languages: [], adult: 'yes', servers: [{ id: 'a', kind: 'opds', url: 'http://x' }, { id: 'b', kind: 'ftp', url: 'x' }], repos: [{ url: 'u', extensions: [{ id: 'e', version: 2 }] }], installed: [{ id: 'e', url: 'c', repoUrl: 'u', version: 1 }] }));
  assert.deepEqual(p.languages, ['en']);
  assert.equal(p.adult, false);
  assert.equal(p.servers.length, 1);
  assert.equal(updatesFor(p).length, 1);
  assert.deepEqual(parseBrowsePrefs('not json').servers, []);
  assert.equal(normaliseServerUrl('192.168.1.5:25600', 'opds'), 'http://192.168.1.5:25600/opds/v1.2/catalog');
  assert.equal(normaliseServerUrl('https://k.example/opds/v1.2/catalog/', 'opds'), 'https://k.example/opds/v1.2/catalog');
  assert.equal(normaliseServerUrl('pc.local:4567/', 'suwayomi'), 'http://pc.local:4567');
});

test('helpers: addresses, logins and dates', () => {
  assert.equal(resolveUrl('http://h:1/a/b/c.xml', '/x'), 'http://h:1/x');
  assert.equal(resolveUrl('http://h:1/a/b/c.xml', 'd/e'), 'http://h:1/a/b/d/e');
  assert.equal(resolveUrl('http://h:1/a/b/c.xml', '../d'), 'http://h:1/a/d');
  assert.equal(resolveUrl('http://h:1/a', 'https://o.org/z'), 'https://o.org/z');
  assert.equal(basicAuth('user', 'päss').Authorization, `Basic ${Buffer.from('user:päss').toString('base64')}`);
  assert.deepEqual(basicAuth(null, 'x'), {});
  assert.equal(time(1700000000), 1700000000000);
  assert.equal(time('2026-01-02T00:00:00Z'), Date.UTC(2026, 0, 2));
});
