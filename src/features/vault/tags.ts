import { getDb } from '@/db';

export type Tag = { id: number; name: string; color: string | null; pinned?: number };

/** Pinned keywords first, then A-Z. */
export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  return db.getAllAsync<Tag>(
    'SELECT id, name, color, pinned FROM tags ORDER BY pinned DESC, name COLLATE NOCASE;'
  );
}

export async function tagsForVideo(videoId: string): Promise<Tag[]> {
  const db = await getDb();
  return db.getAllAsync<Tag>(
    `SELECT t.id, t.name, t.color
       FROM tags t
       JOIN video_tags vt ON vt.tag_id = t.id
      WHERE vt.video_id = ?
      ORDER BY t.name COLLATE NOCASE;`,
    [videoId]
  );
}

/** Creates the tag if new, then links it to the video. Idempotent. */
export async function addTagToVideo(videoId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const db = await getDb();
  await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?);', [trimmed]);
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM tags WHERE name = ?;',
    [trimmed]
  );
  if (row) {
    await db.runAsync(
      'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?);',
      [videoId, row.id]
    );
  }
}

export async function removeTagFromVideo(videoId: string, tagId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?;', [
    videoId,
    tagId,
  ]);
}

/* ------------------------------------------------------------ keyword manager */

/** Smart filters name keywords in their rules: keep them pointing at the right one. */
async function renameInRules(from: string, to: string | null): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; rule_json: string }>('SELECT id, rule_json FROM smart_filters;');
  for (const r of rows) {
    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(r.rule_json);
    } catch {
      continue;
    }
    let changed = false;
    for (const key of ['tags', 'anyTags']) {
      const list = rule[key];
      if (!Array.isArray(list) || !list.includes(from)) continue;
      const next = [...new Set(list.map((t) => (t === from ? to : t)).filter((t): t is string => typeof t === 'string'))];
      if (next.length) rule[key] = next;
      else delete rule[key];
      changed = true;
    }
    if (changed) await db.runAsync('UPDATE smart_filters SET rule_json = ? WHERE id = ?;', [JSON.stringify(rule), r.id]);
  }
}

async function nameOf(id: number): Promise<string | null> {
  const db = await getDb();
  return (await db.getFirstAsync<{ name: string }>('SELECT name FROM tags WHERE id = ?;', [id]))?.name ?? null;
}

/** Moves every video of the `from` keywords onto `into`, then removes them. */
export async function mergeTags(fromIds: number[], intoId: number): Promise<void> {
  const db = await getDb();
  const into = await nameOf(intoId);
  if (!into) return;
  for (const id of fromIds) {
    if (id === intoId) continue;
    const from = await nameOf(id);
    await db.runAsync('INSERT OR IGNORE INTO video_tags (video_id, tag_id) SELECT video_id, ? FROM video_tags WHERE tag_id = ?;', [intoId, id]);
    await db.runAsync('DELETE FROM video_tags WHERE tag_id = ?;', [id]);
    await db.runAsync('DELETE FROM tags WHERE id = ?;', [id]);
    if (from) await renameInRules(from, into);
  }
}

/** Renames a keyword; renaming onto one that exists merges the two. */
export async function renameTag(id: number, newName: string): Promise<void> {
  const name = newName.trim();
  if (!name) return;
  const db = await getDb();
  const old = await nameOf(id);
  if (!old || old === name) return;
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?;', [name, id]);
  if (existing) return mergeTags([id], existing.id);
  await db.runAsync('UPDATE tags SET name = ? WHERE id = ?;', [name, id]);
  await renameInRules(old, name);
}

export async function deleteTag(id: number): Promise<void> {
  const db = await getDb();
  const name = await nameOf(id);
  await db.runAsync('DELETE FROM video_tags WHERE tag_id = ?;', [id]);
  await db.runAsync('DELETE FROM tags WHERE id = ?;', [id]);
  if (name) await renameInRules(name, null);
}

export async function setTagColor(id: number, color: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE tags SET color = ? WHERE id = ?;', [color, id]);
}

/** Removes keywords no video has. Returns how many. */
export async function deleteUnusedTags(): Promise<number> {
  const db = await getDb();
  const unused = await db.getAllAsync<{ id: number }>('SELECT id FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags);');
  for (const t of unused) await deleteTag(t.id);
  return unused.length;
}
