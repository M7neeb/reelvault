/**
 * The books table (schema v15). The files themselves live in each book's
 * folder; here only what is known about them and where you stopped.
 */

import { getDb } from '@/db';

import type { BookItem, BookPlace } from './bookLogic';

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
};

function sizes(json: string): number[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((n) => (typeof n === 'number' && n > 0 ? n : 1)) : [];
  } catch {
    return [];
  }
}

const toBook = (r: Row): BookItem => ({
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
});

export async function listBooks(): Promise<BookItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT * FROM books ORDER BY added_at DESC;');
  return rows.map(toBook);
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

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM books WHERE id = ?;', [id]);
}
