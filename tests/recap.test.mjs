// Run with `npm test`. Wrapped's story facts, records, journey, levels, insights, memories, space ideas, new badges.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { achievements } from '../src/features/vault/achievements.ts';
import {
  growth,
  highlightAt,
  journey,
  levelFor,
  monthRanges,
  noticed,
  onThisDay,
  personalRecords,
  rediscover,
  spaceIdeas,
  storyFacts,
  yearRange,
} from '../src/features/vault/recap.ts';

const MIN = 60_000;
const DAY = 86_400_000;
const at = (y, m, d, h = 20) => new Date(y, m, d, h, 0).getTime();
const NOW = at(2026, 9, 18, 20);
const fmt = (ms) => `${Math.round(ms / MIN)} min`;

const video = (id, over = {}) => ({
  id,
  title: null,
  filename: `${id}.mp4`,
  createdAt: at(2025, 5, 1),
  importedAt: at(2026, 6, 1),
  durationMs: 10 * MIN,
  sizeBytes: 10 * 1024 * 1024,
  rating: 0,
  tagNames: [],
  flag: 0,
  meta: null,
  ...over,
});
const play = (videoId, startedAt, watchedMs = 10 * MIN) => ({ videoId, startedAt, watchedMs });

test('story facts: firsts and returns, comfort video, top five, dayparts, persona', () => {
  const videos = [video('old', { createdAt: at(2020, 3, 2), rating: 9 }), video('new'), video('gem', { rating: 10 })];
  const plays = [
    play('old', at(2026, 8, 1)), // before the range: "old" is a returning video
    play('old', at(2026, 9, 12, 23)),
    play('old', at(2026, 9, 13, 23)),
    play('old', at(2026, 9, 14, 23)),
    play('new', at(2026, 9, 15, 23), 5 * MIN),
  ];
  const f = storyFacts({ start: at(2026, 9, 12, 0), end: at(2026, 9, 19, 0), label: 'This week' }, videos, plays, NOW);
  assert.equal(f.plays, 4);
  assert.equal(f.firsts, 1);
  assert.equal(f.returns, 1);
  assert.equal(f.top[0].id, 'old');
  assert.equal(f.top[0].days, 3);
  assert.equal(f.comfort.id, 'old');
  assert.equal(f.dayparts.find((d) => d.key === 'night').share, 1);
  assert.equal(f.persona.name, 'The Night Owl');
  assert.equal(f.throwback.videoId, 'old');
  assert.equal(f.throwback.years, 6);
  assert.equal(f.gem.videoId, 'gem');
  assert.equal(f.completion, (1 + 1 + 1 + 0.5) / 4);
  assert.equal(f.timeline.length, 7);
  assert.ok(f.equivalents.length >= 1);
});

test('an empty range is a collector, not a crash', () => {
  const f = storyFacts({ start: at(2026, 9, 12, 0), end: at(2026, 9, 19, 0), label: 'x' }, [video('a')], [], NOW);
  assert.equal(f.persona.name, 'The Collector');
  assert.equal(f.top.length, 0);
  assert.equal(f.biggestDay, null);
});

test('ranges, highlights, growth', () => {
  assert.equal(monthRanges(NOW, 3)[0].start, new Date(2026, 9, 1).getTime());
  assert.equal(yearRange(2026, NOW).start, new Date(2026, 0, 1).getTime());
  assert.equal(highlightAt(60_000, [42_000]), 42_000);
  assert.equal(highlightAt(100_000, [98_000]), 92_000);
  assert.equal(highlightAt(10_000), 0);
  assert.equal(highlightAt(100_000), 25_000);
  const g = growth([video('a', { importedAt: at(2026, 9, 2) }), video('b', { importedAt: at(2026, 8, 2) })], NOW, 3);
  assert.deepEqual(g.map((x) => x.count), [0, 1, 1]);
});

test('personal records point at the videos behind them', () => {
  const r = personalRecords(
    [video('a'), video('b')],
    [play('a', at(2026, 9, 1), 50 * MIN), play('b', at(2026, 9, 1, 21), 30 * MIN), play('a', at(2026, 9, 2)), play('a', at(2026, 9, 3))],
    fmt
  );
  const get = (k) => r.find((x) => x.key === k);
  assert.equal(get('sitting').videoId, 'a');
  assert.equal(get('sitting').value, '50 min');
  assert.equal(get('day').value, '80 min');
  assert.equal(get('variety').value, '2');
  assert.equal(get('repeat').value, '×3');
  assert.equal(get('streak').value, '3 days');
});

test('journey, level, insights, memories, rediscover', () => {
  const j = journey([video('a', { importedAt: at(2026, 1, 1) })], [play('a', at(2026, 1, 2))], [{ at: at(2026, 2, 1), title: '10 videos', icon: 'videos' }]);
  assert.deepEqual(j.map((m) => m.title), ['10 videos', 'First watch in ReelVault', 'Your first video']);
  const l = levelFor(3, 0, 0);
  assert.equal(l.xp, 300);
  assert.equal(l.level, 2);
  assert.equal(l.into, 50);
  assert.equal(l.need, 500);
  const ins = noticed([video('a', { importedAt: at(2026, 5, 1) })], [], NOW, { watchedMs: 0, prevMs: 0, change: null, peakWeekday: null, label: 'Last 7 days' }, 0, fmt);
  assert.ok(ins.some((x) => x.key === 'never'));
  const memories = onThisDay([video('a', { createdAt: at(2023, 9, 18, 12) }), video('b', { createdAt: at(2024, 9, 16, 12) })], NOW);
  assert.equal(memories.exact, true);
  assert.deepEqual(memories.videos.map((v) => v.id), ['a']);
  assert.equal(onThisDay([video('b', { createdAt: at(2024, 9, 16, 12) })], NOW).exact, false);
  const re = rediscover([video('fav', { rating: 9 }), video('never')], [play('fav', at(2026, 5, 1))], NOW);
  assert.equal(re[0].video.id, 'fav');
  assert.match(re[1].why, /Never watched/);
});

test('space ideas only offer what the app can act on, biggest first', () => {
  const ideas = spaceIdeas(
    [video('a', { flag: -1 }), video('b', { meta: { codec: 'H.264' }, sizeBytes: 100 * 1024 * 1024 }), video('c'), video('d')],
    [video('x', { sizeBytes: 5 })],
    [['c', 'd']],
    [play('a', NOW)],
    NOW
  );
  assert.deepEqual(ideas.map((i) => i.key).sort(), ['cold', 'deleted', 'dups', 'rejects', 'smaller']);
  assert.ok(ideas[0].bytes >= ideas[ideas.length - 1].bytes);
  assert.deepEqual(ideas.find((i) => i.key === 'dups').ids, ['d']);
});

test('badges know the video that earned them; new and secret ones', () => {
  const videos = Array.from({ length: 10 }, (_, i) => video(`v${i}`, { importedAt: at(2026, 6, 1 + i) }));
  videos.push(video('ten', { rating: 10, createdAt: at(2019, 1, 1), importedAt: at(2026, 9, 3) }));
  const plays = [
    play('ten', at(2026, 9, 3, 3)), // 3 am, same day as imported, filmed 7 years ago
    ...['v1', 'v2', 'v3', 'v4', 'v5'].map((id, i) => play(id, at(2026, 9, 4, 10 + i))),
  ];
  const list = achievements({ videos, plays, bookmarks: 0, albums: 0, smartFilters: 0, series: 0, seriesFinished: 0, kept: 0, simkl: null, now: NOW });
  const get = (id) => list.find((a) => a.id === id);
  assert.equal(get('library-10').videoId, 'v9');
  assert.equal(get('perfect-10').videoId, 'ten');
  assert.equal(get('throwback').unlocked, true);
  assert.equal(get('throwback').videoId, 'ten');
  assert.equal(get('fresh').unlocked, true);
  assert.equal(get('five-a-day').unlocked, true);
  assert.equal(get('five-a-day').videoId, 'v5');
  assert.equal(get('witching-hour').unlocked, true);
  assert.equal(get('witching-hour').secret, true);
  assert.equal(get('holidays').unlocked, false);
  assert.equal(get('time-traveller').unlocked, false);
  assert.equal(get('time-traveller').videoId, null, 'a badge not earned yet has no video');
});

test('story facts: your era is the filming year you watched most', () => {
  const videos = [video('a', { createdAt: at(2023, 4, 1) }), video('b', { createdAt: at(2023, 6, 1) }), video('c', { createdAt: at(2026, 1, 1) })];
  const plays = [play('a', at(2026, 9, 12)), play('b', at(2026, 9, 13)), play('c', at(2026, 9, 14), 5 * MIN)];
  const f = storyFacts({ start: at(2026, 9, 1, 0), end: at(2026, 10, 1, 0), label: 'October' }, videos, plays, NOW);
  assert.equal(f.era.year, 2023);
  assert.equal(f.era.years, 2);
  assert.ok(Math.abs(f.era.share - 0.8) < 0.001);
  const one = storyFacts({ start: at(2026, 9, 1, 0), end: at(2026, 10, 1, 0), label: 'October' }, videos, [plays[0]], NOW);
  assert.equal(one.era, null);
});
