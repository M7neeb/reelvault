// Run with `npm test`. Trim, crop, resolution and frame-rate plans.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cropFor,
  EMPTY_PLAN,
  estimateBytes,
  isNoop,
  isTrimmed,
  nativeOptions,
  needsReencode,
  outputOf,
  planForQuality,
} from '../src/features/vault/edit.ts';

const MB = 1024 * 1024;
const uhd = { width: 3840, height: 2160, fps: 30, durationMs: 60_000, sizeBytes: 360 * MB };
const portrait = { width: 1080, height: 1920, fps: 60, durationMs: 10_000, sizeBytes: 30 * MB };

test('a square crop of a landscape video takes the full height, centred', () => {
  const c = cropFor(1, 3840, 2160);
  assert.equal(c.h, 1);
  assert.ok(Math.abs(c.w - 2160 / 3840) < 1e-9);
  assert.ok(Math.abs(c.x - (1 - c.w) / 2) < 1e-9);
  assert.equal(c.y, 0);
});

test('crop position and zoom stay inside the frame', () => {
  const left = cropFor(9 / 16, 1920, 1080, 1, 0, 0.5);
  assert.equal(left.x, 0);
  const zoomed = cropFor(null, 1920, 1080, 2, 1, 1);
  assert.equal(zoomed.w, 0.5);
  assert.equal(zoomed.x + zoomed.w, 1);
  assert.equal(zoomed.y + zoomed.h, 1);
  assert.equal(cropFor(null, 1920, 1080), null, 'original shape, no zoom = no crop');
});

test('output size: crop, then scale so the short side fits, even numbers', () => {
  const plan = { ...EMPTY_PLAN, crop: cropFor(1, 3840, 2160), maxShortSide: 1080 };
  const out = outputOf(plan, uhd);
  assert.deepEqual([out.width, out.height], [1080, 1080]);
  const down = outputOf({ ...EMPTY_PLAN, maxShortSide: 720 }, portrait);
  assert.deepEqual([down.width, down.height], [720, 1280]);
  const notUp = outputOf({ ...EMPTY_PLAN, maxShortSide: 2160 }, portrait);
  assert.deepEqual([notUp.width, notUp.height], [1080, 1920], 'never scaled up');
});

test('frame rate only goes down, trimming shortens the length', () => {
  assert.equal(outputOf({ ...EMPTY_PLAN, fps: 30 }, portrait).fps, 30);
  assert.equal(outputOf({ ...EMPTY_PLAN, fps: 60 }, uhd).fps, 30);
  assert.equal(outputOf({ ...EMPTY_PLAN, startMs: 2000, endMs: 7000 }, portrait).durationMs, 5000);
  assert.equal(isTrimmed({ ...EMPTY_PLAN, endMs: 10_000 }, 10_000), false);
});

test('a plain trim is lossless; anything else re-encodes', () => {
  const trim = { ...EMPTY_PLAN, startMs: 1000 };
  assert.equal(needsReencode(trim, uhd), false);
  assert.equal(nativeOptions(trim).passthrough, true);
  assert.equal(needsReencode({ ...trim, fps: 24 }, uhd), true);
  assert.equal(needsReencode({ ...trim, maxShortSide: 1080 }, uhd), true);
  assert.equal(nativeOptions({ ...trim, maxShortSide: 1080 }).passthrough, false);
  assert.equal(isNoop(EMPTY_PLAN, uhd), true);
  assert.equal(isNoop({ ...EMPTY_PLAN, fps: 60 }, uhd), true, '60 fps on a 30 fps video changes nothing');
});

test('size estimates: a trim keeps the bitrate, 4K to 1080p shrinks a lot', () => {
  assert.equal(estimateBytes({ ...EMPTY_PLAN, startMs: 30_000 }, uhd), 180 * MB);
  const est = estimateBytes(planForQuality('1080p'), uhd);
  assert.ok(est < 360 * MB * 0.6, `expected a big saving, got ${est / MB} MB`);
  assert.ok(est <= 360 * MB);
});

test('old Make Smaller choices map to plans', () => {
  assert.equal(planForQuality('720p').maxShortSide, 720);
  assert.equal(planForQuality('same').maxShortSide, null);
  assert.equal(planForQuality('same').lossless, false);
});
