/**
 * What the Manga screens get from the data layer (src/features/vault/manga/
 * mangaData.ts) - plain data and functions, no native modules, so the same
 * screens run in the browser preview with fixtures.
 */

import type { MangaChapter, MangaKind, MangaRead, MangaSeries, MangaStatus, ReadingMode } from '../../manga/mangaLogic';
import type { RepoExtension } from '../../manga/sources/extensions';
import type { BrowsePrefs, ServerKind, ReaderPrefs } from '../../manga/sources/prefs';
import type { ImageRef, MangaSource, SourceChapter, SourceDetails, SourceInfo } from '../../manga/sources/types';
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
  /** The pages of a chapter: from the phone, or from its source (read online). */
  loadPages: (series: Pick<MangaSeries, 'sourceId'>, chapter: MangaChapter) => Promise<ImageRef[]>;
  /** Keeps the screen on while the reader is open. */
  keepAwake?: (on: boolean) => void;
  /** Asks a series' source for new chapters; how many were added. */
  refresh: (seriesId: string) => Promise<number>;
  /** Every series from a source; how many new chapters, and the titles that failed. */
  refreshAll: () => Promise<{ added: number; failed: string[] }>;
  setCoverFromPhoto: (seriesId: string) => Promise<void>;
  /** A page of a chapter as the series' cover. */
  setCoverFromPage: (seriesId: string, chapter: MangaChapter, page: number) => Promise<void>;
  /** What the Manga section takes on the phone (bytes). */
  storageBytes: () => Promise<number>;
  /** Adds chapters to the download queue (all, the unread ones, or these); how many were added. */
  download: (seriesId: string, which: 'all' | 'unread' | string[]) => Promise<number>;
  /** Every chapter of every title from a source that isn't on the phone yet. */
  downloadLibrary: () => Promise<number>;
  /** Removes downloaded pages (the chapters stay, readable online). */
  removeDownloads: (seriesId: string, which: 'all' | string[]) => Promise<void>;
  cancelDownloads: (chapterIds: string[] | null) => Promise<void>;
  retryDownloads: () => Promise<void>;
  pauseDownloads: (paused: boolean) => void;
  /** Saves downloaded chapters as .cbz files in Files › ReelVault › Exports; a message for the screen. */
  exportCbz: (seriesId: string, which: 'all' | string[]) => Promise<string>;
  /** One chapter as a .cbz through the share sheet. */
  shareCbz: (seriesId: string, chapterId: string) => Promise<void>;
  /** Picks a Tachimanga / Tachiyomi backup and adds its library. */
  importBackup: () => Promise<void>;
  /** Links a title to a title on a source (chapters matched by number). */
  linkSeries: (seriesId: string, sourceId: string, key: string) => Promise<{ matched: number; added: number }>;
  /** Tries to link every unlinked backup title through your Suwayomi servers; how many linked. */
  autoLink: () => Promise<number>;
  loadReads: () => Promise<MangaRead[]>;
};

export type DownloadItem = { chapterId: string; seriesId: string; state: 'queued' | 'failed'; error: string | null };
export type DownloadState = { queue: DownloadItem[]; current: { chapterId: string; seriesId: string; done: number; total: number } | null; paused: boolean };

export type SourceGroup = { title: string; serverId?: string; items: SourceInfo[]; error?: string };

export type ServerInput = { kind: ServerKind; name: string; url: string; user: string; password: string };

/** Browse: sources, your servers, repos and extensions. */
export type BrowseActions = {
  groups: (refresh?: boolean) => Promise<SourceGroup[]>;
  /** A source Browse listed (null until groups() has run). */
  source: (id: string) => MangaSource | null;
  setLanguages: (codes: string[]) => Promise<void>;
  setAdult: (on: boolean) => Promise<void>;
  /** Download and update options (smaller pages, check when the app opens, download new chapters). */
  setOption: (key: 'smallerPages' | 'checkOnOpen' | 'autoDownload', on: boolean) => Promise<void>;
  /** The reader's own settings (tap zones, page colour, two pages side by side). */
  setReader: (patch: Partial<ReaderPrefs>) => Promise<void>;
  addServer: (input: ServerInput) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  addRepo: (url: string) => Promise<void>;
  refreshRepos: () => Promise<string[]>;
  removeRepo: (url: string) => Promise<void>;
  install: (repoUrl: string, ext: RepoExtension) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  /** Adds a title to the library; its series id. */
  addToLibrary: (sourceId: string, details: SourceDetails, chapters: SourceChapter[]) => Promise<string>;
  openUrl: (url: string) => void;
};

export type BrowseData = { prefs: BrowsePrefs; actions: BrowseActions };

export type MangaData = {
  items: MangaUiSeries[];
  deleted: MangaUiSeries[];
  busy: boolean;
  status: string;
  actions: MangaActions;
  browse: BrowseData;
  downloads: DownloadState;
};
