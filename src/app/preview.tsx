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
import CategoryBar from '@/features/simkl/ui/CategoryBar';
import { FIXTURE_SIMKL, fixtureSimklActions } from '@/features/simkl/ui/fixtures';
import SimklScreen from '@/features/simkl/ui/SimklScreen';
import type { Category, SimklItem, SimklScreenProps } from '@/features/simkl/ui/types';
import { resolveScheme } from '@/features/vault/ui/logic';
import { paletteFor, ThemeContext } from '@/features/vault/ui/theme';

/** Simkl surfaces: list, grid, detail, episodes, discover, calendar, stats, account, connect, notset. */
function SimklPreview({ category, bar, surface }: { category: Exclude<Category, 'videos'>; bar: React.ReactNode; surface: string }) {
  const [items, setItems] = useState<SimklItem[]>(FIXTURE_SIMKL);
  const actions = useMemo(() => fixtureSimklActions(setItems, items), [items]);
  const firstOfType = FIXTURE_SIMKL.find((i) => i.type === category)?.simklId;
  const dev: SimklScreenProps['devInitialState'] = {
    detailId: surface === 'detail' || surface === 'episodes' ? firstOfType : undefined,
    episodesOpen: surface === 'episodes',
    accountOpen: surface === 'account',
    grid: surface === 'grid',
    discoverOpen: surface === 'discover',
    calendarOpen: surface === 'calendar',
    statsOpen: surface === 'stats',
    connectCode: surface === 'connect' ? { code: 'ABCD-1234', url: 'https://simkl.com/pin' } : undefined,
  };
  return (
    <SimklScreen
      category={category}
      categoryBar={bar}
      configured={surface !== 'notset'}
      connected={surface !== 'connect' && surface !== 'notset'}
      items={items}
      syncing={false}
      status=""
      lastSyncAt={null}
      actions={actions}
      devInitialState={dev}
    />
  );
}

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
  map: { mapOpen: true },
  importmenu: { importMenuOpen: true },
  smaller: { smallerOpen: true, selectedIds: FIXTURE_ITEMS.slice(0, 3).map((v) => v.id) },
  'smaller-one': { viewerId: first, smallerOpen: true },
  trim: { viewerId: first, editorTab: 'trim' },
  crop: { viewerId: first, editorTab: 'crop' },
  resize: { viewerId: first, editorTab: 'size' },
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
  const { view, theme, layout, size, info, group, cat, sview } = useLocalSearchParams<{
    view?: string;
    /** movie | show | anime: preview the Simkl screens instead (`sview` picks a surface). */
    cat?: string;
    sview?: string;
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
      onImportLink: () => {},
      readClipboardLink: async () => 'https://example.com/clips/beach.mp4',
      onSaveToPhotos: noop,
      onSetCoverFrame: noop,
      onPickCover: async () => false,
      onResetCover: noop,
      canMakeSmaller: () => true,
      // Pretends to re-encode: a short progress run, then about 45% saved.
      onMakeSmaller: async (item, _quality, onProgress) => {
        for (let i = 1; i <= 10; i++) {
          await new Promise((r) => setTimeout(r, 120));
          onProgress(i / 10);
        }
        return { kind: 'done', before: item.sizeBytes, after: Math.round(item.sizeBytes * 0.55) };
      },
      onEditVideo: async (item, _plan, _mode, onProgress) => {
        for (let i = 1; i <= 10; i++) {
          await new Promise((r) => setTimeout(r, 120));
          onProgress(i / 10);
        }
        return { kind: 'done', before: item.sizeBytes, after: Math.round(item.sizeBytes * 0.4) };
      },
      onCancelMakeSmaller: () => {},
      getImportQuality: async () => null,
      setImportQuality: noop,
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

  const [category, setCategory] = useState<Category>(
    cat === 'movie' || cat === 'show' || cat === 'anime' ? cat : 'videos'
  );
  const palette = paletteFor(resolveScheme(viewOptions.theme, 'dark'));
  const bar = (
    <ThemeContext.Provider value={palette}>
      <CategoryBar value={category} onChange={setCategory} />
    </ThemeContext.Provider>
  );

  if (!inBrowser) return null;

  if (category !== 'videos') {
    return (
      <ThemeContext.Provider value={palette}>
        <SimklPreview category={category} bar={bar} surface={sview ?? 'list'} />
      </ThemeContext.Provider>
    );
  }

  return (
    <VaultScreen
      categoryBar={bar}
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
