// Run with `npm test`. Simkl Wrapped and the Simkl dashboard numbers.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fmtMinutesLong, monthWrapRange, nextRound, simklDash, simklWrap, topQuiz, wrapChoices, yearWrapRange } from '../src/features/simkl/simklWrapped.ts';

const item = (simklId, type, title, extra = {}) => ({
  simklId, type, title, year: 2020, poster: `p/${simklId}`, slug: null, runtime: type === 'movie' ? 120 : 24, status: 'watching', rating: null, ratedAt: null,
  addedAt: null, lastWatchedAt: null, watchedEpisodes: 0, totalEpisodes: 12, notAiredEpisodes: 0, nextToWatch: null, animeType: null, memo: null, nextTitle: null,
  nextDate: null, simklRating: null, simklVotes: null, imdbRating: null, imdbVotes: null, malRating: null, rank: null, ...extra,
});
const at = (y, m, d, h = 20) => new Date(y, m, d, h).getTime();
const ev = (simklId, type, t, minutes = 24, rewatch = false) => ({ simklId, type, at: t, minutes, rewatch });

const items = [
  item(1, 'anime', 'Frieren', { rating: 9.5, status: 'completed', lastWatchedAt: new Date(2026, 2, 3).toISOString() }),
  item(2, 'show', 'Severance', { rating: 8 }),
  item(3, 'movie', 'Dune', { rating: 7, status: 'completed', lastWatchedAt: new Date(2026, 5, 1).toISOString() }),
];
const meta = new Map([
  [1, { genres: ['Fantasy', 'Adventure'], network: null, country: null, language: null, runtime: 24 }],
  [2, { genres: ['Drama'], network: null, country: null, language: null, runtime: 50 }],
]);
const events = [
  ev(2, 'show', at(2025, 11, 30), 50),
  // A binge: 5 episodes of Frieren on 1 March, late at night.
  ...[0, 1, 2, 3, 4].map((i) => ev(1, 'anime', at(2026, 2, 1, 20) + i * 1_500_000)),
  ev(1, 'anime', at(2026, 2, 2, 23)),
  ev(1, 'anime', at(2026, 2, 3, 23), 24, true),
  ev(2, 'show', at(2026, 3, 10), 50),
  ev(3, 'movie', at(2026, 5, 1), 120),
];

test('a year wrapped: totals, top titles, binge, streak, discoveries, finished', () => {
  const w = simklWrap(events, items, meta, yearWrapRange(2026));
  assert.equal(w.minutes, 7 * 24 + 50 + 120);
  assert.equal(w.episodes, 8);
  assert.equal(w.movies, 1);
  assert.equal(w.titles, 3);
  assert.equal(w.rewatches, 1);
  assert.equal(w.previousMinutes, 50);
  assert.equal(w.top[0].title, 'Frieren');
  assert.equal(w.top[0].count, 7);
  assert.equal(w.binge.count, 5);
  assert.equal(w.binge.title, 'Frieren');
  assert.equal(w.longestStreak, 3);
  assert.equal(w.busiest.label, 'March');
  assert.equal(w.topGenres[0].genre, 'Fantasy');
  // Severance was started in 2025: not a discovery of 2026.
  assert.deepEqual(w.discoveries.map((d) => d.title).sort(), ['Dune', 'Frieren']);
  assert.deepEqual(w.finished.map((f) => f.title), ['Dune', 'Frieren']);
  assert.equal(w.bestRated[0].title, 'Frieren');
  assert.equal(w.first.title, 'Frieren');
  assert.equal(w.last.title, 'Dune');
  assert.equal(w.watcher, 'binger');
  assert.equal(w.buckets.length, 12);
  assert.equal(w.buckets[2].minutes, 7 * 24);
});

test('a month wrapped has one bar per day', () => {
  const w = simklWrap(events, items, meta, monthWrapRange(2026, 2));
  assert.equal(w.buckets.length, 31);
  assert.equal(w.buckets[0].minutes, 5 * 24);
  assert.equal(w.label ?? w.range.label, 'March 2026');
  assert.equal(w.titles, 1);
});

test('an empty range is all zeros, never a crash', () => {
  const w = simklWrap(events, items, meta, yearWrapRange(2019));
  assert.equal(w.minutes, 0);
  assert.equal(w.top.length, 0);
  assert.equal(w.busiest, null);
  assert.equal(w.binge, null);
  assert.equal(w.watcher, 'steady');
});

test('choices, quiz, rounding and words', () => {
  const c = wrapChoices(events, at(2026, 6, 15));
  assert.deepEqual(c.years, [2026, 2025]);
  assert.deepEqual(c.months.map((m) => m.month), [5, 3, 2, 11]);
  const top = simklWrap(events, items, meta, yearWrapRange(2026)).top;
  const q = topQuiz(top, 7);
  assert.equal(q.options.length, 3);
  assert.equal(q.answer, 1);
  assert.ok(q.options.some((o) => o.simklId === 1));
  assert.equal(topQuiz(top.slice(0, 2), 1), null);
  assert.equal(nextRound(0), 10);
  assert.equal(nextRound(100), 250);
  assert.equal(nextRound(25000), 30000);
  assert.equal(fmtMinutesLong(45), '45 min');
  assert.equal(fmtMinutesLong(600), '10 hours');
  assert.equal(fmtMinutesLong(60 * 24 * 4), '4.0 days');
});

test('the dashboard: this week by day, streak, what is left, milestones, recent days', () => {
  const now = at(2026, 2, 3, 23) + 3_600_000; // Tuesday 3 March 2026, past midnight? no: 00:00 on the 4th
  const d = simklDash(events, items, meta, at(2026, 2, 3, 23) + 60_000);
  assert.equal(d.weekDays.length, 7);
  assert.equal(d.weekDays.find((x) => x.today).label, 'Tue');
  assert.equal(d.today, 24);
  assert.equal(d.streak, 3);
  assert.equal(d.week, 2 * 24); // Monday 2nd and Tuesday 3rd (Sunday 1st was last week)
  assert.equal(d.lastWeek, 5 * 24);
  assert.equal(d.counts.completed, 2);
  assert.equal(d.counts.watching, 1);
  // Severance: 12 episodes left of 50 minutes (runtime from meta... the item says 24) -> uses the item's runtime first.
  assert.equal(d.leftMinutes, 12 * 24);
  assert.equal(d.milestones[0].label, 'episodes');
  assert.equal(d.milestones[0].at, 10);
  assert.equal(d.recent[0].titles[0].title, 'Frieren');
  assert.ok(now > 0);
});
