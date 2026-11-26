/**
 * Creators: who made a video (downloaded clips from the same person), kept
 * apart from keywords. Names, comparing them, and reading them from file
 * names for suggestions. Pure; no runtime imports.
 */

const MAX = 60;

/** "  @Mr  Beast " -> "Mr Beast"; empty or too long -> null. */
export function normCreator(name: string): string | null {
  const n = name.replace(/^\s*@+/, '').replace(/\s+/g, ' ').trim();
  return n && n.length <= MAX ? n : null;
}

const key = (name: string) => (normCreator(name) ?? '').toLowerCase();

/** Same creator, whatever the case or a leading @. */
export const sameCreator = (a: string, b: string): boolean => key(a) !== '' && key(a) === key(b);

/**
 * The creator written in a file name, if any: "@name_123.mp4" (TikTok style)
 * or "name - title.mp4". Null for camera names and plain titles.
 */
export function creatorFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[a-z0-9]{2,4}$/i, '');
  const at = /^@([a-z0-9._]{2,30}?)(?:[._-]?\d+)?(?:[\s_-]|$)/i.exec(base);
  if (at) return normCreator(at[1].replace(/[._-]+$/, ''));
  const dash = /^(.{2,40}?)\s+-\s+\S/.exec(base);
  if (dash && !/^\d+$/.test(dash[1].trim())) return normCreator(dash[1]);
  return null;
}

/**
 * Who your videos look like they are from, by their file names: one group
 * per name, only videos that don't have that creator yet, at least two
 * videos (one is enough when you already use that creator), names you said
 * "Not this one" to left out, biggest first.
 */
export function suggestCreators(videos: { id: string; filename: string; creators: string[] }[], dismissed: string[]): { name: string; ids: string[] }[] {
  const known = new Map<string, string>();
  for (const v of videos) for (const c of v.creators) if (!known.has(key(c))) known.set(key(c), c);
  const gone = new Set(dismissed.map(key));
  const groups = new Map<string, { name: string; ids: string[] }>();
  for (const v of videos) {
    const found = creatorFromFilename(v.filename);
    if (!found) continue;
    const k = key(found);
    if (gone.has(k) || v.creators.some((c) => key(c) === k)) continue;
    const g = groups.get(k) ?? { name: known.get(k) ?? found, ids: [] };
    g.ids.push(v.id);
    groups.set(k, g);
  }
  return [...groups.entries()]
    .filter(([k, g]) => g.ids.length >= 2 || known.has(k))
    .map(([, g]) => g)
    .sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
}

/** For search: the same creator, or one whose name (spaces or not) starts with what you typed. */
export function creatorMatches(creator: string, typed: string): boolean {
  const c = key(creator);
  const t = key(typed);
  if (!c || !t) return false;
  return c === t || (t.length >= 2 && (c.startsWith(t) || c.replace(/\s+/g, '').startsWith(t.replace(/\s+/g, ''))));
}
