// Run with `npm test`. A big library stays quick: 5,000 videos and 40,000 plays
// through everything that runs while you use the app. Each step has a budget
// well above what it needs on a PC, so a slow pattern (a list searched inside
// a loop) shows up as a failure long before it shows up on the phone.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { achievements } from '../src/features/vault/achievements.ts';
import { libraryHealth, periodDashboard } from '../src/features/vault/dashboard.ts';
import { fuzzyFind } from '../src/features/vault/fuzzy.ts';
import { homeRows } from '../src/features/vault/homeRows.ts';
import { memories } from '../src/features/vault/memories.ts';
import { buildOverview, overviewInsights } from '../src/features/vault/overview.ts';
import { personalRecords, rediscover, spaceIdeas, storyFacts } from '../src/features/vault/recap.ts';
import { videoDashboard, wrapped } from '../src/features/vault/stats.ts';
import { computeSectionedLayout } from '../src/features/vault/ui/layout.ts';
import { groupDuplicates, groupItems, matchesRule } from '../src/features/vault/ui/logic.ts';
import { yearHeat } from '../src/features/vault/yearHeat.ts';

const N = 5000;
const PLAYS = 40000;
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 19, 20).getTime();
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const TAGS = ['holiday', 'family', 'beach', 'city', 'food', 'night', 'funny', 'uni', 'Travel/Japan', 'Travel/Italy', 'pets', 'music', 'sport', 'friends', 'work'];

const videos = Array.from({ length: N }, (_, i) => {
  const createdAt = NOW - Math.floor(rnd() * 6 * 365) * DAY - Math.floor(rnd() * DAY);
  return {
    id: `v${i}`,
    filename: `IMG_${1000 + i}.MOV`,
    title: i % 5 ? null : `Clip number ${i}`,
    notes: i % 9 ? null : 'a note',
    rating: Math.floor(rnd() * 11),
    status: [null, 'completed', 'plantowatch', 'watching'][i % 4],
    tagNames: TAGS.filter(() => rnd() < 0.12),
    createdAt,
    importedAt: createdAt + DAY,
    durationMs: Math.floor(5000 + rnd() * 600000),
    sizeBytes: Math.floor(5e6 + rnd() * 5e8),
    width: i % 3 ? 1080 : 1920,
    height: i % 3 ? 1920 : 1080,
    contentKey: i % 50 === 0 ? 'dup' + (i % 7) : `k${i}`,
    location: i % 4 ? null : { lat: 51 + rnd(), lon: 7 + rnd() },
    albumIds: [],
    isPrivate: false,
    deletedAt: null,
    flag: 0,
    thumbSource: null,
    tagCount: 0,
    inTray: false,
  };
});
const plays = Array.from({ length: PLAYS }, () => {
  const v = videos[Math.floor(rnd() * N)];
  return { videoId: v.id, startedAt: NOW - Math.floor(rnd() * 3 * 365 * DAY), watchedMs: Math.floor(rnd() * (v.durationMs ?? 60000)) };
}).sort((a, b) => a.startedAt - b.startedAt);

const timings = [];
function within(label, budgetMs, fn) {
  const t = performance.now();
  const out = fn();
  const ms = performance.now() - t;
  timings.push(`${label.padEnd(28)} ${ms.toFixed(0).padStart(5)} ms`);
  assert.ok(ms < budgetMs, `${label} took ${ms.toFixed(0)} ms (budget ${budgetMs})`);
  return out;
}

test('5,000 videos and 40,000 plays stay quick', () => {
  const year = { start: new Date(2026, 0, 1).getTime(), end: NOW, label: '2026' };
  within('group by month', 400, () => groupItems(videos, 'month'));
  within('group by keyword', 400, () => groupItems(videos, 'keyword'));
  const sections = groupItems(videos, 'month').map((s) => ({ key: s.key, title: s.title, items: s.items }));
  within('grid layout', 400, () => computeSectionedLayout(sections, { style: 'grid', size: 'medium', width: 390, gap: 3, headerHeight: 38 }));
  within('search (fuzzy)', 400, () => fuzzyFind('holidy', videos, (v) => `${v.title ?? ''} ${v.filename} ${v.tagNames.join(' ')}`));
  within('smart filter', 400, () => videos.filter((v) => matchesRule(v, { minRating: 7, tags: ['beach'] })));
  within('duplicates', 400, () => groupDuplicates(videos));
  within('home rows', 600, () => homeRows(videos, plays, NOW));
  within('dashboard (month)', 800, () => periodDashboard('month', videos, plays, NOW));
  within('library health', 800, () => libraryHealth(videos, plays));
  within('video dashboard', 800, () => videoDashboard(videos, plays));
  within('wrapped (year)', 1200, () => wrapped(year, videos, plays));
  within('story facts (year)', 1200, () => storyFacts(year, videos, plays, NOW));
  within('records', 800, () => personalRecords(videos, plays, (ms) => `${ms}`));
  within('rediscover', 800, () => rediscover(videos, plays, NOW));
  within('space ideas', 800, () => spaceIdeas(videos, [], [], plays, NOW));
  within('memories', 1500, () => memories(videos, plays, NOW));
  within('badges', 1500, () => achievements({ videos, plays, bookmarks: 40, albums: 5, smartFilters: 3, series: 4, seriesFinished: 1, kept: 0, now: NOW }));
  const ov = videos.map((v) => ({ ...v, thumb: null, where: 'library', removedAt: null }));
  const entries = within('overview', 1200, () => buildOverview(ov, [], [], plays));
  within('overview insights', 600, () => overviewInsights(entries));
  within('year heat map', 400, () => yearHeat(plays, 2026, NOW));
  console.log(`\n${timings.join('\n')}`);
});
