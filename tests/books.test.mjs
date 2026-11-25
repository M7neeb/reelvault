import test from 'node:test';
import assert from 'node:assert/strict';

import {
  joinsSitting,
  placeSaved,
  chapterMinutesLeft,
  countedMs,
  displayTitle,
  fmtProgress,
  fracOfBlock,
  minutesLeft,
  parseReaderPrefs,
  progressAt,
  progressOf,
  readingNow,
  safeBlock,
  shelfOrder,
  statusOf,
  withFinished,
  withStatus,
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
  assert.deepEqual(parseReaderPrefs('nope'), { theme: 'night', font: 'serif', size: 19, spacing: 'normal', turn: 'scroll', voice: '', speech: 1 });
  assert.deepEqual(parseReaderPrefs('{"theme":"sepia","size":24,"font":"sans","spacing":"loose","turn":"fade","voice":"com.apple.voice.x","speech":1.5}'), { theme: 'sepia', font: 'sans', size: 24, spacing: 'loose', turn: 'fade', voice: 'com.apple.voice.x', speech: 1.5 });
  assert.equal(parseReaderPrefs('{"speech":7}').speech, 1);
  assert.equal(parseReaderPrefs('{"turn":"curl"}').turn, 'scroll');
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

test('status and the finished date agree, whichever one is changed', () => {
  const reading = { status: null, finishedAt: null };
  assert.deepEqual(withStatus(reading, 'finished', 500), { status: 'finished', finishedAt: 500 });
  // The day it was really finished is kept.
  assert.deepEqual(withStatus({ status: null, finishedAt: 200 }, 'finished', 500), { status: 'finished', finishedAt: 200 });
  assert.deepEqual(withStatus({ status: 'finished', finishedAt: 200 }, 'reading', 500), { status: 'reading', finishedAt: null });
  assert.deepEqual(withStatus({ status: 'finished', finishedAt: 200 }, 'dropped', 500), { status: 'dropped', finishedAt: null });
  assert.deepEqual(withStatus({ status: 'dropped', finishedAt: 200 }, null, 500), { status: null, finishedAt: 200 });

  const done = withFinished({ status: 'reading', finishedAt: null }, true, 900);
  assert.deepEqual(done, { status: null, finishedAt: 900 });
  assert.equal(statusOf({ ...done, lastReadAt: 1 }), 'finished');
  const undone = withFinished({ status: 'finished', finishedAt: 900 }, false, 950);
  assert.deepEqual(undone, { status: null, finishedAt: null });
  assert.equal(statusOf({ ...undone, lastReadAt: 1 }), 'reading');
  assert.deepEqual(withFinished({ status: 'dropped', finishedAt: null }, false, 950), { status: 'dropped', finishedAt: null });
});

test('a dropped book sits below the unread ones, above the finished', () => {
  const order = shelfOrder([
    book({ id: 'fin', finishedAt: 5, lastReadAt: 5 }),
    book({ id: 'drop', status: 'dropped', lastReadAt: 9 }),
    book({ id: 'new', addedAt: 3 }),
    book({ id: 'now', lastReadAt: 4 }),
  ]).map((b) => b.id);
  assert.deepEqual(order, ['now', 'new', 'drop', 'fin']);
});

test('minutes left in the chapter follow your pace through the book', () => {
  // A tenth of the book in an hour: the second chapter (30% of the book) takes three hours.
  const b = { chapterSizes: [100, 300, 600], readMs: 3_600_000 };
  assert.equal(chapterMinutesLeft(b, 1, 0), 180);
  // Halfway through it, a quarter of the book is read in that hour: 0.15 of the book is left of the chapter.
  assert.equal(chapterMinutesLeft(b, 1, 0.5), 36);
  assert.equal(chapterMinutesLeft(b, 1, 1), 1);
  // Too little reading or too early in the book to tell.
  assert.equal(chapterMinutesLeft({ ...b, readMs: 60_000 }, 1, 0.5), null);
  assert.equal(chapterMinutesLeft(b, 0, 0.1), null);
  assert.equal(chapterMinutesLeft({ chapterSizes: [], readMs: 3_600_000 }, 0, 0.5), null);
});

test('reading now is every started book that is not finished, dropped or parked', () => {
  const now = readingNow([
    book({ id: 'old', lastReadAt: 10 }),
    book({ id: 'new', lastReadAt: 50 }),
    book({ id: 'unread' }),
    book({ id: 'done', lastReadAt: 60, finishedAt: 60 }),
    book({ id: 'dropped', lastReadAt: 70, status: 'dropped' }),
    book({ id: 'want', lastReadAt: 80, status: 'want' }),
    book({ id: 'forced', lastReadAt: 5, status: 'reading' }),
    // Set to Reading by hand before opening it: the Reading chip counts it, so Reading now shows it too.
    book({ id: 'set', status: 'reading' }),
  ]).map((b) => b.id);
  assert.deepEqual(now, ['new', 'old', 'forced', 'set']);
});

test('opening a book and closing it at the same place is not reading it', () => {
  const b = { chapter: 4, block: 12, readMs: 3_600_000 };
  assert.equal(placeSaved(b, { chapter: 4, block: 12, chapterFrac: 0.3 }, 0, 1000), null);
  // Turned the page, or read for a while: it counts and moves to the top.
  assert.deepEqual(placeSaved(b, { chapter: 4, block: 20, chapterFrac: 0.5 }, 0, 1000), { chapter: 4, block: 20, chapterFrac: 0.5, readMs: 3_600_000, lastReadAt: 1000 });
  assert.equal(placeSaved(b, { chapter: 4, block: 12, chapterFrac: 0.3 }, 45_000, 1000)?.readMs, 3_645_000);
  // A book never started, opened at its first page and closed again, stays unstarted.
  assert.equal(placeSaved({ chapter: 0, block: 0, readMs: 0 }, { chapter: 0, block: 0, chapterFrac: 0 }, 0, 1000), null);
});

test('a sitting carries on across short breaks but not past midnight', () => {
  const t = (h, m) => new Date(2026, 10, 16, h, m).getTime();
  assert.equal(joinsSitting(t(20, 0), t(20, 5), 60_000), true);
  assert.equal(joinsSitting(t(20, 0), t(20, 15), 60_000), false);
  // 23:58 then 00:03: five minutes apart, but the second part is tomorrow's reading.
  const after = new Date(2026, 10, 17, 0, 3).getTime();
  assert.equal(joinsSitting(t(23, 58), after, 60_000), false);
});

test('the plain shelf splits books to read (covers) from finished and dropped (list), each book once, order kept', async () => {
  const { splitShelf } = await import('../src/features/vault/books/bookLogic.ts');
  const b = (id, status, extra = {}) => ({ id, status, finishedAt: null, lastReadAt: null, ...extra });
  const books = [b('a', 'want'), b('b', 'finished'), b('c', null), b('d', 'dropped'), b('e', null, { lastReadAt: 5 }), b('f', null, { finishedAt: 9 })];
  const { toRead, listed, heading } = splitShelf(books);
  assert.deepEqual(toRead.map((x) => x.id), ['a', 'c', 'e']);
  assert.deepEqual(listed.map((x) => x.id), ['b', 'd', 'f']);
  assert.equal(heading, 'Finished and dropped');
  assert.equal(toRead.length + listed.length, books.length);
  assert.equal(splitShelf([b('x', 'finished')]).heading, 'Finished');
  assert.equal(splitShelf([b('y', 'dropped')]).heading, 'Dropped');
  assert.deepEqual(splitShelf([]), { toRead: [], listed: [], heading: 'Finished' });
});

test('a plain cover sets its title small enough that the longest word stays whole', async () => {
  const { coverTitleSize } = await import('../src/features/vault/books/bookLogic.ts');
  // Short words: an eighth of the width, as before.
  assert.equal(coverTitleSize(132, 'The Idiot'), 132 * 0.13);
  // "Underground" (11 letters) on a 104 wide cover: smaller, so it fits the inner width.
  const size = coverTitleSize(104, 'Notes from Underground');
  assert.ok(size < 104 * 0.13);
  assert.ok(11 * 0.64 * size <= 104 - 2 * 10.4 + 0.001);
  // Never below 9, even for an absurd word.
  assert.equal(coverTitleSize(104, 'Supercalifragilisticexpialidocious'), 9);
});

test('page turns move a screen at a time, keep a line, and hand over at the ends', async () => {
  const { pageTurn } = await import('../src/features/vault/books/bookLogic.ts');
  // 800 pt screen, 30 pt lines, 5000 pt chapter.
  assert.equal(pageTurn(0, 800, 5000, 30, 1), 770);
  assert.equal(pageTurn(770, 800, 5000, 30, -1), 0);
  // The last page lands exactly on the end instead of past it.
  assert.equal(pageTurn(4000, 800, 5000, 30, 1), 4200);
  // Already at the end / start: the next or previous chapter.
  assert.equal(pageTurn(4200, 800, 5000, 30, 1), 'next');
  assert.equal(pageTurn(0, 800, 5000, 30, -1), 'previous');
  // A chapter shorter than the screen.
  assert.equal(pageTurn(0, 800, 500, 30, 1), 'next');
});

test('the word being read is split out of its run, keeping bold and italic', async () => {
  const { spokenRuns, blockSpeech } = await import('../src/features/vault/books/bookLogic.ts');
  const runs = [{ t: 'The ' }, { t: 'quick brown', b: true }, { t: ' fox.' }];
  const out = spokenRuns(runs, 10, 5);
  assert.deepEqual(out, [{ t: 'The ' }, { t: 'quick ', b: true }, { t: 'brown', b: true, sp: 1 }, { t: ' fox.' }]);
  // A word across two runs, and nothing marked when out of range.
  assert.deepEqual(spokenRuns(runs, 14, 3).filter((r) => r.sp).map((r) => r.t), ['n', ' f']);
  assert.deepEqual(spokenRuns(runs, 99, 3), runs);
  assert.deepEqual(spokenRuns(runs, 0, 0), runs);
  // What is spoken for each kind of block.
  assert.equal(blockSpeech({ k: 'p', runs }), 'The quick brown fox.');
  assert.equal(blockSpeech({ k: 'img', src: 'a.png', alt: '' }), '');
  assert.equal(blockSpeech({ k: 'hr' }), '');
});
