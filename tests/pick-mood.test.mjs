import assert from 'node:assert/strict';
import { test } from 'node:test';

import { candidates, MOODS } from '../src/features/simkl/pick.ts';

const item = (id, over = {}) => ({
  simklId: id, type: 'movie', title: `Film ${id}`, year: 2020, poster: null, slug: null, runtime: 100, status: 'plantowatch',
  rating: null, ratedAt: null, addedAt: null, lastWatchedAt: null, watchedEpisodes: 0, totalEpisodes: 0, notAiredEpisodes: 0,
  nextToWatch: null, animeType: null, memo: null, nextTitle: null, nextDate: null, simklRating: null, simklVotes: null,
  imdbRating: null, imdbVotes: null, malRating: null, rank: null, ...over,
});
const items = [item(1), item(2), item(3, { imdbRating: 8.1 }), item(4, { simklRating: 7.6 })];
const genres = new Map([[1, ['Comedy', 'Romance']], [2, ['Horror']], [3, ['Action', 'Science Fiction']], [4, ['Drama']]]);
const base = { type: 'movie', from: 'plan', maxMinutes: null };

test('a mood keeps titles with a matching genre', () => {
  const ids = (mood) => candidates(items, { ...base, mood, genres }).map((i) => i.simklId);
  assert.deepEqual(ids('light'), [1]);
  assert.deepEqual(ids('dark'), [2]);
  assert.deepEqual(ids('thrill'), [3]);
  assert.deepEqual(ids('moving'), [1, 4]);
  assert.deepEqual(ids('any'), [1, 2, 3, 4]);
  assert.ok(MOODS.every((m) => typeof m.label === 'string'));
});

test('titles with no known genres are left out of a mood, not of Anything', () => {
  const fewer = new Map([[1, ['Comedy']]]);
  assert.deepEqual(candidates(items, { ...base, mood: 'light', genres: fewer }).map((i) => i.simklId), [1]);
  assert.equal(candidates(items, { ...base, mood: 'any' }).length, 4);
});

test('"well rated" keeps 7.5 and up from IMDb or Simkl', () => {
  assert.deepEqual(candidates(items, { ...base, wellRated: true }).map((i) => i.simklId), [3, 4]);
});
