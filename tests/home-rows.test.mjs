// Run with `npm test`. The rows on the library's home.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { homeRows } from '../src/features/vault/homeRows.ts';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 19, 12).getTime();
const v = (id, over = {}) => ({ id, importedAt: NOW - Number(id.slice(1)) * DAY, createdAt: NOW, rating: 0, tagNames: [], ...over });

test('rows: recent, best, never watched, the top keyword, today', () => {
  const videos = [v('v1', { rating: 9, tagNames: ['trip'] }), v('v2', { rating: 8, tagNames: ['trip'] }), v('v3', { rating: 10, tagNames: ['trip'] }), v('v4'), v('v5', { tagNames: ['home'] })];
  const plays = [
    { videoId: 'v1', startedAt: NOW - DAY, watchedMs: 60_000 },
    { videoId: 'v2', startedAt: NOW - 5 * DAY, watchedMs: 60_000 },
    { videoId: 'v5', startedAt: NOW - DAY, watchedMs: 1000 },
  ];
  const rows = homeRows(videos, plays, NOW);
  assert.deepEqual(rows.map((r) => r.key), ['recent', 'best', 'never', 'tag', 'today']);
  assert.deepEqual(rows[0].videos.map((x) => x.id), ['v1', 'v2', 'v3', 'v4', 'v5']);
  assert.deepEqual(rows[1].videos.map((x) => x.id), ['v3', 'v1', 'v2']);
  assert.deepEqual(rows[2].videos.map((x) => x.id), ['v3', 'v4']);
  assert.equal(rows[3].title, 'More #trip');
  // Least recently watched first: never-watched v3, then v2, then v1.
  assert.deepEqual(rows[3].videos.map((x) => x.id), ['v3', 'v2', 'v1']);
});

test("today's picks stay the same all day and change the next", () => {
  const videos = Array.from({ length: 30 }, (_, i) => v(`v${i + 1}`));
  const a = homeRows(videos, [], NOW).find((r) => r.key === 'today').videos.map((x) => x.id);
  const b = homeRows(videos, [], NOW + 3 * 3_600_000).find((r) => r.key === 'today').videos.map((x) => x.id);
  const c = homeRows(videos, [], NOW + DAY).find((r) => r.key === 'today').videos.map((x) => x.id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(homeRows(videos.slice(0, 3), [], NOW).length, 0);
});
