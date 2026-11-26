// Rank videos showed covers only: its players waited for a "ready" event, and the
// grid's previews kept playing behind the page. These guard both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../src/features/vault/ui/${f}`, import.meta.url), 'utf8');

test('rank players start playing in their setup, sharing the sound', () => {
  const src = read('rank/RankStage.tsx');
  const setup = src.slice(src.indexOf('useVideoPlayer('), src.indexOf('});', src.indexOf('useVideoPlayer(')));
  assert.match(setup, /pl\.play\(\)/);
  assert.match(setup, /audioMixingMode = 'mixWithOthers'/);
});

test('rank panes have a sound button', () => {
  const src = read('rank/RankStage.tsx');
  assert.match(src, /onSound=/);
  assert.match(src, /name=\{sound \? 'sound' : 'muted'\}/);
});

test('grid previews stop while a page with its own videos is open', () => {
  const src = read('VaultScreen.tsx');
  const m = /const gridPlays = ([^;]+);/.exec(src);
  assert.ok(m, 'gridPlays is defined');
  for (const open of ['playing', 'slideshow', 'insights', 'rankOpen', 'clipsOpen', 'gamesOpen', 'triage', 'sidebarOpen']) assert.match(m[1], new RegExp(`!${open}\\b`), open);
  assert.match(src, /livePreview=\{gridPlays\}/);
});
