/**
 * The books table (schema v15). The files themselves live in each book's
 * folder; here only what is known about them and where you stopped.
 */

import { getDb } from '@/db';

import { SESSION_GAP_MS, type BookItem, type BookMark, type BookPlace, type BookRead, type BookStatus } from './bookLogic';

type Row = {
  id: string;
  folder: string;
  filename: string;
  size: number;
  title: string | null;
  author: string | null;
  language: string | null;
  description: string | null;
  cover: string | null;
  chapter_sizes: string;
  chapter: number;
  block: number;
  chapter_frac: number;
  read_ms: number;
  last_read_at: number | null;
  finished_at: number | null;
  added_at: number;
  rating: number;
  status: string | null;
  notes: string | null;
  is_private: number;
  deleted_at: number | null;
};

const STATUSES = new Set(['want', 'reading', 'finished', 'dropped']);

function sizes(json: string): number[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((n) => (typeof n === 'number' && n > 0 ? n : 1)) : [];
  } catch {
    return [];
  }
}

const toBook = (r: Row, tags: string[] = []): BookItem => ({
  id: r.id,
  folder: r.folder,
  filename: r.filename,
  size: r.size,
  title: r.title,
  author: r.author,
  language: r.language,
  description: r.description,
  cover: r.cover,
  chapterSizes: sizes(r.chapter_sizes),
  chapter: r.chapter,
  block: r.block,
  chapterFrac: r.chapter_frac,
  readMs: r.read_ms,
  lastReadAt: r.last_read_at,
  finishedAt: r.finished_at,
  addedAt: r.added_at,
  rating: r.rating ?? 0,
  status: r.status && STATUSES.has(r.status) ? (r.status as BookStatus) : null,
  notes: r.notes,
  isPrivate: r.is_private === 1,
  deletedAt: r.deleted_at,
  tags,
});

export async function listBooks(): Promise<BookItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT * FROM books ORDER BY added_at DESC;');
  const tags = await db.getAllAsync<{ book_id: string; name: string }>('SELECT book_id, name FROM book_tags ORDER BY name COLLATE NOCASE;');
  const by = new Map<string, string[]>();
  for (const t of tags) by.set(t.book_id, [...(by.get(t.book_id) ?? []), t.name]);
  return rows.map((r) => toBook(r, by.get(r.id) ?? []));
}

export async function findBookByKey(key: string): Promise<BookItem | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Row>('SELECT * FROM books WHERE content_key = ? LIMIT 1;', [key]);
  return r ? toBook(r) : null;
}

export async function insertBook(b: BookItem, contentKey: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO books (id, folder, filename, size, title, author, language, description, cover, chapter_sizes, content_key, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [b.id, b.folder, b.filename, b.size, b.title, b.author, b.language, b.description, b.cover, JSON.stringify(b.chapterSizes), contentKey, b.addedAt]
  );
}

/** Where you are now; `addMs` is reading time since the last save. */
export async function saveBookPlace(id: string, place: BookPlace, addMs: number, at: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE books SET chapter = ?, block = ?, chapter_frac = ?, read_ms = read_ms + ?, last_read_at = ? WHERE id = ?;', [
    place.chapter,
    place.block,
    place.chapterFrac,
    Math.max(0, Math.round(addMs)),
    at,
    id,
  ]);
}

export async function setBookFinished(id: string, at: number | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE books SET finished_at = ? WHERE id = ?;', [at, id]);
}

export async function setBookText(id: string, title: string | null, author: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE books SET title = ?, author = ? WHERE id = ?;', [title, author, id]);
}

/** Gone for good: the book, its sittings, keywords, bookmarks and highlights. */
export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const t of ['book_reads', 'book_tags', 'book_marks']) await tx.runAsync(`DELETE FROM ${t} WHERE book_id = ?;`, [id]);
    await tx.runAsync('DELETE FROM books WHERE id = ?;', [id]);
  });
}

const marks = (ids: string[]) => ids.map(() => '?').join(', ');

export async function setBooksField(ids: string[], field: 'rating' | 'status' | 'is_private' | 'deleted_at', value: number | string | null): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE books SET ${field} = ? WHERE id IN (${marks(ids)});`, [value, ...ids]);
}

export async function setBookNotes(id: string, notes: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE books SET notes = ? WHERE id = ?;', [notes, id]);
}

export async function setBookCover(id: string, cover: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE books SET cover = ? WHERE id = ?;', [cover, id]);
}

export async function addBookTag(ids: string[], name: string): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const id of ids) {
      // The same keyword in other capitals is the same keyword.
      const have = await tx.getFirstAsync<{ name: string }>('SELECT name FROM book_tags WHERE book_id = ? AND name = ? COLLATE NOCASE;', [id, name]);
      if (!have) await tx.runAsync('INSERT INTO book_tags (book_id, name) VALUES (?, ?);', [id, name]);
    }
  });
}

export async function removeBookTag(ids: string[], name: string): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`DELETE FROM book_tags WHERE name = ? COLLATE NOCASE AND book_id IN (${marks(ids)});`, [name, ...ids]);
}

/** Books in Recently Deleted for longer than `days`. */
export async function expiredBooks(days: number, now: number): Promise<{ id: string; folder: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: string; folder: string }>('SELECT id, folder FROM books WHERE deleted_at IS NOT NULL AND deleted_at < ?;', [now - days * 86_400_000]);
}

/* ------------------------------------------- bookmarks and highlights */

type MarkRow = { id: number; book_id: string; kind: string; chapter: number; block: number; text: string | null; note: string | null; created_at: number };

export async function listBookMarks(bookId?: string): Promise<BookMark[]> {
  const db = await getDb();
  const rows = bookId
    ? await db.getAllAsync<MarkRow>('SELECT * FROM book_marks WHERE book_id = ? ORDER BY chapter, block, id;', [bookId])
    : await db.getAllAsync<MarkRow>('SELECT * FROM book_marks ORDER BY book_id, chapter, block, id;');
  return rows.map((r) => ({ id: r.id, bookId: r.book_id, kind: r.kind === 'highlight' ? 'highlight' : 'bookmark', chapter: r.chapter, block: r.block, text: r.text, note: r.note, createdAt: r.created_at }));
}

export async function addBookMark(m: Omit<BookMark, 'id'>): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('INSERT INTO book_marks (book_id, kind, chapter, block, text, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);', [m.bookId, m.kind, m.chapter, m.block, m.text, m.note, m.createdAt]);
  return r.lastInsertRowId;
}

export async function setBookMarkNote(id: number, note: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE book_marks SET note = ? WHERE id = ?;', [note, id]);
}

export async function deleteBookMark(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM book_marks WHERE id = ?;', [id]);
}

/* ---------------------------------------------------- reading sessions */

/**
 * Adds reading time to the sitting it belongs to: the book's last sitting
 * when it ended less than SESSION_GAP_MS ago, else a new one.
 */
export async function logBookRead(bookId: string, at: number, addMs: number, progressBefore: number, progressNow: number): Promise<void> {
  if (addMs <= 0) return;
  const db = await getDb();
  const last = await db.getFirstAsync<{ id: number; ended_at: number }>('SELECT id, ended_at FROM book_reads WHERE book_id = ? ORDER BY ended_at DESC LIMIT 1;', [bookId]);
  if (last && at - last.ended_at < SESSION_GAP_MS) {
    await db.runAsync('UPDATE book_reads SET ended_at = ?, read_ms = read_ms + ?, progress_to = ? WHERE id = ?;', [at, Math.round(addMs), progressNow, last.id]);
  } else {
    await db.runAsync('INSERT INTO book_reads (book_id, started_at, ended_at, read_ms, progress_from, progress_to) VALUES (?, ?, ?, ?, ?, ?);', [
      bookId,
      Math.round(at - addMs),
      at,
      Math.round(addMs),
      progressBefore,
      progressNow,
    ]);
  }
}

type ReadRow = { book_id: string; started_at: number; ended_at: number; read_ms: number; progress_from: number; progress_to: number };

export async function listBookReads(): Promise<BookRead[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ReadRow>('SELECT book_id, started_at, ended_at, read_ms, progress_from, progress_to FROM book_reads ORDER BY started_at;');
  return rows.map((r) => ({ bookId: r.book_id, startedAt: r.started_at, endedAt: r.ended_at, ms: r.read_ms, from: r.progress_from, to: r.progress_to }));
}
