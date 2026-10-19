/**
 * Keywords as a tree for the keyword manager: a keyword named "Travel/Japan"
 * sits under "Travel" (the parent shows even when no video has the bare
 * "Travel" keyword). Pure: no React, no database.
 */

export type KwTag = { id: number; name: string; pinned?: boolean; color?: string | null };

export type KwNode = {
  /** The full keyword ("Travel/Japan"), or the parent's name for a parent that is only a folder. */
  name: string;
  /** What to show ("Japan" under Travel). */
  label: string;
  tag: KwTag | null;
  count: number;
  children: KwNode[];
};

export const parentOf = (name: string): string | null => {
  const i = name.indexOf('/');
  return i > 0 ? name.slice(0, i).trim() : null;
};

export const leafOf = (name: string): string => {
  const i = name.indexOf('/');
  return i > 0 ? name.slice(i + 1).trim() : name;
};

/** Keywords grouped under their parents, filtered by `query`, sorted by name or by use. */
export function keywordTree(tags: KwTag[], counts: Record<string, number>, query = '', sort: 'name' | 'used' = 'name'): KwNode[] {
  const q = query.trim().toLowerCase();
  const roots = new Map<string, KwNode>();
  const order = (a: KwNode, b: KwNode) => (sort === 'used' ? b.count - a.count : 0) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  for (const t of tags) {
    if (q && !t.name.toLowerCase().includes(q)) continue;
    const parent = parentOf(t.name);
    const count = counts[t.name] ?? 0;
    if (!parent) {
      const node = roots.get(t.name.toLowerCase());
      if (node) {
        node.tag = t;
        node.count += count;
      } else roots.set(t.name.toLowerCase(), { name: t.name, label: t.name, tag: t, count, children: [] });
      continue;
    }
    let root = roots.get(parent.toLowerCase());
    if (!root) {
      root = { name: parent, label: parent, tag: tags.find((x) => x.name.toLowerCase() === parent.toLowerCase()) ?? null, count: 0, children: [] };
      roots.set(parent.toLowerCase(), root);
    }
    root.children.push({ name: t.name, label: leafOf(t.name), tag: t, count, children: [] });
    root.count += count;
  }
  const out = [...roots.values()];
  for (const r of out) r.children.sort(order);
  return out.sort(order);
}
