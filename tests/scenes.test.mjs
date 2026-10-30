// Run with `npm test`. Similar videos by their pictures, and search inside videos.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { confirmByPictures, findScenes, groupByPictures, hamming, mergeGroups, samePictures, telling } from '../src/features/vault/sceneLogic.ts';

const flip = (hex, bits) => {
  // Change the lowest `bits` bits.
  const n = BigInt(`0x${hex}`) ^ ((1n << BigInt(bits)) - 1n);
  return n.toString(16).padStart(16, '0');
};
const A = ['3c3c7e7e18183c3c', '0f0f33330f0f5555', 'aa55aa55f0f00f0f', '1234567890abcdef', 'fedcba0987654321', '0ff00ff0a5a55a5a', '7777333311118888', 'c3c3a5a55a5a3c3c', '9999666633336666'];
const B = ['f00ff00f12121212', '5a5aa5a5c3c33c3c', '8888777711113333', 'abcdef0123456789', '6666999933336666', '0f0ff0f0a5a5a5a5', '1111222244448888', 'cafebabedeadbeef', '0123456789abcdef'];

test('fingerprints: bits apart, and flat frames ignored', () => {
  assert.equal(hamming('0000000000000000', '0000000000000000'), 0);
  assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hamming('0000000000000000', '000000000000000f'), 4);
  assert.equal(hamming('', '0000000000000000'), 64);
  assert.equal(telling('0000000000000000'), false);
  assert.equal(telling('ffffffffffffffff'), false);
  assert.equal(telling('3c3c7e7e18183c3c'), true);
  assert.equal(telling(''), false);
});

test('same clip: re-encoded (a few bits off) or trimmed (shifted) still matches; another video does not', () => {
  const reencoded = A.map((p) => flip(p, 3));
  assert.equal(samePictures(A, reencoded), true);
  const trimmed = [...A.slice(2), flip(A[8], 2), flip(A[7], 1)];
  assert.equal(samePictures(A, trimmed), true);
  assert.equal(samePictures(A, B), false);
  assert.equal(samePictures(A, ['', '', '']), false);
});

test('groups by pictures, and length-only groups checked against the pictures', () => {
  const v = (id, durationMs, importedAt, contentKey = null) => ({ id, durationMs, importedAt, contentKey });
  const prints = new Map([
    ['a', A],
    ['a2', A.map((p) => flip(p, 2))],
    ['b', B],
  ]);
  assert.deepEqual(groupByPictures([v('b', 60_000, 1), v('a2', 70_000, 3), v('a', 72_000, 2)], prints), [['a', 'a2']]);
  // Same length, different pictures: episodes, not copies.
  assert.deepEqual(confirmByPictures([['a', 'b']], prints), []);
  // No fingerprints yet: the group stays.
  assert.deepEqual(confirmByPictures([['x', 'y']], prints), [['x', 'y']]);
  assert.deepEqual(mergeGroups([['a', 'b']], [['b', 'c'], ['d', 'e']]), [['a', 'b', 'c'], ['d', 'e']]);
});

test('search inside videos: scene words and text on screen', () => {
  const rows = [
    { videoId: 'v1', atMs: 4000, labels: 'dog, grass, outdoor', words: '' },
    { videoId: 'v1', atMs: 8000, labels: 'dog, beach', words: '' },
    { videoId: 'v2', atMs: 12000, labels: 'kitchen', words: 'Happy Birthday Sara' },
    { videoId: 'v3', atMs: 2000, labels: 'sports car, road', words: '' },
  ];
  assert.deepEqual(findScenes(rows, 'dog'), [{ videoId: 'v1', atMs: 4000, why: 'dog' }]);
  assert.deepEqual(findScenes(rows, 'dog beach'), [{ videoId: 'v1', atMs: 8000, why: 'dog, beach' }]);
  assert.deepEqual(findScenes(rows, 'birthday'), [{ videoId: 'v2', atMs: 12000, why: '"birthday"' }]);
  assert.deepEqual(findScenes(rows, 'car').map((h) => h.videoId), ['v3']);
  assert.deepEqual(findScenes(rows, 'cat'), []);
  assert.deepEqual(findScenes(rows, ' '), []);
});
