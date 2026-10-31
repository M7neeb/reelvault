/**
 * Decides what goes behind each card of the reading Wrapped: which of the
 * page layouts it gets and which of your pages it shows.
 *
 * - The layouts come in a fixed order chosen so that two cards in a row never
 *   look alike (a scrolling strip, then panels of a page, then pages turning,
 *   then pages tossed on a table, then a wall of covers...). All eighteen show
 *   up before any repeats; two of them are made of covers.
 * - Pages are dealt like cards from the pool of everything loaded: each card
 *   takes the next few, so no page shows twice on one card, and none comes
 *   back until the whole pool has been shown.
 * - A layout needing more pages than there are steps down to one that fits.
 * - The same works for the other Wrapped stories, with their own line-ups:
 *   SCREEN_SEQUENCE (films and shows) and SOUND_SEQUENCE (audio).
 * Pure (tested in tests/manga-page-director.test.mjs).
 */

export type Layout =
  | 'strip'
  | 'volume'
  | 'flip'
  | 'scatter'
  | 'twin'
  | 'focus'
  | 'mosaic'
  | 'spread'
  | 'slash'
  | 'cinema'
  | 'triptych'
  | 'blinds'
  | 'zoomout'
  | 'river'
  | 'dealt'
  | 'camera'
  | 'coverwall'
  | 'poster'
  | 'kenburns'
  | 'filmstrips'
  | 'vinyl'
  | 'orbit'
  | 'equalizer';

/** The order cards get them in: still and moving, whole pages and panels, alternate. */
export const SEQUENCE: Layout[] = ['strip', 'volume', 'flip', 'scatter', 'coverwall', 'twin', 'focus', 'mosaic', 'spread', 'slash', 'poster', 'cinema', 'triptych', 'blinds', 'zoomout', 'river', 'dealt', 'camera'];

/** Layouts made of your covers (with a page or two at most), so covers are one look among many. */
export const COVER_LAYOUTS: Layout[] = ['coverwall', 'poster'];

/** Films and shows (posters and wide stills): no manga pages, books or speed lines. */
export const SCREEN_SEQUENCE: Layout[] = ['kenburns', 'river', 'cinema', 'scatter', 'twin', 'mosaic', 'slash', 'poster', 'filmstrips', 'zoomout', 'blinds', 'dealt', 'triptych', 'orbit', 'camera', 'coverwall'];

/** Audiobooks and albums (square covers): a record, an equalizer, covers in orbit. */
export const SOUND_SEQUENCE: Layout[] = ['kenburns', 'vinyl', 'river', 'mosaic', 'scatter', 'equalizer', 'poster', 'blinds', 'orbit', 'zoomout', 'dealt', 'coverwall', 'slash', 'twin', 'triptych', 'cinema'];

/** How many different pages each layout uses (at least, and at best). */
export const NEEDS: Record<Layout, { min: number; best: number }> = {
  strip: { min: 2, best: 6 },
  volume: { min: 4, best: 4 },
  flip: { min: 2, best: 6 },
  scatter: { min: 4, best: 7 },
  twin: { min: 4, best: 8 },
  focus: { min: 1, best: 1 },
  mosaic: { min: 6, best: 16 },
  spread: { min: 4, best: 8 },
  slash: { min: 3, best: 3 },
  cinema: { min: 2, best: 4 },
  triptych: { min: 3, best: 3 },
  blinds: { min: 2, best: 4 },
  zoomout: { min: 3, best: 9 },
  river: { min: 6, best: 12 },
  dealt: { min: 3, best: 6 },
  camera: { min: 1, best: 1 },
  coverwall: { min: 0, best: 0 },
  poster: { min: 0, best: 2 },
  kenburns: { min: 1, best: 1 },
  filmstrips: { min: 3, best: 12 },
  vinyl: { min: 1, best: 1 },
  orbit: { min: 3, best: 8 },
  equalizer: { min: 1, best: 1 },
};

/** The layout for card `i`, or the next one in the order that has enough pages. */
export function layoutFor(i: number, available: number, seq: Layout[] = SEQUENCE): Layout {
  const n = seq.length;
  const start = ((i % n) + n) % n;
  for (let k = 0; k < n; k++) {
    const l = seq[(start + k) % n];
    if (available >= NEEDS[l].min) return l;
  }
  return seq.includes('kenburns') ? 'kenburns' : 'camera';
}

/** How many pages card `i` takes when every card before it took its best. */
function offsetOf(i: number, seq: Layout[]): number {
  const lap = seq.reduce((a, l) => a + NEEDS[l].best, 0);
  const n = seq.length;
  let off = Math.floor(i / n) * lap;
  for (let k = 0; k < i % n; k++) off += NEEDS[seq[k]].best;
  return off;
}

/**
 * The pages (indexes into a pool of `size`) for card `i` with `layout`:
 * distinct, as many as the layout uses at best (fewer when the pool is
 * smaller), starting where the cards before it stopped.
 */
export function deal(size: number, i: number, layout: Layout, seq: Layout[] = SEQUENCE): number[] {
  if (size <= 0) return [];
  const take = Math.min(size, NEEDS[layout].best);
  const start = offsetOf(Math.max(0, i), seq) % size;
  return Array.from({ length: take }, (_, k) => (start + k) % size);
}

/** A layout for the pages of one title (a card about it): the order still turns, but only layouts its pages fill. */
export function titleLayout(i: number, pages: number, webtoon: boolean): Layout {
  // Long strips read best scrolling or as panels; paged manga turning or spread like a book.
  const prefer: Layout[] = webtoon ? ['strip', 'cinema', 'twin', 'focus', 'slash', 'camera', 'blinds', 'zoomout'] : ['flip', 'volume', 'spread', 'focus', 'slash', 'dealt', 'zoomout', 'camera'];
  const n = prefer.length;
  for (let k = 0; k < n; k++) {
    const l = prefer[(((i % n) + n) % n + k) % n];
    if (pages >= NEEDS[l].min) return l;
  }
  return 'camera';
}

/** Distances worth comparing a long scroll to (metres). */
const LANDMARKS: { name: string; m: number }[] = [
  { name: 'a football pitch', m: 105 },
  { name: 'the Eiffel Tower', m: 330 },
  { name: 'the Empire State Building', m: 443 },
  { name: 'Tokyo Skytree', m: 634 },
  { name: 'the Burj Khalifa', m: 828 },
  { name: 'Mount Fuji', m: 3776 },
  { name: 'Mount Everest', m: 8849 },
];

/** "That's 2.4 Eiffel Towers" for a scroll of `metres`: the tallest landmark it passes, and how many times. */
export function scrollCompare(metres: number): { name: string; times: number } | null {
  if (!(metres > 0)) return null;
  const passed = LANDMARKS.filter((l) => metres >= l.m);
  const l = passed[passed.length - 1] ?? LANDMARKS[0];
  return { name: l.name, times: Math.round((metres / l.m) * 10) / 10 };
}
