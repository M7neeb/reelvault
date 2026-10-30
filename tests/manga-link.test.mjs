// Run with `npm test`. Matching imported titles to a Suwayomi server's library (mangaLink.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planChapters, planLinks, sourcePath } from '../src/features/vault/manga/mangaLink.ts';

/* ------------------------------------------------------------- sourcePath */

test('sourcePath drops host, query, fragment and trailing slashes', () => {
  assert.equal(sourcePath('https://comics.8muses.com/comics/album/X/'), '/comics/album/x');
  assert.equal(sourcePath('/comics/album/X'), '/comics/album/x');
  assert.equal(sourcePath('comics/album/X'), '/comics/album/x');
  assert.equal(sourcePath('https://site.org/a/b?page=2'), '/a/b');
  assert.equal(sourcePath('https://site.org/a/b#top'), '/a/b');
  assert.equal(sourcePath('https://site.org//a///b//'), '/a/b');
});

test('sourcePath decodes percent-encoding and ignores case', () => {
  assert.equal(sourcePath('https://site.org/manga/Dexter%27s%20Mom'), "/manga/dexter's mom");
  assert.equal(sourcePath('HTTPS://SITE.ORG/MANGA/AbC'), '/manga/abc');
});

test('sourcePath gives nothing for nothing, and survives a stray percent', () => {
  assert.equal(sourcePath(null), null);
  assert.equal(sourcePath(undefined), null);
  assert.equal(sourcePath('   '), null);
  assert.equal(sourcePath('/'), null);
  assert.equal(sourcePath('https://site.org/'), null);
  assert.equal(sourcePath('/100%off'), '/100%off');
});

test('two addresses of one page reduce to the same path', () => {
  const a = sourcePath('https://porncomic.example/porncomic/dexters-mom/');
  const b = sourcePath('/porncomic/dexters-mom');
  assert.equal(a, b);
});

/* ------------------------------------------------------------ planChapters */

test('planChapters matches by number and keeps a chapter matched once', () => {
  const local = [
    { id: 'a', number: 1 },
    { id: 'b', number: 2 },
    { id: 'c', number: null },
  ];
  const remote = [
    { id: 10, number: 1 },
    { id: 11, number: 1 }, // second scanlator: only the first is taken
    { id: 12, number: 3 }, // not in the library: left out, nothing is invented
  ];
  assert.deepEqual(planChapters(local, remote), [{ chapterId: 'a', sourceKey: 10 }]);
});

test('planChapters leaves a chapter with no number alone', () => {
  assert.deepEqual(planChapters([{ id: 'x', number: null }], [{ id: 1, number: 1 }]), []);
});

/* --------------------------------------------------------------- planLinks */

const library = [
  { id: 1, url: '/comics/album/Various/Sokka', title: 'Sokka Impregnating', chapters: [{ id: 101, number: 1 }] },
  { id: 2, url: '/porncomic/dexters-mom/', title: 'Dexter’s Mom: Deep Cleaning', chapters: [{ id: 201, number: 1 }, { id: 202, number: 2 }] },
  { id: 3, url: '/gone/different-path', title: 'Renamed Thing', chapters: [{ id: 301, number: 1 }] },
];

test('a path match links the title and its chapters', () => {
  const mine = [{ id: 's1', title: 'whatever it is called here', sourceKey: 'https://comics.8muses.com/comics/album/Various/Sokka/', chapters: [{ id: 'c1', number: 1 }] }];
  const plan = planLinks(mine, library);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].mangaId, 1);
  assert.equal(plan[0].how, 'url');
  assert.deepEqual(plan[0].chapters, [{ chapterId: 'c1', sourceKey: 101 }]);
});

test('the title is the fallback when the page address was rewritten', () => {
  const mine = [{ id: 's2', title: 'Renamed Thing', sourceKey: '/old/address', chapters: [{ id: 'c2', number: 1 }] }];
  const plan = planLinks(mine, library);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].mangaId, 3);
  assert.equal(plan[0].how, 'title');
});

test('a path match wins over a title match on another row', () => {
  const lib = [
    { id: 1, url: '/a', title: 'Same Name', chapters: [] },
    { id: 2, url: '/b', title: 'Other', chapters: [] },
  ];
  const mine = [{ id: 's', title: 'Same Name', sourceKey: '/b', chapters: [] }];
  const plan = planLinks(mine, lib);
  assert.equal(plan[0].mangaId, 2);
  assert.equal(plan[0].how, 'url');
});

test('one server title is never linked to two of your series', () => {
  const mine = [
    { id: 's1', title: 'Same', sourceKey: '/one', chapters: [] },
    { id: 's2', title: 'Same', sourceKey: '/two', chapters: [] },
  ];
  const lib = [{ id: 9, url: '/something-else', title: 'Same', chapters: [] }];
  const plan = planLinks(mine, lib);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].seriesId, 's1');
});

test('nothing to match gives an empty plan', () => {
  assert.deepEqual(planLinks([], library), []);
  assert.deepEqual(planLinks([{ id: 's', title: 'Not There', sourceKey: '/nope', chapters: [] }], library), []);
});
