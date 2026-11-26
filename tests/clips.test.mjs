import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLIP_MAX_MS, clipsOf } from '../src/features/vault/clips.ts';

const v = (id, durationMs, over = {}) => ({ id, durationMs, importedAt: Number(id.replace(/\D/g, '')) || 0, isPrivate: false, deletedAt: null, ...over });

test('clips are videos of three minutes or less, newest first', () => {
  const list = [v('a1', 30_000), v('a2', 4 * 60_000), v('a3', 3 * 60_000), v('a4', null), v('a5', 10_000, { isPrivate: true }), v('a6', 9_000, { deletedAt: 5 })];
  assert.equal(CLIP_MAX_MS, 180_000);
  assert.deepEqual(clipsOf(list, 'newest').map((x) => x.id), ['a3', 'a1']);
});

test('shuffle keeps every clip once and is the same for the same seed', () => {
  const list = Array.from({ length: 30 }, (_, i) => v(`c${i}`, 20_000));
  const a = clipsOf(list, 'shuffle', 42).map((x) => x.id);
  const b = clipsOf(list, 'shuffle', 42).map((x) => x.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 30);
  assert.notDeepEqual(a, clipsOf(list, 'newest').map((x) => x.id));
  assert.notDeepEqual(a, clipsOf(list, 'shuffle', 7).map((x) => x.id));
});
