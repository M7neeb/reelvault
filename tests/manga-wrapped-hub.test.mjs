// Run with `npm test`. The numbers on the Wrapped tab.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { weightOf, wrappedHub } from '../src/features/vault/manga/wrappedHub.ts';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const C = (n, extra = {}) => ({ id: `c${n}`, number: n, readAt: null, lastPage: 0, size: 0, downloaded: false, folder: null, pages: [], pageCount: 20, ...extra });
const S = (id, extra = {}) => ({ id, title: id, author: null, kind: null, readingMode: null, deletedAt: null, isPrivate: false, rating: 0, status: 'reading', finishedAt: null, lastReadAt: null, tags: [], chapters: [C(1)], ...extra });
const R = (seriesId, startedAt, min) => ({ seriesId, chapterId: null, startedAt, readMs: min * 60_000, pages: 0 });

const now = at(2026, 10, 31);
const series = [
  S('a', { chapters: [C(1, { readAt: at(2024, 5, 3) }), C(2, { readAt: at(2026, 3, 2) }), C(3, { readAt: at(2026, 3, 3) })] }),
  S('b', { chapters: [C(1, { readAt: at(2026, 10, 29) })] }),
];
const reads = [R('a', at(2026, 3, 2), 90), R('b', at(2026, 10, 29), 20)];

test('this year, all time, and the years before', () => {
  const h = wrappedHub(series, reads, now);
  assert.equal(h.year.range.label, '2026');
  assert.equal(h.year.y.chapters, 3);
  assert.equal(h.all.range.kind, 'all');
  assert.equal(h.all.y.chapters, 4);
  assert.deepEqual(h.pastYears.map((p) => p.range.label), ['2024']);
});

test('twelve months: the ones to come marked, the best one found', () => {
  const h = wrappedHub(series, reads, now);
  assert.equal(h.months.length, 12);
  assert.equal(h.months.filter((m) => m.future).length, 2); // November and December
  assert.equal(h.months[11].future, true);
  assert.equal(h.months[11].y.chapters, 0);
  assert.equal(h.bestMonth, 2); // March: 90 min beats October's 20
  assert.equal(h.months[9].y.top[0].id, 'b');
});

test('weeks: this one first, eight of them', () => {
  const h = wrappedHub(series, reads, now);
  assert.equal(h.weeks.length, 8);
  assert.equal(h.weeks[0].range.label, 'This week');
  assert.equal(h.weeks[0].y.chapters, 1);
});

test('nothing read: no best month, no past years', () => {
  const h = wrappedHub([S('x')], [], now);
  assert.equal(h.bestMonth, null);
  assert.equal(h.pastYears.length, 0);
  assert.equal(weightOf(h.year.y), 0);
});
