// Run with `npm test`. Manga insights: reading in a range, memories, space per title, Videos + Manga numbers.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mangaMemories, mixNumbers, monthRangesOf, readingIn, readingYears, recentWeekRanges, spaceByTitle } from '../src/features/vault/manga/mangaInsights.ts';

const DAY = 86_400_000;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const C = (n, extra = {}) => ({ id: `c${n}`, number: n, readAt: null, lastPage: 0, size: 0, downloaded: false, folder: null, pageCount: 20, ...extra });
const S = (id, extra = {}) => ({ id, title: id, deletedAt: null, isPrivate: false, rating: 0, status: null, finishedAt: null, lastReadAt: null, tags: [], chapters: [C(1)], ...extra });
const R = (seriesId, startedAt, min, pages = 10) => ({ seriesId, chapterId: null, startedAt, readMs: min * 60_000, pages });

test('a range counts time, chapters, days, the busiest day and your #1', () => {
  const series = [
    S('a', { tags: ['action'], chapters: [C(1, { readAt: at(2026, 3, 2) }), C(2, { readAt: at(2026, 3, 2) }), C(3)] }),
    S('b', { tags: ['action', 'drama'], chapters: [C(1, { readAt: at(2026, 3, 4) })] }),
    S('gone', { deletedAt: 1, chapters: [C(1, { readAt: at(2026, 3, 3) })] }),
  ];
  const reads = [R('a', at(2026, 3, 2), 30), R('b', at(2026, 3, 4), 50), R('a', at(2026, 2, 20), 99), R('gone', at(2026, 3, 3), 10)];
  const r = readingIn(series, reads, at(2026, 3, 2, 0), at(2026, 3, 9, 0));
  assert.equal(r.ms, 80 * 60_000);
  assert.equal(r.chapters, 3);
  assert.equal(r.days, 2);
  assert.equal(r.titles, 2);
  assert.equal(r.top[0].id, 'b');
  assert.equal(r.busiestDay.day, at(2026, 3, 4, 0));
  assert.equal(r.perDay.length, 7);
  assert.equal(r.perDay[2], 50 * 60_000);
  assert.equal(r.genre, 'action');
});

test('ranges: this week starts on Monday; months of this year newest first; years you read in', () => {
  const now = at(2026, 10, 24, 15); // a Saturday
  const [w0, w1] = recentWeekRanges(now, 2);
  assert.equal(new Date(w0.start).getDay(), 1);
  assert.equal(w0.label, 'This week');
  assert.equal(w1.end, w0.start);
  const months = monthRangesOf(now);
  assert.equal(months.length, 10);
  assert.equal(new Date(months[0].start).getMonth(), 9);
  assert.deepEqual(readingYears([S('a', { chapters: [C(1, { readAt: at(2024, 5, 1) })] })], [R('a', at(2025, 1, 1), 5)], now), [2026, 2025, 2024]);
});

test('memories: on this day, a month ago, anniversaries and one to come back to', () => {
  const now = at(2026, 10, 24, 9);
  const series = [
    S('old', { chapters: [C(1, { readAt: at(2025, 10, 24, 20) })] }),
    S('month', { chapters: [C(1)] }),
    S('done', { status: 'completed', finishedAt: at(2024, 10, 23), rating: 9, chapters: [C(1, { readAt: at(2024, 10, 23) })], lastReadAt: at(2024, 10, 23) }),
  ];
  const reads = [R('old', at(2025, 10, 24, 20), 40), R('month', at(2026, 9, 24, 10), 15)];
  const m = mangaMemories(series, reads, now);
  const kinds = m.map((x) => x.kind);
  assert.ok(kinds.includes('onThisDay'));
  assert.equal(m.find((x) => x.kind === 'onThisDay').title, 'old');
  assert.equal(m.find((x) => x.kind === 'monthAgo').title, 'month');
  assert.ok(kinds.includes('finished'));
  assert.equal(m.find((x) => x.kind === 'comeBack').title, 'done');
  // A week a year ago that is the same as "a year ago today" is not shown twice.
  assert.ok(!kinds.includes('weekLastYear'));
});

test('space per title: only what is on the phone, biggest first', () => {
  const rows = spaceByTitle([
    S('small', { chapters: [C(1, { downloaded: true, size: 10 }), C(2)] }),
    S('big', { chapters: [C(1, { downloaded: true, size: 50, readAt: 1 }), C(2, { folder: 'x', size: 30 })] }),
    S('online', { chapters: [C(1)] }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['big', 'small']);
  assert.equal(rows[0].bytes, 80);
  assert.equal(rows[0].read, 1);
});

test('Videos + Manga: time side by side, the top video, days you did both', () => {
  const series = [S('a', { chapters: [C(1, { readAt: at(2026, 3, 3) })] })];
  const reads = [R('a', at(2026, 3, 3, 22), 60)];
  const reading = readingIn(series, reads, at(2026, 3, 1, 0), at(2026, 4, 1, 0));
  const plays = [
    { videoId: 'v1', startedAt: at(2026, 3, 3, 8), watchedMs: 20 * 60_000 },
    { videoId: 'v1', startedAt: at(2026, 3, 5, 8), watchedMs: 20 * 60_000 },
    { videoId: 'v2', startedAt: at(2026, 3, 6, 8), watchedMs: 10 * 60_000 },
    { videoId: 'v3', startedAt: at(2026, 5, 1), watchedMs: 99 * 60_000 },
  ];
  const mix = mixNumbers(plays, reading, reads);
  assert.equal(mix.watchMs, 50 * 60_000);
  assert.equal(mix.readMs, 60 * 60_000);
  assert.equal(Math.round(mix.readShare * 100), 55);
  assert.deepEqual(mix.topVideo, { id: 'v1', ms: 40 * 60_000, plays: 2 });
  assert.equal(mix.days, 3);
  assert.equal(mix.bothDays, 1);
  assert.equal(mix.morning, 'watch');
  assert.equal(mix.night, 'read');
  assert.equal(mix.busiestDay.day, at(2026, 3, 3, 0));
});
