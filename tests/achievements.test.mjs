// Run with `npm test`. Achievements, the period dashboard, friendly names and the new Wrapped facts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { achievements, challengeFor, perfectWeeks, streaks, summarize } from '../src/features/vault/achievements.ts';
import { daypart, fmtChange, libraryHealth, periodDashboard } from '../src/features/vault/dashboard.ts';
import { friendlyName, isIdName } from '../src/features/vault/names.ts';
import { wrapped } from '../src/features/vault/stats.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 18, 20, 0).getTime(); // Sun 18 Oct 2026, 20:00
const at = (y, m, d, h = 20) => new Date(y, m, d, h, 0).getTime();

const video = (id, over = {}) => ({
  id,
  title: null,
  filename: `${id}.mp4`,
  rating: 0,
  tagNames: [],
  importedAt: at(2026, 8, 1),
  createdAt: at(2025, 5, 1),
  durationMs: 10 * 60_000,
  sizeBytes: 100,
  flag: 0,
  location: null,
  ...over,
});
const play = (videoId, startedAt, watchedMs = 20 * 60_000) => ({ videoId, startedAt, watchedMs });
const input = (over = {}) => ({
  videos: [],
  plays: [],
  bookmarks: 0,
  albums: 0,
  smartFilters: 0,
  series: 0,
  seriesFinished: 0,
  kept: 0,
  simkl: null,
  now: NOW,
  ...over,
});

test('friendly names hide the ids Photos gives videos', () => {
  assert.equal(isIdName('25FCDDB3-9317-4C2B-8E0A-1F2B3C4D5E6F.mov'), true);
  assert.equal(isIdName('IMG_4471.MOV'), false);
  assert.match(friendlyName({ title: null, filename: '25FCDDB3-9317-4C2B-8E0A-1F2B3C4D5E6F.mov', createdAt: at(2026, 9, 17) }), /^Video from /);
  assert.equal(friendlyName({ title: '  My trip ', filename: 'x.mp4' }), 'My trip');
  assert.equal(friendlyName({ title: null, filename: 'beach_day.mp4' }), 'beach_day');
  assert.match(friendlyName({ title: null, filename: 'Snaptik.app_7358080437329153323.mp4', createdAt: at(2026, 9, 1) }), /^TikTok video from /);
  assert.match(friendlyName({ title: null, filename: 'snaptik_7609629117616590111_v3 (1).mp4', createdAt: at(2026, 9, 1) }), /^TikTok video from /);
  assert.equal(isIdName('clip_2026-10-12_downtown.mp4'), false);
  assert.equal(isIdName('Terra Formars (2016) S01E04.mp4'), false);
});

test('streaks and perfect weeks count calendar days', () => {
  const times = [at(2026, 9, 12), at(2026, 9, 13), at(2026, 9, 14), at(2026, 9, 14, 23), at(2026, 9, 15), at(2026, 9, 16), at(2026, 9, 17), at(2026, 9, 18)];
  const s = streaks(times, NOW);
  assert.equal(s.best, 7);
  assert.equal(s.current, 7);
  assert.equal(s.reachedAt.get(3), new Date(2026, 9, 14).getTime());
  // Mon 12 to Sun 18 Oct is a full week.
  assert.deepEqual(perfectWeeks(times, NOW), [new Date(2026, 9, 18).getTime()]);
  assert.equal(streaks([at(2026, 9, 10)], NOW).current, 0);
});

test('ladders keep the old ids, show reached steps plus the next one, with dates', () => {
  const videos = Array.from({ length: 12 }, (_, i) => video(`v${i}`, { importedAt: at(2026, 8, 1 + i) }));
  const list = achievements(input({ videos }));
  const lib = list.filter((a) => a.family === 'library');
  assert.deepEqual(lib.map((a) => [a.id, a.unlocked, a.tier]), [
    ['library-10', true, 1],
    ['library-100', false, 2],
  ]);
  assert.equal(lib[0].earnedAt, at(2026, 8, 10));
  assert.equal(lib[1].current, 12);
});

test('hours, explorer and replay are dated by the play that crossed the line', () => {
  const plays = [play('a', at(2026, 9, 1), 40 * 60_000), play('a', at(2026, 9, 2), 30 * 60_000), play('a', at(2026, 9, 3), 1000)];
  const list = achievements(input({ videos: [video('a')], plays }));
  const hour = list.find((a) => a.id === 'hours-1');
  assert.equal(hour.unlocked, true);
  assert.equal(hour.earnedAt, at(2026, 9, 2));
  const replay = list.find((a) => a.id === 'replay-3');
  assert.equal(replay.unlocked, true);
  assert.equal(replay.earnedAt, at(2026, 9, 3));
});

test('one-offs: night owl, marathon, perfect 10, full range, globetrotter', () => {
  const nights = [1, 2, 3, 4, 5].map((d) => play('a', at(2026, 9, d, 2), 60_000));
  const list = achievements(
    input({
      videos: [
        video('a', { rating: 10, location: { lat: 51.5, lon: 7.4 } }),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => video(`r${r}`, { rating: r, location: { lat: 51.5 + r * 3, lon: 7.4 } })),
      ],
      plays: [...nights, play('a', at(2026, 9, 7, 10), 2 * HOUR), play('a', at(2026, 9, 7, 15), 1.5 * HOUR)],
    })
  );
  const get = (id) => list.find((a) => a.id === id);
  assert.equal(get('night-owl').unlocked, true);
  assert.equal(get('night-owl').earnedAt, at(2026, 9, 5, 2));
  assert.equal(get('marathon').unlocked, true);
  assert.equal(get('marathon').earnedAt, new Date(2026, 9, 7).getTime());
  assert.equal(get('long-haul').unlocked, true);
  assert.equal(get('perfect-10').unlocked, true);
  assert.equal(get('full-range').unlocked, true);
  assert.equal(get('globetrotter').unlocked, true);
  assert.equal(get('early-bird').unlocked, false);
});

test('monthly challenges: this month in progress, past months only when earned', () => {
  const c = challengeFor(2026, 9);
  assert.ok(['hours', 'days', 'variety'].includes(c.key));
  assert.deepEqual(challengeFor(2026, 9), c, 'the same month always gets the same goal');
  const list = achievements(input({ videos: [video('a')], plays: [play('a', at(2026, 9, 3))] }));
  const months = list.filter((a) => a.kind === 'monthly');
  assert.equal(months.length, 1);
  assert.equal(months[0].id, 'month-2026-10');
  assert.equal(months[0].unlocked, false);
});

test('summary: points, next up, recent', () => {
  const videos = Array.from({ length: 12 }, (_, i) => video(`v${i}`, { importedAt: at(2026, 8, 1 + i) }));
  const s = summarize(achievements(input({ videos })));
  assert.ok(s.earned >= 1);
  assert.ok(s.points >= 1);
  assert.equal(s.recent[0].id, 'library-10');
  assert.ok(s.next.every((a) => !a.unlocked && a.current > 0));
});

test('period dashboard: buckets, comparison, peaks, top videos', () => {
  const videos = [video('a', { tagNames: ['Funny'] }), video('b')];
  const plays = [
    play('a', at(2026, 9, 18, 21), 30 * 60_000),
    play('a', at(2026, 9, 16, 21), 30 * 60_000),
    play('b', at(2026, 9, 14, 9), 40 * 60_000),
    play('b', at(2026, 9, 8, 21), 60 * 60_000), // the week before
  ];
  const d = periodDashboard('week', videos, plays, NOW);
  assert.equal(d.buckets.length, 7);
  assert.equal(d.buckets[6].current, true);
  assert.equal(d.buckets[6].ms, 30 * 60_000);
  assert.equal(d.watchedMs, 100 * 60_000);
  assert.equal(d.prevMs, HOUR);
  assert.equal(fmtChange(d.change, d.prevMs, d.watchedMs), '+67 %');
  assert.equal(d.activeDays, 3);
  assert.equal(d.peakHour, 21);
  assert.equal(d.top[0].id, 'a');
  assert.equal(d.top[0].share, 0.6);
  assert.equal(d.topTags[0].tag, 'Funny');
  assert.equal(periodDashboard('year', videos, plays, NOW).buckets.length, 12);
  assert.equal(periodDashboard('all', videos, plays, NOW).change, null);
  assert.equal(daypart(21).label, 'In the evening');
});

test('library health and the median rating', () => {
  const h = libraryHealth([video('a', { rating: 4, tagNames: ['x'] }), video('b', { rating: 8 }), video('c')], [play('a', 1)]);
  assert.deepEqual(h, { total: 3, rated: 2, tagged: 1, watched: 1, median: 6 });
});

test('wrapped knows active days, the best run, the peak hour and the first video', () => {
  const items = [video('a'), video('b')].map((v) => ({ ...v, width: null, height: null }));
  const w = wrapped(
    { start: at(2026, 9, 12, 0), end: at(2026, 9, 19, 0), label: 'This week' },
    items,
    [play('b', at(2026, 9, 12, 22)), play('a', at(2026, 9, 13, 22), 60 * 60_000), play('a', at(2026, 9, 15, 9))]
  );
  assert.equal(w.videos.activeDays, 3);
  assert.equal(w.videos.bestRun, 2);
  assert.equal(w.videos.peakHour, 22);
  assert.equal(w.videos.firstVideo.key, 'b');
  assert.ok(w.videos.topShare > 0.7);
});
