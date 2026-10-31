// Run with `npm test`. The frames the video Wrapped plays videos in.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lookFor, VIDEO_LOOKS } from '../src/features/vault/videoLookOrder.ts';

test('cards with a video get frames in turn, never the same twice in a row; the big moments fill the screen', () => {
  const cards = Array.from({ length: 30 }, (_, k) => ({ key: k === 10 ? 'top1' : `c${k}`, media: k % 7 === 6 ? [] : ['v'] }));
  const looks = lookFor(cards, ['top1']);
  assert.equal(looks.get('top1'), 'full');
  let prev = null;
  for (const c of cards) {
    const l = looks.get(c.key) ?? null;
    if (!c.media.length) assert.equal(l, null);
    if (l && prev) assert.notEqual(l, prev);
    prev = l;
  }
  const used = new Set(looks.values());
  for (const l of VIDEO_LOOKS) assert.ok(used.has(l), l);
});

test('a montage (several videos) fills the screen', () => {
  assert.equal(lookFor([{ key: 'm', media: ['a', 'b'] }]).get('m'), 'full');
});
