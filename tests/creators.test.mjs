import assert from 'node:assert/strict';
import { test } from 'node:test';

import { creatorFromFilename, normCreator, sameCreator, suggestCreators } from '../src/features/vault/creatorLogic.ts';

test('names are cleaned: spaces, a leading @, length', () => {
  assert.equal(normCreator('  @Mr  Beast '), 'Mr Beast');
  assert.equal(normCreator('@'), null);
  assert.equal(normCreator(''), null);
  assert.equal(normCreator('x'.repeat(61)), null);
  assert.equal(normCreator('x'.repeat(60)), 'x'.repeat(60));
  assert.ok(sameCreator('@berry', 'Berry'));
  assert.ok(!sameCreator('berry', 'berries'));
});

test('the creator is read from file names when it is there', () => {
  assert.equal(creatorFromFilename('@mrbeast_7234.mp4'), 'mrbeast');
  assert.equal(creatorFromFilename('@lil.cat-99 funny.mov'), 'lil.cat');
  assert.equal(creatorFromFilename('mrbeast - I built a house.mp4'), 'mrbeast');
  assert.equal(creatorFromFilename('IMG_1234.mov'), null);
  assert.equal(creatorFromFilename('12 - 34.mp4'), null);
  assert.equal(creatorFromFilename('series beries 2.mp4'), null);
  assert.equal(creatorFromFilename('a very long name that is surely not a creator at all here - x.mp4'), null);
});

test('suggestions group videos by the name in their file, biggest first', () => {
  const v = (id, filename, creators = []) => ({ id, filename, creators });
  const vids = [
    v('1', '@cat_1.mp4'),
    v('2', '@Cat_2.mp4'),
    v('3', '@cat_3.mp4', ['cat']),
    v('4', 'dog - walk.mp4'),
    v('5', 'dog - run.mp4'),
    v('6', 'dog - sit.mp4'),
    v('7', '@solo_1.mp4'),
    v('8', '@known_9.mp4'),
    v('9', 'x.mp4', ['Known']),
  ];
  const s = suggestCreators(vids, []);
  assert.deepEqual(s.map((x) => x.name), ['dog', 'cat', 'Known']);
  // Videos that already have it are left out.
  assert.deepEqual(s.find((x) => x.name === 'cat').ids, ['1', '2']);
  // A single video counts when the creator already exists, spelled as you spelled it.
  assert.deepEqual(suggestCreators(vids, []).find((x) => x.ids.includes('8')), { name: 'Known', ids: ['8'] });
  // "Not this one" stays dismissed.
  assert.deepEqual(suggestCreators(vids, ['DOG']).map((x) => x.name), ['cat', 'Known']);
  assert.deepEqual(suggestCreators([], []), []);
});

test('@ in the Videos search finds a creator; # still means keywords', async () => {
  const { parseSearch } = await import('../src/features/vault/ui/query.ts');
  const { matchesRule, parseRule, describeRule } = await import('../src/features/vault/ui/logic.ts');
  const p = parseSearch('@mrbeast funny', ['funny'], Date.UTC(2026, 10, 26));
  assert.equal(p.rule.creator, 'mrbeast');
  assert.deepEqual(p.rule.tags, ['funny']);
  assert.ok(p.chips.some((c) => c.label === '@mrbeast'));
  const v = (creators) => ({ id: 'x', filename: 'a.mp4', rating: 0, tagNames: [], status: null, creators });
  assert.ok(matchesRule(v(['MrBeast']), { creator: 'mrbeast' }));
  // The start of a name is enough while typing; another creator is not.
  assert.ok(matchesRule(v(['Mr Beast']), { creator: 'mr' }));
  assert.ok(!matchesRule(v(['Lena Moss']), { creator: 'mrbeast' }));
  assert.ok(!matchesRule(v([]), { creator: 'mrbeast' }));
  assert.ok(matchesRule(v(['a']), { has: { creator: true } }));
  assert.ok(matchesRule(v([]), { has: { creator: false } }));
  // Saved filters keep it.
  assert.deepEqual(parseRule(JSON.stringify({ creator: '@Lena  Moss' })), { creator: 'Lena Moss' });
  assert.equal(describeRule({ creator: 'Lena Moss' }), '@Lena Moss');
});
