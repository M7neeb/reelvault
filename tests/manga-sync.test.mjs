// Run with `npm test`. A later backup bringing the new chapters of a series you already have.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pendingChapters } from '../src/features/vault/manga/mangaBackup.ts';

const ch = (number, name = '') => ({ key: `k${number}`, number, name, readAt: null, lastPage: 0, uploadedAt: null });

test('a backup chapter the library does not have comes in', () => {
  const local = [{ number: 1, title: 'Chapter 1' }, { number: 2, title: 'Chapter 2' }];
  const backup = [ch(1, 'Chapter 1'), ch(2, 'Chapter 2'), ch(3, 'Chapter 3')];
  const fresh = pendingChapters(local, backup);
  assert.deepEqual(fresh.map((c) => c.number), [3]);
});

test('nothing new gives nothing back', () => {
  const local = [{ number: 1, title: 'Chapter 1' }, { number: 2, title: 'Chapter 2' }];
  const backup = [ch(1, 'Chapter 1'), ch(2, 'Chapter 2')];
  assert.deepEqual(pendingChapters(local, backup), []);
});

test('a chapter with no number is recognised by its name', () => {
  const local = [{ number: null, title: 'Prologue' }];
  const backup = [ch(null, 'Prologue'), ch(null, 'Epilogue')];
  assert.deepEqual(pendingChapters(local, backup).map((c) => c.name), ['Epilogue']);
});

test('a chapter with no number matches on a filename when the title is empty', () => {
  const local = [{ number: null, title: null, filename: 'Prologue.cbz' }];
  const backup = [ch(null, 'Prologue')];
  assert.deepEqual(pendingChapters(local, backup), []);
});

test('an empty library takes the whole backup', () => {
  const backup = [ch(1, 'One'), ch(2, 'Two')];
  assert.equal(pendingChapters([], backup).length, 2);
});

test('a renumbered chapter is treated as new rather than dropped', () => {
  // 7.5 was inserted between 7 and 8 after you read it: the new number is not known locally.
  const local = [{ number: 7, title: 'Chapter 7' }, { number: 8, title: 'Chapter 8' }];
  const backup = [ch(7, 'Chapter 7'), ch(7.5, 'Chapter 7.5'), ch(8, 'Chapter 8')];
  assert.deepEqual(pendingChapters(local, backup).map((c) => c.number), [7.5]);
});
