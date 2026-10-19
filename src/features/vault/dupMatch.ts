/**
 * "You already have this": what an import does when a file is already in the
 * library. An exact copy is found by its content key (see contentKey.ts); a
 * likely one - the same video saved again, re-exported, or a better copy - by
 * its length, picture size and name. The import then asks: replace the one
 * you have (keeping its rating, keywords and history), keep both, or don't
 * import it. Pure: no React, no native modules (tested in Node).
 */

export type DupChoice = 'replace' | 'both' | 'skip';

/** What is compared: one file's name and what could be read from it. */
export type DupFile = {
  name: string;
  size: number;
  durationMs: number | null;
  width?: number | null;
  height?: number | null;
};

export type DupMatch<T> = { item: T; reason: string };

/** The name without folders and extension, lower case ("Clip (1).MOV" and "clip.mp4" both give "clip"). */
export function baseName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? name;
  return last
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[-_ ]copy$/i, '')
    .trim()
    .toLowerCase();
}

const near = (a: number, b: number, ms: number) => Math.abs(a - b) <= ms;
const sameShape = (a: DupFile, b: DupFile) => !!a.width && !!a.height && a.width === b.width && a.height === b.height;
/** Sizes within a third of each other (the same video re-exported is rarely much bigger or smaller). */
const closeSize = (a: number, b: number) => a > 0 && b > 0 && Math.min(a, b) / Math.max(a, b) >= 0.66;

/**
 * Why `file` looks like `other` (the same video, not just a similar one), or
 * null. Needs a readable length: two files of unknown length are never matched.
 */
export function likelySame(file: DupFile, other: DupFile): string | null {
  if (!file.durationMs || !other.durationMs) return null;
  const sameName = baseName(file.name) !== '' && baseName(file.name) === baseName(other.name);
  if (sameName && near(file.durationMs, other.durationMs, 2000)) return 'the same name and length';
  if (near(file.durationMs, other.durationMs, 500) && sameShape(file, other) && closeSize(file.size, other.size)) return 'the same length and picture size';
  // Audio has no picture: the same length to the second and nearly the same size.
  if (!file.width && !other.width && near(file.durationMs, other.durationMs, 1000) && closeSize(file.size, other.size) && Math.min(file.size, other.size) / Math.max(file.size, other.size) >= 0.9)
    return 'the same length and size';
  return null;
}

/** The best likely match among `candidates` (the closest in length first), or null. */
export function findLikely<T extends DupFile>(file: DupFile, candidates: T[]): DupMatch<T> | null {
  let best: { item: T; reason: string; gap: number } | null = null;
  for (const c of candidates) {
    const reason = likelySame(file, c);
    if (!reason) continue;
    const gap = Math.abs((c.durationMs ?? 0) - (file.durationMs ?? 0)) + (baseName(c.name) === baseName(file.name) ? 0 : 1000);
    if (!best || gap < best.gap) best = { item: c, reason, gap };
  }
  return best ? { item: best.item, reason: best.reason } : null;
}

/**
 * Asks once per duplicate, unless "do the same for the rest" was ticked:
 * then that answer is used for every later one in the same import.
 */
export function stickyAsker<A>(ask: (info: A) => Promise<{ choice: DupChoice; all: boolean }>): (info: A) => Promise<DupChoice> {
  let sticky: DupChoice | null = null;
  return async (info) => {
    if (sticky) return sticky;
    const { choice, all } = await ask(info);
    if (all) sticky = choice;
    return choice;
  };
}
