import test from 'node:test';
import assert from 'node:assert/strict';

import { audioDoneFrac, audioLength, audioOf, chapterKey, listenAlongFrom, listeningAsReads, matchingAudioChapter, matchingTextChapter, nextSpeed, newAudio, parseAudioLinks, placeInAudio, suggestAudio, withAudioLink } from '../src/features/vault/books/bookAudio.ts';

const MIN = 60_000;
const a = (id, title, over = {}) => ({ id, title, filename: `${id}.m4b`, author: null, durationMs: null, tracks: [], ...over });
const book = (title, over = {}) => ({ id: 'b1', title, filename: 'book.epub', author: 'Fyodor Dostoevsky', ...over });

test('links are read back safely and changed without touching the old object', () => {
  assert.deepEqual(parseAudioLinks(null), {});
  assert.deepEqual(parseAudioLinks('nope'), {});
  assert.deepEqual(parseAudioLinks('["x"]'), {});
  assert.deepEqual(parseAudioLinks('{"b1":"a1","b2":5,"b3":""}'), { b1: 'a1' });
  const links = { b1: 'a1' };
  assert.deepEqual(withAudioLink(links, 'b2', 'a2'), { b1: 'a1', b2: 'a2' });
  assert.deepEqual(withAudioLink(links, 'b1', null), {});
  assert.deepEqual(links, { b1: 'a1' });
});

test('the audiobook of a book is only given while it is still in Audio', () => {
  const audio = [a('a1', 'One')];
  assert.equal(audioOf({ b1: 'a1' }, 'b1', audio)?.id, 'a1');
  assert.equal(audioOf({ b1: 'gone' }, 'b1', audio), null);
  assert.equal(audioOf({}, 'b1', audio), null);
});

test('an audio item with the same title is suggested, the closest one first', () => {
  const audio = [a('a1', 'War and Peace'), a('a2', 'Crime and Punishment (Unabridged)'), a('a3', 'Crime and Punishment: Part One'), a('a4', null, { filename: 'the_crime_and_punishment.mp3' })];
  assert.equal(suggestAudio(book('Crime and Punishment'), audio, {})?.id, 'a2');
  assert.equal(suggestAudio(book('The Crime and Punishment'), [audio[3]], {})?.id, 'a4');
  assert.equal(suggestAudio(book('Crime and Punishment'), [audio[0], audio[2]], {})?.id, 'a3');
  assert.equal(suggestAudio(book('The Idiot'), audio, {}), null);
  assert.equal(suggestAudio(book('It'), [a('x', 'It')], {}), null);
});

test('an audiobook already given to another book is not suggested again', () => {
  const audio = [a('a2', 'Crime and Punishment')];
  assert.equal(suggestAudio(book('Crime and Punishment'), audio, { other: 'a2' }), null);
  assert.equal(suggestAudio(book('Crime and Punishment'), audio, { b1: 'a2' })?.id, 'a2');
});

test('a place in the text lands at the same fraction of the audio, a little early', () => {
  const tracks = [{ durationMs: 10 * MIN }, { durationMs: 20 * MIN }, { durationMs: 30 * MIN }];
  assert.deepEqual(placeInAudio(tracks, 0), { track: 0, ms: 0 });
  // Half of 60 min = 30 min, less 15 s: the very end of the second file.
  assert.deepEqual(placeInAudio(tracks, 0.5), { track: 1, ms: 20 * MIN - 15_000 });
  assert.deepEqual(placeInAudio(tracks, 0.75), { track: 2, ms: 15 * MIN - 15_000 });
  // Never past the last half minute.
  assert.deepEqual(placeInAudio(tracks, 1), { track: 2, ms: 30 * MIN - 30_000 });
  assert.deepEqual(placeInAudio(tracks, 7), { track: 2, ms: 30 * MIN - 30_000 });
  assert.equal(placeInAudio([{ durationMs: null }], 0.5), null);
  assert.equal(placeInAudio([], 0.5), null);
  assert.deepEqual(placeInAudio([{ durationMs: 20_000 }], 0.9), { track: 0, ms: 0 });
});

test('length comes from the item, else from its files; new items are the ones not seen before', () => {
  assert.equal(audioLength(a('x', 'X', { durationMs: 5 })), 5);
  assert.equal(audioLength(a('x', 'X', { tracks: [{ durationMs: 2 }, { durationMs: null }, { durationMs: 3 }] })), 5);
  assert.deepEqual(newAudio(new Set(['a1']), [a('a1', 'One'), a('a2', 'Two')]).map((x) => x.id), ['a2']);
});

test('how far through the audiobook you are', () => {
  const tracks = [{ durationMs: 10 * MIN }, { durationMs: 30 * MIN }];
  assert.equal(audioDoneFrac({ durationMs: null, tracks, positionTrack: 1, positionMs: 10 * MIN, finishedAt: null }), 0.5);
  assert.equal(audioDoneFrac({ durationMs: null, tracks, positionTrack: 0, positionMs: 0, finishedAt: 9 }), 1);
  assert.equal(audioDoneFrac({ durationMs: null, tracks: [], positionTrack: 0, positionMs: 5, finishedAt: null }), 0);
});

test('the speed button goes round the list', () => {
  const speeds = [0.75, 1, 1.25, 1.5, 2];
  assert.equal(nextSpeed(1, speeds), 1.25);
  assert.equal(nextSpeed(1.1, speeds), 1.25);
  assert.equal(nextSpeed(2, speeds), 0.75);
  assert.equal(nextSpeed(3, speeds), 0.75);
});

test('chapter names from the text and the audio boil down to the same key', () => {
  assert.equal(chapterKey('Canto V'), 'canto 5');
  assert.equal(chapterKey('Inferno · Canto XXXIV'), 'canto 34');
  assert.equal(chapterKey('03 - Canto 05'), 'canto 5');
  assert.equal(chapterKey('Inferno_Canto_08.mp3'), 'canto 8');
  assert.equal(chapterKey('Chapter Five'), 'chapter 5');
  assert.equal(chapterKey('Ch. 12'), 'chapter 12');
  assert.equal(chapterKey('Part I · Chapter III'), 'chapter 3');
  assert.equal(chapterKey('The Dark Wood'), 'the dark wood');
  assert.equal(chapterKey('Partial actions'), 'partial actions');
  assert.equal(chapterKey('07'), null);
  assert.equal(chapterKey(''), null);
});

// The Divine Comedy: three parts of a few cantos each, one audio file per canto.
const parts = ['Inferno', 'Purgatorio', 'Paradiso'];
const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const textTitles = ['Introduction', ...parts.flatMap((p) => roman.map((r) => `${p} · Canto ${r}`)), 'Notes'];
// Cantos of very different lengths in the audio, so the share of the text is a poor guess.
const lens = parts.flatMap((_, p) => roman.map((_, n) => (8 + ((n * 7 + p * 3) % 9) * 2) * MIN));
const tracks = lens.map((d, i) => ({ durationMs: d, title: `${parts[Math.floor(i / 10)]} Canto ${String((i % 10) + 1).padStart(2, '0')}` }));
const starts = lens.map((_, i) => lens.slice(0, i).reduce((x, y) => x + y, 0));
const audioChapters = tracks.map((t, i) => ({ title: t.title, overallStart: starts[i], lengthMs: lens[i] }));
const comedy = (over = {}) => ({ tracks, lastPlayedAt: null, positionTrack: 0, positionMs: 0, finishedAt: null, ...over });

test('a canto in the text is found in the audio by name, the right part too', () => {
  assert.equal(matchingAudioChapter(textTitles, 5, audioChapters), 4); // Inferno V
  assert.equal(matchingAudioChapter(textTitles, 15, audioChapters), 14); // Purgatorio V
  assert.equal(matchingAudioChapter(textTitles, 0, audioChapters), null); // Introduction
  // Audio of the Inferno only: Canto V is there once, the text has it three times, so no guessing.
  assert.equal(matchingAudioChapter(textTitles, 15, audioChapters.slice(0, 10)), null);
});

test('reading canto 5 and listening to it: after a restart the audio carries on in canto 5', () => {
  // The audio stopped 6 minutes into Inferno Canto V; the text is a little further on.
  const a = comedy({ lastPlayedAt: 1, positionTrack: 4, positionMs: 6 * MIN });
  assert.equal(listenAlongFrom(a, audioChapters, { titles: textTitles, chapter: 5, chapterFrac: 0.6, frac: 0.15 }), null);
});

test('the text moved on to another canto: the audio starts at that canto', () => {
  const a = comedy({ lastPlayedAt: 1, positionTrack: 4, positionMs: 6 * MIN });
  assert.deepEqual(listenAlongFrom(a, audioChapters, { titles: textTitles, chapter: 8, chapterFrac: 0, frac: 0.25 }), { track: 7, ms: 0 });
  const mid = listenAlongFrom(comedy(), audioChapters, { titles: textTitles, chapter: 8, chapterFrac: 0.5, frac: 0.25 });
  assert.deepEqual(mid, { track: 7, ms: lens[7] / 2 - 15_000 });
});

test('no chapter names to go by: the audio keeps its own place while it is near the text', () => {
  const plain = [{ durationMs: 600 * MIN }];
  const a = { tracks: plain, lastPlayedAt: 1, positionTrack: 0, positionMs: 100 * MIN, finishedAt: null };
  assert.equal(listenAlongFrom(a, [], { titles: [], chapter: 0, chapterFrac: 0, frac: 0.2 }), null);
  // The text is far ahead (half way): start from the text instead.
  assert.deepEqual(listenAlongFrom(a, [], { titles: [], chapter: 0, chapterFrac: 0, frac: 0.5 }), { track: 0, ms: 300 * MIN - 15_000 });
  // Never listened: from the text.
  assert.deepEqual(listenAlongFrom({ ...a, lastPlayedAt: null, positionMs: 0 }, [], { titles: [], chapter: 0, chapterFrac: 0, frac: 0.2 }), { track: 0, ms: 120 * MIN - 15_000 });
});

test('listened but hardly read: the audio keeps its own place', () => {
  const a = comedy({ lastPlayedAt: 1, positionTrack: 12, positionMs: 3 * MIN });
  assert.equal(listenAlongFrom(a, audioChapters, { titles: textTitles, chapter: 0, chapterFrac: 0, frac: 0 }), null);
  assert.equal(listenAlongFrom(a, [], { titles: [], chapter: 0, chapterFrac: 0, frac: 0.01 }), null);
});

test('a few seconds of audio do not count as having listened', () => {
  const plain = [{ durationMs: 600 * MIN }];
  const a = { tracks: plain, lastPlayedAt: 5, positionTrack: 0, positionMs: 10_000, finishedAt: null };
  assert.deepEqual(listenAlongFrom(a, [], { titles: [], chapter: 0, chapterFrac: 0, frac: 0.4 }), { track: 0, ms: 240 * MIN - 15_000 });
});

test('listening to a book counts as time with it, but reading along is not counted twice', () => {
  const links = { comedy: 'aud-comedy' };
  const reads = [{ bookId: 'comedy', startedAt: 1000 * MIN, endedAt: 1030 * MIN, ms: 30 * MIN, from: 0, to: 0.1 }];
  const plays = [
    // 20 minutes of it while the book was open and moving: already counted.
    { itemId: 'aud-comedy', startedAt: 1005 * MIN, listenedMs: 20 * MIN },
    // 40 minutes on a walk, well after the reading.
    { itemId: 'aud-comedy', startedAt: 1100 * MIN, listenedMs: 40 * MIN },
    // Half inside, half after.
    { itemId: 'aud-comedy', startedAt: 1020 * MIN, listenedMs: 20 * MIN },
    // Another audiobook, not linked to a book.
    { itemId: 'aud-other', startedAt: 1100 * MIN, listenedMs: 60 * MIN },
  ];
  const out = listeningAsReads(plays, links, reads);
  assert.deepEqual(out.map((r) => [r.bookId, r.ms / MIN]), [['comedy', 40], ['comedy', 10]]);
  assert.deepEqual(listeningAsReads(plays, {}, reads), []);
});

test('the audio moving on to a canto finds that canto in the text', () => {
  assert.equal(matchingTextChapter(textTitles, 4, audioChapters), 5); // Inferno V
  assert.equal(matchingTextChapter(textTitles, 15, audioChapters), 16); // Purgatorio VI
  assert.equal(matchingTextChapter(textTitles, 99, audioChapters), null);
  assert.equal(matchingTextChapter(textTitles, 15, audioChapters.slice(0, 10)), null);
});
