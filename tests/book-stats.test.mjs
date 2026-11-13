import test from 'node:test';
import assert from 'node:assert/strict';

import { bookStats, bookWrapped, bookYears, fmtTime, readerKind, streaks } from '../src/features/vault/books/bookStats.ts';

const book = (id, over = {}) => ({
  id, folder: `books/${id}`, filename: `${id}.epub`, size: 1, title: id, author: null, language: null, description: null, cover: null,
  chapterSizes: [1], chapter: 0, block: 0, chapterFrac: 0, readMs: 0, lastReadAt: null, finishedAt: null, addedAt: 0, ...over,
});
const at = (y, m, d, h = 20) => new Date(y, m - 1, d, h).getTime();
const read = (bookId, t, min, from = 0, to = 0) => ({ bookId, startedAt: t, endedAt: t + min * 60_000, ms: min * 60_000, from, to });

test('time reads like a person wrote it', () => {
  assert.equal(fmtTime(0), '0 min');
  assert.equal(fmtTime(20_000), 'under a minute');
  assert.equal(fmtTime(45 * 60_000), '45 min');
  assert.equal(fmtTime(125 * 60_000), '2 h 5 min');
  assert.equal(fmtTime(12 * 3_600_000 + 60_000), '12 h');
  assert.equal(fmtTime(119.6 * 3_600_000), '120 h');
});

test('streaks count days with at least a minute', () => {
  const now = at(2026, 11, 13, 21);
  const reads = [read('a', at(2026, 11, 11), 10), read('a', at(2026, 11, 12), 10), read('a', at(2026, 11, 13), 10), read('a', at(2026, 11, 1), 10), read('a', at(2026, 11, 2), 0.5)];
  assert.deepEqual(streaks(reads, now), { current: 3, best: 3 });
  // Nothing yet today: yesterday's run still counts.
  assert.equal(streaks(reads.slice(0, 2), now).current, 2);
  assert.equal(streaks(reads.slice(0, 2), at(2026, 11, 15)).current, 0);
});

test('dashboard numbers', () => {
  const now = at(2026, 11, 13, 21); // a Friday
  const books = [book('a', { lastReadAt: now }), book('b', { finishedAt: now - 1000, lastReadAt: now }), book('c')];
  const s = bookStats(books, [read('a', at(2026, 11, 13, 8), 30), read('b', at(2026, 11, 10), 60), read('gone', at(2026, 11, 10), 60)], now);
  assert.equal(s.todayMs, 30 * 60_000);
  assert.equal(s.weekMs, 90 * 60_000);
  assert.equal(s.week[4].today, true);
  assert.equal(s.totalMs, 90 * 60_000);
  assert.deepEqual(s.top.map((t) => t.id), ['b', 'a']);
  assert.equal(s.hours[8], 30 * 60_000);
  assert.deepEqual([s.finished, s.reading, s.notStarted], [1, 1, 1]);
});

test('years, newest first, only ones with reading', () => {
  const books = [book('a', { finishedAt: at(2025, 3, 1) })];
  const ys = bookYears(books, [read('a', at(2025, 2, 1), 90), read('a', at(2023, 2, 1), 5)], at(2026, 11, 13));
  assert.deepEqual(ys.map((y) => y.year), [2026, 2025, 2023]);
  assert.equal(ys[1].finished, 1);
  assert.deepEqual(ys[1].top, ['a']);
});

test('wrapped for a year', () => {
  const books = [book('a', { finishedAt: at(2026, 6, 1) }), book('b')];
  const reads = [
    read('a', at(2025, 12, 30), 20, 0, 0.1),
    read('a', at(2026, 1, 5, 23), 50, 0.1, 0.5),
    read('a', at(2026, 5, 31, 23), 70, 0.5, 1),
    read('b', at(2026, 3, 3, 9), 15, 0, 0.2),
  ];
  const w = bookWrapped(books, reads, new Date(2026, 0, 1).getTime(), at(2026, 11, 13), new Date(2025, 0, 1).getTime());
  assert.equal(w.ms, 135 * 60_000);
  assert.equal(w.sessions, 3);
  assert.equal(w.longest.ms, 70 * 60_000);
  assert.deepEqual(w.top.map((t) => [t.id, Math.round(t.gained * 10) / 10]), [['a', 0.9], ['b', 0.2]]);
  assert.deepEqual(w.finished.map((f) => f.id), ['a']);
  assert.deepEqual(w.started, ['b']);
  assert.equal(w.booksWorth, 1.1);
  assert.equal(w.partOfDay, 'night');
  assert.equal(w.bars.length, 11);
  assert.equal(w.prevMs, 20 * 60_000);
  assert.equal(readerKind(w).name, 'Night reader');
});

test('a short stretch has day bars', () => {
  const w = bookWrapped([book('a')], [], at(2026, 11, 9, 0), at(2026, 11, 16, 0));
  assert.equal(w.bars.length, 7);
  assert.equal(readerKind(w).name, 'Just starting');
});
