import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spineColor, spineHue } from '../src/features/vault/spineColor.ts';

test('the same name always gets the same spine, case and spaces aside', () => {
  assert.equal(spineHue('Berries'), spineHue(' berries '));
  assert.equal(spineColor('Ember Road'), spineColor('Ember Road'));
  assert.match(spineColor('x', 'light'), /^hsl\(\d+, 64%, 44%\)$/);
});

test('names spread over the colour wheel', () => {
  const hues = ['Berries', 'Ember Road', 'SD', 'Harbour Lights', 'The Long Field', 'Tower of Days', 'City walks', 'Crime and Punishment'].map(spineHue);
  assert.ok(hues.every((h) => h >= 0 && h < 360));
  // Not all bunched together: at least 5 different 45-degree slices.
  assert.ok(new Set(hues.map((h) => Math.floor(h / 45))).size >= 5);
});
