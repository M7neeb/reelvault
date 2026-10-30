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
  assert.deepEqual(parseBrowsePrefs(JSON.stringify({ reader: { tapZones: false, tapInvert: true, page: 'white', spreads: false } })).reader, {
    tapZones: false,
    tapInvert: true,
    page: 'white',
    spreads: false,
    fit: 'screen',
    filter: 'none',
    autoSpeed: 3,
    longStrip: false,
    crop: false,
    autoBg: false,
    volumeKeys: true,
    volumeInvert: false,
    holdSpeed: 5,
  });
  assert.equal(parseBrowsePrefs(JSON.stringify({ reader: { page: 'pink' } })).reader.page, 'black');
});

test('reader settings: fit, filter, auto-scroll speed and long strip', () => {
  const r = parseBrowsePrefs(JSON.stringify({ reader: { fit: 'width', filter: 'warm', autoSpeed: 4, longStrip: true } })).reader;
  assert.equal(r.fit, 'width');
  assert.equal(r.filter, 'warm');
  assert.equal(r.autoSpeed, 4);
  assert.equal(r.longStrip, true);
  const bad = parseBrowsePrefs(JSON.stringify({ reader: { fit: 'huge', filter: 'sepia', autoSpeed: 11, longStrip: 'yes', holdSpeed: 0 } })).reader;
  assert.equal(bad.fit, 'screen');
  assert.equal(bad.filter, 'none');
  assert.equal(bad.autoSpeed, 3);
  assert.equal(bad.longStrip, false);
  assert.equal(bad.holdSpeed, 5);
});

test('reader settings: volume buttons and the ten speeds', () => {
  const r = parseBrowsePrefs(JSON.stringify({ reader: { volumeKeys: false, volumeInvert: true, holdSpeed: 9, autoSpeed: 10 } })).reader;
  assert.equal(r.volumeKeys, false);
  assert.equal(r.volumeInvert, true);
  assert.equal(r.holdSpeed, 9);
  assert.equal(r.autoSpeed, 10);
});

test('a double page stands alone and the pairing carries on after it', () => {
  assert.deepEqual(pageSlots(7, true, new Set([3])), [[0], [1, 2], [3], [4, 5], [6]]);
  assert.deepEqual(pageSlots(6, true, new Set([2])), [[0], [1], [2], [3, 4], [5]]);
  assert.deepEqual(pageSlots(4, false, new Set([2])), [[0], [1], [2], [3]]);
});
