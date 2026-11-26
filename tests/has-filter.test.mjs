import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasThing, matchesRule, setHasInfo } from '../src/features/vault/ui/logic.ts';

const v = (id, extra = {}) => ({ id, filename: `${id}.mp4`, rating: 0, tagNames: [], status: null, title: null, notes: null, albumIds: [], customCover: false, meta: null, ...extra });
const vids = [
  v('a', { rating: 7, customCover: true, title: 'Berries 1', tagNames: ['fun'] }),
  v('b', { albumIds: [3], notes: 'good one', meta: { location: { lat: 1, lng: 2 } } }),
  v('c'),
];
const watch = new Map([['b', { plays: 2, lastAt: 1 }]]);
setHasInfo({ series: new Set(['a']), simkl: new Set(['b']), onScreen: new Set(['a', 'c']), resume: new Set(['c']) });
const ids = (rule) => vids.filter((x) => matchesRule(x, rule, watch)).map((x) => x.id);

test('has and has not, one thing at a time', () => {
  assert.deepEqual(ids({ has: { cover: true } }), ['a']);
  assert.deepEqual(ids({ has: { cover: false } }), ['b', 'c']);
  assert.deepEqual(ids({ has: { rating: false } }), ['b', 'c']);
  assert.deepEqual(ids({ has: { keywords: true } }), ['a']);
  assert.deepEqual(ids({ has: { album: true } }), ['b']);
  assert.deepEqual(ids({ has: { title: false } }), ['b', 'c']);
  assert.deepEqual(ids({ has: { notes: true } }), ['b']);
  assert.deepEqual(ids({ has: { series: false } }), ['b', 'c']);
  assert.deepEqual(ids({ has: { simkl: true } }), ['b']);
  assert.deepEqual(ids({ has: { watched: false } }), ['a', 'c']);
  assert.deepEqual(ids({ has: { onScreen: true } }), ['a', 'c']);
  assert.deepEqual(ids({ has: { location: true } }), ['b']);
  assert.deepEqual(ids({ has: { resume: true } }), ['c']);
});

test('several together must all hold; undefined means either', () => {
  assert.deepEqual(ids({ has: { rating: false, cover: false, watched: false } }), ['c']);
  assert.deepEqual(ids({ has: { rating: undefined } }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ has: {} }), ['a', 'b', 'c']);
  // Mixed with the other rules.
  assert.deepEqual(ids({ has: { title: true }, minRating: 5 }), ['a']);
  assert.equal(hasThing(v('z', { title: '   ' }), 'title'), false);
});

test('a saved filter keeps its has rules and describes them; junk is dropped', async () => {
  const { parseRule, describeRule, ruleIsEmpty } = await import('../src/features/vault/ui/logic.ts');
  const back = parseRule(JSON.stringify({ has: { cover: false, rating: true, nope: true, title: 'x' } }));
  assert.deepEqual(back, { has: { cover: false, rating: true } });
  assert.equal(describeRule(back), 'no own cover · with rating');
  assert.equal(ruleIsEmpty({ has: { rating: false } }), false);
  assert.equal(ruleIsEmpty({ has: {} }), true);
});
