import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stalledShows, STALL_DAYS } from '../src/features/simkl/logic.ts';

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 25);
const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
const show = (id, over = {}) => ({
  simklId: id, type: 'show', title: `Show ${id}`, year: 2020, poster: null, slug: null, runtime: 45,
  status: 'watching', rating: null, ratedAt: null, addedAt: iso(400), lastWatchedAt: iso(90),
  watchedEpisodes: 4, totalEpisodes: 10, notAiredEpisodes: 0, nextToWatch: 'S01E05', animeType: null,
  memo: null, nextTitle: null, nextDate: null, simklRating: null, simklVotes: null, imdbRating: null,
  imdbVotes: null, malRating: null, rank: null, ...over,
});

test('watching shows untouched for two months are stalled, oldest first', () => {
  const out = stalledShows([show(1, { lastWatchedAt: iso(70) }), show(2, { lastWatchedAt: iso(200) }), show(3, { lastWatchedAt: iso(10) })], 'show', now, {});
  assert.deepEqual(out.map((i) => i.simklId), [2, 1]);
  assert.equal(STALL_DAYS, 60);
});

test('caught up, other statuses, other types and snoozed ones are left out', () => {
  const items = [
    show(1, { nextToWatch: null }),
    show(2, { status: 'hold' }),
    show(3, { type: 'anime' }),
    show(4),
    show(5),
  ];
  const out = stalledShows(items, 'show', now, { 4: now + DAY, 5: now - DAY });
  assert.deepEqual(out.map((i) => i.simklId), [5]);
});

test('a show never watched counts from when it was added', () => {
  assert.equal(stalledShows([show(1, { lastWatchedAt: null, addedAt: iso(90) })], 'show', now, {}).length, 1);
  assert.equal(stalledShows([show(1, { lastWatchedAt: null, addedAt: iso(5) })], 'show', now, {}).length, 0);
  assert.equal(stalledShows([show(1, { lastWatchedAt: null, addedAt: null })], 'show', now, {}).length, 0);
});
