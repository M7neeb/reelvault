/**
 * How the reader groups pages into screens. Normally one page per screen;
 * with two pages side by side (phone sideways) the cover stays alone, then
 * pages go in pairs, and a last odd page is alone. A page that is already a
 * double page (wider than tall) is alone too, and the pairing carries on
 * after it. Pure (tested).
 */

/** The pages on each screen, in reading order. */
export function pageSlots(count: number, spread: boolean, wide: ReadonlySet<number> = new Set()): number[][] {
  const out: number[][] = [];
  if (!spread) {
    for (let i = 0; i < count; i++) out.push([i]);
    return out;
  }
  if (count > 0) out.push([0]);
  let i = 1;
  while (i < count) {
    if (wide.has(i) || i + 1 >= count || wide.has(i + 1)) {
      out.push([i]);
      i += 1;
    } else {
      out.push([i, i + 1]);
      i += 2;
    }
  }
  return out;
}

/** The screen a page is on. */
export function slotOfPage(slots: number[][], page: number): number {
  if (!slots.length) return 0;
  // Pages are in order, so a binary search would do; screens are few, so a scan is fine.
  for (let i = 0; i < slots.length; i++) if (slots[i].includes(page)) return i;
  return page < slots[0][0] ? 0 : slots.length - 1;
}
