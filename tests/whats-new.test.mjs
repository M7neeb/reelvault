import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RELEASES, toShow } from '../src/features/vault/whatsNew.ts';

const list = [
  { id: '2026-12-01', title: 'C', items: ['c'] },
  { id: '2026-11-25', title: 'B', items: ['b'] },
  { id: '2026-11-24', title: 'A', items: ['a'] },
];

test('shows the releases newer than the last one seen, newest first', () => {
  assert.deepEqual(toShow(list, '2026-11-24').map((r) => r.id), ['2026-12-01', '2026-11-25']);
  assert.deepEqual(toShow(list, '2026-12-01'), []);
});

test('never seen anything: only the newest, not the whole history', () => {
  assert.deepEqual(toShow(list, null).map((r) => r.id), ['2026-12-01']);
  assert.deepEqual(toShow([], null), []);
});

test('the shipped list is newest first, with unique ids and something in each', () => {
  const ids = RELEASES.map((r) => r.id);
  assert.deepEqual([...ids].sort().reverse(), ids);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(RELEASES.every((r) => r.title && r.items.length > 0));
});
