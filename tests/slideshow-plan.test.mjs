import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clipWindow, DEFAULT_SLIDESHOW, parseSlideshow, pickFor, planShow, showLength, startsDay } from '../src/features/vault/slideshowPlan.ts';

const day = (d, h = 12) => new Date(2026, 9, d, h).getTime();
const vids = [
  { id: 'a', createdAt: day(3), rating: 9, durationMs: 60_000 },
  { id: 'b', createdAt: day(1), rating: 0, durationMs: 20_000 },
  { id: 'c', createdAt: day(2), rating: 5, durationMs: null },
  { id: 'd', createdAt: day(2, 18), rating: 8, durationMs: 120_000 },
];
const o = (patch) => ({ ...DEFAULT_SLIDESHOW, ...patch });

test('settings from an older app, or broken ones, read as the defaults; new ones are kept', () => {
  assert.deepEqual(parseSlideshow(null), DEFAULT_SLIDESHOW);
  const old = parseSlideshow({ order: 'best', clipSec: 10, transition: 'zoom', titles: false, sound: false, repeat: true });
  assert.equal(old.order, 'best');
  assert.equal(old.clipSec, 10);
  assert.equal(old.fitMin, 0);
  assert.equal(old.music, null);
  assert.equal(old.speed, 1);
  const odd = parseSlideshow({ order: 'sideways', clipSec: 7, speed: 3, fitMin: 4, transition: 'spin', title: 'x'.repeat(200), music: '', stopAfterMin: 45 });
  assert.equal(odd.order, 'shown');
  assert.equal(odd.clipSec, 0);
  assert.equal(odd.speed, 1);
  assert.equal(odd.fitMin, 0);
  assert.equal(odd.transition, 'fade');
  assert.equal(odd.title.length, 60);
  assert.equal(odd.music, null);
  assert.equal(odd.stopAfterMin, 0);
  const all = parseSlideshow({ order: 'newest', pick: 'favourites', fitMin: 3, transition: 'dip', dayTitles: true, title: 'Lake', music: 'song1', speed: 1.5, fill: true, drift: true, stopAfterMin: 30 });
  assert.deepEqual(
    [all.order, all.pick, all.fitMin, all.transition, all.dayTitles, all.title, all.music, all.speed, all.fill, all.drift, all.stopAfterMin],
    ['newest', 'favourites', 3, 'dip', true, 'Lake', 'song1', 1.5, true, true, 30]
  );
});

test('picking favourites or rated videos', () => {
  assert.deepEqual(pickFor(vids, 'favourites').map((v) => v.id), ['a', 'd']);
  assert.deepEqual(pickFor(vids, 'rated').map((v) => v.id), ['a', 'c', 'd']);
  assert.equal(pickFor(vids, 'all').length, 4);
});

test('orders: as shown from the tapped video, oldest, newest, best, shuffle keeps every video once', () => {
  assert.deepEqual(planShow(vids, 2, o({})).list.map((v) => v.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(planShow(vids, 0, o({ order: 'oldest' })).list.map((v) => v.id), ['b', 'c', 'd', 'a']);
  assert.deepEqual(planShow(vids, 0, o({ order: 'newest' })).list.map((v) => v.id), ['a', 'd', 'c', 'b']);
  assert.deepEqual(planShow(vids, 0, o({ order: 'best' })).list.map((v) => v.id), ['a', 'd', 'c', 'b']);
  const sh = planShow(vids, 0, o({ order: 'shuffle' }), () => 0.3).list.map((v) => v.id);
  assert.deepEqual([...sh].sort(), ['a', 'b', 'c', 'd']);
  // The tapped video was left out by the pick: the show starts at the beginning.
  assert.deepEqual(planShow(vids, 1, o({ pick: 'favourites' })).list.map((v) => v.id), ['a', 'd']);
});

test('fit the show to a length: an equal share each, faster speed shows more of each video', () => {
  const p = planShow(vids, 0, o({ fitMin: 1 }));
  assert.equal(p.clipMs, 15_000);
  assert.equal(p.leftOut, 0);
  // a 15 s + b 15 s + c (no length) 15 s + d 15 s = 60 s.
  assert.equal(p.totalMs, 60_000);
  const fast = planShow(vids, 0, o({ fitMin: 1, speed: 2 }));
  assert.equal(fast.clipMs, 30_000);
  assert.equal(fast.totalMs, (30_000 + 20_000 + 30_000 + 30_000) / 2);
  // 1,000 videos in 1 minute: only 20 fit at 3 s each.
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: `v${i}`, createdAt: i, rating: 0, durationMs: 10_000 }));
  const m = planShow(many, 0, o({ fitMin: 1 }));
  assert.equal(m.list.length, 20);
  assert.equal(m.leftOut, 980);
  assert.equal(m.clipMs, 3000);
  // Two videos in 10 minutes: at most 1 minute each.
  assert.equal(planShow(vids.slice(0, 2), 0, o({ fitMin: 10 })).clipMs, 60_000);
});

test('no videos: an empty plan, not a crash', () => {
  const p = planShow([], 0, o({ fitMin: 3 }));
  assert.deepEqual(p, { list: [], clipMs: 0, totalMs: 0, leftOut: 0 });
  assert.equal(planShow(vids, 0, o({ pick: 'favourites', order: 'shuffle' })).list.length, 2);
});

test('clip windows stay inside the video', () => {
  const mid = (d, c) => d / 2 - c / 2;
  assert.deepEqual(clipWindow(60_000, 0, mid), { start: 0, end: 60_000 });
  assert.deepEqual(clipWindow(null, 5000, mid), { start: 0, end: Infinity });
  assert.deepEqual(clipWindow(6000, 5000, mid), { start: 0, end: 6000 });
  assert.deepEqual(clipWindow(60_000, 10_000, mid), { start: 25_000, end: 35_000 });
  // A highlight near the end is moved back so the whole clip fits.
  assert.deepEqual(clipWindow(60_000, 10_000, () => 58_000), { start: 50_000, end: 60_000 });
});

test('a new day starts at the first video and whenever the date changes', () => {
  const list = [{ createdAt: day(1, 9) }, { createdAt: day(1, 23) }, { createdAt: day(2, 0) }, { createdAt: day(2, 5) }];
  assert.deepEqual(list.map((_, i) => startsDay(list, i)), [true, false, true, false]);
  assert.equal(startsDay([], 0), false);
});

test('show lengths in words', () => {
  assert.equal(showLength(20_000), 'under a minute');
  assert.equal(showLength(3 * 60_000), 'about 3 min');
  assert.equal(showLength(65 * 60_000), 'about 1 h 5 min');
  assert.equal(showLength(120 * 60_000), 'about 2 h');
});
