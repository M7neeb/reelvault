// Run with `npm test`. The reader's screens (two pages side by side) and its settings.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageSlots, slotOfPage } from '../src/features/vault/manga/readerLogic.ts';
import { DEFAULT_BROWSE, parseBrowsePrefs } from '../src/features/vault/manga/sources/prefs.ts';

test('one page per screen normally', () => {
  assert.deepEqual(pageSlots(3, false), [[0], [1], [2]]);
  assert.deepEqual(pageSlots(0, true), []);
});

test('sideways: the cover alone, then pairs, a last odd page alone', () => {
  assert.deepEqual(pageSlots(6, true), [[0], [1, 2], [3, 4], [5]]);
  assert.deepEqual(pageSlots(5, true), [[0], [1, 2], [3, 4]]);
  assert.deepEqual(pageSlots(1, true), [[0]]);
});

test('which screen a page is on', () => {
  const s = pageSlots(6, true);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((p) => slotOfPage(s, p)), [0, 1, 1, 2, 2, 3]);
  assert.equal(slotOfPage(s, 99), 3);
  assert.equal(slotOfPage([], 4), 0);
});

test('reader settings: defaults, saved values, nonsense ignored', () => {
  assert.deepEqual(parseBrowsePrefs(null).reader, DEFAULT_BROWSE.reader);
  assert.deepEqual(parseBrowsePrefs(JSON.stringify({ reader: { tapZones: false, tapInvert: true, page: 'white', spreads: false } })).reader, { tapZones: false, tapInvert: true, page: 'white', spreads: false });
  assert.equal(parseBrowsePrefs(JSON.stringify({ reader: { page: 'pink' } })).reader.page, 'black');
});
