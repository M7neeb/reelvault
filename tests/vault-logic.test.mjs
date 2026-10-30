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
  resolveScheme,
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

const DEFAULTS = {
  layout: 'grid',
  look: 'standard',
  accent: null,
  size: 'large',
  sort: 'recent',
  groupBy: 'none',
  infos: ['duration'],
  showRating: true,
  showKeywords: true,
  theme: 'system',
  colors: 'standard',
  videoColor: null,
  videoColorFrom: null,
  font: 'system',
  glass: 'regular',
  corners: 'standard',
  outlined: false,
  rotate: false,
};

test('colours, font, glass, cards and turning are read, bad values fall back', () => {
  const o = parseViewOptions('{"colors":"video","videoColor":"#1E6B45","videoColorFrom":"v1","font":"georgia","glass":"solid","corners":"round","outlined":true,"rotate":true}', DEFAULTS);
  assert.deepEqual([o.colors, o.videoColor, o.videoColorFrom, o.font, o.glass, o.corners, o.outlined, o.rotate], ['video', '#1E6B45', 'v1', 'georgia', 'solid', 'round', true, true]);
  const bad = parseViewOptions('{"colors":"neon","videoColor":"green","font":"comic","glass":"frosted","corners":"wavy","outlined":"yes","rotate":1}', DEFAULTS);
  assert.deepEqual([bad.colors, bad.videoColor, bad.font, bad.glass, bad.corners, bad.outlined, bad.rotate], ['standard', null, 'system', 'regular', 'standard', false, false]);
});

test('look and accent are read, bad values fall back', () => {
  assert.equal(parseViewOptions('{"look":"desktop","accent":"#FF375F"}', DEFAULTS).look, 'desktop');
  assert.equal(parseViewOptions('{"look":"fancy","accent":"red"}', DEFAULTS).look, 'standard');
  assert.equal(parseViewOptions('{"accent":"red"}', DEFAULTS).accent, null);
  assert.equal(parseViewOptions('{"accent":"#ff375f"}', DEFAULTS).accent, '#ff375f');
});

test('missing view options fall back to the defaults', () => {
  assert.deepEqual(parseViewOptions(null, DEFAULTS), DEFAULTS);
  assert.deepEqual(parseViewOptions('broken', DEFAULTS), DEFAULTS);
});

test('saved view options are kept, invalid values replaced', () => {
  assert.deepEqual(
    parseViewOptions(
      '{"layout": "waterfall", "size": "fit", "sort": "duration", "infos": ["size", "bogus", "date"], "groupBy": "month", "showRating": false, "theme": "light"}',
      DEFAULTS
    ),
    { ...DEFAULTS, layout: 'waterfall', size: 'fit', sort: 'duration', infos: ['size', 'date'], groupBy: 'month', showRating: false, theme: 'light' }
  );
  const junk = parseViewOptions('{"layout": "spiral", "size": 9, "sort": "random", "theme": "blue"}', DEFAULTS);
  assert.deepEqual(junk, DEFAULTS);
});

test('options saved by the first version are carried over', () => {
  const old = parseViewOptions(
    '{"columns": 5, "sort": "size", "showRating": true, "showKeywords": false, "showDuration": false}',
    DEFAULTS
  );
  assert.equal(old.size, 'small');
  assert.deepEqual(old.infos, []);
  assert.equal(old.sort, 'size');
  assert.equal(old.showKeywords, false);
  assert.equal(parseViewOptions('{"columns": 4}', DEFAULTS).size, 'medium');
  // The version with one `info` value.
  assert.deepEqual(parseViewOptions('{"info": "size"}', DEFAULTS).infos, ['size']);
  assert.deepEqual(parseViewOptions('{"info": "none"}', DEFAULTS).infos, []);
});

/* -------------------------------------------------------------------- theme */

test('System follows the phone, and falls back to dark when the phone does not say', () => {
  assert.equal(resolveScheme('system', 'light'), 'light');
  assert.equal(resolveScheme('system', 'dark'), 'dark');
  assert.equal(resolveScheme('system', 'unspecified'), 'dark');
  assert.equal(resolveScheme('system', null), 'dark');
});

test('a chosen theme wins over the phone', () => {
  assert.equal(resolveScheme('light', 'dark'), 'light');
  assert.equal(resolveScheme('dark', 'light'), 'dark');
});

test('smart filters: watch rules, relative dates and any-of keywords', async () => {
  const { matchesRule, watchInfoOf } = await import('../src/features/vault/ui/logic.ts');
  const DAY = 86_400_000;
  const now = 1_800_000_000_000;
  const v = (id, over = {}) => ({ id, filename: `${id}.mp4`, rating: 0, tagNames: [], status: null, createdAt: now - 400 * DAY, importedAt: now - 2 * DAY, ...over });
  const watch = watchInfoOf([
    { videoId: 'a', startedAt: now - 1 * DAY },
    { videoId: 'a', startedAt: now - 3 * DAY },
    { videoId: 'b', startedAt: now - 500 * DAY },
  ]);
  const m = (item, rule) => matchesRule(item, rule, watch, now);
  assert.equal(m(v('c'), { watched: 'never' }), true);
  assert.equal(m(v('a'), { watched: 'never' }), false);
  assert.equal(m(v('a'), { minPlays: 2 }), true);
  assert.equal(m(v('b'), { minPlays: 2 }), false);
  assert.equal(m(v('b'), { notWatchedDays: 365 }), true);
  assert.equal(m(v('a'), { notWatchedDays: 365 }), false);
  assert.equal(m(v('c'), { notWatchedDays: 365 }), true);
  assert.equal(m(v('a'), { watchedWithinDays: 7 }), true);
  assert.equal(m(v('b'), { watchedWithinDays: 7 }), false);
  assert.equal(m(v('a'), { addedWithinDays: 7 }), true);
  assert.equal(m(v('a', { importedAt: now - 40 * DAY }), { addedWithinDays: 30 }), false);
  assert.equal(m(v('a'), { filmedWithinDays: 365 }), false);
  assert.equal(m(v('a', { tagNames: ['trip'] }), { anyTags: ['beach', 'trip'] }), true);
  assert.equal(m(v('a', { tagNames: ['home'] }), { anyTags: ['beach', 'trip'] }), false);
});

test('smart filter rules with the new fields survive a round trip', async () => {
  const { parseRule, describeRule } = await import('../src/features/vault/ui/logic.ts');
  const r = parseRule(JSON.stringify({ watched: 'never', minPlays: 3, notWatchedDays: 365, addedWithinDays: 30, anyTags: ['a', 'b'], filmedWithinDays: -4 }));
  assert.deepEqual(r, { watched: 'never', minPlays: 3, notWatchedDays: 365, addedWithinDays: 30, anyTags: ['a', 'b'] });
  assert.match(describeRule(r), /never watched/);
  assert.match(describeRule(r), /#a or #b/);
});

test('group by rating, keyword, series, length and week', async () => {
  const { groupItems } = await import('../src/features/vault/ui/logic.ts');
  const v = (id, over = {}) => ({ id, createdAt: new Date(2026, 9, 14).getTime(), rating: 0, tagNames: [], durationMs: 30_000, ...over });
  const items = [v('a', { rating: 9, tagNames: ['trip', 'beach'] }), v('b', { rating: 0 }), v('c', { rating: 9, tagNames: ['trip'], durationMs: 10 * 60_000 }), v('d', { rating: 7, durationMs: null })];
  assert.deepEqual(groupItems(items, 'rating').map((s) => [s.title, s.items.length]), [['★ 9', 2], ['★ 7', 1], ['Not rated', 1]]);
  // A video goes under its first keyword (A to Z); the biggest group first, untagged last.
  assert.deepEqual(groupItems(items, 'keyword').map((s) => [s.title, s.items.map((x) => x.id).join('')]), [['No keyword', 'bd'], ['#beach', 'a'], ['#trip', 'c']].sort((x, y) => (x[0] === 'No keyword') - (y[0] === 'No keyword') || y[1].length - x[1].length || x[0].localeCompare(y[0])));
  assert.deepEqual(groupItems(items, 'series', new Map([['a', 'Walks'], ['c', 'Walks']])).map((s) => [s.title, s.items.length]), [['Walks', 2], ['Not in a series', 2]]);
  assert.deepEqual(groupItems(items, 'length').map((s) => s.title), ['Under a minute', '5 to 20 minutes', 'Length unknown']);
  // 14 October 2026 is a Wednesday: its week starts on Monday the 12th.
  assert.deepEqual(groupItems(items, 'week').map((s) => s.title), ['Week of 12 Oct 2026']);
});

test('frame rate and codec in a rule', async () => {
  const { matchesRule, parseRule, describeRule } = await import('../src/features/vault/ui/logic.ts');
  const v = (fps, codec) => ({ filename: 'a.mp4', rating: 0, tagNames: [], status: null, meta: fps ? { fps, codec } : null });
  const rule = { minFps: 60 };
  assert.equal(matchesRule(v(59.94, 'HEVC'), rule), true);
  assert.equal(matchesRule(v(120, 'HEVC'), rule), true);
  assert.equal(matchesRule(v(29.97, 'HEVC'), rule), false);
  assert.equal(matchesRule(v(null), rule), false);
  assert.equal(matchesRule(v(23.976, 'H.264'), { maxFps: 30, codec: 'h.264' }), true);
  assert.equal(matchesRule(v(23.976, 'HEVC'), { codec: 'H.264' }), false);
  const back = parseRule(JSON.stringify({ minFps: 60, codec: 'HEVC' }));
  assert.deepEqual(back, { minFps: 60, codec: 'HEVC' });
  assert.equal(describeRule(back), '60+ fps · HEVC');
});
