// Run with `npm test`. Extra looks: a colour set from one colour, fonts, corners, outlined cards.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHex, restyle, tintPalette, vivid } from '../src/features/vault/ui/paletteMath.ts';

const lum = (hex) => {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

test('a colour set from one colour stays dark (or light) and readable', () => {
  const dark = { scheme: 'dark', bg: '#000000', card: '#1f1f22', accent: '#0A84FF', link: '#4aa8ff', accentSoft: 'x' };
  // Even a very pale picture gives a dark background in dark mode.
  for (const c of ['#F4E9D8', '#1E6B45', '#FF2D55', '#808080']) {
    const t = tintPalette(dark, c, false);
    assert.ok(lum(t.bg) < 0.08, `${c} bg ${t.bg}`);
    assert.ok(lum(t.card) > lum(t.bg), 'cards lift off the background');
    assert.ok(lum(t.accent) > 0.25, `accent ${t.accent} stands out`);
  }
  const light = tintPalette({ scheme: 'light', bg: '#ffffff', card: '#ffffff', accent: '#0A84FF', link: '#007AFF', accentSoft: 'x' }, '#1E2A78', false);
  assert.ok(lum(light.bg) > 0.9);
  // Your own accent is kept when you chose one.
  assert.equal(tintPalette(dark, '#1E6B45', true).accent, '#0A84FF');
  assert.equal(tintPalette(dark, 'nonsense', false), dark);
  // Grey stays calm.
  assert.equal(vivid('#7a7a7a', 'dark'), '#8E9BB0');
});

test('restyle: fonts on text, corners on cards (pills stay pills), outlined cards', () => {
  const s = {
    title: { fontSize: 20, fontWeight: '800' },
    mono: { fontSize: 12, fontFamily: 'Menlo' },
    card: { backgroundColor: '#1c1c1e', borderRadius: 16, padding: 10 },
    pill: { borderRadius: 999, backgroundColor: '#1c1c1e' },
    tiny: { borderRadius: 4 },
    row: { flexDirection: 'row' },
  };
  const round = restyle(s, { font: 'Avenir Next', corners: 'round', outlined: true, cardColors: ['#1c1c1e'], border: '#333' });
  assert.equal(round.title.fontFamily, 'Avenir Next');
  assert.equal(round.mono.fontFamily, 'Menlo');
  assert.equal(round.card.borderRadius, 23);
  assert.equal(round.card.borderWidth, 1);
  assert.equal(round.pill.borderRadius, 999);
  assert.equal(round.tiny.borderRadius, 4);
  assert.deepEqual(round.row, { flexDirection: 'row' });
  const square = restyle(s, { font: null, corners: 'square', outlined: false, cardColors: [], border: '' });
  assert.equal(square.card.borderRadius, 4);
  assert.equal(square.title.fontFamily, undefined);
  // The originals are untouched.
  assert.equal(s.card.borderRadius, 16);
});
