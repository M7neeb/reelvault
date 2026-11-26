import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyGames, episodeRound, higherLowerPair, parseGames, recordGame, showRound } from '../src/features/vault/games.ts';

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

test('an episode round asks about one series, with the answer among up to four of its episodes', () => {
  const series = [
    { name: 'Berries', episodes: ['b1', 'b2', 'b3', 'b4', 'b5'] },
    { name: 'Tiny', episodes: ['t1'] },
  ];
  for (let i = 1; i < 20; i++) {
    const r = episodeRound(series, seeded(i));
    assert.equal(r.series, 'Berries');
    assert.equal(r.options.length, 4);
    assert.equal(new Set(r.options).size, 4);
    assert.ok(r.options.includes(r.answer));
  }
  assert.equal(episodeRound([{ name: 'Tiny', episodes: ['t1'] }], seeded()), null);
});

test('higher or lower never pairs two equal ratings, and skips unrated', () => {
  const items = [{ id: 'a', rating: 7 }, { id: 'b', rating: 7 }, { id: 'c', rating: 9 }, { id: 'd', rating: 0 }];
  for (let i = 1; i < 20; i++) {
    const [x, y] = higherLowerPair(items, seeded(i));
    assert.notEqual(x.rating, y.rating);
    assert.ok(x.rating > 0 && y.rating > 0);
  }
  assert.equal(higherLowerPair([{ id: 'a', rating: 5 }, { id: 'b', rating: 5 }], seeded()), null);
});

test('a show round needs four titles with posters', () => {
  const titles = Array.from({ length: 6 }, (_, i) => ({ simklId: i, title: `T${i}`, poster: i === 5 ? null : `p${i}` }));
  const r = showRound(titles, seeded(3));
  assert.equal(r.options.length, 4);
  assert.ok(r.options.includes(r.answer));
  assert.ok(titles.find((t) => t.simklId === r.answer).poster);
  assert.equal(showRound(titles.slice(0, 3), seeded()), null);
});

test('best scores and the daily streak', () => {
  const day = (d) => new Date(2026, 10, d, 12).getTime();
  let g = emptyGames();
  g = recordGame(g, 'higher', 5, day(20));
  assert.equal(g.best.higher, 5);
  assert.equal(g.streak, 1);
  g = recordGame(g, 'episode', 3, day(20));
  assert.equal(g.streak, 1, 'twice the same day is still one');
  g = recordGame(g, 'higher', 2, day(21));
  assert.equal(g.best.higher, 5, 'a lower score keeps the best');
  assert.equal(g.streak, 2);
  g = recordGame(g, 'show', 1, day(23));
  assert.equal(g.streak, 1, 'a missed day starts again');
  assert.deepEqual(parseGames(JSON.stringify(g)), g);
  assert.deepEqual(parseGames('nope'), emptyGames());
});
