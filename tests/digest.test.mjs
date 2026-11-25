import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDigest, planDigest } from '../src/features/vault/digestPlan.ts';

// Local times, the way the phone schedules them.
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const now = at(25, 10);

test('one note per day at the chosen time, with everything of that day', () => {
  const parts = [
    { at: at(25, 21), title: 'Severance', body: 'S02E05 is out', kind: 'episode' },
    { at: at(26, 3), title: 'Frieren', body: 'E12 is out', kind: 'episode' },
    { at: at(26, 9), title: 'On this day', body: '3 videos from 2023', kind: 'memory' },
    { at: at(26, 14), title: 'Dune', body: 'Out today', kind: 'episode' },
  ];
  const plan = planDigest(parts, 18, now);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].at, at(25, 18));
  assert.equal(plan[0].title, 'Today: 1 new episode');
  assert.ok(plan[0].body.includes('Severance'));
  assert.equal(plan[1].at, at(26, 18));
  assert.equal(plan[1].title, 'Today: 2 new episodes and a memory');
  assert.ok(plan[1].body.includes('Frieren') && plan[1].body.includes('Dune') && plan[1].body.includes('3 videos from 2023'));
});

test("a day whose time has passed is skipped, days with nothing get no note", () => {
  const parts = [{ at: at(25, 21), title: 'Severance', body: 'S02E05', kind: 'episode' }];
  assert.deepEqual(planDigest(parts, 8, now), []);
  assert.deepEqual(planDigest([], 18, now), []);
});

test('no more than two weeks ahead, and long days are cut short', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ at: at(25 + i, 20), title: `Show ${i}`, body: 'x', kind: 'episode' }));
  assert.equal(planDigest(many, 21, now).length, 14);
  const busy = Array.from({ length: 12 }, (_, i) => ({ at: at(26, 20), title: `A rather long show name ${i}`, body: 'S01E01 is out', kind: 'episode' }));
  const one = planDigest(busy, 9, now)[0];
  assert.ok(one.body.length <= 240);
  assert.ok(one.body.includes('more'));
});

test('saved settings are read safely', () => {
  assert.deepEqual(parseDigest(null), { on: false, hour: 9 });
  assert.deepEqual(parseDigest('{"on":true,"hour":21}'), { on: true, hour: 21 });
  assert.deepEqual(parseDigest('{"on":true,"hour":99}'), { on: true, hour: 9 });
  assert.deepEqual(parseDigest('nope'), { on: false, hour: 9 });
});
