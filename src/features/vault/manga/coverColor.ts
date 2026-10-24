/**
 * A title's own colour, taken from its cover, for its page's buttons and bars.
 * Only a colour that reads well is used: not too dark, not too light and not
 * grey (then the app's own colour stays). Pure (tested).
 */

export function usableAccent(hex: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const light = (hi + lo) / 2;
  const sat = hi === lo ? 0 : (hi - lo) / (1 - Math.abs(2 * light - 1));
  if (sat < 0.3 || light < 0.22 || light > 0.72) return null;
  return `#${m[1].toLowerCase()}`;
}
