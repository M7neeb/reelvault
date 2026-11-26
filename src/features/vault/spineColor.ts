/**
 * The colour of a box's spine: picked from its name (a series, a book, a
 * show), so the same box always has the same colour and neighbours differ.
 */

/** 0-359, spread with the golden angle so similar names still land apart. */
export function spineHue(key: string): number {
  let h = 0x811c9dc5;
  const k = key.trim().toLowerCase();
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
  return Math.round(((h >>> 0) % 997) * 137.508) % 360;
}

/** Bright enough to read as a printed band on black; deeper on white. */
export function spineColor(key: string, scheme: 'dark' | 'light' = 'dark'): string {
  const hue = spineHue(key);
  return scheme === 'dark' ? `hsl(${hue}, 70%, 56%)` : `hsl(${hue}, 64%, 44%)`;
}
