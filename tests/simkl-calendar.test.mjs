import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCatalog } from '../src/features/simkl/logic.ts';

// The shape data.simkl.in/calendar/v2/*.json has now: rows plus a metadata map by id.
const v2 = {
  calendar: [
    { simkl_id: 3196704, date: '2026-11-23T15:00:00Z', finale_type: null, episode: { episode: 38, title: 'Episode 38' } },
    { simkl_id: 1440932, date: '2026-11-24T05:00:00Z', finale_type: null, episode: { season: 2, episode: 4 } },
    { simkl_id: 999, date: '2026-11-24T05:00:00Z' },
  ],
  metadata: {
    3196704: { title: 'God of Eternity', poster: '20/207477413f00895f7c', ids: { simkl_id: 3196704, slug: 'wangu-shen-di' }, release_date: '2026-07-20T15:00:00Z', rank: null, ratings: { simkl: { rating: 7.4 }, mal: { rating: 7.9 } } },
    1440932: { title: 'Mark Rober', poster: 'aa/bb', ids: { simkl_id: 1440932, slug: 'mark-rober' }, release_date: '2016-01-01', rank: 120, ratings: { simkl: { rating: 8.1 }, imdb: { rating: 8.4 } } },
  },
};

test('calendar v2 files (rows + metadata) are read, not dropped', () => {
  const rows = parseCatalog(v2, 'anime');
  assert.equal(rows.length, 2, 'the row without metadata is skipped');
  assert.deepEqual(rows[0], {
    simklId: 3196704,
    type: 'anime',
    title: 'God of Eternity',
    year: 2026,
    poster: '20/207477413f00895f7c',
    slug: 'wangu-shen-di',
    date: '2026-11-23T15:00:00Z',
    episodeLabel: rows[0].episodeLabel,
    rank: null,
    simklRating: 7.4,
    imdbRating: null,
  });
  assert.ok(rows[0].episodeLabel && rows[0].episodeLabel.includes('38'));
  assert.equal(rows[1].imdbRating, 8.4);
  assert.equal(rows[1].rank, 120);
});

test('the old array shape still works and nonsense gives nothing', () => {
  assert.equal(parseCatalog([{ title: 'X', ids: { simkl_id: 5 } }], 'show').length, 1);
  assert.deepEqual(parseCatalog({ calendar: 'x' }, 'show'), []);
  assert.deepEqual(parseCatalog(null, 'show'), []);
});
