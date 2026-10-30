// Run with `npm test`. The Manga section's rules: file names, ComicInfo.xml, page and chapter order, what to read next, filters.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  archiveKindOf,
  chapterLabel,
  continueReading,
  isImageName,
  matchesManga,
  modeOf,
  naturalCompare,
  nextChapter,
  normTitle,
  pageFileName,
  pageOrder,
  parseChapterName,
  parseComicInfo,
  planChapters,
  progressOf,
  sameChapter,
  sortChapters,
  sortManga,
  unreadCount,
} from '../src/features/vault/manga/mangaLogic.ts';

test('chapter numbers, volumes, series and titles come out of the usual file names', () => {
  const cases = [
    ['One Piece - Chapter 12 - Romance Dawn.cbz', { series: 'One Piece', number: 12, volume: null, title: 'Romance Dawn' }],
    ['One Piece v03 c012.cbz', { series: 'One Piece', number: 12, volume: 3, title: null }],
    ['[Group] Berserk Vol.02 Ch.010.5 (2021).zip', { series: 'Berserk', number: 10.5, volume: 2, title: null }],
    ['Batman 004 (2016).cbz', { series: 'Batman', number: 4, volume: null, title: null }],
    ['Chapter 7', { series: null, number: 7, volume: null, title: null }],
    ['c045.cbz', { series: null, number: 45, volume: null, title: null }],
    ['Solo_Leveling_Episode_3.cbz', { series: 'Solo Leveling', number: 3, volume: null, title: null }],
    ['Chainsaw Man 097.cbz', { series: 'Chainsaw Man', number: 97, volume: null, title: null }],
    ['Saga (v02) #12.cbz', { series: 'Saga', number: 12, volume: 2, title: null }],
    ['Watchmen.cbz', { series: 'Watchmen', number: null, volume: null, title: null }],
  ];
  for (const [name, want] of cases) assert.deepEqual(parseChapterName(name), want, name);
});

test('a year on its own is not a chapter number', () => {
  assert.equal(parseChapterName('Akira 1988.cbz').number, null);
});

test('pages sort like a person would and junk is left out', () => {
  assert.ok(naturalCompare('page 2.jpg', 'page 10.jpg') < 0);
  assert.deepEqual(pageOrder(['10.jpg', '2.jpg', '1.png', '__MACOSX/._1.png', '.DS_Store', 'Thumbs.db', 'ComicInfo.xml', 'notes.txt']), ['1.png', '2.jpg', '10.jpg']);
  assert.equal(isImageName('a/b/c.WEBP'), true);
  assert.equal(isImageName('a/.hidden.jpg'), false);
});

test('what a picked file is', () => {
  assert.equal(archiveKindOf('x.CBZ'), 'zip');
  assert.equal(archiveKindOf('x.cbr'), 'zip');
  assert.equal(archiveKindOf('x.pdf'), 'pdf');
  assert.equal(archiveKindOf('p.jpeg'), 'image');
  assert.equal(archiveKindOf('song.mp3'), null);
});

test('ComicInfo.xml gives the series, number, people, genres and reading direction', () => {
  const xml = `<?xml version="1.0"?>
  <ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Series>Vinland Saga</Series><Number>54</Number><Volume>8</Volume><Title>Slave</Title>
    <Writer>Makoto Yukimura</Writer><Penciller>Makoto Yukimura</Penciller>
    <Summary>Thorfinn &amp; the farm.</Summary><Genre>Action, Historical; Drama</Genre><Tags>vikings</Tags>
    <Year>2010</Year><Manga>YesAndRightToLeft</Manga><Web>https://example.org/vs</Web><ScanlationGroup>Team</ScanlationGroup><PageCount>22</PageCount>
  </ComicInfo>`;
  const info = parseComicInfo(xml);
  assert.equal(info.series, 'Vinland Saga');
  assert.equal(info.number, 54);
  assert.equal(info.volume, 8);
  assert.equal(info.title, 'Slave');
  assert.equal(info.writer, 'Makoto Yukimura');
  assert.equal(info.artist, null, 'the artist is left out when it is the writer');
  assert.equal(info.summary, 'Thorfinn & the farm.');
  assert.deepEqual(info.genres, ['Action', 'Historical', 'Drama', 'vikings']);
  assert.equal(info.rightToLeft, true);
  assert.equal(info.isManga, true);
  assert.equal(info.scanlator, 'Team');
  assert.equal(info.pageCount, 22);
  assert.equal(parseComicInfo('<Other/>'), null);
});

test('one archive is one chapter; sub-folders make one chapter each, named by their folder', () => {
  const one = planChapters(['ch/002.jpg', 'ch/001.jpg', 'ComicInfo.xml'], 'Dandadan c010.cbz', null);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].pages, ['ch/001.jpg', 'ch/002.jpg']);
  assert.equal(one[0].series, 'Dandadan');
  assert.equal(one[0].number, 10);

  const many = planChapters(['Chapter 2/1.jpg', 'Chapter 10/1.jpg', 'Chapter 1/1.jpg', 'Chapter 1/2.jpg'], 'Frieren', null, 'Frieren');
  assert.deepEqual(many.map((c) => c.number), [1, 2, 10]);
  assert.ok(many.every((c) => c.series === 'Frieren'));

  // A folder with several series: the folder above each chapter is its series.
  const shelf = planChapters(['One Piece/Ch 1/1.jpg', 'Naruto/Ch 1/1.jpg', 'Naruto/Ch 2/1.jpg'], 'Manga', null, 'Manga');
  assert.deepEqual(shelf.map((c) => `${c.series} ${c.number}`).sort(), ['Naruto 1', 'Naruto 2', 'One Piece 1']);

  // ComicInfo wins over the name.
  const named = planChapters(['1.jpg'], 'random.cbz', { series: 'Real Name', number: 3, volume: null, title: 'T' });
  assert.equal(named[0].series, 'Real Name');
  assert.equal(named[0].number, 3);
  assert.equal(planChapters(['a.txt'], 'x.cbz', null).length, 0);
});

const C = (n, extra = {}) => ({ id: `c${n}`, number: n, volume: null, title: null, filename: `c${n}`, position: 0, readAt: null, lastPage: 0, ...extra });

test('chapters sort by number, volumes first when numbers restart, unnumbered ones last by name', () => {
  const list = sortChapters([C(10), C(2), C(1.5), C(null, { filename: 'Extra B' }), C(null, { filename: 'Extra A' })]);
  assert.deepEqual(list.map((c) => c.number ?? c.filename), [1.5, 2, 10, 'Extra A', 'Extra B']);
  const vols = sortChapters([C(1, { volume: 2, id: 'v2c1' }), C(3, { volume: 1, id: 'v1c3' })]);
  assert.deepEqual(vols.map((c) => c.id), ['v1c3', 'v2c1']);
});

test('chapter labels', () => {
  assert.equal(chapterLabel(C(12, { title: 'Dawn' })), 'Chapter 12 - Dawn');
  assert.equal(chapterLabel(C(12, { volume: 3 })), 'Vol. 3 · Ch. 12');
  assert.equal(chapterLabel(C(12.5), true), 'Ch. 12.5');
  assert.equal(chapterLabel(C(null, { filename: 'Oneshot.cbz' })), 'Oneshot');
});

test('what to read next: a chapter part-way through, else the first unread after the last read', () => {
  assert.equal(nextChapter({ chapters: [C(1, { readAt: 1 }), C(2, { readAt: 1 }), C(3), C(4)] }).id, 'c3');
  assert.equal(nextChapter({ chapters: [C(1, { readAt: 1 }), C(2), C(3, { lastPage: 5 })] }).id, 'c3');
  // Skipped ahead: after the last one read.
  assert.equal(nextChapter({ chapters: [C(1), C(2, { readAt: 1 }), C(3)] }).id, 'c3');
  // All read but an early one: that one.
  assert.equal(nextChapter({ chapters: [C(1), C(2, { readAt: 1 })] }).id, 'c1');
  assert.equal(nextChapter({ chapters: [C(1, { readAt: 1 })] }), null);
  assert.equal(progressOf({ chapters: [C(1, { readAt: 1 }), C(2)] }), 0.5);
  assert.equal(unreadCount({ chapters: [C(1, { readAt: 1 }), C(2), C(3)] }), 2);
});

const S = (id, extra = {}) => ({ id, title: id, altTitle: null, author: null, artist: null, notes: null, description: null, kind: null, status: null, rating: 0, tags: [], chapters: [C(1)], importedAt: 0, lastReadAt: null, readingMode: null, ...extra });

test('continue reading: series you are in, newest first, not finished or dropped ones', () => {
  const list = [
    S('a', { lastReadAt: 10 }),
    S('b', { lastReadAt: 30 }),
    S('c', { lastReadAt: 20, status: 'dropped' }),
    S('d', { lastReadAt: 40, chapters: [C(1, { readAt: 1 })] }),
    S('e'),
  ];
  assert.deepEqual(continueReading(list).map((s) => s.id), ['b', 'a']);
});

test('filters and sorts', () => {
  const list = [S('Berserk', { rating: 9, tags: ['dark'], status: 'reading' }), S('Akira', { kind: 'comic', author: 'Otomo' }), S('Cells', { chapters: [C(1, { readAt: 1 })] })];
  assert.deepEqual(list.filter((s) => matchesManga(s, { status: 'reading' })).map((s) => s.id), ['Berserk']);
  assert.deepEqual(list.filter((s) => matchesManga(s, { status: 'none' })).map((s) => s.id), ['Akira', 'Cells']);
  assert.deepEqual(list.filter((s) => matchesManga(s, { unread: true })).map((s) => s.id), ['Berserk', 'Akira']);
  assert.deepEqual(list.filter((s) => matchesManga(s, { query: 'otomo' })).map((s) => s.id), ['Akira']);
  assert.deepEqual(list.filter((s) => matchesManga(s, { tag: 'DARK' })).map((s) => s.id), ['Berserk']);
  assert.deepEqual(list.filter((s) => matchesManga(s, { kind: 'comic' })).map((s) => s.id), ['Akira']);
  assert.deepEqual(list.filter((s) => matchesManga(s, { favourites: true })).map((s) => s.id), ['Berserk']);
  assert.deepEqual(sortManga(list, 'title').map((s) => s.id), ['Akira', 'Berserk', 'Cells']);
  assert.deepEqual(sortManga(list, 'rating').map((s) => s.id)[0], 'Berserk');
});

test('how a series reads: yours, else from its kind', () => {
  assert.equal(modeOf({ readingMode: null, kind: null }), 'rtl');
  assert.equal(modeOf({ readingMode: null, kind: 'manhwa' }), 'webtoon');
  assert.equal(modeOf({ readingMode: null, kind: 'comic' }), 'ltr');
  assert.equal(modeOf({ readingMode: 'vertical', kind: 'comic' }), 'vertical');
});

test('matching titles and chapters', () => {
  assert.equal(normTitle('The Promised Neverland!'), normTitle('promised  neverland'));
  assert.equal(normTitle('Kaguya-sama: Love Is War'), 'kaguya sama love is war');
  assert.equal(sameChapter({ number: 3, volume: null, filename: 'a' }, { number: 3, volume: null, filename: 'b' }), true);
  assert.equal(sameChapter({ number: 3, volume: 1, filename: 'a' }, { number: 3, volume: 2, filename: 'a' }), false);
  assert.equal(sameChapter({ number: null, volume: null, filename: 'x.cbz' }, { number: null, volume: null, filename: 'x.cbz' }), true);
  assert.equal(pageFileName(0, 'dir/Page.JPEG'), '0001.jpg');
  assert.equal(pageFileName(41, 'p.png'), '0042.png');
});

test('logged reading lands on the right day', async () => {
  const { loggedRead, nextUnread } = await import('../src/features/vault/manga/mangaLogic.ts');
  const now = new Date(2026, 9, 29, 15, 0).getTime();
  const today = loggedRead('s1', 30, 0, now);
  assert.equal(today.readMs, 30 * 60_000);
  assert.equal(today.startedAt, now - 30 * 60_000);
  assert.equal(today.chapterId, null);
  const y = new Date(loggedRead('s1', 45, 1, now).startedAt);
  assert.equal(y.getDate(), 28);
  assert.equal(y.getHours(), 20);
  assert.deepEqual(nextUnread([{ id: 'a', readAt: 1 }, { id: 'b', readAt: null }, { id: 'c', readAt: null }, { id: 'd', readAt: null }], 2), ['b', 'c']);
});
