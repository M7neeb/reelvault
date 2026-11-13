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

test('books survive a round trip through the info backup', async () => {
  const { parseBackup, matchAudio } = await import('../src/features/vault/backupFormat.ts');
  const raw = {
    kind: 'reelvault-library-info', version: 2, exportedAt: 1, videos: [], albums: [], folders: [], smartFilters: [], pinnedKeywords: [], kept: [], series: [],
    books: [
      { contentKey: 'k1', filename: 'cp.epub', size: 10, title: 'Crime and Punishment', author: null, chapter: 7, block: 12, chapterFrac: 0.3, readMs: 9, lastReadAt: 5, finishedAt: null, reads: [[1, 2, 3, 0, 0.1], ['bad']] },
      { filename: 42 },
    ],
  };
  const b = parseBackup(JSON.stringify(raw));
  assert.equal(b.books.length, 1);
  assert.deepEqual(b.books[0].reads, [[1, 2, 3, 0, 0.1]]);
  const m = matchAudio(b.books, [{ id: 'x', contentKey: null, filename: 'cp.epub', size: 10 }]);
  assert.equal(m.get(0), 'x');
});

test('status comes from your reading unless you set one', async () => {
  const { statusOf } = await import('../src/features/vault/books/bookLogic.ts');
  assert.equal(statusOf({ status: null, finishedAt: null, lastReadAt: null }), 'want');
  assert.equal(statusOf({ status: null, finishedAt: null, lastReadAt: 5 }), 'reading');
  assert.equal(statusOf({ status: null, finishedAt: 9, lastReadAt: 5 }), 'finished');
  assert.equal(statusOf({ status: 'dropped', finishedAt: null, lastReadAt: 5 }), 'dropped');
});

test('sorting the shelf', async () => {
  const { sortBooks } = await import('../src/features/vault/books/bookLogic.ts');
  const shelf = [
    book({ id: 'k', title: 'The Brothers Karamazov', author: 'Fyodor Dostoevsky', rating: 7, addedAt: 3, chapter: 2 }),
    book({ id: 'm', title: 'The Master and Margarita', author: 'Mikhail Bulgakov', rating: 9, addedAt: 2 }),
    book({ id: 'c', title: 'Crime and Punishment', author: 'Fyodor Dostoevsky', rating: 0, addedAt: 1, lastReadAt: 9 }),
  ];
  const ids = (s) => sortBooks(shelf, s).map((b) => b.id);
  assert.deepEqual(ids('title'), ['k', 'c', 'm']);
  assert.deepEqual(ids('author'), ['m', 'k', 'c']);
  assert.deepEqual(ids('rating'), ['m', 'k', 'c']);
  assert.deepEqual(ids('added'), ['k', 'm', 'c']);
  assert.deepEqual(ids('recent'), ['c', 'k', 'm']);
  assert.deepEqual(ids('progress'), ['k', 'c', 'm']);
});

test('filters, search words and keywords', async () => {
  const { matchesBook, shelfTags, cleanTag, daysLeft } = await import('../src/features/vault/books/bookLogic.ts');
  const b = book({ title: 'Crime and Punishment', author: 'Fyodor Dostoevsky', tags: ['Russian', 'Classics'], notes: 'Garnett translation', lastReadAt: 1 });
  assert.equal(matchesBook(b, null, 'dostoevsky crime'), true);
  assert.equal(matchesBook(b, null, 'garnett'), true);
  assert.equal(matchesBook(b, null, 'tolstoy'), false);
  assert.equal(matchesBook(b, { status: 'reading' }, ''), true);
  assert.equal(matchesBook(b, { status: 'finished' }, ''), false);
  assert.equal(matchesBook(b, { tag: 'russian' }, ''), true);
  assert.deepEqual(shelfTags([b, book({ tags: ['russian'] })]), [{ name: 'Russian', count: 2 }, { name: 'Classics', count: 1 }]);
  assert.equal(cleanTag('  #book   club '), 'book club');
  assert.equal(daysLeft(0, 30, 29.5 * 86_400_000), 1);
  assert.equal(daysLeft(0, 30, 40 * 86_400_000), 0);
});

test('highlights cut the runs, bold and italic kept', async () => {
  const { highlightRuns } = await import('../src/features/vault/books/bookLogic.ts');
  const runs = [{ t: 'He said ' }, { t: 'nothing', i: 1 }, { t: ' at all. Then he left.' }];
  const out = highlightRuns(runs, ['nothing at all.']);
  assert.deepEqual(out, [{ t: 'He said ' }, { t: 'nothing', i: 1, hl: 1 }, { t: ' at all.', hl: 1 }, { t: ' Then he left.' }]);
  assert.equal(highlightRuns(runs, ['not in here']), runs);
});

test('sentences and searching inside a book', async () => {
  const { sentencesOf, findInBlocks } = await import('../src/features/vault/books/bookLogic.ts');
  assert.deepEqual(sentencesOf('“Hm … yes,” he thought. Is that serious? It is not!'), ['“Hm … yes,” he thought.', 'Is that serious?', 'It is not!']);
  const hits = findInBlocks([{ block: 3, text: 'Sonia looked at him. Then Sonia left the room.' }, { block: 4, text: 'Nobody.' }], 7, 'sonia');
  assert.equal(hits.length, 2);
  assert.deepEqual([hits[0].chapter, hits[0].block, hits[0].match, hits[0].before], [7, 3, 'Sonia', '']);
  assert.equal(findInBlocks([{ block: 0, text: 'x' }], 0, 'a').length, 0);
});
