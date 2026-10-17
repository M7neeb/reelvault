// Run with `npm test`. Videos dashboard, storage, Wrapped, badges, rating meanings, resume, keywords.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  badges,
  canResume,
  fmtClock,
  longestStreak,
  parseRatingLabels,
  presetRange,
  qualityOf,
  ratingLabel,
  recentWeeks,
  resumeFrom,
  storageStats,
  videoDashboard,
  wrapped,
} from '../src/features/vault/stats.ts';
import { splitKeywords, xmpKeywords } from '../src/features/vault/mp4.ts';

const T = new Date(2026, 9, 14, 20, 0).getTime(); // Wed 14 Oct 2026, 20:00
const H = 3_600_000;
const v = (id, o = {}) => ({
  id, filename: `${id}.mp4`, title: null, sizeBytes: 100e6, durationMs: 600_000, rating: 0, width: 1920, height: 1080,
  createdAt: T, importedAt: T, tagNames: [], meta: { codec: 'hvc1' }, ...o,
});

test('dashboard: favourite tag by rating, most watched tag by time, most watched video', () => {
  const items = [
    v('a', { rating: 9, tagNames: ['travel'] }),
    v('b', { rating: 8, tagNames: ['travel', 'family'] }),
    v('c', { rating: 4, tagNames: ['family'] }),
    v('d', { rating: 3, tagNames: ['family'] }),
    v('e'),
  ];
  const plays = [
    { videoId: 'c', startedAt: T, watchedMs: H },
    { videoId: 'c', startedAt: T + 1000, watchedMs: H },
    { videoId: 'a', startedAt: T, watchedMs: 0.5 * H },
    { videoId: 'gone', startedAt: T, watchedMs: H },
  ];
  const d = videoDashboard(items, plays);
  assert.equal(d.favouriteTag.tag, 'travel');
  assert.equal(d.mostWatchedTag.tag, 'family');
  assert.equal(d.mostWatched[0].key, 'c');
  assert.equal(d.mostRewatched[0].value, 2);
  assert.equal(d.plays, 3);
  assert.equal(d.neverWatched, 3);
  assert.equal(d.ratingHistogram[8], 1);
  assert.equal(d.weekday[2], 2.5 * H);
});

test('storage: totals, quality and codec groups, what H.264 could save', () => {
  const s = storageStats(
    [v('a', { sizeBytes: 3e9, width: 3840, height: 2160, meta: { codec: 'avc1' } }), v('b', { sizeBytes: 1e9, originalSizeBytes: 2e9 }), v('c', { sizeBytes: 5e8, width: 1280, height: 720 })],
    [v('x', { sizeBytes: 2e8 })]
  );
  assert.equal(s.totalBytes, 4.5e9);
  assert.equal(s.biggest[0].key, 'a');
  assert.equal(s.byQuality[0].key, '4K');
  assert.deepEqual(s.byCodec.map((g) => g.key), ['H.264', 'HEVC']);
  assert.equal(s.savedBytes, 1e9);
  assert.equal(s.couldSaveCount, 1);
  assert.equal(s.deletedBytes, 2e8);
  assert.equal(qualityOf({ width: null, height: null }), 'Unknown');
});

test('wrapped: only the range counts, with Simkl minutes on top', () => {
  const items = [v('a', { tagNames: ['cats'], rating: 9 }), v('b', { importedAt: T - 30 * 86400000 })];
  const plays = [
    { videoId: 'a', startedAt: T, watchedMs: 20 * 60000 },
    { videoId: 'a', startedAt: T + H, watchedMs: 10 * 60000 },
    { videoId: 'b', startedAt: T - 20 * 86400000, watchedMs: H },
  ];
  const [week] = recentWeeks(T + 86400000, 2);
  const w = wrapped(week, items, plays, {
    events: [{ simklId: 1, type: 'show', at: T, minutes: 45, rewatch: false }],
    items: [{ simklId: 1, title: 'Harbour Lights' }],
    meta: new Map([[1, { genres: ['Drama'], network: null, country: null, language: null, runtime: null }]]),
  });
  assert.equal(w.videos.watchedMs, 30 * 60000);
  assert.equal(w.videos.videosWatched, 1);
  assert.equal(w.videos.topTags[0].label, 'cats');
  assert.equal(w.videos.imported, 1);
  assert.equal(w.videos.bestNew.key, 'a');
  assert.equal(w.simkl.topTitles[0].label, 'Harbour Lights');
  assert.equal(w.totalMinutes, 75);
  assert.equal(week.label, 'This week');
  assert.ok(presetRange('days30', T).start < T);
});

test('badges: unlocked tiers plus the next one with progress; streaks', () => {
  const list = badges({
    videos: Array.from({ length: 12 }, (_, i) => v(String(i), { rating: i < 3 ? 8 : 0 })),
    plays: [], bookmarks: 0, albums: 0, simklEpisodes: 120, simklMovies: 0, simklCompleted: 0, simklRewatches: 0, streakDays: 4, lists: 0,
  });
  const lib = list.filter((b) => b.id.startsWith('library'));
  assert.deepEqual(lib.map((b) => [b.target, b.unlocked]), [[10, true], [100, false]]);
  assert.equal(list.find((b) => b.id === 'episodes-500').current, 120);
  const day = 86400000;
  assert.equal(longestStreak([T, T + day, T + 2 * day, T + 5 * day, T + 5 * day + 1000]), 3);
  assert.equal(longestStreak([]), 0);
});

test('rating meanings, resume point, clock, file keywords', () => {
  const labels = parseRatingLabels('{"1":"Waste of time","5":"Mid","11":"x","3":""}');
  assert.deepEqual(labels, { 1: 'Waste of time', 5: 'Mid' });
  assert.equal(ratingLabel(5.8, labels), 'Mid');
  assert.equal(ratingLabel(4, labels), null);
  assert.equal(ratingLabel(0, labels), null);
  assert.deepEqual(parseRatingLabels('not json'), {});
  assert.equal(resumeFrom(14 * 60000, 30 * 60000), 11.5 * 60000);
  assert.equal(resumeFrom(60000, 30 * 60000), 0);
  assert.equal(resumeFrom(29.9 * 60000, 30 * 60000), 27.4 * 60000);
  assert.equal(canResume(4 * 60000), false);
  assert.equal(fmtClock(3723000), '1:02:03');
  assert.equal(fmtClock(65000), '1:05');
  assert.deepEqual(splitKeywords(['Travel, beach;Travel', ' family ']), ['Travel', 'beach', 'family']);
  assert.deepEqual(
    xmpKeywords('<dc:subject><rdf:Bag><rdf:li>Beach</rdf:li><rdf:li>Tom &amp; Ann</rdf:li></rdf:Bag></dc:subject><lr:hierarchicalSubject><rdf:Bag><rdf:li>Places|Spain</rdf:li></rdf:Bag></lr:hierarchicalSubject>'),
    ['Beach', 'Tom & Ann', 'Spain']
  );
});

import { freeCropOrNull, moveCrop } from '../src/features/vault/edit.ts';

test('free crop: drag corners and edges, move it, stays inside and not too small', () => {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  const a = moveCrop(full, 'tl', 0.2, 0.1);
  assert.deepEqual(a, { x: 0.2, y: 0.1, w: 0.8, h: 0.9 });
  const b = moveCrop(a, 'move', 0.5, -0.5);
  assert.ok(Math.abs(b.x - 0.2) < 1e-9 && b.y === 0 && Math.abs(b.w - 0.8) < 1e-9);
  const c = moveCrop({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 'r', -0.5, 0);
  assert.ok(Math.abs(c.w - 0.08) < 1e-9);
  const d = moveCrop(full, 'b', 0, -0.25);
  assert.deepEqual(d, { x: 0, y: 0, w: 1, h: 0.75 });
  assert.equal(freeCropOrNull(full), null);
  assert.deepEqual(freeCropOrNull(d), d);
});
