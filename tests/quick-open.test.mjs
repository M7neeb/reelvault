// Run with `npm test`. Quick links for a Control Center button.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onQuick, pickFavourite, pushQuick, quickKind } from '../src/features/vault/quickOpen.ts';

test('quick links are read in every shape the router hands over', () => {
  assert.equal(quickKind('reelvault://favourite'), 'favourite');
  assert.equal(quickKind('reelvault:///favorite'), 'favourite');
  assert.equal(quickKind('/memory'), 'memory');
  assert.equal(quickKind('reelvault://random?from=cc'), 'random');
  assert.equal(quickKind('memory'), 'memory');
  assert.equal(quickKind('reelvault://simkl/callback'), null);
  assert.equal(quickKind('file:///x/favourite.mov'), null);
  assert.equal(quickKind(''), null);
  assert.equal(quickKind('reelvault://watch'), 'watch');
  assert.equal(quickKind('reelvault://listen'), 'listen');
  assert.equal(quickKind('/read'), 'read');
  assert.equal(quickKind('reelvault://reader'), null);
});

test('a favourite: rated 8 or more, else your best', () => {
  const items = [{ id: 'a', rating: 9 }, { id: 'b', rating: 3 }, { id: 'c', rating: 8 }];
  const seen = new Set([0, 0.4, 0.99].map((r) => pickFavourite(items, () => r).id));
  assert.deepEqual([...seen].sort(), ['a', 'c']);
  assert.equal(pickFavourite([{ id: 'x', rating: 2 }, { id: 'y', rating: 6 }, { id: 'z', rating: 0 }], () => 0).id, 'y');
  assert.equal(pickFavourite([{ id: 'n', rating: 0 }], () => 0.5).id, 'n');
  assert.equal(pickFavourite([]), null);
});

test('a link that comes before the library is ready waits for it', () => {
  pushQuick('memory');
  const got = [];
  const off = onQuick((k) => got.push(k));
  pushQuick('favourite');
  off();
  assert.deepEqual(got, ['memory', 'favourite']);
});
