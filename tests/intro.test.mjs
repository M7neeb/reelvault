import assert from 'node:assert/strict';
import { test } from 'node:test';

import { atStart, formatIntro, introOf, openingSeconds, parseIntro, partners, sharedRun } from '../src/features/vault/intro.ts';

const mix = (n, k) => {
  const h = (x) => ((Math.imul(x ^ k, 2654435761) >>> 0) ^ (x * 40503)) >>> 0;
  return h(n).toString(16).padStart(8, '0') + h(n + 7777).toString(16).padStart(8, '0');
};
const intro = (n) => mix(n, 11);
const own = (seed) => (n) => mix(n, seed);
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test('an intro right at the start of two episodes is found', () => {
  const a = [...range(20, intro), ...range(60, own(1))];
  const b = [...range(20, intro), ...range(60, own(2))];
  const secs = openingSeconds(200_000);
  const x = introOf(a, [b], secs);
  assert.deepEqual(x, { startSec: 0, endSec: 20 });
  assert.ok(atStart(x));
});

test('after a cold open of a different length in each episode', () => {
  const a = [...range(30, own(3)), ...range(25, intro), ...range(40, own(4))];
  const b = [...range(12, own(5)), ...range(25, intro), ...range(40, own(6))];
  const r = sharedRun(a, b);
  assert.deepEqual(r, { a: 30, b: 12, len: 25 });
  const x = introOf(a, [b], openingSeconds(300_000));
  assert.deepEqual(x, { startSec: 30, endSec: 55 });
  assert.equal(atStart(x), false);
});

test('an unreadable frame inside the intro is let through; black frames and short logos are not an intro', () => {
  const a = [...range(20, intro), ...range(30, own(7))];
  const b = [...range(20, (i) => (i === 9 ? '' : intro(i))), ...range(30, own(8))];
  assert.equal(sharedRun(a, b).len, 20);
  const black = '0000000000000000';
  assert.equal(sharedRun([...range(20, () => black), ...range(10, own(1))], [...range(20, () => black), ...range(10, own(2))]), null);
  assert.equal(sharedRun([...range(4, intro), ...range(30, own(1))], [...range(4, intro), ...range(30, own(2))]), null);
  assert.equal(introOf(range(30, own(1)), [range(30, own(2))], openingSeconds(100_000)), null);
  assert.equal(introOf([], [], []), null);
});

test('the longest match among the neighbours wins', () => {
  const a = [...range(15, intro), ...range(40, own(1))];
  const short = [...range(8, intro), ...range(47, own(2))];
  const full = [...range(15, intro), ...range(40, own(3))];
  assert.equal(introOf(a, [short, full], openingSeconds(100_000)).endSec, 15);
});

test('seconds, neighbours and saving', () => {
  assert.deepEqual(openingSeconds(5000), []);
  assert.equal(openingSeconds(60_000).length, 59);
  assert.equal(openingSeconds(20 * 60_000).length, 150);
  assert.deepEqual(partners(['a', 'b', 'c', 'd'], 1), ['c', 'a', 'd']);
  assert.deepEqual(parseIntro(formatIntro({ startSec: 2.5, endSec: 40 })), { startSec: 2.5, endSec: 40 });
  assert.equal(parseIntro('0'), null);
  assert.equal(parseIntro(null), null);
  assert.equal(parseIntro('5,5'), null);
});
