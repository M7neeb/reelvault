// Run with `npm test`. The Videos tab's Overview: titles, series, kept videos, sorting, series suggestions.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildOverview,
  continueSeries,
  episodeOrder,
  filterCounts,
  guessSeriesName,
  isWatched,
  matchesQuery,
  moveEpisode,
  overviewStats,
  playable,
  seriesBase,
  sortEntries,
  suggestSeries,
  topRated,
} from '../src/features/vault/overview.ts';

const MIN = 60_000;
const vid = (id, over = {}) => ({
  id,
  title: null,
  filename: `${id}.mp4`,
  durationMs: 10 * MIN,
  sizeBytes: 1000,
  rating: 0,
  status: null,
  notes: null,
  tagNames: [],
  thumb: `thumb-${id}`,
  createdAt: 1,
  importedAt: 100,
  where: 'library',
  removedAt: null,
  isPrivate: false,
  ...over,
});
const play = (videoId, startedAt, watchedMs) => ({ videoId, startedAt, watchedMs });

test('watched only when you mark it: playing it, however much, never does', () => {
  assert.equal(isWatched(vid('a'), 4 * MIN, 1), false);
  assert.equal(isWatched(vid('a'), 30 * MIN, 5), false);
  assert.equal(isWatched(vid('a', { durationMs: null }), 5000, 1), false);
  assert.equal(isWatched(vid('a', { status: 'completed' }), 0, 0), true);
});

test('videos in a series become one title; the rest stay single', () => {
  const videos = [vid('e1', { rating: 8, status: 'completed' }), vid('e2', { rating: 6 }), vid('e3'), vid('solo', { title: 'Solo clip', rating: 9 })];
  const series = [{ id: 's', name: 'My Show', description: null, cover: null, rating: 7, status: null, createdAt: 50, updatedAt: 50 }];
  const members = [
    { videoId: 'e2', seriesId: 's', position: 2, label: null },
    { videoId: 'e1', seriesId: 's', position: 1, label: 'Pilot' },
    { videoId: 'e3', seriesId: 's', position: 3, label: null },
  ];
  const plays = [play('e1', 1000, 10 * MIN), play('e2', 2000, 3 * MIN)];
  const out = buildOverview(videos, series, members, plays);
  assert.equal(out.length, 2);
  const show = out.find((e) => e.kind === 'series');
  assert.deepEqual(
    show.episodes.map((e) => [e.number, e.name]),
    [
      [1, 'Pilot'],
      [2, 'e2'],
      [3, 'e3'],
    ]
  );
  assert.equal(show.rating, 7);
  assert.equal(show.episodeAvg, 7);
  assert.equal(show.status, 'watching');
  assert.equal(show.statusSet, false);
  assert.equal(show.watchedCount, 1);
  assert.equal(show.next.video.id, 'e2');
  assert.equal(show.cover, 'thumb-e1');
  assert.equal(show.lastWatchedAt, 2000);
  const solo = out.find((e) => e.kind === 'single');
  assert.equal(solo.title, 'Solo clip');
  assert.equal(solo.status, 'plantowatch');
});

test('kept videos stay with their rating; private ones are hidden', () => {
  const out = buildOverview([vid('gone', { where: 'kept', rating: 4, removedAt: 5 }), vid('secret', { isPrivate: true })], [], [], []);
  assert.equal(out.length, 1);
  assert.equal(out[0].gone, true);
  assert.equal(out[0].rating, 4);
  assert.equal(buildOverview([vid('secret', { isPrivate: true })], [], [], [], { includePrivate: true }).length, 1);
});

test('filters, search, stats', () => {
  const videos = [vid('a', { rating: 9, tagNames: ['Funny'], status: 'completed' }), vid('b', { status: 'dropped' }), vid('c', { where: 'kept' })];
  const out = buildOverview(videos, [], [], [play('a', 10, 10 * MIN)]);
  const c = filterCounts(out);
  assert.equal(c.all, 3);
  assert.equal(c.completed, 1);
  assert.equal(c.dropped, 1);
  assert.equal(c.unrated, 2);
  assert.equal(c.removed, 1);
  assert.equal(out.filter((e) => matchesQuery(e, 'funny')).length, 1);
  const s = overviewStats(out);
  assert.equal(s.rated, 1);
  assert.equal(s.avgRating, 9);
  assert.equal(s.watchedMs, 10 * MIN);
  assert.equal(s.removed, 1);
});

test('sorting and shelves', () => {
  const out = buildOverview(
    [vid('a', { rating: 5, title: 'Part 10' }), vid('b', { rating: 8, title: 'Part 2' }), vid('c', { title: 'Part 3' })],
    [],
    [],
    [play('c', 99, MIN)]
  );
  assert.deepEqual(sortEntries(out, 'name').map((e) => e.title), ['Part 2', 'Part 3', 'Part 10']);
  assert.deepEqual(sortEntries(out, 'rating').map((e) => e.id), ['b', 'a', 'c']);
  assert.equal(sortEntries(out, 'recent')[0].id, 'c');
  assert.deepEqual(topRated(out).map((e) => e.id), ['b', 'a']);
});

test('continue shows series you are in the middle of', () => {
  const series = [{ id: 's', name: 'S', description: null, cover: null, rating: 0, status: null, createdAt: 1, updatedAt: 1 }];
  const members = [
    { videoId: 'x', seriesId: 's', position: 1, label: null },
    { videoId: 'y', seriesId: 's', position: 2, label: null },
  ];
  const out = buildOverview([vid('x', { status: 'completed' }), vid('y')], series, members, [play('x', 5, 10 * MIN)]);
  assert.equal(continueSeries(out).length, 1);
  assert.equal(continueSeries(out)[0].next.video.id, 'y');
});

test('series names and suggestions', () => {
  assert.equal(seriesBase('Lecture 03.mp4'), 'lecture');
  assert.equal(seriesBase('My_Show_S01E04'), 'my show');
  assert.equal(seriesBase('Trip part 2'), 'trip');
  assert.equal(guessSeriesName(['Cooking class 1.mp4', 'Cooking class 2.mp4']), 'Cooking class');
  assert.equal(guessSeriesName(['Show - Ep 1', 'Show - Ep 12']), 'Show');
  assert.equal(guessSeriesName(['lecture_part1.mp4', 'lecture_part2.mp4']), 'Lecture');
  assert.deepEqual(
    episodeOrder([vid('b', { title: 'Ep 10' }), vid('a', { title: 'Ep 2' })]).map((v) => v.id),
    ['a', 'b']
  );
  const sug = suggestSeries([vid('1', { title: 'Lecture 1' }), vid('2', { title: 'Lecture 2' }), vid('3', { title: 'Holiday' }), vid('4', { title: 'Holiday' })], []);
  assert.equal(sug.length, 1);
  assert.equal(sug[0].name, 'Lecture');
  assert.deepEqual(sug[0].videoIds, ['1', '2']);
  assert.equal(suggestSeries([vid('1', { title: 'Lecture 1' }), vid('2', { title: 'Lecture 2' })], [{ videoId: '1', seriesId: 's', position: 1, label: null }]).length, 0);
});

test('play skips removed episodes', () => {
  const series = [{ id: 's', name: 'S', description: null, cover: null, rating: 0, status: null, createdAt: 1, updatedAt: 1 }];
  const members = ['a', 'b', 'c'].map((id, i) => ({ videoId: id, seriesId: 's', position: i + 1, label: null }));
  const out = buildOverview([vid('a', { status: 'completed' }), vid('b', { where: 'kept' }), vid('c')], series, members, [play('a', 1, 10 * MIN)]);
  assert.equal(out[0].next.video.id, 'b');
  assert.equal(playable(out[0]).video.id, 'c');
});

test('moving an episode', () => {
  assert.deepEqual(moveEpisode(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveEpisode(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
});

test('backups carry series and removed videos; old backups still read', async () => {
  const { parseBackup, seriesEpisodes } = await import('../src/features/vault/backupFormat.ts');
  const old = parseBackup('{"kind":"reelvault-library-info","videos":[]}');
  assert.deepEqual(old.kept, []);
  assert.deepEqual(old.series, []);
  const b = parseBackup(
    JSON.stringify({
      kind: 'reelvault-library-info',
      videos: [{ filename: 'a.mp4', size: 1 }, { filename: 'b.mp4', size: 2 }],
      kept: [{ id: 'gone-1', filename: 'c.mp4', size: 3, rating: 6 }],
      series: [{ name: 'Show', rating: 8, episodes: [{ video: 1, label: 'Pilot' }, { kept: 'gone-1' }, { video: 0 }, { kept: 'unknown' }] }],
    })
  );
  const plan = seriesEpisodes(b, new Map([[1, 'lib-b']]));
  assert.deepEqual(plan[0].episodes, [
    { videoId: 'lib-b', label: 'Pilot' },
    { videoId: 'gone-1', label: null },
  ]);
});

test('overview insights: statuses, ratings, spotlight and planned', async () => {
  const { overviewInsights } = await import('../src/features/vault/overview.ts');
  const e = (over) => ({ key: over.id, kind: 'single', id: over.id, title: over.id, description: null, cover: 1, rating: 0, episodeAvg: null, status: 'completed', statusSet: true, episodes: [], watchedCount: 0, plays: 0, watchedMs: 0, totalMs: 0, lastWatchedAt: null, addedAt: 0, tags: [], gone: false, next: null, ...over });
  const list = [e({ id: 'a', rating: 9 }), e({ id: 'b', rating: 7.6, status: 'plantowatch', addedAt: 5 }), e({ id: 'c', status: 'watching', next: {}, lastWatchedAt: 10 }), e({ id: 'd', gone: true, rating: 3 })];
  const o = overviewInsights(list);
  assert.equal(o.statuses.find((s) => s.key === 'completed').count, 1);
  assert.equal(o.ratings[8].count, 1);
  assert.equal(o.ratings[7].count, 1);
  assert.equal(o.ratings[2].count, 1);
  assert.equal(o.spotlight.id, 'c');
  assert.deepEqual(o.planned.map((x) => x.id), ['b']);
  assert.equal(o.ratedShare, 0.75);
});
