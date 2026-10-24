// Run with `npm test`. Manga Updates and History.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayLabel, historyFeed, unreadUpdates, updatesFeed } from '../src/features/vault/manga/mangaFeed.ts';

const DAY = 86_400_000;
const now = new Date(2026, 9, 23, 18).getTime();
const ch = (id, o = {}) => ({ id, seriesId: 's', folder: null, number: Number(id.slice(1)), volume: null, title: null, filename: null, pages: [], pageCount: 20, size: 0, contentKey: null, sourceKey: id, sourceUrl: null, scanlator: null, uploadedAt: null, addedAt: now - 30 * DAY, readAt: null, lastPage: 0, downloaded: false, position: 0, ...o });
const series = (o) => ({ id: 's', title: 'Tower', isPrivate: false, deletedAt: null, importedAt: now - 30 * DAY, chapters: [], ...o });

test('updates: only chapters that came after the title was added, newest first, by day', () => {
  const s = series({ chapters: [ch('c1'), ch('c2', { addedAt: now - DAY }), ch('c3', { addedAt: now - 3600_000 }), ch('c4', { addedAt: now - 3500_000, readAt: now })] });
  const days = updatesFeed([s], now);
  assert.deepEqual(days.map((d) => d.label), ['Today', 'Yesterday']);
  assert.deepEqual(days[0].rows.map((r) => r.chapter.id), ['c4', 'c3']);
  assert.equal(unreadUpdates(days), 2);
});

test('history: one line per title per day, the last chapter read that day', () => {
  const a = series({ chapters: [ch('c1', { readAt: now - 1000 }), ch('c2', { readAt: now - 500 }), ch('c3', { readAt: now - 2 * DAY })] });
  const b = series({ id: 'b', title: 'Moon', chapters: [ch('c9', { readAt: now - 200 })] });
  const days = historyFeed([a, b], now);
  assert.deepEqual(days[0].rows.map((r) => `${r.title}:${r.chapter.id}`), ['Moon:c9', 'Tower:c2']);
  assert.equal(days[1].rows[0].chapter.id, 'c3');
});

test('private and deleted titles stay out', () => {
  const hidden = [series({ isPrivate: true, chapters: [ch('c1', { readAt: now, addedAt: now })] }), series({ deletedAt: 1, chapters: [ch('c1', { readAt: now, addedAt: now })] })];
  assert.deepEqual(updatesFeed(hidden, now), []);
  assert.deepEqual(historyFeed(hidden, now), []);
});

test('day labels', () => {
  assert.equal(dayLabel(now, now), 'Today');
  assert.equal(dayLabel(now - DAY, now), 'Yesterday');
  assert.notEqual(dayLabel(now - 10 * DAY, now), 'Today');
});
