// Run with `npm test`. Selecting many titles in the manga library: ranges, invert, categories, undo groups.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { idsBetween, invertSelection, statusGroups, tagState } from '../src/features/vault/manga/mangaLogic.ts';

const ids = ['a', 'b', 'c', 'd', 'e'];

test('idsBetween picks every cover between two, either direction', () => {
  assert.deepEqual(idsBetween(ids, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(idsBetween(ids, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(idsBetween(ids, 'c', 'c'), ['c']);
  // The first cover is not in this tab: only the one held.
  assert.deepEqual(idsBetween(ids, 'zz', 'c'), ['c']);
  assert.deepEqual(idsBetween(ids, 'a', 'zz'), []);
});

test('invertSelection flips the tab and keeps picks from other tabs', () => {
  assert.deepEqual([...invertSelection(ids, ['a', 'c'])].sort(), ['b', 'd', 'e']);
  assert.deepEqual([...invertSelection(ids, ['a', 'x'])].sort(), ['b', 'c', 'd', 'e', 'x']);
  assert.deepEqual([...invertSelection(ids, [])].sort(), ids);
});

test('tagState tells all, some or none', () => {
  const s = [{ tags: ['action'] }, { tags: ['action', 'isekai'] }, { tags: [] }];
  assert.deepEqual(tagState(s, 'action'), { has: 2, state: 'some' });
  assert.deepEqual(tagState(s.slice(0, 2), 'action'), { has: 2, state: 'all' });
  assert.deepEqual(tagState(s, 'romance'), { has: 0, state: 'none' });
});

test('statusGroups keeps what each title had, for Undo', () => {
  const g = statusGroups([
    { id: '1', status: 'reading' },
    { id: '2', status: null },
    { id: '3', status: 'reading' },
  ]);
  assert.deepEqual(g, [
    { status: 'reading', ids: ['1', '3'] },
    { status: null, ids: ['2'] },
  ]);
});
