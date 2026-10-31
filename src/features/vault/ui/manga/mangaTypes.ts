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
  /** Publication: ongoing, completed, hiatus, cancelled. */
  pubStatus: string | null;
  status: MangaStatus | null;
  rating: number;
  isPrivate: boolean;
  readingMode: ReadingMode | null;
  /** Given: set as is (Undo puts back the day a title was finished). */
  finishedAt: number | null;
}>;

export type MangaActions = {
  importFiles: () => Promise<void>;
  importFolder: () => Promise<void>;
  update: (ids: string[], patch: MangaEdit) => Promise<void>;
  addTag: (ids: string[], name: string) => Promise<void>;
  /** One title, or many at once. */
  removeTag: (ids: string | string[], name: string) => Promise<void>;
  /** Renames a keyword (category) on every title. */
  renameTag: (from: string, to: string) => Promise<void>;
  /** Takes keywords (categories) off every title: one name or many. */
  deleteTag: (names: string | string[]) => Promise<void>;
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
  /** While on, the volume buttons call `onKey` instead of changing the volume (app build 18 on). Returns the switch-off. */
  volumeKeys?: (onKey: (direction: 'up' | 'down') => void) => () => void;
  /** Asks a series' source for new chapters; how many were added. */
  refresh: (seriesId: string) => Promise<number>;
  /** Every series from a source; how many new chapters, and the titles that failed. */
  refreshAll: () => Promise<{ added: number; failed: string[] }>;
  setCoverFromPhoto: (seriesId: string) => Promise<void>;
  /** A page of a chapter as the series' cover. */
  setCoverFromPage: (seriesId: string, chapter: MangaChapter, page: number) => Promise<void>;
  /** Any page you are looking at (on the phone or online) as the cover. */
  setCoverFromImage?: (seriesId: string, img: ImageRef) => Promise<void>;
  /** A page through the share sheet, or saved to Photos (false = no permission). */
  sharePage?: (img: ImageRef) => Promise<void>;
  /** The cover's main colour, when it reads well as the title page's colour. */
  coverColor?: (seriesId: string) => Promise<string | null>;
  savePage?: (img: ImageRef) => Promise<boolean>;
  /** A page's plain margins and edge colour (app build 17 on; missing before). */
  pageMargins?: (img: ImageRef) => Promise<{ top: number; left: number; bottom: number; right: number; edge: string } | null>;
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
  /** Puts the waiting downloads in this order (chapter ids). */
  orderDownloads: (chapterIds: string[]) => Promise<void>;
  /** Puts waiting chapters on hold (kept in the list, not downloaded) or lets them download again. */
  holdDownloads: (chapterIds: string[], hold: boolean) => Promise<void>;
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

export type DownloadItem = { chapterId: string; seriesId: string; state: 'queued' | 'failed' | 'held'; error: string | null };
export type DownloadState = {
  queue: DownloadItem[];
  current: { chapterId: string; seriesId: string; done: number; total: number } | null;
  paused: boolean;
  /** "Wi-Fi only" is on and the phone is on mobile data. */
  waitingWifi?: boolean;
  /** This app build can tell Wi-Fi from mobile data (build 17 on). */
  canTellWifi?: boolean;
};

export type SourceGroup = { title: string; serverId?: string; items: SourceInfo[]; error?: string };

export type ServerInput = { kind: ServerKind; name: string; url: string; user: string; password: string };

/** Browse: sources, your servers, repos and extensions. */
import type { AniListActions, AniListState } from '../../manga/anilistData';

export type BrowseActions = {
  groups: (refresh?: boolean) => Promise<SourceGroup[]>;
  /** A source Browse listed (null until groups() has run). */
  source: (id: string) => MangaSource | null;
  setLanguages: (codes: string[]) => Promise<void>;
  setAdult: (on: boolean) => Promise<void>;
  /** Download and update options (smaller pages, check when the app opens, download new chapters). */
  setOption: (key: 'smallerPages' | 'checkOnOpen' | 'autoDownload' | 'skipFinished' | 'removeAfterRead' | 'wifiOnly' | 'patient' | 'autoUpdateExt' | 'syncProgress', on: boolean) => Promise<void>;
  /** Pages downloaded at the same time. */
  setParallel?: (n: 1 | 3 | 5) => Promise<void>;
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

export type BrowseData = { prefs: BrowsePrefs; actions: BrowseActions; /** The app build can tell Wi-Fi from mobile data (17 on). */ canTellWifi?: boolean };

export type MangaData = {
  items: MangaUiSeries[];
  deleted: MangaUiSeries[];
  busy: boolean;
  status: string;
  actions: MangaActions;
  browse: BrowseData;
  downloads: DownloadState;
  /** AniList: links, account and syncing (optional: the preview may leave it out). */
  anilist?: { state: AniListState; actions: AniListActions };
};
