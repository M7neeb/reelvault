/**
 * Quick links for a Control Center button (iOS 18: Control Center → add a
 * control → Shortcuts → a shortcut that opens one of these):
 *
 * - reelvault://favourite  plays a random favourite (rated 8 or more)
 * - reelvault://memory     plays today's memory (On this day, or the top one)
 * - reelvault://random     plays any video
 *
 * The router hands the address here (see app/+native-intent.tsx); the vault
 * screen picks it up. Pure: no React, no native modules.
 */

export type QuickKind = 'favourite' | 'memory' | 'random';

export const QUICK_LINKS: { kind: QuickKind; url: string; label: string; hint: string }[] = [
  { kind: 'favourite', url: 'reelvault://favourite', label: 'A random favourite', hint: 'Plays one of the videos you rated 8 or more' },
  { kind: 'memory', url: 'reelvault://memory', label: "Today's memory", hint: 'Plays On this day, or the top memory for you' },
  { kind: 'random', url: 'reelvault://random', label: 'Any video', hint: 'Plays a video picked at random' },
];

/** The quick link an address asks for, if any ("reelvault://favourite", "/favourite", "reelvault:///memory?x=1"). */
export function quickKind(path: string | null | undefined): QuickKind | null {
  if (!path) return null;
  const m = /^(?:reelvault:\/*|\/)?(favourite|favorite|memory|random)\/?(?:[?#].*)?$/i.exec(path.trim());
  if (!m) return null;
  const k = m[1].toLowerCase();
  return k === 'favorite' ? 'favourite' : (k as QuickKind);
}

/** A random pick for "favourite": rated 8+, else your best rated, else anything. */
export function pickFavourite<T extends { rating: number }>(items: T[], rnd: () => number = Math.random): T | null {
  if (!items.length) return null;
  const loved = items.filter((v) => v.rating >= 8);
  const pool = loved.length ? loved : [...items].sort((a, b) => b.rating - a.rating).slice(0, Math.max(1, Math.min(20, items.filter((v) => v.rating > 0).length || items.length)));
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

let pending: QuickKind | null = null;
const listeners = new Set<(k: QuickKind) => void>();

export function pushQuick(kind: QuickKind): void {
  if (listeners.size) for (const fn of listeners) fn(kind);
  else pending = kind;
}

/** Gets a link that came in before anyone listened, and every one after. */
export function onQuick(fn: (k: QuickKind) => void): () => void {
  listeners.add(fn);
  if (pending) {
    const k = pending;
    pending = null;
    fn(k);
  }
  return () => {
    listeners.delete(fn);
  };
}
