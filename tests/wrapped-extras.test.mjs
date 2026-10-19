// Run with `npm test`. Wrapped extras: video age, the watching club, the rewatch meter.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLUBS, clubOf, rewatchMeter, videoAge } from '../src/features/vault/wrappedExtras.ts';
import { clubJourney, quizFrom, yearBefore } from '../src/features/vault/wrappedExtras.ts';

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

test('club month by month: switches, first, last and most', () => {
  const j = clubJourney([
    { label: 'Jan', club: 'night' },
    { label: 'Feb', club: null },
    { label: 'Mar', club: 'night' },
    { label: 'Apr', club: 'comfort' },
    { label: 'May', club: 'night' },
  ]);
  assert.equal(j.switches, 2);
  assert.equal(j.first.key, 'night');
  assert.equal(j.last.key, 'night');
  assert.equal(j.most.key, 'night');
  assert.equal(j.months, 4);
  assert.equal(clubJourney([{ label: 'Jan', club: 'night' }]), null);
});

test('quiz: the biggest is the answer, three different options', () => {
  const list = [
    { id: 'a', label: 'A', value: 5 },
    { id: 'b', label: 'B', value: 9 },
    { id: 'c', label: 'C', value: 1 },
    { id: 'd', label: 'D', value: 7 },
  ];
  for (let seed = 0; seed < 12; seed++) {
    const q = quizFrom(list, seed);
    assert.equal(q.answer, 'b');
    assert.equal(new Set(q.options.map((o) => o.id)).size, 3);
    assert.ok(q.options.some((o) => o.id === 'b'));
  }
  // A tie at the top, or too few: no quiz.
  assert.equal(quizFrom([{ id: 'a', label: 'A', value: 2 }, { id: 'b', label: 'B', value: 2 }, { id: 'c', label: 'C', value: 1 }], 0), null);
  assert.equal(quizFrom(list.slice(0, 2), 0), null);
});

test('a year before keeps the dates', () => {
  const r = { start: new Date(2026, 9, 1).getTime(), end: new Date(2026, 10, 1).getTime(), label: 'October' };
  const y = yearBefore(r);
  assert.equal(new Date(y.start).getFullYear(), 2025);
  assert.equal(new Date(y.start).getMonth(), 9);
  assert.equal(new Date(y.end).getMonth(), 10);
});
