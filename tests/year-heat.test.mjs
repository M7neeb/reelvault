// Run with `npm test`. The year heat map and the Sunday summary.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentStreak, weeklySummary, yearHeat } from '../src/features/vault/yearHeat.ts';

const MIN = 60_000;
const at = (y, m, d, h = 20) => new Date(y, m, d, h).getTime();

test('a year of days: months as calendars, levels from your own days', () => {
  const plays = [
    { videoId: 'a', startedAt: at(2026, 0, 1), watchedMs: 5 * MIN },
    { videoId: 'a', startedAt: at(2026, 0, 2), watchedMs: 10 * MIN },
    { videoId: 'b', startedAt: at(2026, 0, 3), watchedMs: 20 * MIN },
    { videoId: 'b', startedAt: at(2026, 0, 3, 22), watchedMs: 40 * MIN },
    { videoId: 'c', startedAt: at(2026, 5, 9), watchedMs: 15 * MIN },
    { videoId: 'z', startedAt: at(2025, 3, 1), watchedMs: MIN },
  ];
  const h = yearHeat(plays, 2026, at(2026, 9, 19));
  assert.equal(h.months.length, 12);
  // 1 January 2026 is a Thursday: three empty cells before it (Monday first).
  assert.deepEqual(h.months[0].weeks[0].slice(0, 4).map((c) => c?.date ?? null), [null, null, null, 1]);
  assert.ok(h.months.every((m) => m.weeks.every((w) => w.length === 7)));
  assert.equal(h.days, 4);
  assert.equal(h.run, 3);
  assert.equal(h.totalMs, 90 * MIN);
  assert.equal(h.best.date, 3);
  assert.equal(h.best.top, 'b');
  assert.equal(h.best.level, 4);
  const jan1 = h.months[0].weeks[0][3];
  assert.equal(jan1.level, 1);
  assert.deepEqual(h.years, [2026, 2025]);
  // Days after today are marked.
  assert.equal(h.months[11].weeks[1].find((c) => c)?.future, true);
});

test('current streak: today not watched yet still counts', () => {
  const now = at(2026, 9, 19, 9);
  assert.equal(currentStreak([at(2026, 9, 18), at(2026, 9, 17), at(2026, 9, 15)], now), 2);
  assert.equal(currentStreak([at(2026, 9, 19, 8), at(2026, 9, 18)], now), 2);
  assert.equal(currentStreak([at(2026, 9, 16)], now), 0);
});

test('Sunday summary: this week so far, your #1 and the run of days', () => {
  // Wednesday 14 October 2026.
  const now = at(2026, 9, 14, 21);
  const plays = [
    { videoId: 'old', startedAt: at(2026, 9, 10), watchedMs: 60 * MIN },
    { videoId: 'a', startedAt: at(2026, 9, 12), watchedMs: 30 * MIN },
    { videoId: 'b', startedAt: at(2026, 9, 13), watchedMs: 50 * MIN },
    { videoId: 'a', startedAt: at(2026, 9, 14), watchedMs: 40 * MIN },
  ];
  const s = weeklySummary(plays, now, { nameOf: (id) => ({ a: 'Beach day', b: 'Lake', old: 'Old' })[id] ?? null, fmt: (ms) => `${Math.round(ms / MIN)} min` });
  // Sunday 18 October, 19:00.
  assert.equal(s.at, new Date(2026, 9, 18, 19, 0).getTime());
  assert.equal(s.body, '120 min on 3 days. Your #1: Beach day. Streak: 3 days in a row.');
  // Sunday after 19:00: next week, nothing yet.
  assert.equal(weeklySummary(plays, at(2026, 9, 18, 20), { nameOf: () => 'x', fmt: String }), null);
  // Private videos (no name) are left out.
  assert.equal(weeklySummary(plays, now, { nameOf: () => null, fmt: String }), null);
});
