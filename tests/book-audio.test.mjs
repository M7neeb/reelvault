import test from 'node:test';
import assert from 'node:assert/strict';

import { audioDoneFrac, audioLength, audioOf, listenFrom, nextSpeed, newAudio, parseAudioLinks, placeInAudio, suggestAudio, withAudioLink } from '../src/features/vault/books/bookAudio.ts';

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

test('Listen starts at your place in the book until you have listened yourself', () => {
  assert.equal(listenFrom({ lastPlayedAt: null, positionTrack: 0, positionMs: 0 }, 0.4), 'book');
  assert.equal(listenFrom({ lastPlayedAt: null, positionTrack: 0, positionMs: 0 }, 0.01), 'audio');
  assert.equal(listenFrom({ lastPlayedAt: 5, positionTrack: 0, positionMs: 10_000 }, 0.4), 'book');
  assert.equal(listenFrom({ lastPlayedAt: 5, positionTrack: 2, positionMs: 0 }, 0.4), 'audio');
  assert.equal(listenFrom({ lastPlayedAt: 5, positionTrack: 0, positionMs: 5 * MIN }, 0.4), 'audio');
});

test('the speed button goes round the list', () => {
  const speeds = [0.75, 1, 1.25, 1.5, 2];
  assert.equal(nextSpeed(1, speeds), 1.25);
  assert.equal(nextSpeed(1.1, speeds), 1.25);
  assert.equal(nextSpeed(2, speeds), 0.75);
  assert.equal(nextSpeed(3, speeds), 0.75);
});
