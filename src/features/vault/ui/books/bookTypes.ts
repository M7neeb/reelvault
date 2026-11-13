/**
 * What the Books screens get from the data layer. Types only, so the UI and
 * the browser preview never pull in a native module.
 */

import type { TocEntry } from '../../audio/epub';
import type { BookItem, BookMark, BookPlace, BookRead, BookSort, BookStatus, ReaderPrefs } from '../../books/bookLogic';

export type BookUi = BookItem & { coverUri: string | null };

export type OpenedBook = {
  chapters: { title: string; href: string }[];
  toc: TocEntry[];
  chapterText: (index: number) => Promise<string | null>;
  /** A path inside the book (a picture) as an address the screen can show. */
  uriOf: (path: string) => string;
};

export type BookActions = {
  importFiles: () => Promise<void>;
  open: (id: string) => Promise<OpenedBook | null>;
  /** Where you are; `addMs` is reading time since the last save. */
  savePlace: (id: string, place: BookPlace, addMs: number) => Promise<void>;
  setFinished: (id: string, finished: boolean) => Promise<void>;
  rate: (ids: string[], rating: number) => Promise<void>;
  /** null = let your reading decide. */
  setStatus: (ids: string[], status: BookStatus | null) => Promise<void>;
  addTag: (ids: string[], name: string) => Promise<void>;
  removeTag: (ids: string[], name: string) => Promise<void>;
  setPrivate: (ids: string[], value: boolean) => Promise<void>;
  /** To Recently Deleted. */
  trash: (ids: string[]) => Promise<void>;
  restore: (ids: string[]) => Promise<void>;
  /** Gone for good, files and all. */
  purge: (ids: string[]) => Promise<void>;
  edit: (id: string, title: string | null, author: string | null) => Promise<void>;
  setNotes: (id: string, notes: string | null) => Promise<void>;
  /** A picture from Files as the cover; `own` puts the book's own cover back. */
  setCover: (id: string, own?: boolean) => Promise<void>;
  loadMarks: (id: string) => Promise<BookMark[]>;
  addMark: (m: Omit<BookMark, 'id'>) => Promise<BookMark>;
  setMarkNote: (id: number, note: string | null) => Promise<void>;
  deleteMark: (id: number) => Promise<void>;
  setReader: (prefs: ReaderPrefs) => Promise<void>;
  setSort: (sort: BookSort) => Promise<void>;
  /** Every sitting with every book, oldest first. */
  loadReads: () => Promise<BookRead[]>;
  /** A few paragraphs from where you are in a book (for Wrapped). */
  passage: (id: string) => Promise<string[]>;
};

export type BooksData = {
  /** Every book not in Recently Deleted (Private ones too: the screens hide them while locked). */
  items: BookUi[];
  deleted: BookUi[];
  /** Days a book stays in Recently Deleted. */
  trashDays: number;
  /** False until the shelf has been read from the database once. */
  loaded: boolean;
  status: string;
  busy: boolean;
  reader: ReaderPrefs;
  /** The shelf's order (kept between launches). */
  sort: BookSort;
  actions: BookActions;
};
