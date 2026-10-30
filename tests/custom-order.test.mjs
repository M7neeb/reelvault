// Run with `npm test`. "My order": moving videos up, down, to the top and together.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inCustomOrder, moveIds, reorderWithin } from '../src/features/vault/ui/customOrder.ts';

test('moving: top, bottom, up, down', () => {
  const l = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(moveIds(l, ['d'], 'top'), ['d', 'a', 'b', 'c', 'e']);
  assert.deepEqual(moveIds(l, ['b', 'd'], 'bottom'), ['a', 'c', 'e', 'b', 'd']);
  assert.deepEqual(moveIds(l, ['c'], 'up'), ['a', 'c', 'b', 'd', 'e']);
  assert.deepEqual(moveIds(l, ['a'], 'up'), l);
  assert.deepEqual(moveIds(l, ['c', 'd'], 'down'), ['a', 'b', 'e', 'c', 'd']);
  assert.deepEqual(moveIds(l, ['e'], 'down'), l);
  assert.deepEqual(moveIds(l, ['zz'], 'top'), l);
});

test('vid1, vid2, lid1, vid3: put together, then all three to the top', () => {
  const l = ['x', 'vid1', 'vid2', 'lid1', 'vid3', 'y'];
  const together = moveIds(l, ['vid1', 'vid2', 'vid3'], 'together');
  assert.deepEqual(together, ['x', 'vid1', 'vid2', 'vid3', 'lid1', 'y']);
  assert.deepEqual(moveIds(together, ['vid1', 'vid2', 'vid3'], 'top'), ['vid1', 'vid2', 'vid3', 'x', 'lid1', 'y']);
  // Just vid3 up one place does it too.
  assert.deepEqual(moveIds(l, ['vid3'], 'up'), ['x', 'vid1', 'vid2', 'vid3', 'lid1', 'y']);
});

test('my order: placed videos as left, new ones on top newest first', () => {
  const v = (id, createdAt) => ({ id, createdAt, importedAt: createdAt });
  const items = [v('old', 1), v('mid', 2), v('new', 3), v('newer', 4)];
  assert.deepEqual(inCustomOrder(items, ['mid', 'old']).map((x) => x.id), ['newer', 'new', 'mid', 'old']);
  assert.deepEqual(inCustomOrder(items, []).map((x) => x.id), ['newer', 'new', 'mid', 'old']);
});

test('moving inside an album leaves the other videos where they are', () => {
  const full = ['a', 'X', 'b', 'Y', 'c'];
  // In the album you see a, b, c and move c to the top.
  assert.deepEqual(reorderWithin(full, ['c', 'a', 'b']), ['c', 'X', 'a', 'Y', 'b']);
});
