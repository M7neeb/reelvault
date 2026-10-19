// Run with `npm test`. Forgiving search.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { editDistance, fuzzyFind, fuzzyScore, rememberSearch } from '../src/features/vault/fuzzy.ts';

test('edit distance counts slips, a swap counts once', () => {
  assert.equal(editDistance('family', 'famly'), 1);
  assert.equal(editDistance('birthday', 'birthdya'), 1);
  assert.equal(editDistance('cat', 'dog'), 3);
});

test('typos still match; unrelated words do not', () => {
  assert.ok(fuzzyScore('famly', 'family_evening_oct') > 0);
  assert.ok(fuzzyScore('birthdya', 'birthday_cut_v2') > 0);
  assert.ok(fuzzyScore('even', 'family_evening_oct') > 0);
  assert.equal(fuzzyScore('beach', 'family_evening_oct'), 0);
  // Short words must match exactly or as the start of a word.
  assert.equal(fuzzyScore('cat', 'cot video'), 0);
  // Every word has to match.
  assert.equal(fuzzyScore('family beach', 'family_evening_oct'), 0);
});

test('best match first', () => {
  const names = ['Downtown at dusk', 'Down by the river', 'IMG_4462_lake'];
  assert.deepEqual(fuzzyFind('downtwn', names, (x) => x), ['Downtown at dusk']);
  assert.deepEqual(fuzzyFind('down', names, (x) => x), ['Downtown at dusk', 'Down by the river'].sort((a, b) => fuzzyScore('down', b) - fuzzyScore('down', a)));
});

test('recent searches', () => {
  assert.deepEqual(rememberSearch(['beach', 'Family'], 'family'), ['family', 'beach']);
  assert.deepEqual(rememberSearch(['a'], ' '), ['a']);
});
