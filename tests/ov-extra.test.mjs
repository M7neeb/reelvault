// Run with `npm test`. Overview extras: reviews, rewatches, Plan to Watch order, rating history, stats.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addRewatch, EMPTY_OV_EXTRA, logRating, mergeOvExtra, movePlanned, orderPlanned, ovExtraForBackup, ovStats, parseOvExtra, planKeys, removeLastRewatch, setReview } from '../src/features/vault/ovExtra.ts';

const DAY = 86_400_000;
const T = new Date(2026, 9, 1).getTime();

test('reviews, rewatches and the rating log survive saving', () => {
  let x = setReview(EMPTY_OV_EXTRA, 's:a', '  Loved it ', T);
  x = addRewatch(addRewatch(x, 's:a', T), 's:a', T + DAY);
  x = logRating(logRating(x, 's:a', 7, T), 's:a', 8, T + 30_000);
  const back = parseOvExtra(JSON.stringify(x));
  assert.deepEqual(back.reviews['s:a'], { text: 'Loved it', at: T });
  assert.equal(back.rewatches['s:a'].length, 2);
  // Two changes within a minute: one entry.
  assert.deepEqual(back.ratingLog, [{ key: 's:a', rating: 8, at: T + 30_000 }]);
  assert.equal(removeLastRewatch(back, 's:a').rewatches['s:a'].length, 1);
  assert.equal(setReview(back, 's:a', '  ', T).reviews['s:a'], undefined);
  assert.deepEqual(parseOvExtra('nonsense'), EMPTY_OV_EXTRA);
});

test('Plan to Watch order: placed first, then new ones newest first', () => {
  const planned = [
    { key: 'a', addedAt: 1 },
    { key: 'b', addedAt: 5 },
    { key: 'c', addedAt: 3 },
  ];
  // Placed ones first in your order; a title added later goes after them.
  assert.deepEqual(orderPlanned(planned, ['c', 'a']).map((p) => p.key), ['c', 'a', 'b']);
  assert.deepEqual(planKeys(planned, ['c']), ['c', 'b', 'a']);
  assert.deepEqual(orderPlanned(planned, []).map((p) => p.key), ['b', 'c', 'a']);
  assert.deepEqual(movePlanned(['a', 'b', 'c'], 'c', 'top'), ['c', 'a', 'b']);
  assert.deepEqual(movePlanned(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
  assert.deepEqual(movePlanned(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
});

test('stats: ratings by month, fastest finished, rewatched, changed minds', () => {
  let x = logRating(EMPTY_OV_EXTRA, 's:a', 6, T);
  x = logRating(x, 's:a', 9, T + 40 * DAY);
  x = addRewatch(x, 's:a', T);
  x = setReview(x, 's:a', 'Great', T);
  const entries = [
    { key: 's:a', kind: 'series', title: 'Walks', rating: 9, plays: 4, lastWatchedAt: T + 5 * DAY, gone: false, episodes: [{ watched: true, lastWatchedAt: T + 2 * DAY }, { watched: true, lastWatchedAt: T + 5 * DAY }] },
    { key: 's:b', kind: 'series', title: 'Trip', rating: 0, plays: 1, lastWatchedAt: T, gone: false, episodes: [{ watched: true, lastWatchedAt: T }, { watched: false, lastWatchedAt: null }] },
  ];
  const s = ovStats(entries, x, new Map([['s:a', T]]));
  assert.deepEqual(s.ratingsByMonth.map((m) => [m.label, m.avg]), [['Oct', 6], ['Nov', 9]]);
  assert.deepEqual(s.fastest, [{ key: 's:a', title: 'Walks', days: 5 }]);
  assert.deepEqual(s.mostRewatched, [{ key: 's:a', title: 'Walks', times: 1 }]);
  assert.deepEqual(s.changedMinds, [{ key: 's:a', title: 'Walks', from: 6, to: 9 }]);
  assert.equal(s.finished, 1);
  assert.equal(s.inProgress, 1);
  assert.equal(s.reviewed, 1);
});

test('backups name series and join with what is on the phone', () => {
  let x = setReview(EMPTY_OV_EXTRA, 's:1', 'Series review', T);
  x = setReview(x, 'v:old', 'Video review', T);
  x = setReview(x, 'v:private', 'Hidden', T);
  x = addRewatch(x, 's:1', T);
  x = { ...x, planOrder: ['v:old', 's:1', 's:gone'] };
  x = logRating(x, 's:1', 8, T);
  const out = ovExtraForBackup(x, new Map([['1', 'Walks']]), (k) => k !== 'v:private');
  assert.deepEqual(Object.keys(out.reviews).sort(), ['S:Walks', 'v:old']);
  assert.deepEqual(out.planOrder, ['v:old', 'S:Walks']);

  // On another phone: the series has id 9, the video id 'new'; a review there already wins.
  const here = setReview(addRewatch(EMPTY_OV_EXTRA, 's:9', T + DAY), 's:9', 'Mine', T + DAY);
  const map = (k) => (k === 'S:Walks' ? 's:9' : k === 'v:old' ? 'v:new' : null);
  const merged = mergeOvExtra(here, out, map);
  assert.equal(merged.reviews['s:9'].text, 'Mine');
  assert.equal(merged.reviews['v:new'].text, 'Video review');
  assert.deepEqual(merged.rewatches['s:9'], [T, T + DAY]);
  assert.deepEqual(merged.ratingLog, [{ key: 's:9', rating: 8, at: T }]);
  // Joining twice adds nothing new.
  assert.deepEqual(mergeOvExtra(merged, out, map), merged);
});
