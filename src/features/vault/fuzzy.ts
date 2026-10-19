/**
 * Forgiving search: a word typed with a slip ("famly", "birthdya") still
 * finds "family" and "birthday". Each query word must be close to a word in
 * the text: exact or a prefix scores best, then one or two letters off
 * (two only for long words). Pure: no React, no database.
 */

/** Letters to change, add or remove to get from a to b (stops early past `max`). */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const swap = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + swap);
      // Two neighbouring letters swapped counts as one slip.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** How well `query` matches `text`: 0 = not at all, higher = better. */
export function fuzzyScore(query: string, text: string): number {
  const q = words(query);
  if (!q.length) return 0;
  const t = words(text);
  if (!t.length) return 0;
  let score = 0;
  for (const w of q) {
    let best = 0;
    for (const x of t) {
      if (x === w) best = Math.max(best, 3);
      else if (x.startsWith(w) && w.length >= 2) best = Math.max(best, 2.5);
      else if (w.length >= 4) {
        const allowed = w.length >= 7 ? 2 : 1;
        // Compare with the start of longer words too ("birthdya" vs "birthday2026").
        const d = Math.min(editDistance(w, x, allowed), x.length > w.length ? editDistance(w, x.slice(0, w.length), allowed) : allowed + 1);
        if (d <= allowed) best = Math.max(best, d === 1 ? 1.5 : 1);
      }
    }
    if (!best) return 0;
    score += best;
  }
  return score / q.length;
}

/** The items that match, best first. `text` gives what to search in each. */
export function fuzzyFind<T>(query: string, items: T[], text: (item: T) => string, limit = 200): T[] {
  return items
    .map((item) => ({ item, s: fuzzyScore(query, text(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}

/** Recent searches: the newest first, no repeats (any case), at most `max`. */
export function rememberSearch(list: string[], q: string, max = 10): string[] {
  const t = q.trim();
  if (t.length < 2) return list;
  return [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, max);
}
