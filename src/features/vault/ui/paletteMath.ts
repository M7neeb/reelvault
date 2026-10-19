/**
 * The maths behind the extra looks (Settings → Personalise): a colour set
 * tinted from one colour (a preset, or one taken from a video's picture),
 * and the restyling that applies a font, card corners and outlined cards to
 * every style the UI builds. Pure: no React Native, so it is tested in Node.
 */

export type ColorSet = 'standard' | 'midnight' | 'graphite' | 'forest' | 'rose' | 'ember' | 'video';
export type FontKey = 'system' | 'avenir' | 'futura' | 'georgia' | 'menlo';
export type GlassKey = 'regular' | 'clear' | 'solid';
export type CornerKey = 'standard' | 'round' | 'square';

export const COLOR_SETS: { key: Exclude<ColorSet, 'video'>; label: string; color: string | null }[] = [
  { key: 'standard', label: 'Standard', color: null },
  { key: 'midnight', label: 'Midnight', color: '#2B3A8C' },
  { key: 'graphite', label: 'Graphite', color: '#5C6270' },
  { key: 'forest', label: 'Forest', color: '#1F7A4D' },
  { key: 'rose', label: 'Rose', color: '#A3345F' },
  { key: 'ember', label: 'Ember', color: '#B4561E' },
];

/** iOS font families (each one has its own weights, so bold text stays bold). */
export const FONTS: { key: FontKey; label: string; family: string | null }[] = [
  { key: 'system', label: 'System', family: null },
  { key: 'avenir', label: 'Avenir', family: 'Avenir Next' },
  { key: 'futura', label: 'Futura', family: 'Futura' },
  { key: 'georgia', label: 'Georgia', family: 'Georgia' },
  { key: 'menlo', label: 'Menlo', family: 'Menlo' },
];

type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** `a` moved toward `b` by `t` (0 = a, 1 = b). */
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function toHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** A colour you can use for buttons and links: the same hue, bright enough and colourful enough to stand out. */
export function vivid(hex: string, scheme: 'light' | 'dark'): string {
  const rgb = parseHex(hex);
  if (!rgb) return '#0A84FF';
  const [h, s] = toHsl(rgb);
  // A grey picture gives a calm blue-grey rather than a muddy accent.
  if (s < 0.12) return scheme === 'dark' ? '#8E9BB0' : '#5A6478';
  return toHex(fromHsl(h, Math.max(0.62, Math.min(0.9, s)), scheme === 'dark' ? 0.5 : 0.44));
}

/** The surfaces of a palette, tinted from `hex`: deep and dark, or pale and light. */
export function tintPalette<T extends { scheme: 'light' | 'dark' }>(base: T, hex: string, keepAccent: boolean): T {
  const c = parseHex(hex);
  if (!c) return base;
  const dark = base.scheme === 'dark';
  const ink: RGB = dark ? [0, 0, 0] : [255, 255, 255];
  // Strip most of the brightness first, so a pale picture still gives a dark theme (and the other way round).
  const [h, s] = toHsl(c);
  const pure = fromHsl(h, Math.min(0.7, s), 0.5);
  const at = (t: number) => toHex(mix(pure, ink, t));
  const rgb = (t: number) => mix(pure, ink, t).map((v) => Math.round(v)).join(',');
  const accent = vivid(hex, base.scheme);
  const accentRgb = parseHex(accent)!.join(',');
  return {
    ...base,
    bg: at(dark ? 0.9 : 0.95),
    tile: at(dark ? 0.83 : 0.86),
    panel: at(dark ? 0.86 : 0.91),
    viewerBar: at(dark ? 0.92 : 0.93),
    card: at(dark ? 0.76 : 0.97),
    border: at(dark ? 0.66 : 0.75),
    elevated: at(dark ? 0.8 : 0.9),
    headerBg: `rgba(${rgb(dark ? 0.9 : 0.95)},${dark ? 0.6 : 0.82})`,
    glassFallback: `rgba(${rgb(dark ? 0.72 : 0.9)},${dark ? 0.78 : 0.88})`,
    ...(keepAccent ? {} : { accent, accentSoft: `rgba(${accentRgb},${dark ? 0.24 : 0.15})`, link: accent }),
  };
}

type Style = Record<string, unknown>;

/**
 * Applies the look to a set of styles: the font on every text style that has
 * no font of its own, card corners rounder or squarer (pills stay pills),
 * and a thin border on cards when outlined.
 */
export function restyle<T extends Record<string, unknown>>(
  styles: T,
  o: { font: string | null; corners: CornerKey; outlined: boolean; cardColors: string[]; border: string }
): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(styles)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      out[k] = v;
      continue;
    }
    const x: Style = { ...(v as Style) };
    if (o.font && 'fontSize' in x && !('fontFamily' in x)) x.fontFamily = o.font;
    if (typeof x.borderRadius === 'number' && x.borderRadius >= 8 && x.borderRadius < 400) {
      if (o.corners === 'round') x.borderRadius = Math.round(x.borderRadius * 1.45);
      else if (o.corners === 'square') x.borderRadius = Math.min(x.borderRadius, 4);
    }
    if (o.outlined && typeof x.backgroundColor === 'string' && o.cardColors.includes(x.backgroundColor) && typeof x.borderRadius === 'number' && !('borderWidth' in x)) {
      x.borderWidth = 1;
      x.borderColor = o.border;
    }
    out[k] = x;
  }
  return out as T;
}
