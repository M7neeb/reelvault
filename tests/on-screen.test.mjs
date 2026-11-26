import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onScreen, onScreenQuery } from '../src/features/vault/sceneLogic.ts';

const rows = [
  { videoId: 'a', atMs: 0, labels: 'fruit', words: 'BERRIES  presents' },
  { videoId: 'a', atMs: 4000, labels: '', words: 'Berries' },
  { videoId: 'b', atMs: 0, labels: 'berries', words: '' },
  { videoId: 'c', atMs: 8000, labels: '', words: 'strawberries for sale' },
  { videoId: 'd', atMs: 0, labels: '', words: 'Bérries club' },
  { videoId: 'e', atMs: 0, labels: '', words: 'nothing here' },
];

test('finds every video with the word written on screen, not scene words', () => {
  const ids = onScreen(rows, 'berries');
  assert.deepEqual(ids.sort(), ['a', 'd']);
  // The video showing it most comes first.
  assert.equal(onScreen(rows, 'berries')[0], 'a');
  assert.deepEqual(onScreen(rows, 'berries club'), ['d']);
  assert.deepEqual(onScreen(rows, ' '), []);
  assert.deepEqual(onScreen(rows, 'b'), []);
});

test('part of a longer word does not count', () => {
  assert.ok(!onScreen(rows, 'berries').includes('c'));
  assert.deepEqual(onScreen(rows, 'straw'), ['c']);
});

test('no limit on how many videos come back', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ videoId: `v${i}`, atMs: 0, labels: '', words: 'berries' }));
  assert.equal(onScreen(many, 'berries').length, 500);
});

test('the "on screen:" search words', () => {
  assert.equal(onScreenQuery('on screen: berries'), 'berries');
  assert.equal(onScreenQuery('On screen:Berries club'), 'Berries club');
  assert.equal(onScreenQuery('berries'), null);
  assert.equal(onScreenQuery('on screen:   '), null);
});

test('a letter misread off the picture still matches longer words', async () => {
  const { startsLike } = await import('../src/features/vault/sceneLogic.ts');
  const misread = [
    { videoId: 'x', atMs: 0, labels: '', words: 'BERRLES season 2' },
    { videoId: 'y', atMs: 0, labels: '', words: 'beries' },
    { videoId: 'z', atMs: 0, labels: '', words: 'cherries' },
  ];
  assert.deepEqual(onScreen(misread, 'berries').sort(), ['x', 'y']);
  // Short words must be exact: "sd" never matches "sb".
  assert.equal(startsLike('sb', 'sd'), false);
  assert.equal(startsLike('berriest', 'berries'), true);
  assert.equal(startsLike('strawberries', 'berries'), false);
});

test('reads the first two minutes closely, the rest spread out, never more than the cap', async () => {
  const { readTimes } = await import('../src/features/vault/sceneLogic.ts');
  const short = readTimes(30_000);
  assert.deepEqual(short.slice(0, 3), [1, 3, 5]);
  assert.ok(short.every((t) => t < 30));
  const long = readTimes(20 * 60_000);
  assert.equal(long.length, 100);
  assert.equal(long.filter((t) => t < 120).length, 60);
  assert.ok(long.at(-1) < 1200);
  assert.deepEqual(readTimes(null), []);
  // Times only go forward.
  assert.ok(long.every((t, i) => i === 0 || t > long[i - 1]));
});
