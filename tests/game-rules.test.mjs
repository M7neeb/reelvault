import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cupChampion, cupMatch, cupPick, cupPodium, cupSize, cupStage, cupUndo, newCup,
  orderRound, orderScore, quoteOf, saidRound, zoomPoints, zoomRound, zoomScale, ZOOM_FROM, ZOOM_MS,
} from '../src/features/vault/gameRules.ts';

/** The same "random" every run. */
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const ids = (n) => Array.from({ length: n }, (_, i) => `v${i}`);

test('cup size: the biggest bracket the pool fills', () => {
  assert.equal(cupSize(40), 16);
  assert.equal(cupSize(12), 8);
  assert.equal(cupSize(5), 4);
  assert.equal(cupSize(3), 0);
  assert.equal(cupSize(40, 8), 8);
});

test('a 16 cup: 15 matches to a champion, no one plays twice in a round, podium of four', () => {
  let cup = newCup(ids(30), 16, seeded());
  assert.equal(cup.round.length, 16);
  assert.equal(new Set(cup.round).size, 16);
  assert.deepEqual(cupStage(cup), { round: 'Round of 16', match: 1, matches: 8 });
  let matches = 0;
  const stages = new Set();
  while (cupMatch(cup)) {
    const [a, b] = cupMatch(cup);
    assert.notEqual(a, b);
    stages.add(cupStage(cup).round);
    // The lower number always wins, so the result is known.
    cup = cupPick(cup, Number(a.slice(1)) < Number(b.slice(1)) ? a : b);
    matches++;
  }
  assert.equal(matches, 15);
  assert.deepEqual([...stages], ['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final']);
  const champ = cupChampion(cup);
  assert.equal(champ, cup.played[0].reduce((m, x) => (Number(x.slice(1)) < Number(m.slice(1)) ? x : m)));
  const podium = cupPodium(cup);
  assert.equal(podium.length, 4);
  assert.equal(podium[0], champ);
  assert.equal(new Set(podium).size, 4);
});

test('a pick that is not in the match changes nothing; too small a pool gives no cup', () => {
  const cup = newCup(ids(4), 16, seeded());
  assert.equal(cup.round.length, 4);
  assert.deepEqual(cupPick(cup, 'nope'), cup);
  assert.equal(newCup(ids(3), 16), null);
  assert.equal(newCup(['a', 'a', 'b', 'c'], 16), null);
});

test('undo goes back one pick, also across the end of a round', () => {
  let cup = newCup(ids(4), 4, seeded());
  const start = cup;
  const [a] = cupMatch(cup);
  cup = cupPick(cup, a);
  assert.deepEqual(cupUndo(cup), start);
  const second = cup;
  const [c] = cupMatch(cup);
  cup = cupPick(cup, c);
  assert.equal(cup.round.length, 2);
  assert.deepEqual(cupUndo(cup), second);
  assert.deepEqual(cupUndo(start), start);
});

test('zoom: points fall with time, never below 1; the picture is whole at the end', () => {
  assert.equal(zoomPoints(0), 10);
  assert.equal(zoomPoints(ZOOM_MS / 2), 5);
  assert.equal(zoomPoints(ZOOM_MS * 3), 1);
  assert.equal(zoomScale(0), ZOOM_FROM);
  assert.equal(zoomScale(ZOOM_MS), 1);
  assert.ok(zoomScale(ZOOM_MS / 2) < ZOOM_FROM && zoomScale(ZOOM_MS / 2) > 1);
});

test('zoom round: four different names, the answer among them, focus away from the edges', () => {
  const r = zoomRound(['A', 'B', 'C', 'D', 'E', 'A'], seeded());
  assert.equal(new Set(r.options).size, 4);
  assert.ok(r.options.includes(r.answer));
  assert.ok(r.focus.x >= 0.25 && r.focus.x <= 0.75 && r.focus.y >= 0.25 && r.focus.y <= 0.75);
  assert.equal(zoomRound(['A', 'B', 'C', 'C']), null);
});

test('order round: one from each quarter, shown out of order, scored by place', () => {
  for (let seed = 1; seed < 40; seed++) {
    const r = orderRound(20, seeded(seed));
    assert.deepEqual([...r.truth].sort((a, b) => a - b), r.truth);
    r.truth.forEach((x, q) => assert.ok(x >= q * 5 && x < (q + 1) * 5));
    assert.notDeepEqual(r.shown, r.truth);
    assert.deepEqual([...r.shown].sort((a, b) => a - b), r.truth);
  }
  assert.deepEqual(orderRound(4, seeded()).truth, [0, 1, 2, 3]);
  assert.equal(orderRound(3), null);
  assert.equal(orderScore([1, 2, 3, 4], [1, 2, 3, 4]), 4);
  assert.equal(orderScore([2, 1, 3, 4], [1, 2, 3, 4]), 2);
});

test('quotes: real words only, long ones shortened at a word', () => {
  assert.equal(quoteOf('12:04'), null);
  assert.equal(quoteOf('TikTok @someone'), null);
  assert.equal(quoteOf('ok go'), null);
  assert.equal(quoteOf('  Merhab   challenging Ali bin Abi Talib? '), 'Merhab challenging Ali bin Abi Talib?');
  const long = quoteOf('word '.repeat(40));
  assert.ok(long.endsWith('…') && long.length <= 90);
});

test('who said that: the quote is only on the answer, four different videos', () => {
  const rows = [
    { videoId: 'a', atMs: 1000, words: 'The night the lights went out' },
    { videoId: 'b', atMs: 0, words: 'Subscribe for more videos today' },
    { videoId: 'c', atMs: 0, words: 'Subscribe for more videos today' },
    { videoId: 'd', atMs: 0, words: 'Chapter three begins right here' },
    { videoId: 'e', atMs: 0, words: '00:12' },
  ];
  for (let seed = 1; seed < 30; seed++) {
    const r = saidRound(rows, seeded(seed));
    assert.notEqual(r.quote, 'Subscribe for more videos today');
    assert.ok(['a', 'd'].includes(r.answer));
    assert.equal(new Set(r.options).size, 4);
    assert.ok(r.options.includes(r.answer));
  }
  assert.equal(saidRound(rows.slice(0, 2)), null);
});
