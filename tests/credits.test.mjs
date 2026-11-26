import assert from 'node:assert/strict';
import { test } from 'node:test';

import { endFractions, nextInSeries, sharedEnding } from '../src/features/vault/sceneLogic.ts';

// 16-hex-digit picture prints: equal strings = same picture, flipped digits = different.
const mix = (n, k) => {
  const h = (x) => ((Math.imul(x ^ k, 2654435761) >>> 0) ^ (x * 40503)) >>> 0;
  return h(n).toString(16).padStart(8, '0') + h(n + 7777).toString(16).padStart(8, '0');
};
const pic = (n) => mix(n, 11);
const other = (n) => mix(n, 99991);

test('the ending two episodes share is found from the end backwards', () => {
  // 60 frames, 2 s apart. The last 10 frames are the same outro in both.
  const a = [...Array.from({ length: 50 }, (_, i) => other(i)), ...Array.from({ length: 10 }, (_, i) => pic(1000 + i))];
  const b = [...Array.from({ length: 50 }, (_, i) => other(i + 500)), ...Array.from({ length: 10 }, (_, i) => pic(1000 + i))];
  assert.equal(sharedEnding(a, b, 2), 20);
});

test('one unreadable frame inside the outro does not cut it short; too short is no ending', () => {
  const tail = Array.from({ length: 10 }, (_, i) => pic(2000 + i));
  const a = [...Array.from({ length: 20 }, (_, i) => other(i)), ...tail];
  const b = [...Array.from({ length: 20 }, (_, i) => other(i + 99)), ...tail.map((t, i) => (i === 4 ? '' : t))];
  assert.equal(sharedEnding(a, b, 2), 20);
  const short = [...Array.from({ length: 28 }, (_, i) => other(i)), pic(1), pic(2)];
  const short2 = [...Array.from({ length: 28 }, (_, i) => other(i + 300)), pic(1), pic(2)];
  assert.equal(sharedEnding(short, short2, 2), 0);
  assert.equal(sharedEnding([], [], 2), 0);
});

test('fractions for the last two minutes, and short videos', () => {
  const f = endFractions(600_000, 120, 2);
  assert.equal(f.length, 59);
  assert.ok(Math.abs(f[0] - 482 / 600) < 1e-9);
  assert.ok(f.at(-1) < 1);
  assert.ok(endFractions(60_000, 120, 2).every((x) => x > 0 && x < 1));
  assert.deepEqual(endFractions(null, 120, 2), []);
});

test('the next episode in a series follows the series order', () => {
  const members = [
    { videoId: 'e2', seriesId: 's', position: 2, label: null },
    { videoId: 'e1', seriesId: 's', position: 1, label: null },
    { videoId: 'e3', seriesId: 's', position: 3, label: null },
    { videoId: 'x', seriesId: 't', position: 1, label: null },
  ];
  assert.equal(nextInSeries(members, 'e1'), 'e2');
  assert.equal(nextInSeries(members, 'e2'), 'e3');
  assert.equal(nextInSeries(members, 'e3'), null);
  assert.equal(nextInSeries(members, 'nope'), null);
});
