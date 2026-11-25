import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  confidence,
  emptyRank,
  nextPair,
  parseRank,
  ranked,
  recordPick,
  scoreOf,
  skipPair,
  suggestRatings,
} from '../src/features/vault/rank.ts';

/** A tiny seeded random, so pairs are the same on every run. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const items = (ratings) => ratings.map((rating, i) => ({ id: `v${i}`, rating }));

test('fewer than two items gives no pair, and bad saved data starts fresh', () => {
  assert.equal(nextPair(emptyRank(), [], seeded()), null);
  assert.equal(nextPair(emptyRank(), items([7]), seeded()), null);
  assert.deepEqual(parseRank('not json'), emptyRank());
  assert.deepEqual(parseRank(null), emptyRank());
  assert.deepEqual(parseRank(JSON.stringify({ v: 1, scores: { a: { s: 'x', n: 1 } }, recent: [], picks: 0 })).scores, {});
});

test('a rated item starts where its rating puts it, unrated in the middle', () => {
  const st = emptyRank();
  assert.ok(scoreOf(st, { id: 'a', rating: 9 }) > scoreOf(st, { id: 'b', rating: null }));
  assert.ok(scoreOf(st, { id: 'b', rating: null }) > scoreOf(st, { id: 'c', rating: 2 }));
});

test('the winner moves up, a tie pulls them together, and nothing is changed in place', () => {
  const a = { id: 'a', rating: 5 };
  const b = { id: 'b', rating: 5 };
  const st = emptyRank();
  const after = recordPick(st, a, b, 'a');
  assert.deepEqual(st, emptyRank());
  assert.ok(after.scores.a.s > after.scores.b.s);
  assert.equal(after.scores.a.n, 1);
  assert.equal(after.picks, 1);
  const tie = recordPick(recordPick(after, a, b, 'a'), a, b, 'tie');
  const gapBefore = recordPick(after, a, b, 'a');
  assert.ok(tie.scores.a.s - tie.scores.b.s < gapBefore.scores.a.s - gapBefore.scores.b.s);
});

test('pairs never repeat while other pairs are left', () => {
  const list = items([null, null, null, null, null]);
  let st = emptyRank();
  const rng = seeded(7);
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const pair = nextPair(st, list, rng);
    assert.ok(pair);
    const key = [pair[0].id, pair[1].id].sort().join('|');
    assert.ok(!seen.has(key), `pair ${key} came twice`);
    seen.add(key);
    st = recordPick(st, pair[0], pair[1], 'a');
  }
  // All 10 pairs of 5 are used up: it still offers something rather than stopping.
  assert.ok(nextPair(st, list, rng));
});

test('new items get asked about first', () => {
  const list = items([5, 5, 5, 5]);
  let st = emptyRank();
  for (let i = 0; i < 6; i++) st = recordPick(st, list[0], list[1], i % 2 ? 'a' : 'b');
  const pair = nextPair(st, list, seeded(3));
  assert.ok(pair.some((x) => x.id === 'v2' || x.id === 'v3'));
});

test('ranked lists rated and compared items by score, leaving untouched unrated ones out', () => {
  const list = [
    { id: 'low', rating: 3 },
    { id: 'high', rating: 9 },
    { id: 'new', rating: null },
    { id: 'beaten', rating: null },
  ];
  let st = recordPick(emptyRank(), list[2], list[3], 'a');
  const ids = ranked(st, list).map((x) => x.id);
  assert.equal(ids[0], 'high');
  assert.equal(ids.at(-1), 'low');
  assert.ok(ids.indexOf('new') < ids.indexOf('beaten'));
  st = emptyRank();
  assert.deepEqual(ranked(st, list).map((x) => x.id), ['high', 'low']);
});

test('suggestions follow your own spread of ratings and keep whole numbers', () => {
  // Ratings 9, 8, 7, 6, 5. v4 (rated 5) keeps beating everyone: it should be suggested near the top.
  const list = items([9, 8, 7, 6, 5]);
  let st = emptyRank();
  for (let round = 0; round < 3; round++) for (let i = 0; i < 4; i++) st = recordPick(st, list[4], list[i], 'a');
  const out = suggestRatings(st, list);
  const v4 = out.find((x) => x.id === 'v4');
  assert.ok(v4, 'the climber gets a suggestion');
  assert.equal(v4.from, 5);
  assert.ok(v4.to >= 8);
  assert.ok(out.every((x) => Number.isInteger(x.to)));
  assert.ok(out.every((x) => x.to >= 1 && x.to <= 10));
});

test('no suggestion from a single pick, and small moves are ignored', () => {
  const list = items([8, 8, 8, 8]);
  const st = recordPick(emptyRank(), list[0], list[1], 'a');
  assert.deepEqual(suggestRatings(st, list), []);
});

test('decimals are kept for someone who rates with decimals', () => {
  const list = items([9.4, 8.2, 7.5, 6.1, 5.3]);
  let st = emptyRank();
  for (let round = 0; round < 3; round++) for (let i = 0; i < 4; i++) st = recordPick(st, list[4], list[i], 'a');
  const v4 = suggestRatings(st, list).find((x) => x.id === 'v4');
  assert.ok(v4);
  assert.equal(Math.round(v4.to * 10), v4.to * 10);
  assert.ok(v4.to > 5.3);
});

test('with nothing rated yet, compared items still get a spread of ratings', () => {
  const list = items([null, null, null, null]);
  let st = emptyRank();
  for (let r = 0; r < 3; r++) {
    st = recordPick(st, list[0], list[1], 'a');
    st = recordPick(st, list[0], list[2], 'a');
    st = recordPick(st, list[1], list[3], 'a');
    st = recordPick(st, list[2], list[3], 'a');
  }
  const out = suggestRatings(st, list);
  const by = Object.fromEntries(out.map((x) => [x.id, x.to]));
  assert.equal(out.length, 4);
  assert.ok(by.v0 > by.v3);
  assert.ok(out.every((x) => x.from === null));
});

test('confidence counts items compared at least three times', () => {
  const list = items([5, 5, 5, 5]);
  let st = emptyRank();
  for (let i = 0; i < 3; i++) st = recordPick(st, list[0], list[1], 'a');
  assert.equal(confidence(st, list), 0.5);
  assert.equal(confidence(emptyRank(), []), 0);
});

test('a saved state survives a round trip', () => {
  const list = items([5, 6]);
  const st = recordPick(emptyRank(), list[0], list[1], 'b');
  assert.deepEqual(parseRank(JSON.stringify(st)), st);
});

test('a skipped pair changes no score and is not offered straight away', () => {
  const list = items([5, 5, 5]);
  const st = skipPair(emptyRank(), list[0], list[1]);
  assert.deepEqual(st.scores, {});
  assert.equal(st.picks, 0);
  for (let i = 0; i < 20; i++) {
    const pair = nextPair(st, list, seeded(i + 1));
    assert.notEqual([pair[0].id, pair[1].id].sort().join('|'), 'v0|v1');
  }
});
