// Run with `npm test`. What goes behind each card of the reading Wrapped: layouts and pages, and the new story parts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deal, layoutFor, NEEDS, scrollCompare, SEQUENCE, titleLayout } from '../src/features/vault/manga/pageDirector.ts';
import { wrappedStory } from '../src/features/vault/manga/mangaWrapped.ts';

test('two cards in a row never get the same layout, and all of them show before any repeats', () => {
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const l = layoutFor(i, 50);
    if (i) assert.notEqual(l, seen[i - 1]);
    seen.push(l);
  }
  assert.equal(new Set(seen.slice(0, SEQUENCE.length)).size, SEQUENCE.length);
});

test('a card never shows the same page twice, even with few pages', () => {
  for (const size of [1, 2, 3, 5, 9, 40]) {
    for (let i = 0; i < 30; i++) {
      const l = layoutFor(i, size);
      const got = deal(size, i, l);
      assert.equal(new Set(got).size, got.length, `size ${size} card ${i}`);
      assert.ok(got.length >= Math.min(size, NEEDS[l].min));
      assert.ok(got.every((k) => k >= 0 && k < size));
    }
  }
});

test('with a big pool, pages do not come back until the pool has been shown', () => {
  const size = 200;
  const used = [];
  for (let i = 0; i < 16; i++) used.push(...deal(size, i, layoutFor(i, size)));
  assert.equal(new Set(used).size, used.length);
});

test('layouts step down to ones the pages fill', () => {
  assert.equal(layoutFor(7, 3), 'slash'); // mosaic needs 6, the next that fits
  assert.equal(layoutFor(0, 1), 'coverwall'); // covers need no pages
  assert.equal(layoutFor(0, 0), 'coverwall');
  assert.ok(NEEDS[titleLayout(3, 1, false)].min <= 1);
  assert.equal(titleLayout(0, 10, true), 'strip');
  assert.equal(titleLayout(0, 10, false), 'flip');
  assert.notEqual(titleLayout(0, 10, false), titleLayout(1, 10, false));
});

test('a long scroll is compared to the tallest landmark it passes', () => {
  assert.deepEqual(scrollCompare(900), { name: 'the Burj Khalifa', times: 1.1 });
  assert.deepEqual(scrollCompare(50), { name: 'a football pitch', times: 0.5 });
  assert.equal(scrollCompare(0), null);
});

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const C = (n, extra = {}) => ({ id: `c${n}`, number: n, readAt: null, lastPage: 0, size: 0, downloaded: false, folder: null, pages: [], pageCount: 20, ...extra });
const S = (id, extra = {}) => ({ id, title: id, author: null, kind: null, readingMode: null, deletedAt: null, isPrivate: false, rating: 0, status: 'reading', finishedAt: null, lastReadAt: null, tags: [], chapters: [C(1)], ...extra });
const R = (seriesId, startedAt, min) => ({ seriesId, chapterId: null, startedAt, readMs: min * 60_000, pages: 0 });

test('a year in parts: each month with the title read most then', () => {
  const series = [
    S('a', { lastReadAt: at(2026, 3, 9), chapters: [C(1, { readAt: at(2026, 3, 5) }), C(2, { lastPage: 7 }), C(3)] }),
    S('b', { lastReadAt: at(2026, 5, 2), chapters: [C(1, { readAt: at(2026, 5, 2) }), C(2, { lastPage: 3, readAt: at(2026, 5, 3) })] }),
  ];
  const reads = [R('a', at(2026, 3, 5), 60), R('b', at(2026, 3, 6), 10), R('b', at(2026, 5, 2), 30)];
  const st = wrappedStory(series, reads, at(2026, 1, 1, 0), at(2027, 1, 1, 0), at(2026, 6, 15));
  assert.equal(st.periods.length, 6); // January to June: nothing after today
  assert.equal(st.periods[0].label, 'Jan');
  assert.equal(st.periods[0].seriesId, null);
  assert.equal(st.periods[2].seriesId, 'a');
  assert.equal(st.periods[4].seriesId, 'b');
  // b was read last, but its begun chapter is finished: a's chapter 2, page 7, is where you stopped.
  assert.deepEqual(st.lastStop, { seriesId: 'a', chapterId: 'c2', page: 7, pages: 20, at: at(2026, 3, 9) });
});

test('a week in days, a month in weeks', () => {
  const series = [S('a', { chapters: [C(1, { readAt: at(2026, 10, 27) })] })];
  const week = wrappedStory(series, [], at(2026, 10, 26, 0), at(2026, 11, 2, 0), at(2026, 11, 5));
  assert.equal(week.periods.length, 7);
  assert.equal(week.periods[1].seriesId, 'a');
  const month = wrappedStory(series, [], at(2026, 10, 1, 0), at(2026, 11, 1, 0), at(2026, 11, 5));
  assert.equal(month.periods.length, 5);
  assert.equal(month.periods[0].label, 'Week 1');
  assert.equal(month.lastStop, null);
});

test('all time: from the first day you read, a part for each year, every day counted', async () => {
  const { allTimeRange } = await import('../src/features/vault/manga/mangaInsights.ts');
  const series = [
    S('a', { chapters: [C(1, { readAt: at(2023, 5, 3) }), C(2, { readAt: at(2025, 2, 1) })] }),
    S('b', { chapters: [C(1, { readAt: at(2026, 8, 9) })] }),
  ];
  const now = at(2026, 10, 31);
  const r = allTimeRange(series, [R('b', at(2022, 12, 30), 5)], now);
  assert.equal(r.kind, 'all');
  assert.equal(r.label, 'All time');
  assert.equal(r.start, at(2022, 12, 30, 0));
  const st = wrappedStory(series, [R('b', at(2022, 12, 30), 5)], r.start, r.end, now);
  assert.deepEqual(st.periods.map((p) => p.label), ['2022', '2023', '2024', '2025', '2026']);
  assert.equal(st.periods[1].seriesId, 'a');
  assert.equal(st.periods[2].seriesId, null);
  assert.equal(st.periods[4].seriesId, 'b');
  assert.ok(st.calendar.length > 1400); // not cut off after a year
  assert.equal(st.calendar.filter((c) => c.v > 0).length, 4);
  assert.ok(!st.quizzes.some((q) => q.key === 'month')); // "which month" means nothing across years
  assert.equal(st.y.chapters, 3);
});

test('milestones: the 1st, 10th, 50th... chapter, when and which title', () => {
  const chs = Array.from({ length: 120 }, (_, k) => C(k + 1, { id: `c${k + 1}`, readAt: at(2024, 1, 1) + k * 86_400_000 }));
  const st = wrappedStory([S('a', { chapters: chs })], [], at(2020, 1, 1, 0), at(2026, 1, 1, 0), at(2026, 1, 1));
  assert.deepEqual(st.milestones.map((m) => m.n), [1, 10, 50, 100]);
  assert.equal(st.milestones[3].at, at(2024, 1, 1) + 99 * 86_400_000);
  assert.equal(st.milestones[0].seriesId, 'a');
});

test('films and audio have their own line-ups: no repeats back to back, distinct pictures per card', async () => {
  const { SCREEN_SEQUENCE, SOUND_SEQUENCE } = await import('../src/features/vault/manga/pageDirector.ts');
  for (const seq of [SCREEN_SEQUENCE, SOUND_SEQUENCE]) {
    assert.equal(new Set(seq).size, seq.length);
    for (const size of [1, 4, 30]) {
      let prev = null;
      for (let i = 0; i < 40; i++) {
        const l = layoutFor(i, size, seq);
        assert.ok(seq.includes(l) || l === 'kenburns');
        if (size >= 30) assert.notEqual(l, prev);
        prev = l;
        const got = deal(size, i, l, seq);
        assert.equal(new Set(got).size, got.length);
      }
    }
  }
});
