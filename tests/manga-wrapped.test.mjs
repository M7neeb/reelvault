// Run with `npm test`. The extra cards of the reading Wrapped: habits, streaks, kinds, authors, quiz, reader type.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { wrappedMore } from '../src/features/vault/manga/mangaInsights.ts';

const DAY = 86_400_000;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const C = (n, extra = {}) => ({ id: `c${n}`, number: n, readAt: null, lastPage: 0, size: 0, downloaded: false, folder: null, pageCount: 20, ...extra });
const S = (id, extra = {}) => ({ id, title: id, author: null, kind: null, deletedAt: null, isPrivate: false, rating: 0, status: null, finishedAt: null, lastReadAt: null, tags: [], chapters: [C(1)], ...extra });
const R = (seriesId, startedAt, min) => ({ seriesId, chapterId: null, startedAt, readMs: min * 60_000, pages: 0 });
const start = at(2026, 3, 1, 0);
const end = at(2026, 4, 1, 0);

test('habits: part of day, peak hour, weekday, streak, longest sitting', () => {
  const series = [S('a', { chapters: [C(1, { readAt: at(2026, 3, 2, 23) }), C(2, { readAt: at(2026, 3, 3, 23) }), C(3, { readAt: at(2026, 3, 4, 23) })] })];
  const reads = [R('a', at(2026, 3, 2, 23), 30), R('a', at(2026, 3, 3, 23), 150), R('a', at(2026, 3, 10, 9), 10)];
  const w = wrappedMore(series, reads, start, end);
  assert.equal(w.partOfDay, 'night');
  assert.equal(w.peakHour, 23);
  assert.equal(w.weekday.day, 1); // Tuesday 3 March
  assert.equal(w.streak, 3);
  assert.equal(w.longest.ms, 150 * 60_000);
  assert.equal(w.type.key, 'binger');
});

test('kinds, author, genres, favourite and throwback', () => {
  const series = [
    S('a', { kind: 'manhwa', author: 'Kim', rating: 9, tags: ['action', 'drama'], chapters: [C(1, { readAt: at(2025, 1, 5) }), C(2, { readAt: at(2026, 3, 5) }), C(3, { readAt: at(2026, 3, 6) })] }),
    S('b', { kind: 'manga', author: 'Kim', rating: 7, tags: ['action'], chapters: [C(1, { readAt: at(2026, 3, 7) })] }),
    S('c', { kind: 'manga', author: 'Oda', tags: ['comedy'], chapters: [C(1)] }),
  ];
  const w = wrappedMore(series, [], start, end);
  assert.deepEqual(w.kinds.map((k) => [k.kind, k.chapters]), [['manhwa', 2], ['manga', 1]]);
  assert.deepEqual(w.author, { name: 'Kim', chapters: 3, titles: 2 });
  assert.deepEqual(w.genres[0], { name: 'action', titles: 2 });
  assert.deepEqual(w.favourite, { id: 'a', rating: 9 });
  assert.equal(w.throwback.id, 'a');
});

test('quiz has the #1 among its options; then vs now uses the month before', () => {
  const series = ['a', 'b', 'c', 'd'].map((id) => S(id));
  const reads = [R('a', at(2026, 3, 2), 90), R('b', at(2026, 3, 3), 20), R('c', at(2026, 3, 4), 10), R('d', at(2026, 3, 5), 5), R('a', at(2026, 2, 10), 40)];
  const w = wrappedMore(series, reads, start, end);
  assert.equal(w.quiz.answer, 'a');
  assert.ok(w.quiz.options.includes('a'));
  assert.equal(w.quiz.options.length, 4);
  assert.equal(w.prev.ms, 40 * 60_000);
});

test('an empty range has no habits and is a steady reader', () => {
  const w = wrappedMore([S('a')], [], start, end);
  assert.equal(w.partOfDay, null);
  assert.equal(w.weekday, null);
  assert.equal(w.longest, null);
  assert.equal(w.quiz, null);
  assert.equal(w.type.key, 'steady');
});
