// Run with `npm test`. Cover file names, which the storage clean-up reads back.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCoverName } from '../src/features/vault/coverNames.ts';

const ID = '0b7a1e2c-3d4f-4a5b-8c6d-123456789012';

test('a cover made at import and a chosen one', () => {
  assert.deepEqual(parseCoverName(`${ID}.jpg`), { id: ID, at: null });
  assert.deepEqual(parseCoverName(`${ID}-1792354037238.jpg`), { id: ID, at: 1792354037238 });
});

test('other files are not covers', () => {
  assert.equal(parseCoverName('kept'), null);
  assert.equal(parseCoverName(`${ID}.png`), null);
  assert.equal(parseCoverName(`${ID}-abc.jpg`), null);
  assert.equal(parseCoverName('short.jpg'), null);
});
