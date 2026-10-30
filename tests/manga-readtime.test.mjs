// Run with `npm test`. Reading time from Tachimanga (Stats table) and Tachiyomi backups, for stats and Wrapped.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planReadTime, tachiFromTachimanga } from '../src/features/vault/manga/mangaBackup.ts';
import { mangaStats } from '../src/features/vault/manga/mangaStats.ts';

const empty = { manga: [], chapters: [], categories: [], categoryManga: [], history: [], sources: [], tracks: [] };

test('Tachimanga Stats rows become reading time (seconds to ms, day when no time)', () => {
  const b = tachiFromTachimanga({
    ...empty,
    stats: [
      { day: 20250415, secs: 250, at: 1744710558801, title: 'Tower of Days ' },
      { day: 20250416, secs: 30, at: 0, title: 'Moonwell' },
      { day: 20250416, secs: 0, at: 0, title: 'Nothing' },
    ],
  });
  assert.equal(b.readTime.length, 2);
  assert.deepEqual(b.readTime[0], { title: 'Tower of Days', at: 1744710558801, ms: 250_000 });
  const d = new Date(b.readTime[1].at);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2025, 3, 16, 12]);
});

test('older backups without Stats bring no reading time', () => {
  assert.deepEqual(tachiFromTachimanga(empty).readTime, []);
});

test('planReadTime puts time on the title of that name, else on "other:"', () => {
  const rows = planReadTime(
    [
      { title: 'tower of days!', at: 1, ms: 1000 },
      { title: 'Solo Gallery', at: 2, ms: 2000 },
      { title: 'Kage no Jitsuryokusha', at: 3, ms: 3000 },
    ],
    [
      { id: 's1', title: 'Tower of Days' },
      { id: 's2', title: 'The Eminence in Shadow', altTitle: 'Kage no Jitsuryokusha' },
    ]
  );
  assert.deepEqual(rows.map((r) => r.seriesId), ['s1', 'other:Solo Gallery', 's2']);
});

test('time on titles not in the library counts in totals, not in the top list', () => {
  const now = Date.UTC(2026, 9, 30, 12);
  const series = [{ id: 's1', title: 'A', deletedAt: null, chapters: [], tags: [], status: null, rating: 0 }];
  const reads = [
    { seriesId: 's1', chapterId: 'backup', startedAt: now - 3_600_000, readMs: 60_000, pages: 0 },
    { seriesId: 'other:B', chapterId: 'backup', startedAt: now - 3_600_000, readMs: 120_000, pages: 0 },
  ];
  const st = mangaStats(series, reads, now);
  assert.equal(st.totalMs, 180_000);
  assert.deepEqual(st.top.map((t) => t.id), ['s1']);
});
