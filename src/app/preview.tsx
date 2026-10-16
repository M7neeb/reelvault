/**
 * Design preview - the render loop.
 *
 * Renders the REAL vault UI (`@/features/vault/ui/VaultScreen`) against fixture
 * data, with no database and no native modules. It exists so the layout can be
 * built in a browser: `npx expo export -p web`, serve `dist/`, screenshot at
 * phone dimensions, look, fix, repeat.
 *
 * Before this existed the UI could only be seen by loading it on a physical
 * iPhone, which meant it was written blind.
 *
 * Open `/preview?view=<name>` to capture one surface; the names are the keys of
 * VIEWS below. Fixtures are neutral placeholders, never real videos.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import {
  FIXTURE_ALBUMS,
  FIXTURE_DELETED,
  FIXTURE_DUPLICATE_GROUPS,
  FIXTURE_FOLDERS,
  FIXTURE_ITEMS,
  FIXTURE_SMART_FILTERS,
  FIXTURE_TAGS,
  FIXTURE_TAG_MAP,
  fixtureFrames,
  fixtureSearch,
} from '@/features/vault/ui/fixtures';
import { parseViewOptions } from '@/features/vault/ui/logic';
import {
  DEFAULT_VIEW_OPTIONS,
  type SecurityState,
  type VaultActions,
  type VaultScreenProps,
  type ViewOptions,
} from '@/features/vault/ui/types';
import VaultScreen from '@/features/vault/ui/VaultScreen';

const noop = async () => {};

const first = FIXTURE_ITEMS[0].id;

/** Every surface the preview can open on first render. */
const VIEWS: Record<string, NonNullable<VaultScreenProps['devInitialState']>> = {
  grid: {},
  sidebar: { sidebarOpen: true },
  'sidebar-unlocked': { sidebarOpen: true, privateUnlocked: true },
  search: { searchOpen: true },
  viewer: { viewerId: first },
  info: { viewerId: first, infoOpen: true },
  menu: { viewerId: first, menuOpen: true },
  select: { selectMode: true },
  deleted: { filter: 'deleted' },
  'deleted-select': { filter: 'deleted', selectMode: true },
  duplicates: { filter: 'duplicates' },
  similar: { filter: 'similar' },
  tray: { filter: 'tray' },
  picks: { filter: 'picks' },
  uncategorized: { filter: 'uncategorized' },
  album: { albumId: 1 },
  'view-options': { viewOptionsOpen: true },
  bulk: { selectMode: true, selectedIds: [first, FIXTURE_ITEMS[1].id], bulkOpen: true },
  'bulk-bar': { selectMode: true, selectedIds: [first, FIXTURE_ITEMS[1].id] },
  'smart-editor': { smartEditorOpen: true },
  private: { filter: 'private', privateUnlocked: true },
  'private-menu': { privateUnlocked: true, viewerId: 'fixture-private-1', menuOpen: true },
  settings: { settingsOpen: true },
  calendar: { calendarOpen: true },
  timeline: { timelineOpen: true },
  overview: { overviewOpen: true },
  passcode: { passcodeOpen: true },
  slideshow: { slideshowOpen: true },
  compare: { compareOpen: true },
};

/**
 * Look options can be set from the URL too, e.g.
 * `/preview?view=grid&theme=light&layout=natural&size=medium&info=size&group=month`.
 * The preview starts dark (the app's original look) unless `theme` says otherwise.
 */
function optionsFromUrl(params: Record<string, string | undefined>): ViewOptions {
  const { info, group, ...rest } = params;
  const json = JSON.stringify({
    ...DEFAULT_VIEW_OPTIONS,
    theme: 'dark',
    ...rest,
    ...(info ? { infos: info.split(',') } : {}),
    ...(group ? { groupBy: group } : {}),
  });
  return parseViewOptions(json, { ...DEFAULT_VIEW_OPTIONS, theme: 'dark' });
}

export default function PreviewRoute() {
  const { view, theme, layout, size, info, group } = useLocalSearchParams<{
    view?: string;
    theme?: string;
    layout?: string;
    size?: string;
    info?: string;
    group?: string;
  }>();
  const [viewOptions, setViewOptions] = useState<ViewOptions>(() =>
    optionsFromUrl({ theme, layout, size, info, group })
  );
  const [security, setSecurity] = useState<SecurityState>({ passcodeKind: null, faceId: true, hasFakePasscode: false });

  // The web export pre-renders this page once, without URL options. Hydrating
  // that HTML with different options (e.g. the light theme) keeps the old
  // colours on elements whose structure matches, so render only in the browser.
  const [inBrowser, setInBrowser] = useState(false);
  useEffect(() => setInBrowser(true), []);

  const actions = useMemo<VaultActions>(
    () => ({
      onImport: () => {},
      onImportFolder: () => {},
      search: async (q) => fixtureSearch(q),
      loadTags: async (id) => {
        const names = FIXTURE_ITEMS.find((i) => i.id === id)?.tagNames ?? [];
        return FIXTURE_TAGS.filter((t) => names.includes(t.name));
      },
      loadFrames: async (item) => fixtureFrames(item),
      onRate: noop,
      onAddTag: noop,
      onRemoveTag: noop,
      onPinTag: noop,
      onDeleteOne: noop,
      onDeleteMany: noop,
      onRestoreMany: noop,
      onPurgeMany: noop,
      onRateMany: noop,
      onAddTagMany: noop,
      onSetStatus: noop,
      onSetFlag: noop,
      onSetTray: noop,
      onClearTray: noop,
      onSetText: noop,
      onAdjustDates: noop,
      onViewOptionsChange: async (next) => setViewOptions(next),
      onSaveSmartFilter: noop,
      onDeleteSmartFilter: noop,
      onMoveSmartFilter: noop,
      onSetPrivate: noop,
      unlockPrivate: async () => ({ ok: true }),
      onCreateAlbum: async () => 99,
      onUpdateAlbum: noop,
      onDeleteAlbum: noop,
      onAddToAlbums: noop,
      onRemoveFromAlbum: noop,
      onAlbumNameToKeyword: noop,
      onCreateFolder: async () => 99,
      onRenameFolder: noop,
      onDeleteFolder: noop,
      onShare: noop,
      onExtractFrame: noop,
      onDuplicate: noop,
      onOpenMap: () => {},
      onExportBackup: noop,
      onImportBackup: noop,
      getSecurity: async () => security,
      setPasscode: async (kind) => setSecurity((s) => ({ ...s, passcodeKind: kind })),
      clearPasscode: async () => setSecurity((s) => ({ ...s, passcodeKind: null, hasFakePasscode: false })),
      setFakePasscode: async (code) => setSecurity((s) => ({ ...s, hasFakePasscode: code !== null })),
      setFaceId: async (enabled) => setSecurity((s) => ({ ...s, faceId: enabled })),
      checkPasscode: async (code) => (code === '123456' ? 'real' : code === '000000' ? 'fake' : 'wrong'),
    }),
    [security]
  );

  const items = useMemo(() => {
    const list = [...FIXTURE_ITEMS];
    switch (viewOptions.sort) {
      case 'oldest':
        return list.sort((a, b) => a.createdAt - b.createdAt);
      case 'rating':
        return list.sort((a, b) => b.rating - a.rating);
      case 'name':
        return list.sort((a, b) => a.filename.localeCompare(b.filename));
      case 'size':
        return list.sort((a, b) => b.sizeBytes - a.sizeBytes);
      case 'duration':
        return list.sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1));
      default:
        return list.sort((a, b) => b.createdAt - a.createdAt);
    }
  }, [viewOptions.sort]);

  if (!inBrowser) return null;

  return (
    <VaultScreen
      items={items}
      allTags={FIXTURE_TAGS}
      tagMap={FIXTURE_TAG_MAP}
      deletedItems={FIXTURE_DELETED}
      duplicateGroups={FIXTURE_DUPLICATE_GROUPS}
      smartFilters={FIXTURE_SMART_FILTERS}
      albums={FIXTURE_ALBUMS}
      folders={FIXTURE_FOLDERS}
      viewOptions={viewOptions}
      // The owner's real situation: an almost full 128 GB iPhone.
      freeGb={2.1}
      busy={false}
      status=""
      actions={actions}
      enableVideo={false}
      devInitialState={VIEWS[view ?? 'grid'] ?? {}}
    />
  );
}
