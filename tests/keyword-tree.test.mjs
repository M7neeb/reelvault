// Run with `npm test`. Keywords as a tree in the keyword manager.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { keywordTree, leafOf, parentOf } from '../src/features/vault/keywordTree.ts';

const tags = [
  { id: 1, name: 'Travel/Japan' },
  { id: 2, name: 'family' },
  { id: 3, name: 'Travel/Italy' },
  { id: 4, name: 'beach' },
  { id: 5, name: 'Travel' },
];
const counts = { 'Travel/Japan': 4, family: 9, 'Travel/Italy': 2, beach: 0, Travel: 1 };

test('children sit under their parent, which adds up their videos', () => {
  const tree = keywordTree(tags, counts);
  assert.deepEqual(tree.map((n) => n.label), ['beach', 'family', 'Travel']);
  const travel = tree[2];
  assert.equal(travel.tag?.id, 5);
  assert.equal(travel.count, 7);
  assert.deepEqual(travel.children.map((c) => c.label), ['Italy', 'Japan']);
});

test('by use, and a search keeps the parent as a folder', () => {
  assert.deepEqual(keywordTree(tags, counts, '', 'used').map((n) => n.label), ['family', 'Travel', 'beach']);
  const found = keywordTree(tags, counts, 'jap');
  assert.equal(found.length, 1);
  assert.equal(found[0].label, 'Travel');
  assert.deepEqual(found[0].children.map((c) => c.name), ['Travel/Japan']);
});

test('names', () => {
  assert.equal(parentOf('Travel/Japan'), 'Travel');
  assert.equal(parentOf('family'), null);
  assert.equal(leafOf('Travel/Japan'), 'Japan');
});
