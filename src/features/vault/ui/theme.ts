/**
 * The vault's two colour sets and the hook every UI file uses to read them.
 *
 * Styles are written as `makeStyles(p)` factories instead of module-level
 * `StyleSheet.create` calls, so they can follow the theme. Each factory runs
 * once per theme (cached below), not on every render.
 */

import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';

import { COLOR_SETS, FONTS, restyle, tintPalette, type ColorSet, type CornerKey, type FontKey, type GlassKey } from './paletteMath';

export type Scheme = 'light' | 'dark';

export type Palette = {
  scheme: Scheme;
  /** Screen background. */
  bg: string;
  /** Empty tile, image placeholder. */
  tile: string;
  /** Sheets, the sidebar, the viewer's info panel. */
  panel: string;
  /** The viewer's bottom bar (scrubber, filmstrip, toolbar). */
  viewerBar: string;
  /** Inputs, chips and rows sitting on a panel. */
  card: string;
  border: string;
  separator: string;
  text: string;
  /** Body text: slightly softer than `text`. */
  textSoft: string;
  textSecondary: string;
  textMuted: string;
  /** Round header buttons. */
  circle: string;
  /** The two floating round buttons at the bottom of the grid. */
  floating: string;
  /** Glyph colour on round buttons. */
  icon: string;
  /** The translucent bar behind the floating header. */
  headerBg: string;
  /** Behind sheets and the sidebar. */
  backdrop: string;
  accent: string;
  /** Selected sidebar row. */
  accentSoft: string;
  /** Blue text links ("Tap here to add title", "+ New Smart Filter"). */
  link: string;
  keyword: string;
  rating: string;
  danger: string;
  dangerText: string;
  grabber: string;
  starOff: string;
  switchOff: string;
  /** Behind glass controls where the system has no Liquid Glass. */
  glassFallback: string;
  /** Raised cards on the screen background (Up Next, grouped rows). */
  elevated: string;
  success: string;
  /** Styles are built once per key (colours + look); the scheme when unset. */
  key?: string;
  /** Settings → Personalise: a font family for all text, glass strength, card corners, outlined cards. */
  font?: string | null;
  glass?: GlassKey;
  corners?: CornerKey;
  outlined?: boolean;
  /** Settings → Personalise: backgrounds taken from the artwork on pages built around one picture. */
  art?: boolean;
};

/** A card on the screen background (not on a sheet): `card` is white in light mode, the same as the background. */
export const raised = (p: Palette): string => (p.scheme === 'light' ? p.elevated : p.card);

/** The original ReelVault / HashPhotos dark look. */
export const DARK: Palette = {
  scheme: 'dark',
  bg: '#000000',
  tile: '#121214',
  panel: '#101012',
  viewerBar: '#070708',
  card: '#1a1a1d',
  border: '#26262a',
  separator: 'rgba(255,255,255,0.09)',
  text: '#ffffff',
  textSoft: '#e7e9ec',
  textSecondary: '#8d8d95',
  textMuted: '#5c5c64',
  circle: 'rgba(120,120,128,0.32)',
  floating: 'rgba(120,120,128,0.42)',
  icon: '#ffffff',
  headerBg: 'rgba(0,0,0,0.55)',
  backdrop: 'rgba(0,0,0,0.55)',
  accent: '#FF5A36',
  accentSoft: 'rgba(255,90,54,0.2)',
  link: '#FF7A5C',
  keyword: '#2f9ee0',
  rating: '#F5A623',
  danger: '#c0392b',
  dangerText: '#ff6b6b',
  grabber: '#48484a',
  starOff: '#4a4a4e',
  switchOff: '#3a3a3e',
  glassFallback: 'rgba(58,58,62,0.72)',
  elevated: '#151517',
  success: '#30D158',
};

/** iOS-style light look: white grid, grouped grey panels. */
export const LIGHT: Palette = {
  scheme: 'light',
  bg: '#ffffff',
  tile: '#e9e9ee',
  panel: '#f2f2f7',
  viewerBar: '#f2f2f7',
  card: '#ffffff',
  border: '#d1d1d6',
  separator: 'rgba(0,0,0,0.12)',
  text: '#000000',
  textSoft: '#1c1c1e',
  textSecondary: '#6e6e73',
  textMuted: '#8e8e93',
  circle: 'rgba(118,118,128,0.16)',
  floating: 'rgba(242,242,247,0.94)',
  icon: '#1c1c1e',
  headerBg: 'rgba(255,255,255,0.8)',
  backdrop: 'rgba(0,0,0,0.3)',
  accent: '#E4472A',
  accentSoft: 'rgba(228,71,42,0.12)',
  link: '#D33F23',
  keyword: '#2f9ee0',
  rating: '#F5A623',
  danger: '#e5484d',
  dangerText: '#d93025',
  grabber: '#c7c7cc',
  starOff: '#c7c7cc',
  switchOff: '#d1d1d6',
  glassFallback: 'rgba(242,242,247,0.86)',
  elevated: '#f2f2f7',
  success: '#34C759',
};

export const paletteFor = (scheme: Scheme): Palette => (scheme === 'light' ? LIGHT : DARK);

export const ThemeContext = createContext<Palette>(DARK);

export const usePalette = (): Palette => useContext(ThemeContext);

type Factory = (p: Palette) => object;
const cache = new WeakMap<Factory, Record<string, object>>();

/**
 * The styles a `makeStyles(p)` factory returns for the current theme, built
 * once per theme. Factories return `StyleSheet.create({...})`.
 */
export function useStyles<T extends object>(factory: (p: Palette) => T): T {
  const p = usePalette();
  let byScheme = cache.get(factory);
  if (!byScheme) {
    byScheme = {};
    cache.set(factory, byScheme);
  }
  const key = p.key ?? p.scheme;
  return (byScheme[key] ??= build(factory, p)) as T;
}

function build<T extends object>(factory: (p: Palette) => T, p: Palette): T {
  const styles = factory(p);
  return restyle(styles as Record<string, unknown>, {
    font: p.font ?? null,
    corners: p.corners ?? 'standard',
    outlined: !!p.outlined,
    cardColors: [p.elevated, p.card, p.panel],
    border: p.border,
  }) as T;
}

/** For factories: `StyleSheet.create`, re-exported so UI files need one import. */
export const sheet = StyleSheet.create;

/** "#0a84ff" → "10,132,255", for rgba() gradients that fade into a theme colour. */
export function rgbOf(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/**
 * The whole look from your settings: the light or dark colours, tinted from
 * a colour set (or a colour taken from a video), your accent, font, glass,
 * card corners and outlines.
 */
export function themeFor(
  scheme: Scheme,
  o: { accent: string | null; colors?: ColorSet; videoColor?: string | null; font?: FontKey; glass?: GlassKey; corners?: CornerKey; outlined?: boolean; artwork?: boolean }
): Palette {
  let p = paletteFor(scheme);
  const tint = o.colors === 'video' ? (o.videoColor ?? null) : (COLOR_SETS.find((c) => c.key === o.colors)?.color ?? null);
  if (tint) p = tintPalette(p, tint, !!o.accent);
  p = withAccent(p, o.accent);
  const font = FONTS.find((f) => f.key === o.font)?.family ?? null;
  const corners = o.corners ?? 'standard';
  const outlined = !!o.outlined;
  return { ...p, font, glass: o.glass ?? 'regular', corners, outlined, art: o.artwork ?? true, key: [scheme, p.bg, p.accent, font ?? '', corners, outlined ? 1 : 0].join('|') };
}

/** The palette with your accent colour (Settings → Personalise); null keeps the default vermilion. */
export function withAccent(p: Palette, accent: string | null | undefined): Palette {
  if (!accent) return p;
  const rgb = rgbOf(accent);
  return { ...p, accent, accentSoft: `rgba(${rgb},${p.scheme === 'dark' ? 0.22 : 0.14})`, link: accent };
}
