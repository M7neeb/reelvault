// Run with `npm test`. Watch history, stats, the year-old shelf, random picks and watch sorting.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { albumsByWatching, historyDays, notInAYear, randomPick, sortByWatching, watchStats } from '../src/features/vault/history.ts';

const MIN = 60_000;
const DAY = 86_400_000;
const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();
const NOW = at(2026, 9, 18, 20);

const video = (id, over = {}) => ({ id, title: null, filename: `${id}.mp4`, createdAt: at(2025, 0, 1), importedAt: at(2025, 0, 2), durationMs: 10 * MIN, rating: 0, tagNames: [], ...over });
const play = (videoId, startedAt, watchedMs = 5 * MIN) => ({ videoId, startedAt, watchedMs });

test('plays close together become one sitting, grouped by day', () => {
  const days = historyDays(
    [play('a', at(2026, 9, 18, 10)), play('a', at(2026, 9, 18, 10, 10)), play('b', at(2026, 9, 18, 11)), play('a', at(2026, 9, 17, 9))],
    NOW
  );
  assert.equal(days.length, 2);
  assert.equal(days[0].title, 'Today');
  assert.equal(days[1].title, 'Yesterday');
  assert.equal(days[0].sittings.length, 2);
  assert.equal(days[0].sittings[0].videoId, 'b');
  assert.equal(days[0].sittings[1].plays, 2);
  assert.equal(days[0].ms, 15 * MIN);
});

test('stats: peaks, streaks, rewatches and finish rate', () => {
  const vids = [video('a', { tagNames: ['beach'] }), video('b'), video('c')];
  const plays = [play('a', at(2026, 9, 18, 21)), play('a', at(2026, 9, 17, 21)), play('a', at(2026, 9, 16, 21)), play('b', at(2026, 9, 10, 8), 10 * MIN)];
  const s = watchStats(vids, plays, NOW);
  assert.equal(s.plays, 4);
  assert.equal(s.watched, 2);
  assert.equal(s.neverWatched, 1);
  assert.equal(s.peakHour, 21);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.longestStreak, 3);
  assert.equal(s.rewatched[0].videoId, 'a');
  assert.equal(s.rewatched[0].plays, 3);
  assert.ok(Math.abs(s.finishRate - (0.5 * 3 + 1) / 4) < 1e-9);
  assert.equal(s.topTags[0].tag, 'beach');
  assert.equal(s.months.length, 12);
});

test("haven't watched in a year: lapsed first, then never watched old ones", () => {
  const vids = [video('old', { rating: 9 }), video('fresh'), video('never', { createdAt: at(2023, 5, 1) }), video('newnever', { createdAt: at(2026, 8, 1) })];
  const plays = [play('old', at(2025, 1, 1)), play('fresh', at(2026, 9, 1))];
  const out = notInAYear(vids, plays, NOW);
  assert.deepEqual(out.map((x) => x.video.id), ['old', 'never']);
  assert.match(out[0].why, /months ago/);
});

test('random pick leans towards unwatched and never repeats the last one', () => {
  const vids = [video('a'), video('b')];
  const plays = [play('a', at(2026, 9, 17))];
  assert.equal(randomPick(vids, plays, NOW, () => 0.99).id, 'b');
  assert.equal(randomPick(vids, plays, NOW, () => 0.0, 'a').id, 'b');
  assert.equal(randomPick([], plays, NOW), null);
});

test('sort by watching and albums by watching', () => {
  const vids = [video('a'), video('b'), video('c')];
  const plays = [play('b', at(2026, 9, 1)), play('b', at(2026, 9, 2)), play('a', at(2026, 9, 3))];
  assert.deepEqual(sortByWatching(vids, plays, 'mostWatched').map((v) => v.id), ['b', 'a', 'c']);
  assert.deepEqual(sortByWatching(vids, plays, 'leastWatched').map((v) => v.id), ['c', 'a', 'b']);
  assert.deepEqual(sortByWatching(vids, plays, 'lastWatched').map((v) => v.id), ['a', 'b', 'c']);
  const albums = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(albumsByWatching(albums, (id) => (id === 1 ? ['a'] : ['b']), plays).map((a) => a.id), [2, 1]);
});
