/**
 * What the phone saw inside your videos, as rules: picture fingerprints for
 * "Similar" (copies of one clip, re-encoded, resized or trimmed) and scene
 * words / text on screen for "search inside videos". Pure (tested in
 * tests/scenes.test.mjs); the looking is in scenes.ts and the native module.
 */

/** Where in each video fingerprints are taken (fractions of its length). */
export const PRINT_AT = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/** Bits that differ between two 16-hex fingerprints (64 = nothing alike). */
export function hamming(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64;
  let d = 0;
  for (let i = 0; i < 16; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) {
      d += x & 1;
      x >>>= 1;
    }
  }
  return d;
}

/** A fingerprint worth comparing: not a plain black, white or flat frame (those match everything). */
export function telling(print: string): boolean {
  if (!/^[0-9a-f]{16}$/.test(print)) return false;
  let ones = 0;
  for (const ch of print) {
    let x = parseInt(ch, 16);
    while (x) {
      ones += x & 1;
      x >>= 1;
    }
  }
  return ones >= 6 && ones <= 58;
}

/** Close enough to be the same picture. */
const SAME = 10;

/**
 * Two videos show the same clip: enough of one's frames have a near-twin
 * among the other's (any position, so a trimmed copy still matches).
 */
export function samePictures(a: string[], b: string[]): boolean {
  const x = a.filter(telling);
  const y = b.filter(telling);
  if (x.length < 3 || y.length < 3) return false;
  let hits = 0;
  for (const p of x) if (y.some((q) => hamming(p, q) <= SAME)) hits++;
  return hits >= Math.max(3, Math.ceil(Math.min(x.length, y.length) * 0.6));
}

/**
 * Groups of videos showing the same clip, by their pictures. Only videos of
 * roughly comparable length are compared (a copy is at most a quarter
 * shorter or longer, more for short clips). Byte-identical files are left to
 * Duplicates. Oldest import first in each group.
 */
export function groupByPictures<T extends { id: string; durationMs: number | null; contentKey: string | null; importedAt: number }>(
  items: T[],
  prints: Map<string, string[]>
): string[][] {
  const list = items.filter((v) => (prints.get(v.id)?.filter(telling).length ?? 0) >= 3).sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0));
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (seen.has(a.id)) continue;
    const pa = prints.get(a.id)!;
    const group = [a];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const da = a.durationMs ?? 0;
      const db = b.durationMs ?? 0;
      if (da && db && db > da * 1.34 + 3000) break;
      if (seen.has(b.id) || (a.contentKey && a.contentKey === b.contentKey)) continue;
      if (samePictures(pa, prints.get(b.id)!)) group.push(b);
    }
    if (group.length > 1) {
      for (const g of group) seen.add(g.id);
      groups.push(group.sort((x, y) => x.importedAt - y.importedAt).map((g) => g.id));
    }
  }
  return groups;
}

/**
 * Takes away groups the length-and-shape rule made whose pictures say they
 * are different videos (episodes of one show are often the same length).
 * A group stays when its videos have no fingerprints yet.
 */
export function confirmByPictures(groups: string[][], prints: Map<string, string[]>): string[][] {
  return groups
    .map((g) => {
      const known = g.filter((id) => (prints.get(id)?.filter(telling).length ?? 0) >= 3);
      if (known.length < 2) return g;
      const first = known[0];
      return g.filter((id) => !known.includes(id) || id === first || samePictures(prints.get(first)!, prints.get(id)!));
    })
    .filter((g) => g.length > 1);
}

/** Merges two lists of groups: groups sharing a video become one. */
export function mergeGroups(a: string[][], b: string[][]): string[][] {
  const out: string[][] = [];
  for (const g of [...a, ...b]) {
    const hit = out.find((o) => g.some((id) => o.includes(id)));
    if (hit) {
      for (const id of g) if (!hit.includes(id)) hit.push(id);
    } else out.push([...g]);
  }
  return out;
}

/* ------------------------------------------------- search inside videos */

export type SceneRow = { videoId: string; atMs: number; labels: string; words: string };
export type SceneHit = { videoId: string; atMs: number; why: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Moments matching a search: every word of it is a scene word or appears in
 * the text on screen. One moment per video (the first), best matches first:
 * a scene word beats text, and more matching frames rank higher.
 */
export function findScenes(rows: SceneRow[], query: string, max = 30): SceneHit[] {
  const words = norm(query)
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((w) => w.length >= 2);
  if (!words.length) return [];
  const best = new Map<string, { atMs: number; why: string; score: number; count: number }>();
  for (const r of rows) {
    const labels = norm(r.labels);
    const text = norm(r.words);
    let score = 0;
    const why: string[] = [];
    let ok = true;
    for (const w of words) {
      const inLabel = labels.split(/\s*,\s*|\s{2,}/).some((l) => l === w || l.split(' ').includes(w) || (w.length >= 4 && l.startsWith(w)));
      if (inLabel) {
        score += 2;
        why.push(w);
      } else if (text.includes(w)) {
        score += 1;
        why.push(`"${w}"`);
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const cur = best.get(r.videoId);
    if (!cur) best.set(r.videoId, { atMs: r.atMs, why: why.join(', '), score, count: 1 });
    else {
      cur.count++;
      if (score > cur.score) Object.assign(cur, { atMs: r.atMs, why: why.join(', '), score });
    }
  }
  return [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count)
    .slice(0, max)
    .map(([videoId, h]) => ({ videoId, atMs: h.atMs, why: h.why }));
}
