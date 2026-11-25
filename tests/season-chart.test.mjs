import assert from 'node:assert/strict';
import { test } from 'node:test';

import { seasonChart, seasonOf } from '../src/features/simkl/logic.ts';

const now = Date.UTC(2026, 10, 25);
const meta = (id, over = {}) => ({
  title: `Anime ${id}`, poster: `p/${id}`, ids: { simkl_id: id, slug: `a-${id}` }, release_date: '2026-10-05T15:00:00Z',
  ratings: { simkl: { rating: null }, mal: { rating: 7 } }, genres: ['Action'], anime_type: 'tv', total_episodes: 12, status: 'ongoing', ...over,
});
const file = {
  calendar: [
    { simkl_id: 1, date: '2026-11-27T15:00:00Z', episode: { episode: 9 } },
    { simkl_id: 1, date: '2026-12-04T15:00:00Z', episode: { episode: 10 } },
    { simkl_id: 2, date: '2026-11-26T15:00:00Z', episode: { episode: 120 } },
    { simkl_id: 3, date: '2026-11-28T15:00:00Z', episode: { episode: 2 } },
    { simkl_id: 4, date: '2026-11-28T15:00:00Z', episode: { episode: 1 } },
  ],
  metadata: {
    1: meta(1, { ratings: { simkl: { rating: 8.1 }, mal: { rating: 8.6 } } }),
    2: meta(2, { release_date: '2019-04-01', ratings: { mal: { rating: 8.9 } } }),
    3: meta(3, { ratings: { simkl: { rating: 6.2 } } }),
    4: meta(4, { anime_type: 'music video' }),
  },
};

test('the season is named by its months', () => {
  assert.deepEqual(seasonOf(now), { label: 'Fall 2026', start: Date.UTC(2026, 9, 1) });
  assert.equal(seasonOf(Date.UTC(2027, 0, 3)).label, 'Winter 2027');
  assert.equal(seasonOf(Date.UTC(2026, 4, 3)).label, 'Spring 2026');
  assert.equal(seasonOf(Date.UTC(2026, 7, 3)).label, 'Summer 2026');
});

test('one entry per title, new ones split from long runners, best score first', () => {
  const chart = seasonChart(file, now);
  assert.deepEqual(chart.map((a) => a.simklId), [2, 1, 3]);
  const one = chart.find((a) => a.simklId === 1);
  assert.equal(one.isNew, true);
  assert.equal(one.score, 8.6);
  assert.equal(one.nextDate, '2026-11-27T15:00:00Z');
  assert.equal(one.nextEpisode, 9);
  assert.equal(chart.find((a) => a.simklId === 2).isNew, false);
  assert.equal(chart.find((a) => a.simklId === 3).score, 6.2);
});

test('music videos are left out, and bad files give an empty chart', () => {
  assert.ok(!seasonChart(file, now).some((a) => a.simklId === 4));
  assert.deepEqual(seasonChart(null, now), []);
  assert.deepEqual(seasonChart([], now), []);
});
