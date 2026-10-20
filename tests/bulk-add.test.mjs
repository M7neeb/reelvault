// Run with `npm test`. Pasting many titles into a list: cleaning the lines and matching each to Simkl.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { googleUrl, normTitle, parseTitleLines, pickMatch } from '../src/features/simkl/bulkAdd.ts';

test('pasted lines: bullets, numbers, years, ratings and repeats', () => {
  const list = parseTitleLines('1. Naruto\n- One Piece (1999)\n• Re:Zero - 9/10\n\n[x] Steins;Gate\nnaruto\n12) Attack on Titan [2013]\n');
  assert.deepEqual(
    list.map((t) => [t.name, t.year]),
    [
      ['Naruto', null],
      ['One Piece', 1999],
      ['Re:Zero', null],
      ['Steins;Gate', null],
      ['Attack on Titan', 2013],
    ]
  );
  assert.deepEqual(parseTitleLines('Dune, Alien, Heat').map((t) => t.name), ['Dune', 'Alien', 'Heat']);
  assert.deepEqual(parseTitleLines('2001: A Space Odyssey').map((t) => t.name), ['2001: A Space Odyssey']);
  assert.equal(normTitle('Re:ZERO -Starting Life-'), 're zero starting life');
  assert.equal(normTitle('Fast & Furious'), 'fast and furious');
});

test('the right search result, or none when it is a guess', () => {
  const r = (title, year, simklId = year) => ({ simklId, type: 'anime', title, year, poster: null, slug: null });
  const results = [r('One Piece Film: Red', 2022), r('One Piece', 2023, 1), r('One Piece', 1999, 2)];
  assert.equal(pickMatch({ name: 'One Piece', year: 1999 }, results).simklId, 2);
  assert.equal(pickMatch({ name: 'one piece', year: null }, results).simklId, 1);
  assert.equal(pickMatch({ name: 'Naruto', year: null }, [r('Naruto Shippuden', 2007)]).title, 'Naruto Shippuden');
  assert.equal(pickMatch({ name: 'Bleach', year: null }, [r('Something Else', 2001)]), null);
  assert.equal(pickMatch({ name: 'Bleach', year: null }, []), null);
});

test('a Google search says what kind of title it is', () => {
  assert.equal(googleUrl({ title: 'Monster', year: 2004, type: 'anime' }), 'https://www.google.com/search?q=Monster%202004%20anime');
  assert.equal(googleUrl({ title: 'Dark', year: null, type: 'show' }), 'https://www.google.com/search?q=Dark%20TV%20series');
});
