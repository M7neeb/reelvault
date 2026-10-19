/**
 * View-model types for the vault UI.
 *
 * IMPORTANT: nothing in `ui/` may import a native module (expo-sqlite,
 * expo-file-system, expo-document-picker). The UI takes plain data and
 * callbacks, which is what lets the exact same components render in a browser
 * for screenshots (see `src/app/preview.tsx`) and on the phone.
 *
 * To keep that boundary honest, the sort keys and tag shape are redeclared
 * here rather than imported from `repo.ts`/`tags.ts` - those pull in sqlite.
 */

import type { EditPlan } from '../edit';
import type { CompressQuality } from '../smaller';

export type { CompressQuality, EditPlan };

export type VaultSort = 'recent' | 'oldest' | 'rating' | 'name' | 'size' | 'duration' | 'mostWatched' | 'leastWatched' | 'lastWatched';

/** Sorts worked out from your plays (the rest come sorted from the database). */
export const WATCH_SORTS: VaultSort[] = ['mostWatched', 'leastWatched', 'lastWatched'];

export type UiTag = { id: number; name: string; pinned?: boolean; color?: string | null };

/** Watch status. The same values Simkl uses (redeclared from `../types`, see above). */
export type UiStatus = 'plantowatch' | 'watching' | 'completed' | 'hold' | 'dropped';

export const STATUSES: { key: UiStatus; label: string }[] = [
  { key: 'plantowatch', label: 'To watch' },
  { key: 'watching', label: 'Watching' },
  { key: 'completed', label: 'Watched' },
  { key: 'hold', label: 'On hold' },
  { key: 'dropped', label: 'Dropped' },
];

export const statusLabel = (s: UiStatus | null): string =>
  STATUSES.find((x) => x.key === s)?.label ?? 'No status';

/** 1 = pick, -1 = reject, 0 = none (HashPhotos' Flag). */
export type UiFlag = -1 | 0 | 1;

/** HashPhotos' four layout styles. */
export type LayoutStyle = 'grid' | 'natural' | 'waterfall' | 'mosaic';

export const LAYOUTS: { key: LayoutStyle; label: string }[] = [
  { key: 'grid', label: 'Grid' },
  { key: 'natural', label: 'Natural' },
  { key: 'waterfall', label: 'Waterfall' },
  { key: 'mosaic', label: 'Mosaic' },
];

/** HashPhotos' thumbnail sizes. Columns per size live in `layout.ts`. */
export type ThumbSize = 'small' | 'medium' | 'large' | 'xlarge' | 'fit';

export const THUMB_SIZES: { key: ThumbSize; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
  { key: 'xlarge', label: 'Extra Large' },
  { key: 'fit', label: 'Fit to screen' },
];

/** Things a thumbnail can show in its bottom-right label (several at once). */
export type ThumbInfo =
  | 'duration'
  | 'size'
  | 'date'
  | 'time'
  | 'dimensions'
  | 'format'
  | 'filename'
  | 'keywords'
  | 'albums'
  | 'device';

export const THUMB_INFOS: { key: ThumbInfo; label: string }[] = [
  { key: 'duration', label: 'Duration' },
  { key: 'size', label: 'File size' },
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'format', label: 'Format' },
  { key: 'filename', label: 'File name' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'albums', label: 'Album names' },
  { key: 'device', label: 'Camera model' },
];

/** HashPhotos' Grouping: section headers above the rows (never tiles inside the grid). */
export type GroupBy = 'none' | 'day' | 'week' | 'month' | 'year' | 'rating' | 'keyword' | 'series' | 'length';

/** The groupings by filming date (the timeline and calendar jump between these). */
export type DateGroup = 'day' | 'week' | 'month' | 'year';

export const GROUPINGS: { key: GroupBy; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'rating', label: 'Rating' },
  { key: 'keyword', label: 'Keyword' },
  { key: 'series', label: 'Series' },
  { key: 'length', label: 'Length' },
];

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEMES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

/** How the app looks. Saved in the settings table, so it survives a restart. */
/**
 * How the whole app is laid out (Settings → Look). Each one is really
 * different, not a tweak: Simple = big tiles and nothing else, Detailed =
 * rows with every fact, Compact = as much on screen as fits, Desktop = a
 * table with columns and a filter rail.
 */
export type Look = 'standard' | 'simple' | 'detailed' | 'compact' | 'desktop';

export const LOOKS: { key: Look; label: string; hint: string }[] = [
  { key: 'standard', label: 'Standard', hint: 'The grid with badges, like HashPhotos' },
  { key: 'simple', label: 'Simple', hint: 'Big pictures, no badges, nothing to read' },
  { key: 'detailed', label: 'Detailed', hint: 'A row per video with every fact, tags and your rating words' },
  { key: 'compact', label: 'Compact', hint: 'Small tiles and short rows: the most on one screen' },
  { key: 'desktop', label: 'Desktop', hint: 'A sortable table with columns and a filter rail on the left' },
];

/** Accent colours offered in Settings (null = the default blue). */
export const ACCENTS: { key: string; label: string }[] = [
  { key: '#0A84FF', label: 'Blue' },
  { key: '#5E5CE6', label: 'Indigo' },
  { key: '#BF5AF2', label: 'Purple' },
  { key: '#FF375F', label: 'Pink' },
  { key: '#FF453A', label: 'Red' },
  { key: '#FF9F0A', label: 'Orange' },
  { key: '#30D158', label: 'Green' },
  { key: '#30B0C7', label: 'Teal' },
  { key: '#00A86B', label: 'Jade' },
  { key: '#AC8E68', label: 'Brown' },
];

export type ViewOptions = {
  layout: LayoutStyle;
  look: Look;
  /** null = the default blue. */
  accent: string | null;
  size: ThumbSize;
  sort: VaultSort;
  groupBy: GroupBy;
  /** In this order on the label; empty = no label. */
  infos: ThumbInfo[];
  /** Rating and flag marks. */
  showRating: boolean;
  showKeywords: boolean;
  theme: ThemeMode;
  /** A colour set for the whole app; 'video' = tinted from `videoColor`. */
  colors: import('./paletteMath').ColorSet;
  /** The colour taken from a video's picture, and which video. */
  videoColor: string | null;
  videoColorFrom: string | null;
  font: import('./paletteMath').FontKey;
  glass: import('./paletteMath').GlassKey;
  corners: import('./paletteMath').CornerKey;
  /** A thin line around cards. */
  outlined: boolean;
  /** The whole app turns with the phone, not only the player. */
  rotate: boolean;
};

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  layout: 'grid',
  look: 'standard',
  accent: null,
  size: 'large',
  sort: 'recent',
  groupBy: 'none',
  infos: ['duration'],
  showRating: true,
  showKeywords: true,
  theme: 'system',
  colors: 'standard',
  videoColor: null,
  videoColorFrom: null,
  font: 'system',
  glass: 'regular',
  corners: 'standard',
  outlined: false,
  rotate: false,
};

export type Orientation = 'landscape' | 'portrait' | 'square';

/**
 * A saved search (Smart Filter / Smart Album) or a one-off search with filters.
 * Every condition that is set must match; an empty rule matches everything.
 * Evaluated in the UI (`logic.ts`) over the loaded items.
 */
export type SmartRule = {
  /** Part of the filename, title or caption, any case. */
  text?: string;
  /** Treat `text` as a regular expression. */
  regex?: boolean;
  minRating?: number;
  maxRating?: number;
  /** The video carries ALL of these keywords. */
  tags?: string[];
  status?: UiStatus;
  /** Only videos without any keyword. */
  untagged?: boolean;
  flag?: 'pick' | 'reject' | 'none';
  /** Filming date range (ms since epoch, inclusive). */
  dateFrom?: number;
  dateTo?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  minSizeMb?: number;
  maxSizeMb?: number;
  orientation?: Orientation;
  /** File extension, e.g. 'MOV'. */
  format?: string;
  minKeywords?: number;
  maxKeywords?: number;
  minAlbums?: number;
  maxAlbums?: number;
  /** Only videos that have / don't have GPS in their file. */
  hasLocation?: boolean;
  inTray?: boolean;
  /** The video carries ANY of these keywords. */
  anyTags?: string[];
  /** Never played in ReelVault, or played at least once. */
  watched?: 'never' | 'watched';
  /** Played at least this many times. */
  minPlays?: number;
  /** Not played in the last N days (never played counts too). */
  notWatchedDays?: number;
  /** Played in the last N days. */
  watchedWithinDays?: number;
  /** Imported in the last N days. */
  addedWithinDays?: number;
  /** Filmed in the last N days. */
  filmedWithinDays?: number;
};

export type SmartFilter = { id: number; name: string; rule: SmartRule; folderId: number | null };

export type UiAlbum = {
  id: number;
  name: string;
  folderId: number | null;
  isPrivate: boolean;
  pinned: boolean;
  /** Its videos still show in Uncategorized. */
  excludeUncategorized: boolean;
  lastUsedAt: number | null;
};

export type UiFolder = { id: number; name: string };

/** What the video file says about itself (redeclared from `../mp4`). */
export type UiMeta = {
  createdAt?: number;
  codec?: string;
  fps?: number;
  rotation?: number;
  make?: string;
  model?: string;
  software?: string;
  location?: { lat: number; lon: number; alt?: number };
};

/**
 * An image the UI can display. The device passes a `file://` uri string; the
 * browser preview passes whatever `require('…png')` returns (a module id or a
 * URL). Both are valid expo-image sources, so the type allows all three shapes.
 */
export type ThumbSource = number | string | { uri: string };

/**
 * "Already in your library": an import found a file you already have and
 * waits for an answer. `all` = do the same for the rest of this import.
 */
export type DuplicateAsk = {
  kind: 'video' | 'audio';
  /** The file being imported. */
  name: string;
  size: number;
  durationMs: number | null;
  /** The one you already have. */
  existing: { id: string; title: string; detail: string; thumb: ThumbSource | null; rating: number; importedAt: number };
  /** The very same file (true) or one that looks like the same (false; `reason` says why). */
  exact: boolean;
  reason: string;
  /** Files of this import still to come. */
  remaining: number;
  answer: (choice: 'replace' | 'both' | 'skip', all: boolean) => void;
};

/** One video, already resolved for display. */
export type VaultItem = {
  id: string;
  filename: string;
  /** Absolute file:// uri, used for playback only. */
  uri: string;
  /** Cover thumbnail. String uri on device; a require() module in the preview. */
  thumbSource: ThumbSource;
  sizeBytes: number;
  durationMs: number | null;
  rating: number;
  width: number | null;
  height: number | null;
  /** When it was filmed (from the file) or, failing that, imported. */
  createdAt: number;
  importedAt: number;
  /** Number of tags on this video (drives the # badge). */
  tagCount: number;
  /** Tag names on this video, used for client-side filtering in the UI. */
  tagNames: string[];
  /** Set while the video is in Recently Deleted (ms since epoch). */
  deletedAt: number | null;
  status: UiStatus | null;
  /** In the Private album: hidden everywhere else, shown only after unlocking. */
  isPrivate: boolean;
  flag: UiFlag;
  inTray: boolean;
  albumIds: number[];
  title: string | null;
  /** HashPhotos' "caption". */
  notes: string | null;
  meta: UiMeta | null;
  /** Size + hash of both ends; equal keys = the same video. */
  contentKey: string | null;
  /** A cover was picked by hand (frame or photo). */
  customCover: boolean;
  /** Size before Make Smaller; null if it never was. */
  originalSizeBytes: number | null;
};

export type ImportSource = 'files' | 'photos' | 'camera';

/** What Make Smaller did to one video. */
export type UiSmallerResult =
  | { kind: 'done'; before: number; after: number; newId?: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string };

export const SORTS: { key: VaultSort; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'rating', label: 'Rating' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'duration', label: 'Duration' },
  { key: 'mostWatched', label: 'Most watched' },
  { key: 'leastWatched', label: 'Least watched' },
  { key: 'lastWatched', label: 'Last watched' },
];

export type PasscodeKind = '4' | '6' | 'numeric' | 'alphanumeric';

export const PASSCODE_KINDS: { key: PasscodeKind; label: string }[] = [
  { key: '4', label: '4 digits' },
  { key: '6', label: '6 digits' },
  { key: 'numeric', label: 'Custom number' },
  { key: 'alphanumeric', label: 'Letters and numbers' },
];

export type SecurityState = {
  /** null = no app passcode: Private opens with Face ID / the phone's passcode. */
  passcodeKind: PasscodeKind | null;
  faceId: boolean;
  hasFakePasscode: boolean;
};

/** Everything the UI can ask the native layer to do. */
export type VaultActions = {
  /** Open the document picker and import. Container owns the busy/status text. */
  /** Files (HashPhotos exports), the Photos picker, or the camera. */
  onImport: (source: ImportSource) => void;
  /** Import every video in a folder from Files (sub-folders included); originals stay. */
  onImportFolder: () => void;
  /** A direct link to a video file (downloaded, then imported). */
  onImportLink: (url: string) => void;
  /** The link on the clipboard, if any - pre-fills "Paste Link". */
  readClipboardLink: () => Promise<string | null>;
  /** Copies into the Photos app (Save to Photos). */
  onSaveToPhotos: (items: VaultItem[]) => Promise<void>;
  /** Full-text search. The native layer uses SQLite FTS5; the preview filters locally. */
  search: (query: string) => Promise<VaultItem[]>;
  /** Tags currently on one video. */
  loadTags: (videoId: string) => Promise<UiTag[]>;
  /** Filmstrip frames for the scrubber (device: generated + cached; preview: placeholders). */
  loadFrames: (item: VaultItem) => Promise<ThumbSource[]>;
  onRate: (videoId: string, rating: number) => Promise<void>;
  onAddTag: (videoId: string, name: string) => Promise<void>;
  onRemoveTag: (videoId: string, tagId: number) => Promise<void>;
  onPinTag: (tagId: number, pinned: boolean) => Promise<void>;
  /** Keyword manager. Renaming onto an existing keyword merges them. */
  renameTag: (tagId: number, name: string) => Promise<void>;
  mergeTags: (fromIds: number[], intoId: number) => Promise<void>;
  deleteTag: (tagId: number) => Promise<void>;
  setTagColor: (tagId: number, color: string | null) => Promise<void>;
  deleteUnusedTags: () => Promise<number>;
  /** Bulk edits for the selected videos. `null` status / rating 0 clears it. */
  onRateMany: (videoIds: string[], rating: number) => Promise<void>;
  onAddTagMany: (videoIds: string[], name: string) => Promise<void>;
  onSetStatus: (videoIds: string[], status: UiStatus | null) => Promise<void>;
  onSetFlag: (videoIds: string[], flag: UiFlag) => Promise<void>;
  onSetTray: (videoIds: string[], inTray: boolean) => Promise<void>;
  onClearTray: () => Promise<void>;
  /** Title or caption; empty text clears it. */
  onSetText: (videoIds: string[], field: 'title' | 'notes', value: string) => Promise<void>;
  /** Set one filming date for all, or shift each by the same amount (ms). */
  onAdjustDates: (videoIds: string[], change: { setTo?: number; shiftBy?: number }) => Promise<void>;
  /** Move videos into (true) or out of (false) the Private album. */
  onSetPrivate: (videoIds: string[], isPrivate: boolean) => Promise<void>;
  /** Ask for Face ID (or the phone's passcode). `message` explains a refusal. */
  unlockPrivate: () => Promise<{ ok: boolean; message?: string }>;
  onViewOptionsChange: (options: ViewOptions) => Promise<void>;
  /** Saves a new smart filter, or replaces the one with `id`. */
  onSaveSmartFilter: (filter: { id?: number; name: string; rule: SmartRule }) => Promise<void>;
  onDeleteSmartFilter: (id: number) => Promise<void>;
  onMoveSmartFilter: (id: number, folderId: number | null) => Promise<void>;
  /** Albums and folders. */
  onCreateAlbum: (name: string, opts?: { folderId?: number | null; isPrivate?: boolean }) => Promise<number>;
  onUpdateAlbum: (
    id: number,
    patch: Partial<{ name: string; folderId: number | null; pinned: boolean; excludeUncategorized: boolean }>
  ) => Promise<void>;
  onDeleteAlbum: (id: number) => Promise<void>;
  onAddToAlbums: (videoIds: string[], albumIds: number[]) => Promise<void>;
  onRemoveFromAlbum: (videoIds: string[], albumId: number) => Promise<void>;
  /** Every video in the album gets the album's name as a keyword. */
  onAlbumNameToKeyword: (albumId: number) => Promise<void>;
  onCreateFolder: (name: string) => Promise<number>;
  onRenameFolder: (id: number, name: string) => Promise<void>;
  onDeleteFolder: (id: number) => Promise<void>;
  /** Share sheet: Save Video, Save to Files, AirDrop, other apps. */
  onShare: (item: VaultItem) => Promise<void>;
  /** Save the frame at `timeMs` as an image (share sheet). */
  onExtractFrame: (item: VaultItem, timeMs: number) => Promise<void>;
  /** A second copy of the video inside ReelVault. */
  onDuplicate: (item: VaultItem) => Promise<void>;
  /** Covers: the frame at `timeMs`, a picked photo (false = cancelled), or back to the import frame. */
  onSetCoverFrame: (item: VaultItem, timeMs: number) => Promise<void>;
  onPickCover: (item: VaultItem) => Promise<boolean>;
  onResetCover: (item: VaultItem) => Promise<void>;
  /** Make Smaller is only there in app builds with the encoder (1.1+). */
  canMakeSmaller: () => boolean;
  /** Replace the file with a re-encoded one, only if it saves at least 10%. */
  onMakeSmaller: (item: VaultItem, plan: EditPlan, onProgress: (f: number) => void) => Promise<UiSmallerResult>;
  /** Trim / crop / resolution / frame rate: replace the video or save a new copy. */
  onEditVideo: (
    item: VaultItem,
    plan: EditPlan,
    mode: 'replace' | 'copy',
    onProgress: (f: number) => void
  ) => Promise<UiSmallerResult>;
  onCancelMakeSmaller: () => void;
  /** Make every imported video smaller right away (null = off). */
  /** The automatic weekly backups of your info, newest first. */
  listAutoBackups: () => Promise<import('../backup').AutoBackup[]>;
  /** Makes an automatic backup now. */
  backupNow: () => Promise<import('../backup').AutoBackup | null>;
  /** Restores your info from one automatic backup. */
  restoreAutoBackup: (uri: string) => Promise<{ matched: number; total: number; plays: number } | null>;
  /** Videos with a bookmark whose name contains `q`. */
  searchBookmarks: (q: string) => Promise<string[]>;
  /** What ReelVault takes on the phone, by kind (see housekeeping.ts). */
  getAppStorage: () => Promise<import('../housekeeping').AppStorage>;
  /** Clears temporary files, leftovers and old filmstrips; `deep` also empties the picture cache. */
  tidyStorage: (deep: boolean) => Promise<import('../housekeeping').TidyResult>;
  /** Removes everything in Recently Deleted for good now. */
  emptyRecentlyDeleted: () => Promise<number>;
  getImportQuality: () => Promise<CompressQuality | null>;
  setImportQuality: (quality: CompressQuality | null) => Promise<void>;
  /** Open the place a video was filmed in Apple Maps. */
  onOpenMap: (lat: number, lon: number, label: string) => void;
  /** Library-info backup (ratings, keywords, albums...): export to Files / import back. */
  onExportBackup: () => Promise<void>;
  onImportBackup: () => Promise<void>;
  /** App passcode, Face ID and fake passcode for the Private album. */
  getSecurity: () => Promise<SecurityState>;
  setPasscode: (kind: PasscodeKind, code: string) => Promise<void>;
  clearPasscode: () => Promise<void>;
  setFakePasscode: (code: string | null) => Promise<void>;
  setFaceId: (enabled: boolean) => Promise<void>;
  /** `log: false` when checking a code you are choosing (not someone trying to get in). */
  checkPasscode: (code: string, opts?: { log?: boolean }) => Promise<'real' | 'fake' | 'wrong'>;
  /** Move to Recently Deleted. Nothing is removed from disk yet. */
  onDeleteOne: (item: VaultItem) => Promise<void>;
  onDeleteMany: (items: VaultItem[]) => Promise<void>;
  /** Bring videos back from Recently Deleted. */
  onRestoreMany: (items: VaultItem[]) => Promise<void>;
  /** Remove videos in Recently Deleted for good (file, thumbnails, row). */
  onPurgeMany: (items: VaultItem[]) => Promise<void>;
  /** Watching: every play is recorded for the dashboard, Wrapped and badges. */
  recordPlay: (videoId: string, startedAt: number, watchedMs: number) => Promise<void>;
  loadPlays: () => Promise<import('../stats').VaultPlay[]>;
  loadBookmarks: (videoId: string) => Promise<import('../watching').Bookmark[]>;
  addBookmark: (videoId: string, atMs: number, label: string | null) => Promise<void>;
  renameBookmark: (id: number, label: string | null) => Promise<void>;
  deleteBookmark: (id: number) => Promise<void>;
  countBookmarks: () => Promise<number>;
  /** null clears it. */
  setResume: (videoId: string, positionMs: number | null) => Promise<void>;
  setPrefs: (prefs: VaultPrefs) => Promise<void>;
  /** Alternate app icons (names from APP_ICONS; null = default). */
  appIcon: () => string | null;
  setAppIcon: (name: string | null) => Promise<void>;
  canChangeAppIcon: () => boolean;
  /** A notification every Monday morning: "Your weekly Wrapped is ready". */
  getWrappedReminder: () => Promise<boolean>;
  setWrappedReminder: (on: boolean) => Promise<boolean>;
  /** 9:00 on days with videos filmed on that date in earlier years. */
  getOnThisDayReminder: () => Promise<boolean>;
  setOnThisDayReminder: (on: boolean) => Promise<boolean>;
  /** 1 December: "Your year's Wrapped is ready". */
  getYearWrappedReminder: () => Promise<boolean>;
  setYearWrappedReminder: (on: boolean) => Promise<boolean>;
  getMonthWrappedReminder: () => Promise<boolean>;
  setMonthWrappedReminder: (on: boolean) => Promise<boolean>;
  /** Sunday 19:00: your week, your #1 and your run of days. */
  getWeeklySummary: () => Promise<boolean>;
  setWeeklySummary: (on: boolean) => Promise<boolean>;
  /** Take one keyword off many videos. */
  onRemoveTagMany: (videoIds: string[], name: string) => Promise<void>;
  /** Remove one sitting from the watch history. */
  deletePlays: (videoId: string, from: number, to: number) => Promise<void>;
  /** HashPhotos' Export Metadata file: pick and read it (null = cancelled), then apply what was planned. */
  pickMetadataFile: () => Promise<{ name: string; file: import('../hashphotos').MetaFile } | null>;
  applyMetadata: (changes: import('../hashphotos').MetaChange[]) => Promise<void>;
  /** Wrong and fake passcodes typed at Private, newest first. */
  passcodeLog: () => Promise<{ at: number; kind: 'wrong' | 'fake' | 'faceid-failed' }[]>;
  clearPasscodeLog: () => Promise<void>;
  /** Wi-Fi transfer from a computer (app 1.9+): null when this build has no server. */
  wifi: WifiBridge | null;

  /** A picture's main colours (the video theme); null where it can't be read. */
  colorsOf: (item: VaultItem) => Promise<{ dominant: string; average: string } | null>;

  /* Overview (rate and track your videos like shows). */
  ovCreateSeries: (name: string, videoIds: string[]) => Promise<string>;
  ovAddToSeries: (seriesId: string, videoIds: string[]) => Promise<void>;
  ovRemoveFromSeries: (videoIds: string[]) => Promise<void>;
  ovReorder: (seriesId: string, order: string[]) => Promise<void>;
  ovEpisodeName: (videoId: string, name: string | null) => Promise<void>;
  ovUpdateSeries: (
    id: string,
    change: { name?: string; description?: string | null; rating?: number; status?: UiStatus | null }
  ) => Promise<void>;
  /** 'photo' = pick one; { uri } = copy that picture (an episode's cover); null = first episode's cover. */
  ovSeriesCover: (id: string, from: 'photo' | { uri: string } | null) => Promise<boolean>;
  /** Ungroups: the videos stay. */
  ovDeleteSeries: (id: string) => Promise<void>;
  /** A video removed for good (only its info is left). */
  ovUpdateKept: (id: string, change: { title?: string | null; notes?: string | null; rating?: number; status?: UiStatus | null }) => Promise<void>;
  ovKeptCover: (id: string) => Promise<boolean>;
  /** Forget removed videos completely. */
  ovForget: (ids: string[]) => Promise<void>;
  /** Reviews, rewatches, Plan to Watch order and rating history. */
  loadOvExtra: () => Promise<import('../ovExtra').OvExtra>;
  saveOvExtra: (x: import('../ovExtra').OvExtra) => Promise<void>;
};

/** The Wi-Fi transfer server, as the UI sees it. */
export type WifiBridge = {
  /** Starts the server; resolves with the address to type on the computer (null = no Wi-Fi). */
  start: (onEvent: (e: WifiEvent) => void) => Promise<{ url: string | null; code: string }>;
  stop: () => Promise<void>;
};

export type WifiEvent =
  | { kind: 'receiving'; name: string; received: number; total: number }
  | { kind: 'imported'; name: string }
  | { kind: 'duplicate'; name: string }
  | { kind: 'failed'; name: string; reason: string };

/** Your own settings for watching your videos. */
export type VaultPrefs = {
  /** Your words for ratings ("1 = Waste of time"). */
  ratingLabels: import('../stats').RatingLabels;
  /** Offer "Continue another time" on videos of 5 minutes or more. */
  resumeEnabled: boolean;
  /** Hold the left or right edge of the video to play at 2×. */
  holdForSpeed: boolean;
  /** The Videos tab: watch your videos, or rate and track them (Overview). */
  /** Watch (the grid), Overview (rate and track) or Audio (your audio files and books). */
  videosMode: 'watch' | 'overview' | 'audio';
  /** Keep the info of removed videos you never rated too (not only rated ones). */
  keepUnrated: boolean;
  /** Series suggestions you dismissed (by their name). */
  hiddenSuggestions: string[];
  /** Up to three badges you pinned to the top of Badges (their ids). */
  showcase: string[];
  /** Your weekly watch-time goal on the dashboard, in minutes. */
  weeklyGoalMin: number;
  /** Memories you saved, and ones you hid (their ids). */
  memoryFavs: string[];
  memoryHidden: string[];
  /** Memories you have opened (the rest show a New dot). */
  memoriesSeen: string[];
  /** Memories you made yourself. */
  customMemories: import('../memories').CustomMemory[];
  /** Things you did that leave no other trace, for badges (memories played, Wrapped quizzes). */
  events: import('../achievements').AchEvent[];
  /** Badges you have already been shown earning; null until the first look (so old ones don't all pop up). */
  badgesSeen: string[] | null;
  /** Sound on the videos that play by themselves in cards (Dashboard, Memories, Wrapped, History). */
  liveSound: boolean;
  /** How Slideshow plays (remembered). */
  slideshow: SlideshowOptions;
  /** Albums in the sidebar: A to Z, most watched, or recently used. */
  albumSort: 'name' | 'watched' | 'recent';
  /** Rows above the library grid (recently added, your best, never watched…). */
  homeRows: boolean;
  /** What you searched for lately, newest first. */
  recentSearches: string[];
  /** How the video player behaves (remembered). */
  player: PlayerOptions;
  /** Videos pinned to the shelf at the top of the library (their ids, in order). */
  pinned: string[];
  /** Days a video stays in Recently Deleted before it is removed for good. */
  trashDays: number;
  /** Streak freezes: banked ones, and the days they covered (start of day, ms). */
  freezes: { banked: number; used: number[]; lastEarnedWeek: number | null };
};

export type PlayerOptions = {
  /** When a video ends, play the next one in the list (after a short countdown). */
  autoplayNext: boolean;
  /** Start the video again when it ends. */
  loop: boolean;
  /** Playback speed (1 = normal). */
  speed: number;
  /** A soft glow of the video's own colours around it. */
  ambient: boolean;
  /** Show the time left instead of the length. */
  remaining: boolean;
  /** Keep the sound playing when you leave the app or lock the phone. */
  background: boolean;
};

export const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const DEFAULT_PLAYER: PlayerOptions = { autoplayNext: true, loop: false, speed: 1, ambient: true, remaining: false, background: true };

export type SlideshowOptions = {
  order: 'shown' | 'shuffle' | 'oldest' | 'best';
  /** Seconds of each video; 0 = the whole video. */
  clipSec: number;
  transition: 'fade' | 'zoom' | 'slide' | 'none';
  titles: boolean;
  sound: boolean;
  repeat: boolean;
};

export const DEFAULT_SLIDESHOW: SlideshowOptions = { order: 'shown', clipSec: 0, transition: 'fade', titles: true, sound: true, repeat: false };

export const DEFAULT_VAULT_PREFS: VaultPrefs = {
  ratingLabels: {},
  resumeEnabled: true,
  holdForSpeed: true,
  videosMode: 'watch',
  keepUnrated: true,
  hiddenSuggestions: [],
  showcase: [],
  weeklyGoalMin: 120,
  memoryFavs: [],
  memoryHidden: [],
  memoriesSeen: [],
  customMemories: [],
  events: [],
  badgesSeen: null,
  liveSound: true,
  slideshow: DEFAULT_SLIDESHOW,
  albumSort: 'name',
  homeRows: true,
  recentSearches: [],
  player: DEFAULT_PLAYER,
  pinned: [],
  trashDays: 30,
  freezes: { banked: 1, used: [], lastEarnedWeek: null },
};

/** What the Overview needs besides the library: removed videos' info, and series. */
export type OverviewData = {
  kept: import('../overview').OvVideo[];
  series: import('../overview').OvSeries[];
  members: import('../overview').OvMember[];
};

export type VaultScreenProps = {
  /** Removed videos' info and series, for Overview mode. */
  overview?: OverviewData;
  /** Saved "continue another time" points: video id → position (ms). */
  resume?: Map<string, number>;
  prefs?: VaultPrefs;
  /** Open this week's Wrapped (the Monday notification was tapped). */
  wrappedRequest?: boolean;
  onWrappedHandled?: () => void;
  /** An On this day or yearly Wrapped notification was tapped. */
  openRequest?: 'yearWrapped' | 'monthWrapped' | 'weekWrapped' | 'onThisDay' | null;
  onOpenRequestHandled?: () => void;
  /** Simkl, for linking videos to a movie or episode and scrobbling them. */
  simkl?: import('@/features/simkl/ui/types').SimklBridge;
  /** All videos, already sorted by `viewOptions.sort`. Filtering happens inside the UI. */
  items: VaultItem[];
  /** Every tag in the library, pinned first - powers the sidebar and the search cloud. */
  allTags: UiTag[];
  /** tag name -> video ids. Powers sidebar counts and tag filtering. */
  tagMap: Record<string, string[]>;
  /** Videos in Recently Deleted, newest deletion first. Never part of `items`. */
  deletedItems: VaultItem[];
  /** Ids of videos with the same content, oldest import first in each group. */
  duplicateGroups: string[][];
  smartFilters: SmartFilter[];
  albums: UiAlbum[];
  folders: UiFolder[];
  viewOptions: ViewOptions;
  /** Free space on the device, or null when unknown (web/preview). */
  freeGb: number | null;
  busy: boolean;
  status: string;
  actions: VaultActions;
  /** An import is waiting: this file is already in the library (replace, keep both or skip). */
  duplicateAsk?: DuplicateAsk | null;
  /** The Audio section (Audio mode of this tab). */
  audio?: import('./audio/audioTypes').AudioData;
  /**
   * Mount the real <VideoView>. Off in the browser preview, where fixture
   * videos have no playable source - the stage is black either way.
   */
  enableVideo?: boolean;
  /**
   * Open one surface immediately on first render. Only the browser preview sets
   * this, so each sheet can be screenshotted on its own (`/preview?view=...`).
   * Never set by the app.
   */
  devInitialState?: {
    keywordsOpen?: boolean;
    triage?: 'tag' | 'keep';
    viewerId?: string;
    sidebarOpen?: boolean;
    searchOpen?: boolean;
    selectMode?: boolean;
    infoOpen?: boolean;
    menuOpen?: boolean;
    /** Start on one of the library views. */
    filter?: 'deleted' | 'duplicates' | 'private' | 'tray' | 'similar' | 'uncategorized' | 'picks';
    /** Start inside an album. */
    albumId?: number;
    /** Start with the Private album unlocked. */
    privateUnlocked?: boolean;
    /** Pre-selected ids (select mode). */
    selectedIds?: string[];
    viewOptionsOpen?: boolean;
    bulkOpen?: boolean;
    smartEditorOpen?: boolean;
    settingsOpen?: boolean;
    /** Opens Make Smaller for the selected ids. */
    smallerOpen?: boolean;
    calendarOpen?: boolean;
    timelineOpen?: boolean;
    overviewOpen?: boolean;
    mapOpen?: boolean;
    /** With viewerId: open the editor on this tab. */
    editorTab?: 'trim' | 'crop' | 'size';
    importMenuOpen?: boolean;
    insightsTab?: 'dashboard' | 'history' | 'memories' | 'wrapped' | 'badges' | 'storage';
    /** Play the first memory as Memories opens. */
    memoryOpen?: boolean;
    personaliseOpen?: boolean;
    /** Overview: open this title ('s:<id>' or 'v:<id>'), or a sheet. */
    overviewKey?: string;
    overviewSheet?: 'new' | 'edit' | 'add' | 'order';
    passcodeOpen?: boolean;
    slideshowOpen?: boolean;
    /** Slideshow: start playing at once (skip the options). */
    slideshowPlay?: boolean;
    coverPickerOpen?: boolean;
    dupReviewOpen?: boolean;
    /** Show the "already in your library" question. */
    dupAsk?: boolean;
    /** Audio mode: open the player, an item's details, the stats or Recently Deleted. */
    audio?: import('./audio/AudioSection').AudioDev;
    metaImportOpen?: boolean;
    wifiOpen?: boolean;
    historyStats?: boolean;
    compareOpen?: boolean;
  };
};
