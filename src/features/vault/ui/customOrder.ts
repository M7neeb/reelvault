/**
 * "My order": the library in the order you arrange it. Select videos and move
 * them to the top, up, down, to the bottom, or put them together (vid1, vid2,
 * vid3 next to each other even when another video sat between them). Videos
 * you have not placed yet (new imports) go on top, newest first. Pure (tested
 * in tests/custom-order.test.mjs).
 */

export type MoveHow = 'top' | 'up' | 'down' | 'bottom' | 'together';

/** The items in your order: placed ones as you left them, the rest (newest first) on top. */
export function inCustomOrder<T extends { id: string; createdAt: number; importedAt: number }>(items: T[], order: string[]): T[] {
  const at = new Map(order.map((id, i) => [id, i]));
  const placed = items.filter((v) => at.has(v.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  const fresh = items.filter((v) => !at.has(v.id)).sort((a, b) => b.createdAt - a.createdAt || b.importedAt - a.importedAt);
  return [...fresh, ...placed];
}

/** Moves the chosen ids within a list (the others keep their order). */
export function moveIds(list: string[], chosen: string[], how: MoveHow): string[] {
  const pick = new Set(chosen.filter((id) => list.includes(id)));
  if (!pick.size) return list;
  const mine = list.filter((id) => pick.has(id));
  const rest = list.filter((id) => !pick.has(id));
  if (how === 'top') return [...mine, ...rest];
  if (how === 'bottom') return [...rest, ...mine];
  if (how === 'together') {
    // Right where the first chosen one is.
    const first = list.findIndex((id) => pick.has(id));
    const before = list.slice(0, first).filter((id) => !pick.has(id));
    return [...before, ...mine, ...rest.slice(before.length)];
  }
  // Up / down: each chosen one swaps with the neighbour that is not chosen.
  const out = [...list];
  if (how === 'up') {
    for (let i = 1; i < out.length; i++) {
      if (pick.has(out[i]) && !pick.has(out[i - 1])) [out[i - 1], out[i]] = [out[i], out[i - 1]];
    }
  } else {
    for (let i = out.length - 2; i >= 0; i--) {
      if (pick.has(out[i]) && !pick.has(out[i + 1])) [out[i + 1], out[i]] = [out[i], out[i + 1]];
    }
  }
  return out;
}

/**
 * Puts a rearranged part (what you see: an album, a filter) back into the
 * whole order: the slots those videos had are filled in their new order, so
 * videos you cannot see right now do not move.
 */
export function reorderWithin(full: string[], part: string[]): string[] {
  const inPart = new Set(part);
  const missing = part.filter((id) => !full.includes(id));
  const base = [...missing, ...full];
  let k = 0;
  return base.map((id) => (inPart.has(id) ? part[k++] : id));
}
