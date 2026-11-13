import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countedMs,
  displayTitle,
  fmtProgress,
  fracOfBlock,
  minutesLeft,
  parseReaderPrefs,
  progressAt,
  progressOf,
  safeBlock,
  shelfOrder,
} from '../src/features/vault/books/bookLogic.ts';

const book = (over = {}) => ({
  id: 'a',
  folder: 'books/a',
  filename: 'crime_and_punishment.epub',
  size: 1,
  title: null,
  author: null,
  language: null,
  description: null,
  cover: null,
  chapterSizes: [100, 300, 600],
  chapter: 0,
  block: 0,
  chapterFrac: 0,
  readMs: 0,
  lastReadAt: null,
  finishedAt: null,
  addedAt: 1,
  ...over,
});

test('progress weights chapters by length', () => {
  assert.equal(progressAt([100, 300, 600], 0, 0), 0);
  assert.equal(progressAt([100, 300, 600], 1, 0), 0.1);
  assert.equal(progressAt([100, 300, 600], 2, 0.5), 0.7);
  assert.equal(progressAt([100, 300, 600], 9, 1), 1);
  assert.equal(progressAt([], 3, 0.5), 0);
});

test('a finished book is 100%, a started one never shows 0%', () => {
  assert.equal(progressOf(book({ finishedAt: 5 })), 1);
  assert.equal(fmtProgress(0.001, true), '1%');
  assert.equal(fmtProgress(0, false), 'Not started');
  assert.equal(fmtProgress(0.999, true), '99%');
  assert.equal(fmtProgress(1, true), 'Finished');
});

test('paragraph position', () => {
  assert.equal(fracOfBlock(0, 10), 0);
  assert.equal(fracOfBlock(9, 10), 1);
  assert.equal(fracOfBlock(0, 1), 0);
  assert.equal(safeBlock(40, 10), 9);
  assert.equal(safeBlock(-2, 10), 0);
  assert.equal(safeBlock(3, 0), 0);
});

test('title falls back to the file name', () => {
  assert.equal(displayTitle(book()), 'crime and punishment');
  assert.equal(displayTitle(book({ title: ' Crime and Punishment ' })), 'Crime and Punishment');
});

test('shelf: last read first, finished last', () => {
  const order = shelfOrder([
    book({ id: 'done', finishedAt: 9, lastReadAt: 9 }),
    book({ id: 'new', addedAt: 5 }),
    book({ id: 'old', lastReadAt: 2 }),
    book({ id: 'recent', lastReadAt: 7 }),
  ]).map((b) => b.id);
  assert.deepEqual(order, ['recent', 'old', 'new', 'done']);
});

test('time left only once there is enough reading', () => {
  assert.equal(minutesLeft(book({ chapter: 1, readMs: 60_000 })), null);
  assert.equal(minutesLeft(book({ chapter: 1, readMs: 60 * 60_000 })), 540);
});

test('reader settings survive bad input', () => {
  assert.deepEqual(parseReaderPrefs('nope'), { theme: 'night', font: 'serif', size: 19, spacing: 'normal' });
  assert.deepEqual(parseReaderPrefs('{"theme":"sepia","size":24,"font":"sans","spacing":"loose"}'), { theme: 'sepia', font: 'sans', size: 24, spacing: 'loose' });
  assert.equal(parseReaderPrefs('{"size":99}').size, 19);
});

test('idle time is not reading time', () => {
  assert.equal(countedMs(30_000), 30_000);
  assert.equal(countedMs(10 * 60_000), 0);
  assert.equal(countedMs(-5), 0);
});

test('chapter names carry their part', async () => {
  const { chapterLabel } = await import('../src/features/vault/books/bookLogic.ts');
  const toc = [
    { title: 'Translator’s Preface', chapter: 2, depth: 0 },
    { title: 'Crime and Punishment', chapter: 3, depth: 0 },
    { title: 'Part I', chapter: 4, depth: 1 },
    { title: 'I', chapter: 5, depth: 2 },
    { title: 'II', chapter: 6, depth: 2 },
  ];
  assert.equal(chapterLabel(toc, 6, 'Crime and Punishment', 'x'), 'Part I · II');
  assert.equal(chapterLabel(toc, 4, 'Crime and Punishment', 'x'), 'Part I');
  assert.equal(chapterLabel(toc, 2, 'Crime and Punishment', 'x'), 'Translator’s Preface');
  assert.equal(chapterLabel(toc, 9, 'Crime and Punishment', 'Part 10'), 'Part 10');
});
