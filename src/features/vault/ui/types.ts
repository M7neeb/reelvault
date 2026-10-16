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

export type VaultSort = 'recent' | 'oldest' | 'rating' | 'name' | 'size' | 'duration';

export type UiTag = { id: number; name: string };

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

/** What the bottom-right label of every thumbnail shows. */
export type ThumbInfo =
  | 'duration'
  | 'size'
  | 'date'
  | 'dimensions'
  | 'format'
  | 'filename'
  | 'keywords'
  | 'none';

export const THUMB_INFOS: { key: ThumbInfo; label: string }[] = [
  { key: 'duration', label: 'Duration' },
  { key: 'size', label: 'File size' },
  { key: 'date', label: 'Date' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'format', label: 'Format' },
  { key: 'filename', label: 'File name' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'none', label: 'Nothing' },
];

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEMES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

/** How the app looks. Saved in the settings table, so it survives a restart. */
export type ViewOptions = {
  layout: LayoutStyle;
  size: ThumbSize;
  sort: VaultSort;
  info: ThumbInfo;
  showRating: boolean;
  showKeywords: boolean;
  theme: ThemeMode;
};

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  layout: 'grid',
  size: 'large',
  sort: 'recent',
  info: 'duration',
  showRating: true,
  showKeywords: true,
  theme: 'system',
};

/**
 * A saved search. Every condition that is set must match; an empty rule
 * matches everything. Evaluated in the UI (`logic.ts`) over the loaded items.
 */
export type SmartRule = {
  /** Part of the filename, any case. */
  text?: string;
  /** Rating at least this (1..10). */
  minRating?: number;
  /** The video carries ALL of these keywords. */
  tags?: string[];
  status?: UiStatus;
  /** Only videos without any keyword. */
  untagged?: boolean;
};

export type SmartFilter = { id: number; name: string; rule: SmartRule };

/**
 * An image the UI can display. The device passes a `file://` uri string; the
 * browser preview passes whatever `require('…png')` returns (a module id or a
 * URL). Both are valid expo-image sources, so the type allows all three shapes.
 */
export type ThumbSource = number | string | { uri: string };

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
  importedAt: number;
  /** Number of tags on this video (drives the 🏷 badge). */
  tagCount: number;
  /** Tag names on this video, used for client-side filtering in the UI. */
  tagNames: string[];
  /** Set while the video is in Recently Deleted (ms since epoch). */
  deletedAt: number | null;
  status: UiStatus | null;
  /** In the Private album: hidden everywhere else, shown only after Face ID. */
  isPrivate: boolean;
};

export const SORTS: { key: VaultSort; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'rating', label: 'Rating' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'duration', label: 'Duration' },
];

/** Everything the UI can ask the native layer to do. */
export type VaultActions = {
  /** Open the document picker and import. Container owns the busy/status text. */
  onImport: () => void;
  /** Full-text search. The native layer uses SQLite FTS5; the preview filters locally. */
  search: (query: string) => Promise<VaultItem[]>;
  /** Tags currently on one video. */
  loadTags: (videoId: string) => Promise<UiTag[]>;
  /** Filmstrip frames for the scrubber (device: generated + cached; preview: placeholders). */
  loadFrames: (item: VaultItem) => Promise<ThumbSource[]>;
  onRate: (videoId: string, rating: number) => Promise<void>;
  onAddTag: (videoId: string, name: string) => Promise<void>;
  onRemoveTag: (videoId: string, tagId: number) => Promise<void>;
  /** Bulk edits for the selected videos. `null` status / rating 0 clears it. */
  onRateMany: (videoIds: string[], rating: number) => Promise<void>;
  onAddTagMany: (videoIds: string[], name: string) => Promise<void>;
  onSetStatus: (videoIds: string[], status: UiStatus | null) => Promise<void>;
  /** Move videos into (true) or out of (false) the Private album. */
  onSetPrivate: (videoIds: string[], isPrivate: boolean) => Promise<void>;
  /** Ask for Face ID (or the phone's passcode). `message` explains a refusal. */
  unlockPrivate: () => Promise<{ ok: boolean; message?: string }>;
  onViewOptionsChange: (options: ViewOptions) => Promise<void>;
  /** Saves a new smart filter, or replaces the one with `id`. */
  onSaveSmartFilter: (filter: { id?: number; name: string; rule: SmartRule }) => Promise<void>;
  onDeleteSmartFilter: (id: number) => Promise<void>;
  /** Move to Recently Deleted. Nothing is removed from disk yet. */
  onDeleteOne: (item: VaultItem) => Promise<void>;
  onDeleteMany: (items: VaultItem[]) => Promise<void>;
  /** Bring videos back from Recently Deleted. */
  onRestoreMany: (items: VaultItem[]) => Promise<void>;
  /** Remove videos in Recently Deleted for good (file, thumbnails, row). */
  onPurgeMany: (items: VaultItem[]) => Promise<void>;
};

export type VaultScreenProps = {
  /** All videos, already sorted by `viewOptions.sort`. Filtering happens inside the UI. */
  items: VaultItem[];
  /** Every tag in the library - powers the sidebar and the search cloud. */
  allTags: UiTag[];
  /** tag name -> video ids. Powers sidebar counts and tag filtering. */
  tagMap: Record<string, string[]>;
  /** Videos in Recently Deleted, newest deletion first. Never part of `items`. */
  deletedItems: VaultItem[];
  /** Ids of videos with the same content, oldest import first in each group. */
  duplicateGroups: string[][];
  smartFilters: SmartFilter[];
  viewOptions: ViewOptions;
  /** Free space on the device, or null when unknown (web/preview). */
  freeGb: number | null;
  busy: boolean;
  status: string;
  actions: VaultActions;
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
    viewerId?: string;
    sidebarOpen?: boolean;
    searchOpen?: boolean;
    selectMode?: boolean;
    infoOpen?: boolean;
    menuOpen?: boolean;
    /** Start on one of the special library views. */
    filter?: 'deleted' | 'duplicates' | 'private';
    /** Start with the Private album unlocked. */
    privateUnlocked?: boolean;
    /** Pre-selected ids (select mode). */
    selectedIds?: string[];
    viewOptionsOpen?: boolean;
    bulkOpen?: boolean;
    smartEditorOpen?: boolean;
  };
};
