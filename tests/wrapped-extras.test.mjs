// Run with `npm test`. Wrapped extras: video age, the watching club, the rewatch meter.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLUBS, clubOf, rewatchMeter, videoAge } from '../src/features/vault/wrappedExtras.ts';

const YEAR = 365.25 * 86_400_000;
const NOW = new Date(2026, 9, 18).getTime();

test('video age weighs each video by how long it was watched', () => {
  const a = videoAge(
    [
      { ms: 3 * 60_000, createdAt: NOW - 4 * YEAR },
      { ms: 1 * 60_000, createdAt: NOW },
    ],
    NOW
  );
  assert.equal(a.years, 3);
  assert.equal(a.label, 'The nostalgic');
});

test('video age ignores missing dates and returns null with nothing to go on', () => {
  assert.equal(videoAge([{ ms: 1000, createdAt: null }], NOW), null);
  assert.equal(videoAge([], NOW), null);
  assert.equal(videoAge([{ ms: 1000, createdAt: NOW - 0.1 * YEAR }], NOW).label, 'Fresh off the camera');
});

test('the club follows the strongest habit', () => {
  const base = { plays: 20, firsts: 5, returns: 5, completion: 0.9, longestMs: 60_000, biggestDayMs: 600_000 };
  const night = clubOf({ ...base, dayparts: [{ key: 'night', share: 0.7 }, { key: 'morning', share: 0.1 }] });
  assert.equal(night.club.key, 'night');
  const comfort = clubOf({ ...base, firsts: 1, returns: 12, dayparts: [{ key: 'evening', share: 0.6 }] });
  assert.equal(comfort.club.key, 'comfort');
  assert.equal(Object.keys(night.fit).length, CLUBS.length);
});

test('too few plays for a club', () => {
  assert.equal(clubOf({ plays: 2, firsts: 1, returns: 1, dayparts: [], completion: null, longestMs: null, biggestDayMs: null }), null);
});

test('rewatch meter', () => {
  assert.deepEqual(rewatchMeter(12, 4), { perVideo: 3, label: 'On repeat' });
  assert.equal(rewatchMeter(1, 1), null);
  assert.equal(rewatchMeter(5, 5).label, 'Once is enough');
});
