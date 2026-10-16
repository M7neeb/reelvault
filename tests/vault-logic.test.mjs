// Run with `npm test`. Node strips the TypeScript types from logic.ts itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  daysLeft,
  describeRule,
  extraCopies,
  groupDuplicates,
  matchesRule,
  parseRule,
  parseViewOptions,
  purgeCutoff,
  RECENTLY_DELETED_DAYS,
  safeBatchGb,
} from '../src/features/vault/ui/logic.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 16, 12, 0);

test('a video deleted just now has the full 30 days left', () => {
  assert.equal(daysLeft(NOW, NOW), RECENTLY_DELETED_DAYS);
});

test('days left counts down and never goes below zero', () => {
  assert.equal(daysLeft(NOW - 10 * DAY, NOW), 20);
  assert.equal(daysLeft(NOW - 29.5 * DAY, NOW), 1);
  assert.equal(daysLeft(NOW - 45 * DAY, NOW), 0);
});

test('purge cutoff is exactly 30 days back', () => {
  assert.equal(purgeCutoff(NOW), NOW - 30 * DAY);
});

test('duplicates group by content key, oldest import first', () => {
  const items = [
    { id: 'b', contentKey: 'k1', importedAt: 200 },
    { id: 'x', contentKey: 'k2', importedAt: 50 },
    { id: 'a', contentKey: 'k1', importedAt: 100 },
    { id: 'solo', contentKey: 'k3', importedAt: 10 },
    { id: 'unknown', contentKey: null, importedAt: 10 },
    { id: 'c', contentKey: 'k1', importedAt: 300 },
  ];
  assert.deepEqual(groupDuplicates(items), [['a', 'b', 'c']]);
});

test('videos without a fingerprint are never duplicates', () => {
  const items = [
    { id: 'a', contentKey: null, importedAt: 1 },
    { id: 'b', contentKey: null, importedAt: 2 },
  ];
  assert.deepEqual(groupDuplicates(items), []);
});

test('extra copies leave the original of each group', () => {
  assert.deepEqual(extraCopies([['a', 'b', 'c'], ['x', 'y']]), ['b', 'c', 'y']);
});

test('safe batch: half the space above the 0.5 GB reserve', () => {
  assert.equal(safeBatchGb(2.1), 0.8);
  assert.equal(safeBatchGb(10.5), 5);
  assert.equal(safeBatchGb(0.4), 0);
});

/* ------------------------------------------------------------ smart filters */

const clip = (over = {}) => ({
  filename: 'Holiday_Lake_2026.mp4',
  rating: 8,
  tagNames: ['holiday', 'nature'],
  status: 'completed',
  ...over,
});

test('an empty rule matches every video', () => {
  assert.equal(matchesRule(clip(), {}), true);
  assert.equal(matchesRule(clip({ rating: 0, tagNames: [], status: null }), {}), true);
});

test('every condition in a rule must match', () => {
  const rule = { minRating: 8, tags: ['holiday'], status: 'completed', text: 'lake' };
  assert.equal(matchesRule(clip(), rule), true);
  assert.equal(matchesRule(clip({ rating: 7 }), rule), false);
  assert.equal(matchesRule(clip({ tagNames: ['nature'] }), rule), false);
  assert.equal(matchesRule(clip({ status: 'plantowatch' }), rule), false);
  assert.equal(matchesRule(clip({ filename: 'city.mp4' }), rule), false);
});

test('keywords in a rule must ALL be on the video', () => {
  assert.equal(matchesRule(clip(), { tags: ['holiday', 'nature'] }), true);
  assert.equal(matchesRule(clip(), { tags: ['holiday', 'family'] }), false);
});

test('name search ignores case', () => {
  assert.equal(matchesRule(clip(), { text: 'LAKE' }), true);
});

test('untagged rule only keeps videos without keywords', () => {
  assert.equal(matchesRule(clip(), { untagged: true }), false);
  assert.equal(matchesRule(clip({ tagNames: [] }), { untagged: true }), true);
});

test('a rule is described in plain words', () => {
  assert.equal(describeRule({ minRating: 8, tags: ['travel'], status: 'completed' }), 'rated 8+ · #travel · watched');
  assert.equal(describeRule({}), 'everything');
});

test('a saved rule with junk in it is cleaned, never fatal', () => {
  assert.deepEqual(parseRule('not json'), {});
  assert.deepEqual(parseRule('{"minRating": 42, "status": "nope", "tags": [1, "a"], "untagged": "yes"}'), {
    tags: ['a'],
  });
  assert.deepEqual(parseRule('{"minRating": 8, "status": "hold"}'), { minRating: 8, status: 'hold' });
});

/* ------------------------------------------------------------- view options */

const DEFAULTS = { columns: 3, sort: 'recent', showRating: true, showKeywords: true, showDuration: true };

test('missing view options fall back to the defaults', () => {
  assert.deepEqual(parseViewOptions(null, DEFAULTS), DEFAULTS);
  assert.deepEqual(parseViewOptions('broken', DEFAULTS), DEFAULTS);
});

test('saved view options are kept, invalid values replaced', () => {
  assert.deepEqual(
    parseViewOptions('{"columns": 5, "sort": "size", "showRating": false, "showDuration": "no"}', DEFAULTS),
    { columns: 5, sort: 'size', showRating: false, showKeywords: true, showDuration: true }
  );
  assert.equal(parseViewOptions('{"columns": 7, "sort": "random"}', DEFAULTS).columns, 3);
});
