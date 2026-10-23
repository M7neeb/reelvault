// Run with `npm test`. Search everything and Jump back in.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chapterLabel, countByKind, findEverything, jumpBackIn } from '../src/features/home/everything.ts';

const video = (o) => ({ id: 'v1', title: null, filename: 'IMG_0001.mov', notes: null, tagNames: [], isPrivate: false, deletedAt: null, createdAt: Date.UTC(2024, 5, 1), durationMs: 600_000, rating: 0, ...o });
const audio = (o) => ({
  id: 'a1', kind: 'book', title: 'The Long Road', filename: 'road.epub', author: 'Jane Doe', album: null, narrator: null, genre: null, notes: null, tags: [],
  isPrivate: false, deletedAt: null, durationMs: null, tracks: [{ durationMs: 1_000_000 }, { durationMs: 1_000_000 }], positionTrack: 1, positionMs: 500_000,
  lastPlayedAt: 1000, finishedAt: null, status: 'watching', importedAt: 1, rating: 0, ...o,
});
const ch = (i, o = {}) => ({ id: `c${i}`, number: i, volume: null, title: null, readAt: null, lastPage: 0, pageCount: 20, ...o });
const manga = (o) => ({
  id: 'm1', title: 'Tower of Clouds', altTitle: null, author: 'Sora Ito', artist: null, kind: 'manga', notes: null, tags: ['fantasy'], isPrivate: false, deletedAt: null,
  status: 'watching', lastReadAt: 2000, importedAt: 1, rating: 9, chapters: [ch(1, { readAt: 5 }), ch(2, { readAt: 6 }), ch(3), ch(4)], ...o,
});
const title = (o) => ({
  simklId: 7, type: 'show', title: 'Harbour Lights', year: 2024, status: 'watching', rating: 8, memo: null, nextToWatch: 'S02E04', nextTitle: 'The Keeper',
  watchedEpisodes: 10, totalEpisodes: 20, lastWatchedAt: new Date(3000).toISOString(), addedAt: null, ...o,
});
const input = (o = {}) => ({ videos: [video({ title: 'Family trip to the harbour', tagNames: ['summer'] })], audio: [audio()], manga: [manga()], titles: [title()], ...o });

test('finds things in every section, title matches first', () => {
  const hits = findEverything('harbour', input());
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['show', 'video']);
  // "Harbour Lights" starts with the word, so it ranks above the video that only contains it.
  assert.equal(hits[0].kind, 'show');
});

test('people, keywords and typos count', () => {
  assert.equal(findEverything('jane', input())[0].kind, 'book');
  assert.equal(findEverything('fantasy', input())[0].kind, 'manga');
  assert.equal(findEverything('summer', input())[0].kind, 'video');
  assert.equal(findEverything('towr', input())[0].kind, 'manga'); // one letter missing
  assert.deepEqual(findEverything('zzqx', input()), []);
  assert.equal(findEverything('clouds', input())[0].kind, 'manga');
  assert.equal(findEverything('clods', input())[0].kind, 'manga'); // one letter off
});

test('private and deleted things never show', () => {
  const i = input({
    videos: [video({ title: 'Secret harbour', isPrivate: true }), video({ id: 'v2', title: 'Old harbour', deletedAt: 5 })],
    audio: [audio({ title: 'Harbour book', isPrivate: true })],
    manga: [manga({ title: 'Harbour manga', deletedAt: 9 })],
    titles: [],
  });
  assert.deepEqual(findEverything('harbour', i), []);
});

test('a video without a title is found by its file name', () => {
  const hits = findEverything('img', input({ videos: [video()] }));
  assert.equal(hits[0].title, 'IMG_0001.mov');
});

test('empty words find nothing; counts per kind', () => {
  assert.deepEqual(findEverything('   ', input()), []);
  assert.deepEqual(countByKind(findEverything('harbour', input())), { show: 1, video: 1 });
});

test('jump back in: one per section, most recent first', () => {
  const list = jumpBackIn({ ...input(), resume: [{ id: 'v1', ms: 120_000, at: 4000 }] });
  assert.deepEqual(list.map((j) => j.kind), ['video', 'show', 'manga', 'book']);
  const [v, s, m, b] = list;
  assert.equal(v.sub, '8 min left');
  assert.equal(Math.round(v.progress * 100), 20);
  assert.equal(s.sub, 'S02E04 · The Keeper');
  assert.equal(s.progress, 0.5);
  assert.equal(m.sub, 'Ch. 3 next');
  assert.equal(m.progress, 0.5);
  assert.equal(b.sub, 'Chapter 2 of 2');
  assert.equal(b.progress, 0.75);
});

test('jump back in: a chapter part read shows its page; finished things are left out', () => {
  const m = manga({ chapters: [ch(1, { readAt: 5 }), ch(2, { lastPage: 7 })] });
  assert.equal(jumpBackIn({ ...input({ manga: [m] }), resume: [] }).find((j) => j.kind === 'manga').sub, 'Ch. 2 · page 8 of 20');
  const done = { ...input({ audio: [audio({ finishedAt: 9 })], manga: [manga({ status: 'completed' })], titles: [title({ status: 'completed' })] }), resume: [] };
  assert.deepEqual(jumpBackIn(done), []);
  const allRead = manga({ chapters: [ch(1, { readAt: 1 })] });
  assert.deepEqual(jumpBackIn({ ...input({ audio: [], titles: [], manga: [allRead] }), resume: [] }), []);
});

test('chapter labels', () => {
  assert.equal(chapterLabel({ number: 12, volume: null, title: null }), 'Ch. 12');
  assert.equal(chapterLabel({ number: 3, volume: 2, title: 'x' }), 'Vol. 2 Ch. 3');
  assert.equal(chapterLabel({ number: null, volume: null, title: 'Prologue' }), 'Prologue');
});

test('near misses are dropped when something has the very words', () => {
  const i = input({ titles: [title({ title: 'Night Ferry' }), title({ simklId: 8, title: 'Harbour Lights' })] });
  assert.deepEqual(findEverything('lights', i).map((h) => h.title), ['Harbour Lights']);
  // With no exact match, the near miss still helps.
  assert.deepEqual(findEverything('nigth', i).map((h) => h.title), ['Night Ferry']);
});

test('this week across every section, and the week before', async () => {
  const { weekSummary } = await import('../src/features/home/everything.ts');
  const now = new Date(2026, 9, 23, 20).getTime();
  const d = (n) => now - n * 86_400_000;
  const w = weekSummary(
    {
      videoPlays: [{ startedAt: d(1), watchedMs: 600_000 }, { startedAt: d(9), watchedMs: 60_000 }],
      watches: [{ at: d(2), minutes: 45, type: 'show' }, { at: d(2), minutes: 120, type: 'movie' }],
      chapterTimes: [d(0.1), d(3), d(8)],
      audioPlays: [{ startedAt: d(4), listenedMs: 1_800_000 }, { startedAt: d(5), listenedMs: 10_000 }],
    },
    now
  );
  assert.equal(w.videoMs, 600_000);
  assert.deepEqual([w.episodes, w.movies, w.watchMs], [1, 1, 165 * 60_000]);
  assert.equal(w.chapters, 2);
  assert.equal(w.listenMs, 1_810_000);
  assert.equal(w.activeDays, 5); // the 10-second listen doesn't count as a day
  assert.deepEqual([w.before.videoMs, w.before.chapters], [60_000, 1]);
});

test('recent searches', async () => {
  const { rememberSearch } = await import('../src/features/home/everything.ts');
  assert.deepEqual(rememberSearch(['Naruto', 'harbour'], ' Harbour '), ['Harbour', 'Naruto']);
  assert.deepEqual(rememberSearch(['a1'], 'x'), ['a1']);
  assert.equal(rememberSearch(Array.from({ length: 8 }, (_, i) => `q${i}`), 'new').length, 8);
});
