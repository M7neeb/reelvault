/**
 * What the Manga screens get from the data layer (src/features/vault/manga/
 * mangaData.ts) - plain data and functions, no native modules, so the same
 * screens run in the browser preview with fixtures.
 */

import type { MangaChapter, MangaKind, MangaRead, MangaSeries, MangaStatus, ReadingMode } from '../../manga/mangaLogic';
import type { ThumbSource } from '../types';

export type MangaUiSeries = MangaSeries & { coverSource: ThumbSource | null };

export type MangaEdit = Partial<{
  title: string;
  altTitle: string | null;
  author: string | null;
  artist: string | null;
  description: string | null;
  notes: string | null;
  kind: MangaKind | null;
  status: MangaStatus | null;
  rating: number;
  isPrivate: boolean;
  readingMode: ReadingMode | null;
}>;

export type MangaActions = {
  importFiles: () => Promise<void>;
  importFolder: () => Promise<void>;
  update: (ids: string[], patch: MangaEdit) => Promise<void>;
  addTag: (ids: string[], name: string) => Promise<void>;
  removeTag: (id: string, name: string) => Promise<void>;
  /** To Recently Deleted. */
  trash: (ids: string[]) => Promise<void>;
  restore: (ids: string[]) => Promise<void>;
  /** For good (from Recently Deleted): removes the pages. */
  purge: (ids: string[]) => Promise<void>;
  /** Removes chapters (and their pages) from a series. */
  deleteChapters: (seriesId: string, chapterIds: string[]) => Promise<void>;
  setRead: (chapterIds: string[], read: boolean) => Promise<void>;
  /** Every chapter before this one, read. */
  markPreviousRead: (seriesId: string, chapterId: string) => Promise<void>;
  /** Where you are in a chapter; `finished` when you reached its last page. */
  saveProgress: (seriesId: string, chapterId: string, page: number, finished: boolean) => Promise<void>;
  addRead: (r: MangaRead) => Promise<void>;
  /** The pages of a chapter as addresses the screen can show. */
  pageUris: (chapter: MangaChapter) => string[];
  setCoverFromPhoto: (seriesId: string) => Promise<void>;
  /** A page of a chapter as the series' cover. */
  setCoverFromPage: (seriesId: string, chapter: MangaChapter, page: number) => Promise<void>;
  /** What the Manga section takes on the phone (bytes). */
  storageBytes: () => Promise<number>;
};

export type MangaData = {
  items: MangaUiSeries[];
  deleted: MangaUiSeries[];
  busy: boolean;
  status: string;
  actions: MangaActions;
};
