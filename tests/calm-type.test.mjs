import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calmType, restyle } from '../src/features/vault/ui/paletteMath.ts';

test('big titles stay bold, everything smaller is semibold at most', () => {
  assert.equal(calmType({ fontSize: 34, fontWeight: '900' }).fontWeight, '700');
  assert.equal(calmType({ fontSize: 22, fontWeight: '800' }).fontWeight, '600');
  assert.equal(calmType({ fontSize: 15, fontWeight: '700' }).fontWeight, '600');
  assert.equal(calmType({ fontSize: 15, fontWeight: '500' }).fontWeight, '500');
  assert.equal(calmType({ fontSize: 15 }).fontWeight, undefined);
  // Not text: left alone.
  assert.deepEqual(calmType({ width: 10 }), { width: 10 });
});

test('small all-caps labels become quiet sentence case', () => {
  const x = calmType({ fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.4, color: 'red' });
  assert.deepEqual(x, { fontSize: 13, fontWeight: '600', letterSpacing: 0, color: 'red' });
  // Big caps (a design choice, e.g. a poster title) are kept.
  assert.equal(calmType({ fontSize: 30, textTransform: 'uppercase' }).textTransform, 'uppercase');
});

test('restyle applies it to every style in a sheet, with the default look', () => {
  const out = restyle({ a: { fontSize: 12, fontWeight: '900' }, b: { padding: 4 } }, { font: null, corners: 'standard', outlined: false, cardColors: [], border: '#000' });
  assert.equal(out.a.fontWeight, '600');
  assert.deepEqual(out.b, { padding: 4 });
});

test('styles named as kickers lose their letter spacing whatever the case', () => {
  assert.deepEqual(calmType({ fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: '#fff' }, 'pickKicker'), { fontSize: 13, fontWeight: '600', letterSpacing: 0, color: '#fff' });
  assert.equal(calmType({ fontSize: 11, letterSpacing: 1.2 }, 'badge').letterSpacing, 0.2);
  assert.equal(calmType({ fontSize: 30, letterSpacing: 1.2 }, 'badge').letterSpacing, 1.2);
});

test('titles and big numbers take the condensed display face, unless a font was chosen', async () => {
  const { DISPLAY_FONT } = await import('../src/features/vault/ui/paletteMath.ts');
  const t = calmType({ fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 40 }, 'title', true);
  assert.deepEqual(t, { fontSize: 37, fontFamily: DISPLAY_FONT.bold, letterSpacing: 0, lineHeight: 44 });
  assert.equal(calmType({ fontSize: 22, fontWeight: '700' }, 'h', true).fontFamily, DISPLAY_FONT.semibold);
  // Body text and light big text keep the system face.
  assert.equal(calmType({ fontSize: 17, fontWeight: '700' }, 'b', true).fontFamily, undefined);
  assert.equal(calmType({ fontSize: 30, fontWeight: '400' }, 'b', true).fontFamily, undefined);
  // Personalise > font set: restyle leaves the display face out.
  const out = restyle({ a: { fontSize: 30, fontWeight: '800' } }, { font: 'Georgia', corners: 'standard', outlined: false, cardColors: [], border: '#000' });
  assert.equal(out.a.fontFamily, 'Georgia');
});

test('box corners: circles stay round, pills and cards get tight corners', async () => {
  const { boxCorner } = await import('../src/features/vault/ui/paletteMath.ts');
  assert.equal(boxCorner({ width: 44, height: 44, borderRadius: 22 }), 22);
  assert.equal(boxCorner({ height: 54, borderRadius: 27 }), 14);
  assert.equal(boxCorner({ borderRadius: 26 }), 13);
  assert.equal(boxCorner({ borderRadius: 10 }), 6);
});
