// Run with `npm test`. Ratings for single episodes (IMDb through OMDb, TVmaze).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  combineRatings,
  fmtEpisodeRating,
  matchRatings,
  omdbKeyProblem,
  omdbSeasons,
  parseOmdbSeason,
  parseTvmazeEpisodes,
} from '../src/features/simkl/episodeRatings.ts';

const ep = (season, episode, special = false) => ({ season, episode, title: null, aired: true, date: null, img: null, special });

test('OMDb seasons: ratings kept, "N/A" skipped; bad keys and season counts read', () => {
  const json = {
    Response: 'True',
    Season: '1',
    Episodes: [
      { Title: 'Pilot', Episode: '1', imdbRating: '9.0' },
      { Title: 'Two', Episode: '2', imdbRating: 'N/A' },
      { Title: 'Three', Episode: '3', imdbRating: '8.75' },
    ],
  };
  assert.deepEqual(parseOmdbSeason(json, 1), [
    { season: 1, episode: 1, rating: 9, date: null },
    { season: 1, episode: 2, rating: null, date: null },
    { season: 1, episode: 3, rating: 8.8, date: null },
  ]);
  assert.deepEqual(parseOmdbSeason({ Response: 'False', Error: 'Series or season not found!' }, 2), []);
  assert.equal(omdbSeasons({ Response: 'True', totalSeasons: '5' }), 5);
  assert.equal(omdbSeasons({ Response: 'True', totalSeasons: 'N/A' }), 0);
  assert.equal(omdbKeyProblem({ Response: 'False', Error: 'Invalid API key!' }), 'Invalid API key!');
  assert.equal(omdbKeyProblem({ Response: 'False', Error: 'Incorrect IMDb ID.' }), null);
});

test('TVmaze episodes: numbered ones kept (unrated too), specials left out', () => {
  const json = [
    { season: 1, number: 1, rating: { average: 8.3 }, type: 'regular', airdate: '2008-01-20' },
    { season: 1, number: 2, rating: { average: null }, type: 'regular' },
    { season: 1, number: null, rating: { average: 7 }, type: 'significant_special' },
  ];
  assert.deepEqual(parseTvmazeEpisodes(json), [
    { season: 1, episode: 1, rating: 8.3, date: '2008-01-20' },
    { season: 1, episode: 2, rating: null, date: null },
  ]);
  assert.deepEqual(parseTvmazeEpisodes(null), []);
});

test('shows match by season and episode; IMDb wins, TVmaze fills the gaps', () => {
  const eps = [ep(1, 1), ep(1, 2), ep(2, 1), ep(0, 1, true)];
  const imdb = [{ season: 1, episode: 1, rating: 9 }];
  const tv = [
    { season: 1, episode: 1, rating: 8.3 },
    { season: 1, episode: 2, rating: 7.9 },
    { season: 0, episode: 1, rating: 6 },
  ];
  assert.deepEqual(combineRatings(eps, 'show', imdb, tv), {
    '1:1': { rating: 9, source: 'imdb' },
    '1:2': { rating: 7.9, source: 'tvmaze' },
  });
});

test('anime without dates: the nth episode is the nth, only when both lists are the same length', () => {
  const eps = [ep(1, 1), ep(1, 2), ep(1, 3), ep(1, 4)];
  const split = [
    { season: 2, episode: 1, rating: 8.5 },
    { season: 1, episode: 2, rating: 8.1 },
    { season: 1, episode: 1, rating: 8 },
    { season: 2, episode: 2, rating: 9.2 },
  ];
  assert.deepEqual(matchRatings(eps, split, 'anime'), { '1:1': 8, '1:2': 8.1, '1:3': 8.5, '1:4': 9.2 });
  // No dates and a different number of episodes: could be another season's title, so nothing.
  assert.deepEqual(matchRatings(eps, [{ season: 1, episode: 3, rating: 7 }], 'anime'), {});
  // An unrated episode keeps its place, so the rest stay right.
  const unrated = split.map((x) => (x.season === 1 && x.episode === 2 ? { ...x, rating: null } : x));
  assert.deepEqual(matchRatings(eps, unrated, 'anime'), { '1:1': 8, '1:3': 8.5, '1:4': 9.2 });
  // One fewer in the source: they could be shifted, so nothing.
  const gap = split.filter((x) => !(x.season === 2 && x.episode === 1));
  assert.deepEqual(combineRatings(eps, 'anime', gap, []), {});
});

test('anime: a Simkl "Season 2" title finds its episodes by air date', () => {
  const dated = (episode, date) => ({ ...ep(1, episode), date });
  // Simkl: its own title, episodes 1 and 2 (Japan time, a day after TVmaze's date).
  const s2 = [dated(1, '2017-04-02T00:00:00+09:00'), dated(2, '2017-04-09T00:00:00+09:00')];
  const whole = [
    { season: 1, episode: 1, rating: 8, date: '2013-04-07' },
    { season: 1, episode: 2, rating: 8.1, date: '2013-04-14' },
    { season: 2, episode: 1, rating: 9.1, date: '2017-04-01' },
    { season: 2, episode: 2, rating: 8.7, date: '2017-04-08' },
  ];
  assert.deepEqual(matchRatings(s2, whole, 'anime'), { '1:1': 9.1, '1:2': 8.7 });
  // Two on the same day in both lists go in order.
  const double = [dated(1, '2020-01-05'), dated(2, '2020-01-05')];
  const src = [
    { season: 1, episode: 1, rating: 7, date: '2020-01-05' },
    { season: 1, episode: 2, rating: 7.5, date: '2020-01-05' },
  ];
  assert.deepEqual(matchRatings(double, src, 'anime'), { '1:1': 7, '1:2': 7.5 });
});

test('ratings read like IMDb: one decimal', () => {
  assert.equal(fmtEpisodeRating(9), '9.0');
  assert.equal(fmtEpisodeRating(8.25), '8.3');
});
