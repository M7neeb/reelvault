// Run with `npm test`. The spreadsheet export, cloud drives, show time left,
// finales, Continue watching, audio settings, cover colours and backup merging.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { csvCell, sheetLength, toCsv } from '../src/features/vault/sheetExport.ts';
import { base64Url, codeFromRedirect, parseDropboxList, parseGraphList, parseTokens, signInUrl, visibleEntries } from '../src/features/vault/cloud/cloudLogic.ts';
import { finaleLabel, fmtMinutes, minutesLeft, parseEpisodes, parsePlayback, upToHere } from '../src/features/simkl/logic.ts';
import { parseAudioPrefs, smartRewindMs } from '../src/features/vault/audio/audioLogic.ts';
import { usableAccent } from '../src/features/vault/manga/coverColor.ts';
import { progressToMerge } from '../src/features/vault/manga/mangaBackup.ts';

test('spreadsheet cells: quotes, commas, line breaks and formulas are made safe', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a, b'), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(7), '7');
  assert.equal(sheetLength(3_725_000), '1:02:05');
  assert.equal(sheetLength(65_000), '1:05');
});

test('spreadsheet: a header row, then one row per video', () => {
  const csv = toCsv([
    { title: 'Lake', filename: 'IMG_1.mov', createdAt: null, importedAt: null, durationMs: 90_000, sizeBytes: 10_485_760, rating: 8, flag: 1, status: 'Watched', keywords: ['trip', 'summer'], albums: ['Holiday'], caption: null, plays: 3, watchedMs: 240_000 },
  ]);
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('Title,File,Filmed'));
  assert.equal(lines[1], 'Lake,IMG_1.mov,,,1:30,10,8,Pick,Watched,trip; summer,Holiday,,3,4');
});

test('cloud sign-in: the address carries PKCE and our redirect; the code comes back only with our state', () => {
  const u = new URL(signInUrl('dropbox', 'abc', 'CH', 'ST'));
  assert.equal(u.searchParams.get('code_challenge'), 'CH');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'reelvault://auth/dropbox');
  assert.equal(u.searchParams.get('token_access_type'), 'offline');
  assert.equal(codeFromRedirect('reelvault://auth/dropbox?code=XYZ&state=ST', 'ST'), 'XYZ');
  assert.equal(codeFromRedirect('reelvault://auth/dropbox?code=XYZ&state=OTHER', 'ST'), null);
  assert.equal(codeFromRedirect('reelvault://auth/dropbox?error=access_denied&state=ST', 'ST'), null);
  assert.equal(base64Url('a+b/c=='), 'a-b_c');
});

test('cloud tokens: expiry a minute early, refresh kept when not sent again, errors said', () => {
  const t = parseTokens({ access_token: 'A', expires_in: 3600 }, 1000, 'R');
  assert.equal(t.access, 'A');
  assert.equal(t.refresh, 'R');
  assert.equal(t.expiresAt, 1000 + 3540_000);
  assert.throws(() => parseTokens({ error_description: 'bad code' }, 0), /bad code/);
});

test('cloud listings: Dropbox and OneDrive into one shape; folders first, only videos', () => {
  const d = parseDropboxList({
    entries: [
      { '.tag': 'file', name: 'b.mp4', path_lower: '/v/b.mp4', path_display: '/V/b.mp4', size: 5, client_modified: '2026-01-02T00:00:00Z' },
      { '.tag': 'folder', name: 'Trips', path_lower: '/v/trips', path_display: '/V/Trips' },
      { '.tag': 'file', name: 'notes.txt', path_lower: '/v/notes.txt', size: 1 },
    ],
    has_more: true,
    cursor: 'C',
  });
  assert.equal(d.cursor, 'C');
  const shown = visibleEntries(d.entries);
  assert.deepEqual(shown.map((e) => e.name), ['Trips', 'b.mp4']);
  assert.equal(shown[1].id, '/V/b.mp4');
  const g = parseGraphList({ value: [{ id: '1', name: 'a.MOV', size: 9, file: {}, '@microsoft.graph.downloadUrl': 'https://dl' }, { id: '2', name: 'Pics', folder: { childCount: 3 } }], '@odata.nextLink': 'https://next' });
  assert.equal(g.next, 'https://next');
  assert.equal(g.entries[0].downloadUrl, 'https://dl');
  assert.equal(g.entries[1].folder, true);
});

test('episodes keep finale markers and runtimes; time left counts what you have not seen', () => {
  const eps = parseEpisodes(
    [
      { season: 1, episode: 1, aired: true, runtime: 50 },
      { season: 1, episode: 2, aired: true, runtime: null, finale_type: 2 },
      { season: 2, episode: 1, aired: true, runtime: 45, finale_type: 3 },
      { season: 2, episode: 2, aired: false, runtime: 45 },
      { type: 'special', episode: 1, aired: true, runtime: 20 },
    ],
    'show'
  );
  assert.equal(eps[1].finale, 2);
  assert.equal(finaleLabel(eps[2].finale), 'Series finale');
  assert.equal(finaleLabel(null), null);
  const left = minutesLeft(eps, new Set(['1:1']), 40);
  assert.deepEqual(left, { minutes: 85, episodes: 2, guessed: true });
  assert.equal(fmtMinutes(85), '1 h 25 min');
  assert.equal(fmtMinutes(45), '45 min');
  assert.deepEqual(upToHere(eps, { season: 2, episode: 1 }), [
    { season: 1, episode: 1 },
    { season: 1, episode: 2 },
    { season: 2, episode: 1 },
  ]);
});

test('Continue watching: paused movies and episodes, newest first; ones without an id skipped', () => {
  const rows = parsePlayback([
    { id: 1, progress: 45.5, paused_at: '2026-10-01T10:00:00Z', type: 'episode', episode: { season: 2, number: 4 }, show: { title: 'Show', ids: { simkl: 11 } } },
    { id: 2, progress: 75, paused_at: '2026-10-05T10:00:00Z', type: 'movie', movie: { title: 'Film', ids: { simkl: 22 } } },
    { id: 3, progress: 10, movie: { title: 'No id', ids: {} } },
  ]);
  assert.deepEqual(rows.map((r) => r.simklId), [22, 11]);
  assert.equal(rows[1].season, 2);
  assert.equal(rows[1].episode, 4);
  assert.equal(rows[1].type, 'show');
  assert.equal(rows[0].episode, null);
});

test('audio: smart rewind follows the chosen amount; settings read safely', () => {
  assert.equal(smartRewindMs(5 * 60_000), 5_000);
  assert.equal(smartRewindMs(5 * 60_000, 2), 10_000);
  assert.equal(smartRewindMs(5 * 60_000, 0), 0);
  assert.equal(smartRewindMs(30_000, 2), 0);
  assert.deepEqual(parseAudioPrefs(null), { rewind: 1, favSpeeds: [1, 1.2, 1.5] });
  assert.deepEqual(parseAudioPrefs(JSON.stringify({ rewind: 0.5, favSpeeds: [1.5, 2, 9, 1.5] })), { rewind: 0.5, favSpeeds: [1.5, 2] });
  assert.equal(parseAudioPrefs(JSON.stringify({ rewind: 7 })).rewind, 1);
});

test('cover colours: only colours that read well', () => {
  assert.equal(usableAccent('#d94a2a'), '#d94a2a');
  assert.equal(usableAccent('#808080'), null);
  assert.equal(usableAccent('#0a0a10'), null);
  assert.equal(usableAccent('#fbf7f0'), null);
  assert.equal(usableAccent(''), null);
});

test('backup of a title you have: the furthest progress wins, nothing is unmarked', () => {
  const local = [
    { id: 'a', number: 1, readAt: 5, lastPage: 0 },
    { id: 'b', number: 2, readAt: null, lastPage: 3 },
    { id: 'c', number: 3, readAt: null, lastPage: 9 },
    { id: 'd', number: null, readAt: null, lastPage: 0 },
  ];
  const backup = [
    { number: 1, readAt: null, lastPage: 0 },
    { number: 2, readAt: 77, lastPage: 20 },
    { number: 3, readAt: null, lastPage: 4 },
    { number: 3, readAt: null, lastPage: 12 },
  ];
  assert.deepEqual(progressToMerge(local, backup), { read: [{ id: 'b', at: 77 }], pages: [{ id: 'c', page: 12 }] });
});
