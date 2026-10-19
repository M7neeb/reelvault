// Run with `npm test`. Simkl stats: genres over time, hours per show, how many you finish.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { finishing, genresOverTime, hoursPerShow } from '../src/features/simkl/insights.ts';

const at = (m, d) => new Date(2026, m, d, 20).getTime();
const NOW = at(9, 19);
const item = (id, type, status, title = `T${id}`) => ({ simklId: id, type, status, title, totalEpisodes: 10, watchedEpisodes: 0 });
const ev = (id, type, t, minutes = 30, rewatch = false) => ({ simklId: id, type, at: t, minutes, rewatch });

test('genres over time: top five and Other, minutes shared between a title\'s genres', () => {
  const meta = new Map([
    [1, { genres: ['Drama', 'Comedy'] }],
    [2, { genres: ['Drama'] }],
    [3, { genres: [] }],
  ]);
  const events = [ev(1, 'show', at(9, 2), 40), ev(2, 'show', at(9, 3), 30), ev(3, 'show', at(8, 5), 20), ev(2, 'show', at(0, 1), 99)];
  const g = genresOverTime(events, meta, NOW, 3);
  assert.deepEqual(g.genres, ['Drama', 'Comedy']);
  assert.equal(g.months.length, 3);
  const oct = g.months[2];
  assert.equal(oct.total, 70);
  assert.deepEqual(oct.parts, [{ genre: 'Drama', minutes: 50 }, { genre: 'Comedy', minutes: 20 }]);
  assert.deepEqual(g.months[1].parts, [{ genre: 'Other', minutes: 20 }]);
  // January is outside the last three months.
  assert.equal(g.months[0].total, 0);
});

test('hours per show and how many you finish', () => {
  const items = [item(1, 'show', 'completed', 'Fast'), item(2, 'show', 'completed', 'Slow'), item(3, 'anime', 'dropped'), item(4, 'show', 'plantowatch'), item(5, 'movie', 'completed'), item(6, 'show', 'watching')];
  const events = [ev(1, 'show', at(9, 1)), ev(1, 'show', at(9, 2)), ev(2, 'show', at(0, 1), 45), ev(2, 'show', at(5, 1), 45), ev(2, 'show', at(5, 2), 45, true), ev(5, 'movie', at(3, 1), 120)];
  const h = hoursPerShow(events, items);
  assert.deepEqual(h.map((x) => [x.title, x.minutes, x.episodes]), [['Slow', 135, 3], ['Fast', 60, 2]]);
  const f = finishing(items, events);
  assert.equal(f.started, 4);
  assert.equal(f.finished, 2);
  assert.equal(f.dropped, 1);
  assert.equal(f.watching, 1);
  assert.equal(f.rate, 50);
  assert.deepEqual(f.fastest[0], { title: 'Fast', days: 1 });
  // (1 day + 151 days) / 2.
  assert.equal(f.avgDays, 76);
});
