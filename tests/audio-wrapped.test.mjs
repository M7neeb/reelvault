// Run with `npm test`. The Audio Wrapped's numbers: top five, habits, people, quizzes, badges, listener type.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { audioWrapped } from '../src/features/vault/audio/audioWrapped.ts';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const I = (id, extra = {}) => ({ id, kind: 'book', title: id, author: null, narrator: null, genre: null, rating: 0, finishedAt: null, deletedAt: null, ...extra });
const P = (itemId, startedAt, min) => ({ itemId, startedAt, listenedMs: min * 60_000 });
const start = at(2026, 1, 1, 0);
const end = at(2027, 1, 1, 0);
const now = at(2026, 10, 31);

const items = [
  I('a', { author: 'Ann Lee', narrator: 'Sam Voice', genre: 'Fantasy', rating: 9, finishedAt: at(2026, 3, 9) }),
  I('b', { author: 'Ann Lee', narrator: 'Sam Voice', genre: 'Fantasy', rating: 6 }),
  I('c', { kind: 'audio', author: 'Bob', genre: 'Podcast' }),
  I('gone', { deletedAt: 1 }),
];
const plays = [
  P('a', at(2026, 3, 2, 23), 150),
  P('a', at(2026, 3, 3, 23), 60),
  P('a', at(2026, 3, 4, 23), 30),
  P('b', at(2026, 5, 1, 8), 40),
  P('c', at(2026, 7, 7, 14), 20),
  P('gone', at(2026, 7, 8), 999),
  P('a', at(2025, 6, 1), 10),
];

test('totals, top five with their best day, people and genres', () => {
  const w = audioWrapped(items, plays, start, end, now);
  assert.equal(w.ms, 300 * 60_000);
  assert.equal(w.titles, 3);
  assert.equal(w.top[0].id, 'a');
  assert.equal(w.top[0].bestDay.ms, 150 * 60_000);
  assert.deepEqual(w.author, { name: 'Ann Lee', ms: 280 * 60_000, titles: 2 });
  assert.equal(w.narrator.name, 'Sam Voice');
  assert.equal(w.genres[0].name, 'Fantasy');
  assert.ok(w.books.share > 0.9);
});

test('habits: night, peak hour inside the night, streak, longest sitting', () => {
  const w = audioWrapped(items, plays, start, end, now);
  assert.equal(w.partOfDay, 'night');
  assert.equal(w.peakHour, 23);
  assert.equal(w.streak, 3);
  assert.equal(w.longest.ms, 150 * 60_000);
  assert.equal(w.type.key, 'marathon');
  // The listener type is the marathon one: its badge is not shown twice.
  assert.ok(!w.badges.some((b) => b.key === 'marathon'));
});

test('started, finished, ratings, quizzes and the year before', () => {
  const w = audioWrapped(items, plays, start, end, now);
  assert.deepEqual(w.started.sort(), ['b', 'c']);
  assert.deepEqual(w.finished, ['a']);
  assert.equal(w.ratings.average, 7.5);
  const q = w.quizzes.find((x) => x.key === 'hours');
  assert.equal(q.options[q.answer], '5 h');
  assert.equal(new Set(q.options).size, 4);
  const m = w.quizzes.find((x) => x.key === 'month');
  assert.equal(m.options[m.answer], 'March');
  assert.equal(w.prev.ms, 10 * 60_000);
});

test('nothing played: calm and empty', () => {
  const w = audioWrapped(items, [], start, end, now);
  assert.equal(w.ms, 0);
  assert.equal(w.top.length, 0);
  assert.equal(w.peakHour, null);
  assert.equal(w.quizzes.length, 0);
  assert.equal(w.type.key, 'steady');
});
