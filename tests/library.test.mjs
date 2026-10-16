// Run with `npm test`. Search filters, similar videos, places, dates, overview, backup matching.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countByDay,
  dayKey,
  describeRule,
  distanceKm,
  groupItems,
  groupSimilar,
  libraryOverview,
  matchesRule,
  monthGrid,
  nearby,
  orientationOf,
  parseRule,
} from '../src/features/vault/ui/logic.ts';
import { matchBackup, parseBackup } from '../src/features/vault/backupFormat.ts';

const MB = 1024 * 1024;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

const video = (over = {}) => ({
  id: 'v1',
  filename: 'IMG_4471_market.MOV',
  title: 'Market morning',
  notes: 'Bought figs',
  rating: 7,
  tagNames: ['holiday'],
  status: null,
  flag: 0,
  createdAt: at(2026, 10, 3),
  durationMs: 41_000,
  sizeBytes: 12 * MB,
  width: 1080,
  height: 1920,
  albumIds: [1],
  meta: { location: { lat: 51.66, lon: 7.35 }, model: 'iPhone 15' },
  inTray: false,
  importedAt: at(2026, 10, 13),
  contentKey: 'k1',
  ...over,
});

test('text search looks in name, title and caption', () => {
  assert.equal(matchesRule(video(), { text: 'figs' }), true);
  assert.equal(matchesRule(video(), { text: 'morning' }), true);
  assert.equal(matchesRule(video(), { text: 'beach' }), false);
});

test('regular expressions, and a broken one matches nothing instead of crashing', () => {
  assert.equal(matchesRule(video(), { text: '^IMG_\\d{4}', regex: true }), true);
  assert.equal(matchesRule(video(), { text: '^VID_', regex: true }), false);
  assert.equal(matchesRule(video(), { text: '([', regex: true }), false);
});

test('date, length, size, shape, format and counts', () => {
  const v = video();
  assert.equal(matchesRule(v, { dateFrom: at(2026, 10, 1), dateTo: at(2026, 10, 31) }), true);
  assert.equal(matchesRule(v, { dateFrom: at(2026, 10, 5) }), false);
  assert.equal(matchesRule(v, { minDurationSec: 30, maxDurationSec: 60 }), true);
  assert.equal(matchesRule(v, { minDurationSec: 60 }), false);
  assert.equal(matchesRule(v, { maxSizeMb: 10 }), false);
  assert.equal(matchesRule(v, { orientation: 'portrait' }), true);
  assert.equal(matchesRule(v, { orientation: 'landscape' }), false);
  assert.equal(matchesRule(v, { format: 'mov' }), true);
  assert.equal(matchesRule(v, { minKeywords: 2 }), false);
  assert.equal(matchesRule(v, { maxAlbums: 0 }), false);
  assert.equal(matchesRule(v, { hasLocation: true }), true);
  assert.equal(matchesRule(video({ meta: null }), { hasLocation: true }), false);
});

test('flags and the tray', () => {
  assert.equal(matchesRule(video({ flag: 1 }), { flag: 'pick' }), true);
  assert.equal(matchesRule(video({ flag: -1 }), { flag: 'pick' }), false);
  assert.equal(matchesRule(video(), { flag: 'none' }), true);
  assert.equal(matchesRule(video(), { inTray: true }), false);
  assert.equal(matchesRule(video({ inTray: true }), { inTray: true }), true);
});

test('a video with unknown length fails a length filter instead of slipping through', () => {
  assert.equal(matchesRule(video({ durationMs: null }), { minDurationSec: 1 }), false);
});

test('new rule fields are described and survive a save', () => {
  const rule = { flag: 'pick', orientation: 'portrait', minDurationSec: 30, format: 'MOV', hasLocation: true, inTray: true };
  assert.equal(describeRule(rule), 'picks · 30+ s · portrait · MOV · with location · in tray');
  assert.deepEqual(parseRule(JSON.stringify(rule)), rule);
  assert.deepEqual(parseRule('{"orientation": "diagonal", "format": "../../etc", "minAlbums": -3}'), {});
});

test('similar videos: same shape and length, but a different file', () => {
  const items = [
    video({ id: 'a', durationMs: 128_000, width: 1920, height: 1080, contentKey: 'x', importedAt: 2 }),
    video({ id: 'b', durationMs: 129_000, width: 1280, height: 720, contentKey: 'y', importedAt: 1 }),
    video({ id: 'c', durationMs: 128_500, width: 1080, height: 1920, contentKey: 'z', importedAt: 3 }),
    video({ id: 'd', durationMs: 200_000, width: 1920, height: 1080, contentKey: 'w' }),
    video({ id: 'same-file', durationMs: 128_200, width: 1920, height: 1080, contentKey: 'x', importedAt: 9 }),
  ];
  const groups = groupSimilar(items);
  assert.equal(groups.length, 1);
  // 'b' (oldest import) first; 'c' is the same clip rotated; 'same-file' is a duplicate, not "similar".
  assert.deepEqual(groups[0], ['b', 'a', 'c']);
});

test('places: distance and videos nearby', () => {
  const berlin = { lat: 52.52, lon: 13.405 };
  const potsdam = { lat: 52.39, lon: 13.065 };
  const d = distanceKm(berlin, potsdam);
  assert.ok(d > 25 && d < 30, `Berlin-Potsdam about 27 km, got ${d}`);
  const here = video({ id: 'here', meta: { location: { lat: 51.66, lon: 7.35 } } });
  const close = video({ id: 'close', meta: { location: { lat: 51.6605, lon: 7.3505 } } });
  const far = video({ id: 'far', meta: { location: berlin } });
  const none = video({ id: 'none', meta: null });
  assert.deepEqual(nearby([here, close, far, none], here).map((v) => v.id), ['close']);
  assert.deepEqual(nearby([here, close], none), []);
});

test('grouping by day, month and year keeps the sort order', () => {
  const items = [
    video({ id: '1', createdAt: at(2026, 10, 14, 18) }),
    video({ id: '2', createdAt: at(2026, 10, 14, 9) }),
    video({ id: '3', createdAt: at(2026, 10, 2) }),
    video({ id: '4', createdAt: at(2025, 12, 31) }),
  ];
  const days = groupItems(items, 'day');
  assert.deepEqual(days.map((s) => s.items.map((v) => v.id)), [['1', '2'], ['3'], ['4']]);
  assert.match(days[0].title, /14 Oct 2026$/);
  assert.deepEqual(groupItems(items, 'month').map((s) => s.title), ['October 2026', 'December 2025']);
  assert.deepEqual(groupItems(items, 'year').map((s) => s.key), ['2026', '2025']);
  assert.deepEqual(groupItems(items, 'none').map((s) => s.items.length), [4]);
  assert.deepEqual(groupItems([], 'none'), []);
});

test('calendar: counts per day and a Monday-first month grid', () => {
  const counts = countByDay([video({ createdAt: at(2026, 10, 3) }), video({ createdAt: at(2026, 10, 3, 20) })]);
  assert.equal(counts.get(dayKey(at(2026, 10, 3))), 2);
  const weeks = monthGrid(2026, 9); // October 2026 starts on a Thursday
  assert.deepEqual(weeks[0], [null, null, null, 1, 2, 3, 4]);
  assert.equal(weeks.flat().filter((d) => d !== null).length, 31);
  assert.ok(weeks.every((w) => w.length === 7));
});

test('library overview numbers', () => {
  const o = libraryOverview([
    video({ rating: 8, flag: 1 }),
    video({ rating: 0, tagNames: [], albumIds: [], meta: null, filename: 'b.mp4', width: 1920, height: 1080 }),
  ]);
  assert.equal(o.count, 2);
  assert.equal(o.totalBytes, 24 * MB);
  assert.equal(o.rated, 1);
  assert.equal(o.averageRating, 8);
  assert.equal(o.picks, 1);
  assert.equal(o.withLocation, 1);
  assert.deepEqual(o.byFormat.map((r) => r.label).sort(), ['MOV', 'MP4']);
  assert.equal(orientationOf(1080, 1080), 'square');
});

test('backup files are recognised and matched back to the right videos', () => {
  assert.equal(parseBackup('{"kind": "something-else", "videos": []}'), null);
  assert.equal(parseBackup('nope'), null);
  const backup = parseBackup(
    JSON.stringify({
      kind: 'reelvault-library-info',
      version: 1,
      videos: [
        { contentKey: 'k1', filename: 'renamed.mov', size: 10, keywords: ['a'], albums: [] },
        { contentKey: null, filename: 'clip.mp4', size: 20, keywords: [], albums: [] },
        { contentKey: 'gone', filename: 'missing.mp4', size: 30, keywords: [], albums: [] },
      ],
    })
  );
  assert.ok(backup);
  const library = [
    { id: 'x', contentKey: 'k1', filename: 'IMG_1.MOV', size: 10 },
    { id: 'y', contentKey: 'k9', filename: 'clip.mp4', size: 20 },
  ];
  const matches = matchBackup(backup, library);
  assert.equal(matches.get(0), 'x', 'by content key, even after renaming');
  assert.equal(matches.get(1), 'y', 'by name + size when there is no key');
  assert.equal(matches.has(2), false);
});
