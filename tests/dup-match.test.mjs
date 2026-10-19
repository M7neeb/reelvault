// Run with `npm test`. "Already in your library": which files count as the same video, and the sticky answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baseName, findLikely, likelySame, stickyAsker } from '../src/features/vault/dupMatch.ts';

const v = (name, durationMs, size, width = 1920, height = 1080) => ({ name, durationMs, size, width, height });

test('names compare without folders, extension, copy numbers and case', () => {
  assert.equal(baseName('IMG_4471.MOV'), 'img_4471');
  assert.equal(baseName('folder/IMG_4471 (1).mov'), 'img_4471');
  assert.equal(baseName('Holiday copy.mp4'), 'holiday');
  assert.equal(baseName('Holiday_copy.mp4'), 'holiday');
});

test('the same video saved again is found; a different one is not', () => {
  // Same name, a second longer (re-exported): same.
  assert.equal(likelySame(v('IMG_1.MOV', 60_000, 100e6), v('IMG_1 (1).mp4', 61_000, 40e6)), 'the same name and length');
  // Other name, same length and picture, similar size: same.
  assert.equal(likelySame(v('a.mov', 60_000, 100e6), v('b.mov', 60_300, 90e6)), 'the same length and picture size');
  // Same length but another picture size: not the same.
  assert.equal(likelySame(v('a.mov', 60_000, 100e6), v('b.mov', 60_000, 100e6, 1080, 1920)), null);
  // Same length and picture but a much smaller file (a different clip of the same length): not the same.
  assert.equal(likelySame(v('a.mov', 60_000, 100e6), v('b.mov', 60_000, 30e6)), null);
  // Same name but very different length: not the same.
  assert.equal(likelySame(v('IMG_1.MOV', 60_000, 100e6), v('IMG_1.MOV', 90_000, 100e6)), null);
  // Unknown length never matches.
  assert.equal(likelySame(v('a.mov', null, 1e6), v('a.mov', null, 1e6)), null);
});

test('audio (no picture) needs the same length and nearly the same size', () => {
  const a = (name, d, s) => ({ name, durationMs: d, size: s });
  assert.equal(likelySame(a('ch1.mp3', 600_000, 9_600_000), a('Chapter one.mp3', 600_400, 9_500_000)), 'the same length and size');
  assert.equal(likelySame(a('ch1.mp3', 600_000, 9_600_000), a('other.mp3', 600_400, 6_000_000)), null);
});

test('the closest match wins, a same-named one first', () => {
  const file = v('IMG_9.MOV', 30_000, 50e6);
  const m = findLikely(file, [v('x.mov', 30_400, 50e6), v('IMG_9.mp4', 31_500, 20e6), v('y.mov', 30_100, 49e6)]);
  assert.equal(m.item.name, 'y.mov');
  assert.equal(findLikely(file, [v('z.mov', 45_000, 50e6)]), null);
});

test('"do the same for the rest" answers every later question', async () => {
  const asked = [];
  const answers = [{ choice: 'both', all: false }, { choice: 'skip', all: true }, { choice: 'replace', all: false }];
  const ask = stickyAsker(async (info) => {
    asked.push(info);
    return answers.shift();
  });
  assert.equal(await ask('a'), 'both');
  assert.equal(await ask('b'), 'skip');
  assert.equal(await ask('c'), 'skip');
  assert.equal(await ask('d'), 'skip');
  assert.deepEqual(asked, ['a', 'b']);
});
