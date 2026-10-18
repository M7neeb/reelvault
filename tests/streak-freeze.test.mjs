// Run with `npm test`. Streak freezes: earning them, spending them on a gap.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settleFreezes, sod } from '../src/features/vault/streakFreeze.ts';

const at = (y, m, d, h = 20) => new Date(y, m, d, h).getTime();
// Sunday 18 October 2026, evening.
const NOW = at(2026, 9, 18);

test('one missed day is covered by a banked freeze', () => {
  const plays = [at(2026, 9, 14), at(2026, 9, 15), at(2026, 9, 16)];
  const f = settleFreezes(plays, { banked: 1, used: [], lastEarnedWeek: new Date(2026, 9, 5).getTime() }, NOW);
  assert.deepEqual(f.used, [sod(at(2026, 9, 17))]);
  assert.equal(f.banked, 0);
});

test('a gap bigger than the banked freezes is left alone', () => {
  const plays = [at(2026, 9, 14)];
  const start = { banked: 1, used: [], lastEarnedWeek: new Date(2026, 9, 5).getTime() };
  const f = settleFreezes(plays, start, NOW);
  assert.equal(f, start);
});

test('watching yesterday needs no freeze', () => {
  const start = { banked: 1, used: [], lastEarnedWeek: new Date(2026, 9, 5).getTime() };
  assert.equal(settleFreezes([at(2026, 9, 17)], start, NOW), start);
});

test('a week with five days of watching earns a freeze, up to two', () => {
  // Monday 5 to Friday 9 October.
  const plays = [5, 6, 7, 8, 9].map((d) => at(2026, 9, d)).concat([at(2026, 9, 17)]);
  const f = settleFreezes(plays, { banked: 1, used: [], lastEarnedWeek: new Date(2026, 8, 28).getTime() }, NOW);
  assert.equal(f.banked, 2);
  assert.equal(f.lastEarnedWeek, new Date(2026, 9, 5).getTime());
  const g = settleFreezes(plays, { banked: 2, used: [], lastEarnedWeek: new Date(2026, 8, 28).getTime() }, NOW);
  assert.equal(g.banked, 2);
});
