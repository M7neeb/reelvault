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
