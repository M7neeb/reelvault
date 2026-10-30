// Run with `npm test`. The Audio section's rules: position across files, chapters, progress, list, grouping, stats.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  audioStats, chapterIndexAt, chaptersOf, continueListening, fmtClockMs, fmtLength, fmtRating, groupIntoBooks, isAtEnd, locate, matchesAudio, nextSpeed,
  normaliseRating, overallMs, progressOf, smartRewindMs, sortAudio, totalMs, authorsOf, seriesNumber, seriesBooks, seriesOf, nextInSeries, pickNext, parseAudioPrefs,
} from '../src/features/vault/audio/audioLogic.ts';

const item = (id, extra = {}) => ({
  id, kind: 'audio', folder: `audio/${id}`, filename: `${id}.mp3`, size: 1000, durationMs: null, title: null, author: null, album: null, narrator: null, year: null,
  genre: null, description: null, notes: null, rating: 0, status: null, cover: null, tracks: [{ file: `${id}.mp3`, title: id, durationMs: 60_000 }], chapters: [],
  contentKey: null, isPrivate: false, positionTrack: 0, positionMs: 0, speed: null, lastPlayedAt: null, finishedAt: null, createdAt: 0, importedAt: 0, deletedAt: null, tags: [],
  ...extra,
});

const book = item('b', {
  tracks: [
    { file: '01.mp3', title: 'One', durationMs: 600_000 },
    { file: '02.mp3', title: 'Two', durationMs: 300_000 },
    { file: '03.mp3', title: 'Three', durationMs: 900_000 },
  ],
});

test('a book of several files: total, where you are overall, and back', () => {
  assert.equal(totalMs(book), 1_800_000);
  assert.equal(overallMs({ ...book, positionTrack: 2, positionMs: 1000 }), 900_000 + 1000);
  assert.deepEqual(locate(book, 700_000), { track: 1, ms: 100_000 });
  assert.deepEqual(locate(book, 0), { track: 0, ms: 0 });
  assert.deepEqual(locate(book, 5_000_000), { track: 2, ms: 900_000 });
  assert.equal(progressOf({ ...book, positionTrack: 1, positionMs: 300_000 }), 0.5);
  assert.equal(isAtEnd(book, 1_750_000), true);
  assert.equal(isAtEnd(book, 1_000_000), false);
});

test('chapters: marks in the file win; else one per file; lengths fill the gaps', () => {
  const c = chaptersOf(book);
  assert.deepEqual(c.map((x) => [x.title, x.overallStart, x.lengthMs]), [['One', 0, 600_000], ['Two', 600_000, 300_000], ['Three', 900_000, 900_000]]);
  assert.equal(chapterIndexAt(c, 650_000), 1);
  assert.equal(chapterIndexAt(c, 0), 0);
  const one = item('m', { tracks: [{ file: 'm.m4b', title: 'm', durationMs: 3_600_000 }], chapters: [{ title: 'B', track: 0, startMs: 1_800_000 }, { title: 'A', track: 0, startMs: 0 }] });
  assert.deepEqual(chaptersOf(one).map((x) => [x.title, x.lengthMs]), [['A', 1_800_000], ['B', 1_800_000]]);
  assert.deepEqual(chaptersOf(item('x')), []);
});

test('ratings with decimals, times and speeds', () => {
  assert.equal(normaliseRating(8.66), 8.7);
  assert.equal(normaliseRating(0), 0);
  assert.equal(normaliseRating(12), 10);
  assert.equal(normaliseRating(0.4), 1);
  assert.equal(fmtRating(9), '9');
  assert.equal(fmtRating(9.5), '9.5');
  assert.equal(fmtRating(0), '');
  assert.equal(fmtLength(3_720_000), '1 h 2 min');
  assert.equal(fmtLength(45_000), '45 s');
  assert.equal(fmtClockMs(3_723_000), '1:02:03');
  assert.equal(fmtClockMs(63_000), '1:03');
  assert.equal(nextSpeed(1), 1.1);
  assert.equal(nextSpeed(3), 0.75);
  assert.equal(smartRewindMs(30_000), 0);
  assert.equal(smartRewindMs(5 * 60_000), 5000);
  assert.equal(smartRewindMs(20 * 60_000), 15000);
  assert.equal(smartRewindMs(5 * 3_600_000), 30000);
});

test('search, filters and sorting', () => {
  const list = [
    item('a', { title: 'Zebra Nights', author: 'Émile', rating: 9, tags: ['Sleep'], lastPlayedAt: 5, positionMs: 30_000, importedAt: 3 }),
    item('b', { title: 'apple tales', author: 'Bob', status: 'finished', finishedAt: 9, importedAt: 2 }),
    item('c', { title: 'Middle', kind: 'book', notes: 'read on the train', importedAt: 1 }),
  ];
  assert.deepEqual(list.filter((i) => matchesAudio(i, { query: 'emile' })).map((i) => i.id), ['a']);
  assert.deepEqual(list.filter((i) => matchesAudio(i, { query: 'train' })).map((i) => i.id), ['c']);
  assert.deepEqual(list.filter((i) => matchesAudio(i, { favourites: true })).map((i) => i.id), ['a']);
  assert.deepEqual(list.filter((i) => matchesAudio(i, { tag: 'sleep' })).map((i) => i.id), ['a']);
  assert.deepEqual(list.filter((i) => matchesAudio(i, { status: 'inProgress' })).map((i) => i.id), ['a']);
  assert.deepEqual(list.filter((i) => matchesAudio(i, { status: 'notStarted' })).map((i) => i.id), ['c']);
  assert.deepEqual(list.filter((i) => matchesAudio(i, { kind: 'book' })).map((i) => i.id), ['c']);
  assert.deepEqual(sortAudio(list, 'title').map((i) => i.id), ['b', 'c', 'a']);
  assert.deepEqual(sortAudio(list, 'added').map((i) => i.id), ['a', 'b', 'c']);
  assert.deepEqual(sortAudio(list, 'rating').map((i) => i.id), ['a', 'b', 'c']);
  assert.deepEqual(continueListening(list).map((i) => i.id), ['a']);
  assert.deepEqual(authorsOf(list).map((x) => x.name), ['Émile', 'Bob']);
});

test('picked files with the same album become one book, in track order', () => {
  const { groups, singles } = groupIntoBooks([
    { name: '02.mp3', album: 'My Book', artist: 'Me', track: 2 },
    { name: 'single.mp3', album: null },
    { name: '01.mp3', album: 'my book', artist: 'me', track: 1 },
    { name: 'other.mp3', album: 'Lonely' },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].files.map((f) => f.name), ['01.mp3', '02.mp3']);
  assert.deepEqual(singles.map((f) => f.name).sort(), ['other.mp3', 'single.mp3']);
});

test('listening stats: totals, this week, streaks, top', () => {
  const day = 86_400_000;
  const now = new Date(2026, 9, 21, 20).getTime(); // a Wednesday
  const plays = [
    { itemId: 'a', startedAt: now - 2 * day, listenedMs: 600_000 },
    { itemId: 'a', startedAt: now - day, listenedMs: 300_000 },
    { itemId: 'b', startedAt: now - 3600_000, listenedMs: 120_000 },
    { itemId: 'gone', startedAt: now, listenedMs: 999_000 },
  ];
  const s = audioStats([item('a', { rating: 8 }), item('b', { status: 'finished', rating: 9 })], plays, now);
  assert.equal(s.totalMs, 1_020_000);
  assert.equal(s.todayMs, 120_000);
  assert.equal(s.streak, 3);
  assert.equal(s.bestStreak, 3);
  assert.equal(s.finished, 1);
  assert.equal(s.top[0].id, 'a');
  assert.equal(s.week.find((d) => d.today).label, 'Wed');
  assert.equal(s.weekMs, 1_020_000);
  assert.equal(s.averageRating, 8.5);
});

test('the info backup carries the Audio section and finds each item again', async () => {
  const { matchAudio, parseBackup } = await import('../src/features/vault/backupFormat.ts');
  const entry = (filename, extra = {}) => ({ contentKey: null, filename, size: 10, title: null, author: null, narrator: null, album: null, genre: null, year: null, notes: null, rating: 8.5, status: 'listening', keywords: ['k'], positionTrack: 0, positionMs: 5, speed: null, lastPlayedAt: 1, finishedAt: null, plays: [[1, 2]], bookmarks: [], ...extra });
  const raw = JSON.stringify({ kind: 'reelvault-library-info', version: 2, videos: [], audio: [entry('a.mp3', { contentKey: 'K1' }), entry('b.mp3'), entry('c.mp3', { size: 99 }), { bad: true }] });
  const backup = parseBackup(raw);
  assert.equal(backup.audio.length, 3);
  const m = matchAudio(backup.audio, [
    { id: 'x', contentKey: 'K1', filename: 'renamed.mp3', size: 1 },
    { id: 'y', contentKey: null, filename: 'b.mp3', size: 10 },
    { id: 'z', contentKey: null, filename: 'c.mp3', size: 50 },
  ]);
  assert.deepEqual([...m.entries()], [[0, 'x'], [1, 'y'], [2, 'z']]);
  // An older backup without audio still reads.
  assert.deepEqual(parseBackup(JSON.stringify({ kind: 'reelvault-library-info', videos: [] })).audio, []);
});

test('series: the number of a book from its title or file name', () => {
  assert.equal(seriesNumber({ title: 'The Way of Kings (Book 1)', filename: 'x.m4b' }), 1);
  assert.equal(seriesNumber({ title: 'Harry Potter, Band 3', filename: 'x.m4b' }), 3);
  assert.equal(seriesNumber({ title: 'Dune Vol. 2', filename: 'x.m4b' }), 2);
  assert.equal(seriesNumber({ title: 'Mistborn #4', filename: 'x.m4b' }), 4);
  assert.equal(seriesNumber({ title: null, filename: '05 - The Hero.mp3' }), 5);
  assert.equal(seriesNumber({ title: 'Project Hail Mary', filename: 'phm.m4b' }), null);
  // "part" inside a word is not a number marker.
  assert.equal(seriesNumber({ title: 'Departure 7', filename: 'x.m4b' }), null);
});

test('series: books in order, what comes next, and Listen next first', () => {
  const s = (id, title, extra = {}) => item(id, { title, album: 'Stormlight', ...extra });
  const list = [s('c', 'Oathbringer (Book 3)'), s('a', 'The Way of Kings (Book 1)', { status: 'finished', lastPlayedAt: 5 }), s('b', 'Words of Radiance (Book 2)'), item('z', { title: 'Alone' })];
  assert.deepEqual(seriesBooks(list, 'stormlight').map((x) => x.id), ['a', 'b', 'c']);
  const all = seriesOf(list);
  assert.equal(all.length, 1);
  assert.equal(all[0].finished, 1);
  assert.equal(all[0].next.id, 'b');
  assert.equal(nextInSeries(list, list[1]).id, 'b');
  assert.equal(nextInSeries(list, list[0]), null);
  // Listen next wins over the series, and gone items are skipped.
  assert.deepEqual(pickNext(list, list[1], { upNext: ['gone', 'z', 'c'], seriesAutoplay: true }), { next: list[3], upNext: ['c'] });
  assert.equal(pickNext(list, list[1], { upNext: [], seriesAutoplay: true }).next.id, 'b');
  assert.equal(pickNext(list, list[1], { upNext: [], seriesAutoplay: false }).next, null);
});

test('audio settings: listen next, series and Voice Boost read safely', () => {
  const p = parseAudioPrefs(JSON.stringify({ rewind: 2, upNext: ['a', 'a', 3, 'b'], seriesAutoplay: false, boosted: ['x'] }));
  assert.deepEqual(p.upNext, ['a', 'b']);
  assert.equal(p.seriesAutoplay, false);
  assert.deepEqual(p.boosted, ['x']);
  assert.equal(parseAudioPrefs(null).seriesAutoplay, true);
});
