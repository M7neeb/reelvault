// Run with `npm test`. The manga library's tabs: order, hidden, names, renames.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { arrangeTabs, moveTab, parseTabPrefs, renameTabKey } from '../src/features/vault/manga/mangaLogic.ts';

const tabs = ['all', 'reading', 'planned', 'unread', '#action'].map((key) => ({ key }));
const keys = (l) => l.map((t) => t.key);

test('parseTabPrefs survives junk', () => {
  assert.deepEqual(parseTabPrefs(null), { order: [], hidden: [], labels: {}, extra: [] });
  assert.deepEqual(parseTabPrefs('nope'), { order: [], hidden: [], labels: {}, extra: [] });
  assert.deepEqual(parseTabPrefs('{"order":["a",1],"labels":{"x":"Y","z":""},"extra":["isekai"]}'), { order: ['a'], hidden: [], labels: { x: 'Y' }, extra: ['isekai'] });
});

test('arrangeTabs keeps Library first, your order next, new tabs after', () => {
  assert.deepEqual(keys(arrangeTabs(tabs, parseTabPrefs('{}'))), ['all', 'reading', 'planned', 'unread', '#action']);
  assert.deepEqual(keys(arrangeTabs(tabs, parseTabPrefs('{"order":["#action","planned","all"]}'))), ['all', '#action', 'planned', 'reading', 'unread']);
});

test('moveTab swaps with the neighbour and stops at the ends', () => {
  assert.deepEqual(moveTab(['all', 'a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveTab(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  assert.deepEqual(moveTab(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
});

test('renameTabKey carries the place and hidden state', () => {
  const p = renameTabKey({ order: ['#old', 'reading'], hidden: ['#old'], labels: { '#old': 'x' }, extra: ['old'] }, '#old', '#new');
  assert.deepEqual(p, { order: ['#new', 'reading'], hidden: ['#new'], labels: {}, extra: ['new'] });
});
