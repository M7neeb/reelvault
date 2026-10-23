/**
 * How the reader groups pages into screens. Normally one page per screen;
 * with two pages side by side (phone sideways) the cover stays alone, then
 * pages go in pairs, and a last odd page is alone. Pure (tested).
 */

/** The pages on each screen, in reading order. */
export function pageSlots(count: number, spread: boolean): number[][] {
  const out: number[][] = [];
  if (!spread) {
    for (let i = 0; i < count; i++) out.push([i]);
    return out;
  }
  if (count > 0) out.push([0]);
  for (let i = 1; i < count; i += 2) out.push(i + 1 < count ? [i, i + 1] : [i]);
  return out;
}

/** The screen a page is on. */
export function slotOfPage(slots: number[][], page: number): number {
  if (!slots.length) return 0;
  // Pages are in order, so a binary search would do; screens are few, so a scan is fine.
  for (let i = 0; i < slots.length; i++) if (slots[i].includes(page)) return i;
  return page < slots[0][0] ? 0 : slots.length - 1;
}
