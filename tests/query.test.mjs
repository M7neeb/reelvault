// Run with `npm test`. Smarter search: words in the box that mean filters.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSmartSearch, parseSearch } from '../src/features/vault/ui/query.ts';

const NOW = new Date(2026, 9, 18, 20).getTime();
const TAGS = ['Holiday', 'family', 'new york'];

test('plain words stay text', () => {
  const p = parseSearch('sunset clip', TAGS, NOW);
  assert.equal(p.text, 'sunset clip');
  assert.equal(isSmartSearch(p), false);
});

test('years, ratings, length, shape, keywords and watching', () => {
  const p = parseSearch('beach 2024 8+ long portrait #holiday unwatched', TAGS, NOW);
  assert.equal(p.text, 'beach');
  assert.equal(p.rule.minRating, 8);
  assert.equal(p.rule.minDurationSec, 300);
  assert.equal(p.rule.orientation, 'portrait');
  assert.deepEqual(p.rule.tags, ['Holiday']);
  assert.equal(p.watch, 'unwatched');
  assert.equal(new Date(p.rule.dateFrom).getFullYear(), 2024);
  assert.equal(new Date(p.rule.dateTo).getFullYear(), 2024);
  assert.ok(isSmartSearch(p));
});

test('keywords without #, two-word keywords, quotes keep text', () => {
  const p = parseSearch('family new york "holiday"', TAGS, NOW);
  assert.deepEqual(p.rule.tags, ['family', 'new york']);
  assert.equal(p.text, 'holiday');
});

test('month and year, relative dates, sizes and durations', () => {
  const june = parseSearch('june 2024', TAGS, NOW);
  assert.equal(new Date(june.rule.dateFrom).getMonth(), 5);
  assert.equal(new Date(june.rule.dateTo).getMonth(), 5);
  const last = parseSearch('last month', TAGS, NOW);
  assert.equal(new Date(last.rule.dateFrom).getMonth(), 8);
  assert.equal(last.chips[0].label, 'Last month');
  const s = parseSearch('>1gb <30s mov', TAGS, NOW);
  assert.equal(s.rule.minSizeMb, 1024);
  assert.equal(s.rule.maxDurationSec, 30);
  assert.equal(s.rule.format, 'MOV');
  assert.equal(parseSearch('★9', TAGS, NOW).rule.minRating, 9);
  assert.equal(parseSearch('rated 7', TAGS, NOW).rule.minRating, 7);
  assert.equal(parseSearch('never watched', TAGS, NOW).watch, 'unwatched');
});

test('frame rate and codec words', () => {
  let p = parseSearch('>60fps', TAGS, NOW);
  assert.equal(p.rule.minFps, 60);
  assert.equal(p.rule.maxFps, undefined);
  assert.equal(p.text, '');
  p = parseSearch('60fps+ big', TAGS, NOW);
  assert.equal(p.rule.minFps, 60);
  assert.equal(p.rule.minSizeMb, 500);
  p = parseSearch('<30fps', TAGS, NOW);
  assert.equal(p.rule.maxFps, 30);
  p = parseSearch('anime 120 fps', TAGS, NOW);
  assert.equal(p.rule.minFps, 120);
  assert.equal(p.rule.maxFps, 120);
  assert.equal(p.text, 'anime');
  p = parseSearch('high fps h264', TAGS, NOW);
  assert.equal(p.rule.minFps, 50);
  assert.equal(p.rule.codec, 'H.264');
  p = parseSearch('1080p 60', TAGS, NOW);
  assert.equal(p.rule.minFps, undefined);
  assert.equal(p.text, '1080p 60');
});
