// Run with `npm test`. Listening year by year, for the Audio Wrapped posters.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listeningYears } from '../src/features/vault/audio/audioYears.ts';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const P = (itemId, startedAt, min) => ({ itemId, startedAt, listenedMs: min * 60_000 });

test('newest year first, this year always there, top three by time', () => {
  const plays = [P('a', at(2026, 3, 1), 30), P('b', at(2026, 3, 1, 20), 50), P('a', at(2026, 4, 2), 30), P('c', at(2026, 5, 2), 5), P('d', at(2026, 5, 3), 1), P('x', at(2024, 1, 1), 10), P('z', at(2024, 1, 1), 0)];
  const ys = listeningYears(plays, at(2026, 10, 31));
  assert.deepEqual(ys.map((y) => y.year), [2026, 2024]);
  assert.equal(ys[0].ms, 116 * 60_000);
  assert.deepEqual(ys[0].top, ['a', 'b', 'c']);
  assert.equal(ys[0].titles, 4);
  assert.equal(ys[0].days, 4);
  assert.equal(ys[1].titles, 1);
  assert.deepEqual(listeningYears([], at(2026, 1, 1)), [{ year: 2026, ms: 0, titles: 0, days: 0, top: [] }]);
});
