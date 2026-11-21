import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fmtTimeLeft, stoppedLine } from '../src/features/vault/ui/logic.ts';

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

test('time left reads in seconds, then minutes and seconds, then minutes or hours', () => {
  assert.equal(fmtTimeLeft(0), '1 s');
  assert.equal(fmtTimeLeft(52_000), '52 s');
  assert.equal(fmtTimeLeft(60_000), '1 min');
  assert.equal(fmtTimeLeft(112_000), '1 min 52 s');
  assert.equal(fmtTimeLeft(599_000), '9 min 59 s');
  assert.equal(fmtTimeLeft(600_000), '10 min');
  assert.equal(fmtTimeLeft(3_600_000), '1 h');
  assert.equal(fmtTimeLeft(3_840_000), '1 h 4 min');
});

test('the stopped line says where you stopped and what is left, and nothing made up without a length', () => {
  assert.equal(stoppedLine(80_000, 192_000, clock), 'Stopped at 1:20 · 1 min 52 s left');
  assert.equal(stoppedLine(80_000, null, clock), 'Stopped at 1:20');
  assert.equal(stoppedLine(80_000, 0, clock), 'Stopped at 1:20');
  assert.equal(stoppedLine(200_000, 192_000, clock), 'Stopped at 3:20');
});

test('the picture is about 1.15 times as tall as wide, at least 400 pt, at most two thirds of the screen', async () => {
  const { heroHeight } = await import('../src/features/vault/ui/logic.ts');
  assert.equal(heroHeight(393, 852), 452);
  assert.equal(heroHeight(320, 693), 400);
  assert.equal(heroHeight(320, 568), 400);
  assert.equal(heroHeight(430, 932), 494);
});

test('the picture only shows on the whole library, upright, in the artwork look, Standard or Detailed', async () => {
  const { showsHero } = await import('../src/features/vault/ui/logic.ts');
  const base = { art: true, look: 'standard', filter: 'all', inPrivate: false, selectMode: false, width: 393, height: 852 };
  assert.equal(showsHero(base), true);
  assert.equal(showsHero({ ...base, look: 'detailed' }), true);
  for (const change of [{ art: false }, { look: 'simple' }, { look: 'compact' }, { look: 'desktop' }, { filter: 'album' }, { filter: 'deleted' }, { inPrivate: true }, { selectMode: true }, { width: 852, height: 393 }]) {
    assert.equal(showsHero({ ...base, ...change }), false, JSON.stringify(change));
  }
});
