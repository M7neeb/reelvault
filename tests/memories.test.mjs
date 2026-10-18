// Run with `npm test`. Memories: on this day, trips, days, months, seasons, themes, favourites, clips.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceKm, homeOf, memories, memoryClips, memoryLength, memorySections } from '../src/features/vault/memories.ts';

const MIN = 60_000;
const DAY = 86_400_000;
const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();
const NOW = at(2026, 9, 18, 20);
const HOME = { lat: 51.66, lon: 7.35 };
const AWAY = { lat: 48.85, lon: 2.35 };

let n = 0;
const video = (over = {}) => ({
  id: `v${++n}`,
  title: null,
  filename: `clip${n}.mp4`,
  createdAt: at(2025, 1, 1),
  importedAt: at(2026, 1, 1),
  durationMs: 2 * MIN,
  sizeBytes: 1,
  rating: 0,
  tagNames: [],
  location: null,
  ...over,
});

test('distance and home', () => {
  assert.ok(Math.abs(distanceKm(HOME, AWAY) - 473) < 5);
  const home = homeOf([video({ location: HOME }), video({ location: HOME }), video({ location: AWAY })]);
  assert.ok(Math.abs(home.lat - HOME.lat) < 0.01);
  assert.equal(homeOf([video()]), null);
});

test('on this day finds videos from earlier years near today', () => {
  const list = [video({ createdAt: at(2025, 9, 18, 9) }), video({ createdAt: at(2024, 9, 20) }), video({ createdAt: at(2024, 5, 1) })];
  const m = memories(list, [], NOW);
  const otd = m.filter((x) => x.kind === 'onThisDay');
  assert.deepEqual(otd.map((x) => x.title).sort(), ['1 year ago today', '2 years ago this week']);
  assert.equal(m[0].kind, 'onThisDay', 'on this day comes first');
});

test('trips are runs of videos far from home; days are bursts of filming', () => {
  const home = Array.from({ length: 4 }, (_, i) => video({ location: HOME, createdAt: at(2026, 6, 1 + i * 5) }));
  const trip = [
    video({ location: AWAY, createdAt: at(2026, 7, 7, 10) }), // a Friday
    video({ location: AWAY, createdAt: at(2026, 7, 8, 15) }),
    video({ location: AWAY, createdAt: at(2026, 7, 9, 11) }),
  ];
  const day = [0, 1, 2, 3].map((i) => video({ createdAt: at(2026, 8, 12, 14, i * 40), tagNames: ['party'] }));
  const m = memories([...home, ...trip, ...day], [], NOW);
  const t = m.find((x) => x.kind === 'trip');
  assert.ok(t, 'a trip');
  assert.equal(t.title, 'A weekend away, August 2026');
  assert.match(t.subtitle, /km from home · 3 videos/);
  const d = m.find((x) => x.kind === 'day');
  assert.equal(d.title, 'Party, 12 September');
  assert.equal(d.videoIds.length, 4);
  assert.ok(!m.some((x) => x.kind === 'day' && x.videoIds.includes(trip[0].id)), 'trip videos are not a day as well');
});

test('months, seasons, themes, favourites, gems and years', () => {
  const list = Array.from({ length: 7 }, (_, i) =>
    video({ createdAt: at(2026, 6, 2 + i * 4), rating: i < 4 ? 9 : 5, tagNames: i < 3 ? ['beach'] : [], importedAt: at(2026, 0, 1) })
  );
  const m = memories(list, [], NOW);
  const kinds = new Set(m.map((x) => x.kind));
  for (const k of ['month', 'season', 'theme', 'favourites', 'gems', 'year']) assert.ok(kinds.has(k), k);
  assert.equal(m.find((x) => x.kind === 'season').title, 'Summer 2026');
  assert.equal(m.find((x) => x.kind === 'theme').title, 'Beach moments');
  // Clips play in filming order and the cover is the best one.
  const fav = m.find((x) => x.kind === 'favourites');
  assert.deepEqual(fav.videoIds, [...fav.videoIds].sort((a, b) => list.find((v) => v.id === a).createdAt - list.find((v) => v.id === b).createdAt));
  assert.ok(list.find((v) => v.id === fav.coverId).rating === 9);
  // Ids are stable.
  assert.deepEqual(memories(list, [], NOW).map((x) => x.id), m.map((x) => x.id));
});

test('clips: short videos play whole, long ones from the highlight; sections hide what you hid', () => {
  const a = video({ durationMs: 2_000 });
  const b = video({ durationMs: 10 * MIN });
  const mem = { id: 'x', kind: 'recent', videoIds: [a.id, b.id, 'gone'], coverId: a.id };
  const map = new Map([a, b].map((v) => [v.id, v]));
  const clips = memoryClips(mem, map, 'upbeat');
  assert.equal(clips.length, 2);
  assert.deepEqual(clips[0], { videoId: a.id, startMs: 0, ms: 2_000 });
  assert.equal(clips[1].startMs, 150_000);
  assert.equal(memoryClips(mem, map, 'upbeat', new Map([[b.id, [42_000]]]))[1].startMs, 42_000);
  assert.equal(memoryLength(clips), '8 s');
  const s = memorySections([{ ...mem, kind: 'trip', start: 1 }, { ...mem, id: 'y', kind: 'year', start: 2 }], ['y'], ['x']);
  assert.equal(s.years.length, 0);
  assert.equal(s.favourites.length, 1);
  assert.equal(s.moments.length, 1);
});

test('custom memories pick by keyword, album, dates and rating', async () => {
  const { customMemory, customMatches, isCustomMemory } = await import('../src/features/vault/memories.ts');
  const list = [
    video({ tagNames: ['Beach'], rating: 9, albumIds: [2], createdAt: at(2026, 6, 1) }),
    video({ tagNames: ['beach'], rating: 4, albumIds: [], createdAt: at(2026, 6, 2) }),
    video({ tagNames: [], rating: 9, albumIds: [2], createdAt: at(2025, 6, 2) }),
  ];
  const base = { tag: null, albumId: null, from: null, to: null, minRating: 0 };
  assert.equal(customMatches({ ...base, tag: 'beach' }, list).length, 2);
  assert.equal(customMatches({ ...base, albumId: 2 }, list).length, 2);
  assert.equal(customMatches({ ...base, from: at(2026, 0, 1, 0) }, list).length, 2);
  assert.equal(customMatches({ ...base, tag: 'beach', minRating: 8 }, list).length, 1);
  const c = { ...base, id: 'c1', title: 'Summer', mood: 'epic', createdAt: NOW, tag: 'beach' };
  assert.ok(isCustomMemory(c));
  assert.equal(isCustomMemory({ id: 1 }), false);
  const m = customMemory(c, list, []);
  assert.equal(m.kind, 'custom');
  assert.equal(m.title, 'Summer');
  assert.equal(customMemory({ ...c, tag: 'nothing' }, list, []), null);
});

test('a year ago, first videos, milestones and after dark', () => {
  const list = [];
  // 120 videos over three years, one every ~9 days, all at 22:00 for the first ten.
  for (let i = 0; i < 120; i++) list.push(video({ createdAt: at(2023, 10, 1) + i * 9 * DAY + (i < 10 ? 10 * 3_600_000 : 0) }));
  // Three filmed around this date last year (2025-10-18), not on the same few days.
  list.push(video({ createdAt: at(2025, 9, 8) }), video({ createdAt: at(2025, 9, 28) }), video({ createdAt: at(2025, 10, 1) }));
  const out = memories(list, [], NOW);
  const kinds = new Set(out.map((m) => m.kind));
  assert.ok(kinds.has('yearAgo'));
  const ya = out.find((m) => m.kind === 'yearAgo');
  assert.equal(ya.title, 'October, a year ago');
  assert.ok(kinds.has('first'));
  assert.equal(out.find((m) => m.kind === 'first').videoIds[0], list[0].id);
  const ms = out.find((m) => m.id === 'milestone:100');
  assert.ok(ms);
  assert.equal(ms.title, 'Video number 100');
  assert.ok(kinds.has('night'));
});

test('quick mixes: best rated, this month through the years, random; each needs three videos', async () => {
  const { memoryMixes } = await import('../src/features/vault/memories.ts');
  const now = new Date(2026, 9, 18).getTime();
  const v = (id, y, m, rating = 0) => ({ id, createdAt: new Date(y, m, 5).getTime(), rating });
  const videos = [v('a', 2023, 9, 9), v('b', 2024, 9, 10), v('c', 2025, 9, 8), v('d', 2025, 2), v('e', 2026, 9)];
  const seq = [0.1, 0.5, 0.9, 0.3, 0.7];
  let n = 0;
  const mixes = memoryMixes([], videos, [], now, () => seq[n++ % seq.length]);
  const ids = mixes.map((m) => m.id);
  assert.deepEqual(ids, ['mix:best', 'mix:month', 'mix:random']);
  const best = mixes[0];
  assert.deepEqual(best.videoIds, ['a', 'b', 'c']);
  assert.equal(best.coverId, 'b');
  assert.equal(best.kind, 'mix');
  assert.deepEqual(mixes[1].videoIds, ['a', 'b', 'c']);
  assert.equal(new Set(mixes[2].videoIds).size, 5);
});

test('the saved memories mix joins the memories you saved', async () => {
  const { memoryMixes } = await import('../src/features/vault/memories.ts');
  const videos = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, createdAt: i * 1000 + 1, rating: 0 }));
  const list = [
    { id: 'm1', videoIds: ['a', 'b'] },
    { id: 'm2', videoIds: ['b', 'c'] },
  ];
  const saved = memoryMixes(list, videos, ['m1', 'm2'], 10_000, () => 0).find((m) => m.id === 'mix:saved');
  assert.deepEqual(saved.videoIds, ['a', 'b', 'c']);
});
