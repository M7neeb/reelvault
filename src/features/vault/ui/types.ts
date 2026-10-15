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

export type VaultSort = 'recent' | 'oldest' | 'rating' | 'name' | 'size';

export type UiTag = { id: number; name: string };

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
};

export const SORTS: { key: VaultSort; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'rating', label: 'Rating' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
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
  onDeleteOne: (item: VaultItem) => Promise<void>;
  onDeleteMany: (items: VaultItem[]) => Promise<void>;
};

export type VaultScreenProps = {
  /** All videos, already sorted by `sort`. Filtering happens inside the UI. */
  items: VaultItem[];
  /** Every tag in the library - powers the sidebar and the search cloud. */
  allTags: UiTag[];
  /** tag name -> video ids. Powers sidebar counts and tag filtering. */
  tagMap: Record<string, string[]>;
  /** Free space on the device, or null when unknown (web/preview). */
  freeGb: number | null;
  busy: boolean;
  status: string;
  sort: VaultSort;
  onSortChange: (sort: VaultSort) => void;
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
  };
};
