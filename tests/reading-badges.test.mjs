// Run with `npm test`. Badges for the Manga (Reading) and Audio (Listening) sections.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { achievements, listeningFrom, readingFrom } from '../src/features/vault/achievements.ts';

const DAY = 86_400_000;
const now = new Date(2026, 9, 23, 12).getTime();
const base = { videos: [], plays: [], bookmarks: 0, albums: 0, smartFilters: 0, series: 0, seriesFinished: 0, kept: 0, now };

const chapters = (n, read) => Array.from({ length: n }, (_, i) => ({ readAt: i < read ? now - (n - i) * DAY : null, pageCount: 20 }));

test('no manga and no audio: no Reading or Listening badges at all', () => {
  const list = achievements(base);
  assert.equal(list.some((a) => a.group === 'Reading' || a.group === 'Listening'), false);
  assert.equal(readingFrom([], []), null);
  assert.equal(listeningFrom([], []), null);
});

test('reading numbers: chapters, pages, finished series, streak', () => {
  const series = [
    { deletedAt: null, rating: 8, status: 'watching', finishedAt: null, chapters: chapters(12, 12) },
    { deletedAt: null, rating: 0, status: 'watching', finishedAt: null, chapters: chapters(5, 2) },
    { deletedAt: 5, rating: 0, status: null, finishedAt: null, chapters: chapters(50, 50) },
  ];
  const reads = [0, 1, 2].map((d) => ({ startedAt: now - d * DAY, readMs: 20 * 60_000, pages: 30 }));
  const r = readingFrom(series, reads);
  assert.equal(r.chapterTimes.length, 14);
  assert.equal(r.pages, 280); // the finished chapters' pages beat the 90 turned in sessions
  assert.equal(r.finished, 1); // every chapter read
  assert.equal(r.series, 2); // the deleted one doesn't count
  assert.equal(r.rated, 1);
  assert.equal(Math.round(r.hours * 10) / 10, 1);

  const list = achievements({ ...base, reading: r });
  const got = (id) => list.find((a) => a.id === id);
  assert.equal(got('chapters-read-10').unlocked, true);
  assert.equal(got('chapters-read-100').unlocked, false);
  assert.equal(got('series-finished-1').unlocked, true);
  assert.equal(got('reading-streak-3').unlocked, true);
  assert.equal(got('chapters-read-10').group, 'Reading');
  // Earned on the day the tenth chapter was read.
  assert.equal(got('chapters-read-10').earnedAt, r.chapterTimes.sort((a, b) => a - b)[9]);
});

test('listening numbers: hours, books, finished', () => {
  const items = [
    { kind: 'book', deletedAt: null, rating: 9, finishedAt: now - DAY },
    { kind: 'audio', deletedAt: null, rating: 0, finishedAt: null },
  ];
  const plays = [{ startedAt: now, listenedMs: 6 * 3_600_000 }];
  const l = listeningFrom(items, plays);
  assert.deepEqual([l.items, l.books, l.finishedTimes.length, l.hours], [2, 1, 1, 6]);
  const list = achievements({ ...base, listening: l });
  assert.equal(list.find((a) => a.id === 'listen-hours-5').unlocked, true);
  assert.equal(list.find((a) => a.id === 'audio-finished-1').unlocked, true);
  assert.equal(list.find((a) => a.id === 'bookworm-1').unlocked, true);
});
