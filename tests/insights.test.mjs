// Run with `npm test`. Exact ratings, rewatches, reviews, detailed stats and reminders.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activeSession,
  buildEvents,
  detailedStats,
  effectiveRating,
  fmtChange,
  fmtDuration,
  fmtRating,
  nextSessionNumber,
  normaliseExact,
  periodOf,
  review,
  shiftPeriod,
  toSimklRating,
  watchCounts,
} from '../src/features/simkl/insights.ts';
import { parseReminderSettings, planReminders } from '../src/features/simkl/reminders.ts';

const item = (over = {}) => ({
  simklId: 1,
  type: 'show',
  title: 'Harbour Lights',
  year: 2024,
  poster: null,
  slug: null,
  runtime: 50,
  status: 'watching',
  rating: 9,
  ratedAt: null,
  addedAt: null,
  lastWatchedAt: null,
  watchedEpisodes: 3,
  totalEpisodes: 10,
  notAiredEpisodes: 0,
  nextToWatch: 'S01E04',
  animeType: null,
  memo: null,
  nextTitle: null,
  nextDate: null,
  simklRating: null,
  simklVotes: null,
  imdbRating: null,
  imdbVotes: null,
  malRating: null,
  rank: null,
  ...over,
});

const at = (y, m, d, h = 20) => new Date(y, m - 1, d, h).toISOString();

test('exact ratings: Simkl gets the rounded one, the exact one shows while they agree', () => {
  assert.equal(toSimklRating(9.7), 10);
  assert.equal(toSimklRating(8.1), 8);
  assert.equal(toSimklRating(0.2), 1);
  assert.equal(normaliseExact(9.74), 9.7);
  assert.equal(effectiveRating(10, 9.7), 9.7);
  assert.equal(effectiveRating(7, 9.7), 7, 'changed on Simkl since: Simkl wins');
  assert.equal(effectiveRating(null, 9.7), null, 'removed on Simkl');
  assert.equal(effectiveRating(8, null), 8);
  assert.equal(fmtRating(9), '9');
  assert.equal(fmtRating(9.7), '9.7');
});

test('rewatch sessions are numbered from #2, the open one is active', () => {
  assert.equal(nextSessionNumber([]), 2);
  const sessions = [
    { id: 1, simklId: 1, number: 2, startedAt: 'a', finishedAt: 'b', remoteId: null },
    { id: 2, simklId: 1, number: 3, startedAt: 'c', finishedAt: null, remoteId: null },
  ];
  assert.equal(nextSessionNumber(sessions), 4);
  assert.equal(activeSession(sessions).number, 3);
  const counts = watchCounts(new Set(['1:1', '1:2']), [
    { id: 1, simklId: 1, season: 1, episode: 1, watchedAt: 'x', sessionId: null },
    { id: 2, simklId: 1, season: 1, episode: 1, watchedAt: 'y', sessionId: 2 },
  ]);
  assert.equal(counts.get('1:1'), 3);
  assert.equal(counts.get('1:2'), 1);
});

test('periods: Monday-first weeks, months, years, and stepping between them', () => {
  const sat = new Date(2026, 9, 17, 12).getTime();
  const w = periodOf('week', sat);
  assert.equal(new Date(w.start).getDay(), 1);
  assert.equal(new Date(w.start).getDate(), 12);
  assert.equal(w.label, '12–18 Oct 2026');
  assert.equal(periodOf('month', sat).label, 'October 2026');
  assert.equal(shiftPeriod(periodOf('month', sat), -1).label, 'September 2026');
  assert.equal(shiftPeriod(periodOf('year', sat), 1).label, '2027');
  assert.equal(shiftPeriod(w, -1).label, '5–11 Oct 2026');
});

const library = [
  item(),
  item({ simklId: 2, title: 'Glass Orchard', type: 'movie', runtime: 120, status: 'completed', rating: 8, lastWatchedAt: at(2026, 10, 14), ratedAt: at(2026, 10, 14), imdbRating: 7.5 }),
  item({ simklId: 3, title: 'Starlit Workshop', type: 'anime', runtime: 24, rating: null, addedAt: at(2026, 10, 2) }),
  item({ simklId: 4, title: 'Low Tide', type: 'movie', runtime: 100, status: 'plantowatch', rating: null }),
];
const history = [
  { simklId: 1, watchedAt: at(2026, 10, 13) },
  { simklId: 1, watchedAt: at(2026, 10, 13, 21) },
  { simklId: 1, watchedAt: at(2026, 10, 13, 22) },
  { simklId: 3, watchedAt: at(2026, 10, 16) },
  { simklId: 3, watchedAt: at(2026, 9, 30) },
  { simklId: 1, watchedAt: null },
];
const plays = [{ simklId: 1, watchedAt: at(2026, 10, 15) }];
const meta = new Map([
  [1, { genres: ['Drama', 'Mystery'], network: 'HBO', country: 'US', language: 'EN', runtime: 50 }],
  [3, { genres: ['Fantasy'], network: 'MBS', country: 'JP', language: 'JA', runtime: 24 }],
]);

test('watch events: history, completed movies and rewatches, with runtimes', () => {
  const ev = buildEvents(library, history, plays, meta);
  assert.equal(ev.length, 7, 'five dated episodes + one movie + one rewatch');
  assert.equal(ev.filter((e) => e.rewatch).length, 1);
  assert.ok(ev.every((e, i) => i === 0 || e.at >= ev[i - 1].at));
});

test('week review: totals, a bar per day, top titles and genres, the binge', () => {
  const ev = buildEvents(library, history, plays, meta);
  const r = review(ev, library, meta, periodOf('week', new Date(2026, 9, 17).getTime()));
  assert.equal(r.episodes, 5);
  assert.equal(r.movies, 1);
  assert.equal(r.rewatches, 1);
  assert.equal(r.minutes, 4 * 50 + 24 + 120);
  assert.equal(r.buckets.length, 7);
  assert.equal(r.buckets[1].count, 3, 'Tuesday 13th: three episodes');
  assert.equal(r.buckets[2].count, 1, 'Wednesday 14th: the movie');
  assert.equal(r.topTitles[0].label, 'Harbour Lights');
  assert.equal(r.topGenres[0].label, 'Drama');
  assert.equal(r.biggestBinge.count, 3);
  assert.equal(r.rated.count, 1);
  assert.equal(r.previousMinutes, 0, 'nothing in 5-11 Oct');
  const oct = review(ev, library, meta, periodOf('month', new Date(2026, 9, 17).getTime()));
  assert.equal(oct.previousMinutes, 24, 'September had the anime episode on the 30th');
  assert.equal(r.activeDays, 4);
});

test('month and year reviews bucket by day and by month', () => {
  const ev = buildEvents(library, history, plays, meta);
  const month = review(ev, library, meta, periodOf('month', new Date(2026, 9, 1).getTime()));
  assert.equal(month.buckets.length, 31);
  assert.equal(month.added, 1);
  assert.equal(month.finished.map((i) => i.title).join(), 'Glass Orchard');
  const year = review(ev, library, meta, periodOf('year', new Date(2026, 0, 1).getTime()));
  assert.equal(year.buckets.length, 12);
  assert.equal(year.buckets[8].count, 1, 'September');
  assert.equal(year.buckets[9].count, 6, 'October');
});

test('detailed stats: per type, ratings against IMDb, patterns, what is left', () => {
  const ev = buildEvents(library, history, plays, meta);
  const s = detailedStats(ev, library, meta);
  assert.equal(s.byType.movie.titles, 2);
  assert.equal(s.byType.movie.plan, 1);
  assert.equal(s.ratingHistogram[8], 1, 'one 9');
  assert.equal(s.ratingHistogram[7], 1, 'one 8');
  assert.equal(s.myAverage, 8.5);
  assert.equal(s.vsImdb, 0.5, 'rated the movie 8 against IMDb 7.5');
  assert.equal(s.planMinutes, 100);
  assert.equal(s.leftMinutes, 7 * 50 + 7 * 24);
  assert.equal(s.topCountries[0].label, 'US');
  assert.equal(s.weekday.reduce((n, b) => n + b.count, 0), 7);
  assert.equal(s.metaCoverage.have, 2);
  assert.equal(s.mostRewatched[0].label, 'Harbour Lights');
});

test('durations and changes', () => {
  assert.equal(fmtDuration(45), '45 min');
  assert.equal(fmtDuration(320), '5 h 20 min');
  assert.equal(fmtDuration(3060), '2 d 3 h');
  assert.equal(fmtChange(120, 100), '+20%');
  assert.equal(fmtChange(65, 100), '−35%');
  assert.equal(fmtChange(10, 0), null);
});

test('reminders: followed titles only, soonest first, inside three weeks, delay applied', () => {
  const now = Date.parse('2026-10-17T10:00:00Z');
  const cal = [
    { simklId: 1, type: 'show', title: 'x', year: null, poster: null, slug: null, date: '2026-10-18T01:00:00Z', episodeLabel: 'S01E05' },
    { simklId: 1, type: 'show', title: 'x', year: null, poster: null, slug: null, date: '2026-10-18T01:00:00Z', episodeLabel: 'S01E05' },
    { simklId: 3, type: 'anime', title: 'y', year: null, poster: null, slug: null, date: '2026-10-17T15:00:00Z', episodeLabel: 'E8' },
    { simklId: 2, type: 'movie', title: 'z', year: null, poster: null, slug: null, date: '2026-10-20T00:00:00Z' },
    { simklId: 4, type: 'movie', title: 'w', year: null, poster: null, slug: null, date: '2026-10-21T00:00:00Z' },
    { simklId: 99, type: 'show', title: 'not mine', year: null, poster: null, slug: null, date: '2026-10-18T00:00:00Z' },
    { simklId: 1, type: 'show', title: 'x', year: null, poster: null, slug: null, date: '2026-12-30T00:00:00Z', episodeLabel: 'S01E09' },
  ];
  const settings = { ...parseReminderSettings(null), enabled: true, delayMinutes: 60 };
  const plan = planReminders(cal, library, settings, now);
  assert.deepEqual(plan.map((r) => r.key), ['3:E8', '1:S01E05', '4:release']);
  assert.equal(plan[0].at, Date.parse('2026-10-17T16:00:00Z'));
  assert.deepEqual(planReminders(cal, library, { ...settings, enabled: false }, now), []);
  assert.deepEqual(
    planReminders(cal, library, { ...settings, types: { show: false, anime: false, movie: true } }, now).map((r) => r.key),
    ['4:release']
  );
  assert.deepEqual(parseReminderSettings('{"enabled":true,"delayMinutes":7}').delayMinutes, 0);
});
