/**
 * What the Audio screens get from the data layer (src/features/vault/audio/
 * audioData.ts) - plain data and functions, no native modules, so the same
 * screens run in the browser preview with fixtures.
 */

import type { AudioItem, AudioPlay, AudioPrefs, AudioStatus } from '../../audio/audioLogic';
import type { BookJson } from '../../audio/epub';
import type { DuplicateAsk, ThumbSource } from '../types';

/** One item, with the addresses the screens need already worked out. */
export type AudioUiItem = AudioItem & {
  coverSource: ThumbSource | null;
  /** The file of each track, ready to play. */
  trackUris: string[];
  /** The Voice Boost copy of each track (null while it is not made yet); only for items with Voice Boost on. */
  boostUris?: (string | null)[];
};

export type AudioBookmark = { id: number; itemId: string; track: number; atMs: number; label: string | null; createdAt: number };

/** An opened EPUB: its structure, and how to get each chapter's text and pictures. */
export type OpenBook = {
  book: BookJson;
  chapterText: (index: number) => Promise<string | null>;
  /** A path inside the book (a picture) as an address the screen can show. */
  uriOf: (path: string) => string;
};

export type AudioEdit = Partial<Pick<AudioItem, 'title' | 'author' | 'album' | 'narrator' | 'year' | 'genre' | 'description' | 'notes' | 'rating' | 'status' | 'isPrivate' | 'speed'>>;

export type AudioActions = {
  importFiles: () => Promise<void>;
  importFolder: () => Promise<void>;
  update: (ids: string[], patch: AudioEdit) => Promise<void>;
  addTag: (ids: string[], name: string) => Promise<void>;
  removeTag: (id: string, name: string) => Promise<void>;
  /** To Recently Deleted. */
  trash: (ids: string[]) => Promise<void>;
  restore: (ids: string[]) => Promise<void>;
  /** For good (from Recently Deleted): removes the files. */
  purge: (ids: string[]) => Promise<void>;
  savePosition: (id: string, track: number, ms: number) => Promise<void>;
  markFinished: (id: string) => Promise<void>;
  /** Back to the start, with this status (null = not started). */
  reset: (id: string, status: AudioStatus | null) => Promise<void>;
  addPlay: (id: string, startedAt: number, listenedMs: number, fromMs: number, toMs: number) => Promise<void>;
  loadPlays: () => Promise<AudioPlay[]>;
  listBookmarks: (id: string) => Promise<AudioBookmark[]>;
  addBookmark: (id: string, track: number, atMs: number, label: string | null) => Promise<void>;
  removeBookmark: (bookmarkId: number) => Promise<void>;
  loadBook: (id: string) => Promise<OpenBook | null>;
  /** The share sheet: the audio file, or the book rebuilt as an .epub. */
  share: (id: string) => Promise<void>;
  setCoverFromPhoto: (id: string) => Promise<void>;
  /** Pictures to look at while listening, in order (file addresses). */
  listPhotos?: (id: string) => Promise<string[]>;
  /** Picks one or more pictures from Photos; how many were added. */
  addPhotos?: (id: string) => Promise<number>;
  removePhoto?: (id: string, uri: string) => Promise<void>;
  /** What the Audio section takes on the phone (bytes). */
  storageBytes: () => Promise<number>;
  /** More audio files for this item, added on the end as chapters. Resolves how many. */
  addTracks?: (id: string) => Promise<number>;
  /** Extras: a PDF, an ebook or pictures that come with a book. */
  listExtras?: (id: string) => Promise<AudioExtraUi[]>;
  addExtras?: (id: string) => Promise<number>;
  openExtra?: (uri: string) => Promise<void>;
  removeExtra?: (id: string, name: string) => Promise<void>;
  setPrefs?: (p: AudioPrefs) => Promise<void>;
  /** Voice Boost works in this app build (18 and later). */
  canBoost?: () => boolean;
  /** Turns Voice Boost on (making the boosted copies first, with progress 0..1) or off. */
  setVoiceBoost?: (id: string, on: boolean, onProgress: (f: number) => void) => Promise<void>;
};

export type AudioExtraUi = { name: string; uri: string; size: number; kind: 'pdf' | 'image' | 'book' | 'other' };

export type AudioData = {
  items: AudioUiItem[];
  deleted: AudioUiItem[];
  busy: boolean;
  status: string;
  duplicateAsk: DuplicateAsk | null;
  actions: AudioActions;
  prefs?: AudioPrefs;
};
