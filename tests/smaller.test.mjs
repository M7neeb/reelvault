// Run with `npm test`. The rules for Make Smaller (the encoder itself runs only on the phone).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeMeta, parseQuality, QUALITIES, spaceNeeded, worthKeeping } from '../src/features/vault/smaller.ts';
import { libraryOverview } from '../src/features/vault/ui/logic.ts';

const MB = 1024 * 1024;

test('a new file is only kept when it saves at least 10%', () => {
  assert.equal(worthKeeping(100 * MB, 50 * MB), true);
  assert.equal(worthKeeping(100 * MB, 90 * MB), true);
  assert.equal(worthKeeping(100 * MB, 95 * MB), false, 'not worth losing the original for 5%');
  assert.equal(worthKeeping(100 * MB, 120 * MB), false, 'bigger: keep the original');
  assert.equal(worthKeeping(100 * MB, 0), false, 'an empty result is a failure, not a win');
});

test('re-encoding needs room for a second copy while it runs', () => {
  assert.ok(spaceNeeded(1024 * MB) > 1024 * MB);
});

test('what the encoder drops is filled back in from the original', () => {
  const original = { createdAt: 1, location: { lat: 1, lon: 2 }, model: 'iPhone 15', codec: 'H.264', width: 3840 };
  const next = { codec: 'HEVC', width: 1920, height: 1080 };
  const merged = mergeMeta(original, next);
  assert.equal(merged.codec, 'HEVC');
  assert.equal(merged.width, 1920);
  assert.equal(merged.createdAt, 1);
  assert.deepEqual(merged.location, { lat: 1, lon: 2 });
  assert.equal(merged.model, 'iPhone 15');
  assert.equal(mergeMeta(null, next), next);
  assert.equal(mergeMeta(original, null), original);
});

test('the saved quality setting is read strictly', () => {
  for (const q of QUALITIES) assert.equal(parseQuality(q.key), q.key);
  assert.equal(parseQuality('off'), null);
  assert.equal(parseQuality(null), null);
  assert.equal(parseQuality('4k'), null);
});

test('library overview counts the space Make Smaller saved', () => {
  const base = { durationMs: 1000, rating: 0, tagNames: [], filename: 'a.mov', width: 1, height: 1, createdAt: 0, flag: 0 };
  const o = libraryOverview([
    { ...base, sizeBytes: 40 * MB, originalSizeBytes: 100 * MB },
    { ...base, sizeBytes: 10 * MB, originalSizeBytes: null },
  ]);
  assert.equal(o.savedBytes, 60 * MB);
  assert.equal(o.madeSmaller, 1);
});
