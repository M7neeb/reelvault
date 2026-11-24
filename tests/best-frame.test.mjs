import assert from 'node:assert/strict';
import { test } from 'node:test';

import { frameScore, importFrameMs, lookFromColors, needsAutoCover, parseDone, pickCover } from '../src/features/vault/bestFrame.ts';

const look = (over = {}) => ({ atMs: 0, brightness: 0.45, contrast: 0.4, sharpness: 0.5, colorfulness: 0.4, faces: 0, faceArea: 0, faceQuality: 0, ...over });

test('black, white and unreadable frames are never a cover', () => {
  assert.equal(frameScore(look({ brightness: 0.02 })), -1);
  assert.equal(frameScore(look({ brightness: 0.98 })), -1);
  assert.equal(frameScore(look({ brightness: NaN })), -1);
  assert.equal(pickCover([look({ brightness: 0.01 }), look({ brightness: 0.99 })], null), null);
});

test('a sharp, well lit frame beats a blurred dark one', () => {
  const blurred = look({ atMs: 1000, brightness: 0.12, sharpness: 0.05, contrast: 0.08 });
  const good = look({ atMs: 9000 });
  assert.ok(frameScore(good) > frameScore(blurred));
  assert.equal(pickCover([blurred, good], null)?.atMs, 9000);
});

test('a clear face beats the same scene without one, a tiny face counts for less', () => {
  const scene = look({ atMs: 1 });
  const face = look({ atMs: 2, faces: 1, faceArea: 0.12, faceQuality: 0.8 });
  const tiny = look({ atMs: 3, faces: 1, faceArea: 0.002, faceQuality: 0.8 });
  assert.equal(pickCover([scene, tiny, face], null)?.atMs, 2);
  assert.ok(frameScore(tiny) > frameScore(scene));
  assert.ok(frameScore(face) > frameScore(tiny));
});

test('the current cover stays when nothing is clearly better', () => {
  const current = look({ atMs: 1000 });
  assert.equal(pickCover([look({ atMs: 5000, sharpness: 0.52 })], current), null);
  assert.equal(pickCover([look({ atMs: 5000, sharpness: 0.95, colorfulness: 0.8 })], current)?.atMs, 5000);
  // A black import frame is replaced by any usable one.
  assert.equal(pickCover([look({ atMs: 7000 })], look({ brightness: 0.01 }))?.atMs, 7000);
});

test('no frames: keep what is there', () => {
  assert.equal(pickCover([], null), null);
  assert.equal(pickCover([], look()), null);
});

test('rough measure from colours: dark frames score low, broken colours give nothing', () => {
  const dark = lookFromColors(0, '#050505', '#0a0a0a');
  const lit = lookFromColors(0, '#7a6a5a', '#d04020');
  assert.equal(frameScore(dark), -1);
  assert.ok(frameScore(lit) > 0);
  assert.ok(lit.colorfulness > 0.3);
  assert.equal(lookFromColors(0, '', ''), null);
  assert.equal(lookFromColors(0, 'red', '#fff'), null);
});

test('only videos on their import frame, long enough, not deleted, not done yet, newest first', () => {
  const v = (id, over = {}) => ({ id, coverAt: null, durationMs: 60_000, deletedAt: null, importedAt: 1, ...over });
  const list = [
    v('a', { importedAt: 1 }),
    v('b', { importedAt: 3 }),
    v('chosen', { coverAt: 123 }),
    v('short', { durationMs: 1000 }),
    v('nolength', { durationMs: null }),
    v('deleted', { deletedAt: 5 }),
    v('done'),
  ];
  assert.deepEqual(needsAutoCover(list, new Set(['done'])).map((x) => x.id), ['b', 'a']);
});

test('the done list survives junk', () => {
  assert.deepEqual([...parseDone('["a","b",3]')], ['a', 'b']);
  assert.equal(parseDone('{oops').size, 0);
  assert.equal(parseDone(null).size, 0);
  assert.equal(parseDone('{"a":1}').size, 0);
});

test('the import frame is at 1 s, or halfway in very short clips', () => {
  assert.equal(importFrameMs(60_000), 1000);
  assert.equal(importFrameMs(1200), 600);
});
