// Run with `npm test`. AniList tracking rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chaptersToMark, cleanDescription, entryFor, fromAniStatus, parseDetails, parseMedia, progressOf, tokenFromRedirect } from '../src/features/vault/manga/anilistLogic.ts';

const c = (number, readAt = null, id = `c${number}`) => ({ id, number, readAt });

test('progress = the highest whole chapter finished, or how many when unnumbered', () => {
  assert.equal(progressOf([c(1, 5), c(2, 6), c(3)]), 2);
  assert.equal(progressOf([c(10.5, 5), c(11)]), 10);
  assert.equal(progressOf([c(null, 1), c(null, 2), c(null)]), 2);
  assert.equal(progressOf([c(1)]), 0);
});

test('entry: status, progress and score', () => {
  assert.deepEqual(entryFor({ status: 'reading', rating: 8.5, chapters: [c(1, 1)] }), { status: 'CURRENT', progress: 1, scoreRaw: 85 });
  assert.equal(entryFor({ status: 'planned', rating: 0, chapters: [c(1, 1)] }).status, 'CURRENT');
  assert.equal(entryFor({ status: 'planned', rating: 0, chapters: [c(1)] }).status, 'PLANNING');
  assert.equal(entryFor({ status: null, rating: 0, chapters: [] }).status, 'PLANNING');
  assert.equal(entryFor({ status: 'onHold', rating: 0, chapters: [] }).status, 'PAUSED');
  assert.equal(fromAniStatus('REPEATING'), 'reading');
  assert.equal(fromAniStatus(null), null);
});

test('AniList read further: mark those chapters here', () => {
  assert.deepEqual(chaptersToMark([c(1, 5), c(2), c(3), c(4), c(null)], 3), ['c2', 'c3']);
  assert.deepEqual(chaptersToMark([c(1)], 0), []);
});

test('parsing AniList answers', () => {
  const m = parseMedia({ id: 30013, title: { romaji: 'One Piece', english: 'One Piece', native: 'ONE PIECE' }, coverImage: { large: 'x.jpg' }, chapters: null, status: 'RELEASING', startDate: { year: 1997 }, countryOfOrigin: 'JP' });
  assert.equal(m.title, 'One Piece');
  assert.deepEqual(m.altTitles, ['ONE PIECE']);
  assert.equal(m.url, 'https://anilist.co/manga/30013');
  assert.equal(parseMedia({}), null);
  const d = parseDetails({ description: 'A <i>pirate</i>.<br><br>(Source: x)', genres: ['Action'], status: 'FINISHED', countryOfOrigin: 'KR', staff: { edges: [{ role: 'Art', node: { name: { full: 'B' } } }, { role: 'Story', node: { name: { full: 'A' } } }] } });
  assert.deepEqual([d.author, d.artist, d.pubStatus, d.kind], ['A', 'B', 'completed', 'manhwa']);
  assert.equal(cleanDescription('a<br>b &amp; c'), 'a\nb & c');
});

test('the sign-in address back from AniList', () => {
  const t = tokenFromRedirect('reelvault://auth/anilist#access_token=abc.def&token_type=Bearer&expires_in=31536000');
  assert.equal(t.token, 'abc.def');
  assert.ok(t.expiresAt > Date.now() + 300 * 86_400_000);
  assert.equal(tokenFromRedirect('reelvault://auth/anilist#error=access_denied'), null);
});
