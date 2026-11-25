import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchesSetting, SETTINGS_TERMS } from '../src/features/vault/settingsSearch.ts';

test('every word typed must be found, in any order and case', () => {
  assert.equal(matchesSetting('', 'covers best frame'), true);
  assert.equal(matchesSetting('  ', 'covers best frame'), true);
  assert.equal(matchesSetting('Cover', 'covers best frame'), true);
  assert.equal(matchesSetting('frame best', 'covers best frame'), true);
  assert.equal(matchesSetting('frame passcode', 'covers best frame'), false);
});

test("accents and apostrophes don't get in the way", () => {
  assert.equal(matchesSetting('whats new', "what's new"), true);
  assert.equal(matchesSetting('pokemon', 'Pokémon'), true);
});

test('the common words find their setting', () => {
  const find = (q) => Object.entries(SETTINGS_TERMS).filter(([, t]) => matchesSetting(q, t)).map(([k]) => k);
  assert.ok(find('passcode').includes('private'));
  assert.ok(find('thumbnail').includes('covers'));
  assert.ok(find('backup').includes('backup'));
  assert.ok(find('bug').includes('help'));
  assert.ok(find('notification').includes('daily'));
  assert.ok(find('colour').includes('personalise'));
  assert.deepEqual(find('zzzz'), []);
});
