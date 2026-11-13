/**
 * What the Books screens get from the data layer. Types only, so the UI and
 * the browser preview never pull in a native module.
 */

import type { TocEntry } from '../../audio/epub';
import type { BookItem, BookPlace, ReaderPrefs } from '../../books/bookLogic';

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
  remove: (id: string) => Promise<void>;
  setReader: (prefs: ReaderPrefs) => Promise<void>;
};

export type BooksData = {
  items: BookUi[];
  /** False until the shelf has been read from the database once. */
  loaded: boolean;
  status: string;
  busy: boolean;
  reader: ReaderPrefs;
  actions: BookActions;
};
