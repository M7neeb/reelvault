import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setSpeed } from '../src/features/vault/ui/logic.ts';

// Behaves like expo-video on iOS: setting the speed sets AVPlayer's rate, which starts playback.
function fakePlayer(playing = false, rate = 1) {
  let r = rate;
  return {
    playing,
    plays: 0,
    get playbackRate() {
      return r;
    },
    set playbackRate(v) {
      r = v;
      if (v > 0 && !this.playing) {
        this.playing = true;
        this.plays++;
      }
    },
    pause() {
      this.playing = false;
    },
  };
}

test('a paused player gets the new speed and stays paused', () => {
  const p = fakePlayer(false);
  setSpeed(p, 1.5);
  assert.equal(p.playbackRate, 1.5);
  assert.equal(p.playing, false);
});

test('a playing player keeps playing at the new speed', () => {
  const p = fakePlayer(true);
  setSpeed(p, 2);
  assert.equal(p.playbackRate, 2);
  assert.equal(p.playing, true);
});

test('the same speed again does not touch the player at all', () => {
  const p = fakePlayer(false, 1.25);
  setSpeed(p, 1.25);
  assert.equal(p.plays, 0);
  assert.equal(p.playing, false);
});

test('a preloaded player set to the show speed twice in a row stays paused', () => {
  const p = fakePlayer(false);
  setSpeed(p, 0.5);
  setSpeed(p, 0.5);
  assert.equal(p.playing, false);
  assert.equal(p.playbackRate, 0.5);
});
