/** Cover file names (pure, for the clean-up and its tests). */

/**
 * A cover's file name back to its video id and custom-cover time:
 * `<uuid>.jpg` (made at import) or `<uuid>-<time>.jpg` (chosen later). Ids are
 * 36-character UUIDs, which contain hyphens themselves, so they are cut by length.
 */
export function parseCoverName(name: string): { id: string; at: number | null } | null {
  if (name.length < 40 || !/^[0-9a-f-]{36}/i.test(name)) return null;
  const id = name.slice(0, 36);
  const rest = name.slice(36);
  if (rest === '.jpg') return { id, at: null };
  const m = /^-(\d+)\.jpg$/.exec(rest);
  return m ? { id, at: Number(m[1]) } : null;
}
