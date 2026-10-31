// Run with `npm test`. The reading Wrapped's story: titles, calendar, ratings, waiting chapters, badges, quizzes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chapterToShow, wrappedStory } from '../src/features/vault/manga/mangaWrapped.ts';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const C = (n, extra = {}) => ({ id: `c${n}`, number: n, readAt: null, lastPage: 0, size: 0, downloaded: false, folder: null, pages: [], pageCount: 20, ...extra });
const S = (id, extra = {}) => ({ id, title: id, author: null, kind: null, readingMode: null, deletedAt: null, isPrivate: false, rating: 0, status: 'reading', finishedAt: null, lastReadAt: null, tags: [], chapters: [C(1)], ...extra });
const R = (seriesId, startedAt, min, pages = 0) => ({ seriesId, chapterId: null, startedAt, readMs: min * 60_000, pages });
const start = at(2026, 1, 1, 0);
const end = at(2027, 1, 1, 0);
const now = at(2026, 10, 31);

const series = [
  S('a', { rating: 9, kind: 'manhwa', tags: ['action'], chapters: [C(1, { readAt: at(2025, 6, 1) }), C(2, { readAt: at(2026, 3, 5, 9) }), C(3, { readAt: at(2026, 3, 5, 10) }), C(4, { readAt: at(2026, 3, 5, 11) }), C(5)] }),
  S('b', { rating: 4, status: 'dropped', chapters: [C(1, { readAt: at(2026, 4, 2) })] }),
  S('c', { rating: 8, status: 'completed', chapters: [C(1, { readAt: at(2026, 7, 9) })] }),
  S('d', { rating: 6, chapters: [C(1, { readAt: at(2026, 8, 1) }), C(2), C(3)] }),
];
const reads = [R('a', at(2026, 3, 5, 9), 120, 400), R('b', at(2026, 4, 2), 20), R('other:x', at(2026, 5, 1), 30), R('c', at(2026, 7, 9), 15)];

test('the top title has its story: share, binge day, first met', () => {
  const st = wrappedStory(series, reads, start, end, now);
  const a = st.titles[0];
  assert.equal(a.id, 'a');
  assert.equal(a.chapters, 3);
  assert.deepEqual(a.binge, { day: at(2026, 3, 5, 0), chapters: 3 });
  assert.equal(a.metAt, at(2025, 6, 1));
  assert.ok(a.share > 0.6);
});

test('calendar covers the range up to today; months add up', () => {
  const st = wrappedStory(series, reads, start, end, now);
  assert.equal(st.calendar[0].day, start);
  assert.ok(st.calendar.length >= 303 && st.calendar.length <= 305);
  assert.ok(st.calendar.find((c) => c.day === at(2026, 5, 1, 0)).v > 0); // time on a title not in the library counts
  assert.equal(st.months[2].chapters, 3);
  assert.equal(st.months[4].ms, 30 * 60_000);
});

test('ratings, gem, dropped, waiting, first and last chapter', () => {
  const st = wrappedStory(series, reads, start, end, now);
  assert.equal(st.ratings.rated, 4);
  assert.equal(st.ratings.histogram[8], 1);
  assert.equal(st.ratings.harshest.id, 'b');
  assert.deepEqual(st.dropped, ['b']);
  assert.equal(st.waiting.chapters, 3);
  assert.equal(st.waiting.most.id, 'd');
  assert.equal(st.firstChapter.seriesId, 'a');
  assert.equal(st.lastChapter.seriesId, 'd');
});

test('directions, speed, what it adds up to, badges and quizzes', () => {
  const st = wrappedStory(series, reads, start, end, now);
  assert.equal(st.directions[0].mode, 'webtoon');
  assert.equal(st.secondsPerPage, 18);
  assert.equal(st.adds.movies, 1.5);
  // The reader type is The Binger, so the Marathoner badge (the same thing) is not shown twice.
  assert.equal(st.w.type.key, 'binger');
  assert.ok(!st.badges.some((b) => b.key === 'marathon'));
  const q = st.quizzes.find((x) => x.key === 'hours');
  assert.equal(q.options[q.answer], '3 h');
  assert.equal(new Set(q.options).size, q.options.length);
  const m = st.quizzes.find((x) => x.key === 'month');
  assert.equal(m.options[m.answer], 'March');
});

test('an empty range is calm', () => {
  const st = wrappedStory([S('z')], [], start, end, now);
  assert.equal(st.titles.length, 0);
  assert.equal(st.quizzes.length, 0);
  assert.equal(st.badges.length, 0);
  assert.equal(st.firstChapter, null);
});

test('chapterToShow prefers a chapter on the phone', () => {
  const s = { chapters: [C(1, { readAt: at(2026, 2, 1) }), C(2, { folder: 'x', pages: ['1', '2', '3'] }), C(3)] };
  assert.equal(chapterToShow(s, start, end), 'c2');
  assert.equal(chapterToShow({ chapters: [C(1, { readAt: at(2026, 2, 1) }), C(2)] }, start, end), 'c1');
});

test('the period before is the same stretch of last year; waiting chapters start after the furthest read', () => {
  const st = wrappedStory(series, [...reads, R('a', at(2025, 2, 1), 60)], start, at(2026, 10, 31, 12), now, at(2025, 1, 1, 0));
  assert.equal(st.w.prev.ms, 60 * 60_000);
  const s2 = [S('w', { chapters: [C(1), C(2), C(300, { readAt: at(2026, 4, 1) }), C(301)] })];
  assert.equal(wrappedStory(s2, [], start, end, now).waiting.chapters, 1);
});

test('a title with only chapters (no time) still beats one read for ten minutes', () => {
  const s3 = [S('big', { chapters: Array.from({ length: 30 }, (_, i) => C(i + 1, { readAt: at(2026, 5, 1 + (i % 20)) })) }), S('small')];
  const st = wrappedStory(s3, [R('small', at(2026, 5, 2), 10)], start, end, now);
  assert.equal(st.titles[0].id, 'big');
});
