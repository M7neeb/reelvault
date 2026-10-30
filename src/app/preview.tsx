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
  fixturePlays,
  fixtureOvExtra,
  FIXTURE_BOOKMARKS,
  FIXTURE_OVERVIEW,
  FIXTURE_META,
} from '@/features/vault/ui/fixtures';
import { parseViewOptions } from '@/features/vault/ui/logic';
import { SUGGESTED_LABELS } from '@/features/vault/stats';
import {
  DEFAULT_VIEW_OPTIONS,
  type SecurityState,
  type VaultActions,
  DEFAULT_VAULT_PREFS,
  type VaultPrefs,
  type VaultScreenProps,
  type ViewOptions,
} from '@/features/vault/ui/types';
import VaultScreen from '@/features/vault/ui/VaultScreen';
import { FIXTURE_LISTS, FIXTURE_SIMKL, fixtureBridge, fixtureSimklActions } from '@/features/simkl/ui/fixtures';
import SearchScreen from '@/features/simkl/ui/SearchScreen';
import type { LocalSearch } from '@/features/simkl/ui/EverythingParts';
import { findEverything, jumpBackIn, type FindInput } from '@/features/home/everything';
import SimklScreen from '@/features/simkl/ui/SimklScreen';
import { Text, View } from 'react-native';
import { TabBarSpace } from '@/features/vault/ui/chrome';
import Icon from '@/features/vault/ui/Icon';
import type { IconName } from '@/features/vault/ui/icons';
import type { Category, SimklItem, SimklScreenProps } from '@/features/simkl/ui/types';
import { resolveScheme } from '@/features/vault/ui/logic';
import { themeFor, ThemeContext, usePalette } from '@/features/vault/ui/theme';
import { fixtureAudioData } from '@/features/vault/ui/audio/audioFixtures';
import { fixtureMangaData } from '@/features/vault/ui/manga/mangaFixtures';
import { AudioPlaybackProvider, useAudioPlayback } from '@/features/vault/ui/audio/playback';

/**
 * A drawing of the iOS 26 tab bar (the real one is native and has no web
 * version): a floating glass capsule with the four tabs, and the round
 * search tab beside it. Only here so screenshots show what sits on top.
 */
function TabBarMock({ active }: { active: Category | 'search' }) {
  const p = usePalette();
  const tabs: { key: Category; label: string; icon: IconName }[] = [
    { key: 'videos', label: 'Videos', icon: 'videos' },
    { key: 'movie', label: 'Movies', icon: 'movie' },
    { key: 'show', label: 'Shows', icon: 'tv' },
    { key: 'anime', label: 'Anime', icon: 'anime' },
  ];
  const glass = {
    backgroundColor: p.scheme === 'dark' ? 'rgba(40,40,44,0.86)' : 'rgba(250,250,252,0.9)',
    borderWidth: 1,
    borderColor: p.separator,
  };
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 22,
        flexDirection: 'row',
        gap: 10,
        alignItems: 'center',
      }}>
      <View
        style={[
          {
            flex: 1,
            height: 62,
            borderRadius: 31,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 4,
          },
          glass,
        ]}>
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <View
              key={t.key}
              style={[
                {
                  flex: 1,
                  height: 54,
                  borderRadius: 27,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                },
                on && {
                  backgroundColor: p.scheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                },
              ]}>
              <Icon name={t.icon} size={22} color={on ? p.accent : p.text} />
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '600',
                  color: on ? p.accent : p.text,
                }}>
                {t.label}
              </Text>
              {t.key === 'show' && (
                <View
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 14,
                    backgroundColor: '#FF3B30',
                    borderRadius: 9,
                    minWidth: 18,
                    height: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>2</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
      <View
        style={[
          {
            width: 62,
            height: 62,
            borderRadius: 31,
            alignItems: 'center',
            justifyContent: 'center',
          },
          glass,
        ]}>
        <Icon name="search" size={22} color={active === 'search' ? p.accent : p.text} />
      </View>
    </View>
  );
}

/** Space the mock tab bar takes, like the real one (home indicator + bar). */
const MOCK_TAB_SPACE = 34 + 56;

/**
 * Simkl surfaces: list, grid, detail, episodes, rewatch, rating, addlist, lists, pick, import, discover,
 * calendar, stats, review, account, connect, notset.
 */
function SimklPreview({ category, surface, look }: { category: Exclude<Category, 'videos'>; surface: string; look: ViewOptions['look'] }) {
  const [items, setItems] = useState<SimklItem[]>(FIXTURE_SIMKL);
  const actions = useMemo(() => fixtureSimklActions(setItems, items), [items]);
  const firstOfType = FIXTURE_SIMKL.find((i) => i.type === category)?.simklId;
  const dev: SimklScreenProps['devInitialState'] = {
    detailId: ['detail', 'episodes', 'rating'].includes(surface) ? firstOfType : surface === 'rewatch' ? 103 : undefined,
    rewatchOpen: surface === 'rewatch',
    ratingOpen: surface === 'rating',
    insightsTab: surface === 'review' ? 'review' : undefined,
    episodesOpen: surface === 'episodes',
    accountOpen: surface === 'account',
    grid: surface === 'grid',
    discoverOpen: surface === 'discover',
    calendarOpen: surface === 'calendar',
    statsOpen: surface === 'stats',
    dashboardOpen: surface === 'dashboard',
    wrappedOpen: surface === 'wrapped',
    connectCode: surface === 'connect' ? { code: 'ABCD-1234', url: 'https://simkl.com/pin' } : undefined,
    listOpen: surface === 'lists' || surface === 'addmany' ? 1 : undefined,
    addManyOpen: surface === 'addmany',
    pickOpen: surface === 'pick',
    importOpen: surface === 'import',
    addToListOpen: surface === 'addlist',
  };
  if (surface === 'addlist') dev.detailId = firstOfType;
  return (
    <SimklScreen
      category={category}
      configured={surface !== 'notset'}
      connected={surface !== 'connect' && surface !== 'notset'}
      items={items}
      syncing={false}
      status=""
      lastSyncAt={null}
      actions={actions}
      lists={FIXTURE_LISTS}
      look={look}
      prefs={{ hideSpoilers: surface === 'spoilers' }}
      devInitialState={dev}
    />
  );
}

function SearchPreview({ q, mine }: { q?: string; mine?: boolean }) {
  const [items, setItems] = useState<SimklItem[]>(FIXTURE_SIMKL);
  const actions = useMemo(() => fixtureSimklActions(setItems, items), [items]);
  const local = useMemo<LocalSearch>(() => {
    const audio = fixtureAudioData().items;
    const manga = fixtureMangaData().items;
    const input: FindInput = { videos: FIXTURE_ITEMS, audio, manga, titles: items };
    const resume = FIXTURE_ITEMS.slice(0, 2).map((v, i) => ({ id: v.id, ms: (v.durationMs ?? 60_000) * 0.4, at: Date.now() - (i + 1) * 3_600_000 }));
    return {
      find: (s) => findEverything(s, input),
      jump: jumpBackIn({ ...input, resume }),
      thumb: (kind, id) =>
        (kind === 'video' ? FIXTURE_ITEMS.find((v) => v.id === id)?.thumbSource : kind === 'manga' ? manga.find((m) => m.id === id)?.coverSource : audio.find((a) => a.id === id)?.coverSource) ?? null,
      poster: (id) => items.find((t) => t.simklId === id)?.poster ?? null,
      open: () => undefined,
      week: {
        videoMs: 4_920_000,
        episodes: 6,
        movies: 1,
        watchMs: 410 * 60_000,
        chapters: 23,
        listenMs: 7_400_000,
        activeDays: 5,
        before: { videoMs: 3_100_000, episodes: 8, movies: 0, watchMs: 400 * 60_000, chapters: 9, listenMs: 0 },
      },
      recent: ['Harbour', 'Lighthouse', 'night walks'],
      remember: () => undefined,
      clearRecent: () => undefined,
    };
  }, [items]);
  return <SearchScreen connected items={items} lists={FIXTURE_LISTS} actions={actions} local={local} initialQuery={q} key={mine ? 'mine' : 'all'} />;
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
  bulk: {
    selectMode: true,
    selectedIds: [first, FIXTURE_ITEMS[1].id],
    bulkOpen: true,
  },
  'bulk-bar': { selectMode: true, selectedIds: [first, FIXTURE_ITEMS[1].id] },
  'smart-editor': { smartEditorOpen: true },
  private: { filter: 'private', privateUnlocked: true },
  'private-menu': {
    privateUnlocked: true,
    viewerId: 'fixture-private-1',
    menuOpen: true,
  },
  settings: { settingsOpen: true },
  calendar: { calendarOpen: true },
  timeline: { timelineOpen: true },
  overview: { overviewOpen: true },
  map: { mapOpen: true },
  importmenu: { importMenuOpen: true },
  smaller: {
    smallerOpen: true,
    selectedIds: FIXTURE_ITEMS.slice(0, 3).map((v) => v.id),
  },
  'smaller-one': { viewerId: first, smallerOpen: true },
  trim: { viewerId: first, editorTab: 'trim' },
  crop: { viewerId: first, editorTab: 'crop' },
  resize: { viewerId: first, editorTab: 'size' },
  passcode: { passcodeOpen: true },
  slideshow: { slideshowOpen: true },
  'slideshow-play': { slideshowOpen: true, slideshowPlay: true },
  cover: { viewerId: first, coverPickerOpen: true },
  'dup-review': { dupReviewOpen: true },
  'dup-ask': { dupAsk: true },
  // The Audio section (Audio mode).
  audio: {},
  'audio-player': { audio: { player: true } },
  'audio-read': { audio: { player: true } },
  'audio-info': { audio: { info: true } },
  'audio-stats': { audio: { dashboard: true } },
  'audio-deleted': { audio: { deleted: true } },
  manga: {},
  'manga-detail': { manga: { detail: true } },
  'manga-reader': { manga: { reader: true } },
  'manga-strip': { manga: { reader: true, seriesId: 'tower' } },
  'manga-deleted': { manga: { deleted: true } },
  'manga-browse': { manga: { browse: 'sources' } },
  'manga-ext': { manga: { browse: 'extensions' } },
  'manga-source': { manga: { browse: 'sources', source: 'mangadex' } },
  'manga-server': { manga: { browse: 'sources', source: 'server:home' } },
  'manga-title': { manga: { browse: 'sources', source: 'mangadex', openKey: 'mangadex-0' } },
  'manga-repo': { manga: { browse: 'extensions', form: 'repo' } },
  'manga-addserver': { manga: { browse: 'sources', form: 'server' } },
  'manga-stats': { manga: { dashboard: true } },
  'manga-history2': { manga: { dashboard: true, dashTab: 'history' } },
  'manga-memories': { manga: { dashboard: true, dashTab: 'memories' } },
  'manga-wrapped': { manga: { dashboard: true, dashTab: 'wrapped' } },
  'manga-badges': { manga: { dashboard: true, dashTab: 'badges' } },
  'manga-storage': { manga: { dashboard: true, dashTab: 'storage' } },
  'manga-updates': { manga: { feed: 'updates' } },
  'manga-history': { manga: { feed: 'history' } },
  'manga-downloads': { manga: { downloadsOpen: true } },
  'meta-import': { metaImportOpen: true },
  wifi: { wifiOpen: true },
  keywords: { keywordsOpen: true },
  'quick-tag': { triage: 'tag' },
  'keep-delete': { triage: 'keep' },
  history: { insightsTab: 'history' },
  'history-stats': { insightsTab: 'history', historyStats: true },
  compare: { compareOpen: true },
  dashboard: { insightsTab: 'dashboard' },
  memories: { insightsTab: 'memories' },
  memory: { insightsTab: 'memories', memoryOpen: true },
  wrapped: { insightsTab: 'wrapped' },
  badges: { insightsTab: 'badges' },
  'badges-new': { insightsTab: 'badges' },
  storage: { insightsTab: 'storage' },
  personalise: { personaliseOpen: true },
  // Overview mode (rate and track your videos like shows).
  ov: {},
  'ov-series': { overviewKey: 's:fixture-series-1' },
  'ov-walks': { overviewKey: 's:fixture-series-2' },
  'ov-single': { overviewKey: 'v:fixture-2' },
  'ov-kept': { overviewKey: 'v:fixture-kept-6' },
  'ov-new': { overviewSheet: 'new' },
  'ov-order': { overviewSheet: 'order' },
  'ov-edit': { overviewKey: 's:fixture-series-1', overviewSheet: 'edit' },
  'ov-add': { overviewKey: 's:fixture-series-2', overviewSheet: 'add' },
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
  const { view, theme, layout, size, info, group, cat, sview, look, accent, q } = useLocalSearchParams<{
    /** Search tab: words already typed. */
    q?: string;
    look?: string;
    accent?: string;
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
  const [viewOptions, setViewOptions] = useState<ViewOptions>(() => optionsFromUrl({ theme, layout, size, info, group, look, accent: accent ? `#${accent}` : undefined }));
  const [prefs, setPrefs] = useState<VaultPrefs>({
    ...DEFAULT_VAULT_PREFS,
    ratingLabels: SUGGESTED_LABELS,
    videosMode: view === 'ov' || view?.startsWith('ov-') ? 'overview' : view?.startsWith('audio') ? 'audio' : view?.startsWith('manga') ? 'manga' : 'watch',
    // `badges-new` shows the reveal of newly earned badges.
    badgesSeen: view === 'badges-new' ? [] : null,
    events: [
      { k: 'memory', at: Date.now() - 3 * 86_400_000, v: 'onThisDay' },
      { k: 'mood', at: Date.now() - 3 * 86_400_000, v: 'gentle' },
      { k: 'quiz-right', at: Date.now() - 2 * 86_400_000 },
    ],
  });
  const [security, setSecurity] = useState<SecurityState>({
    passcodeKind: null,
    faceId: true,
    hasFakePasscode: false,
  });

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
      canSaveSound: () => true,
      onSaveSound: async () => true,
      loadChapters: async (item) =>
        (item.durationMs ?? 0) > 120_000
          ? [
              { title: 'Opening', startMs: 0 },
              { title: 'The middle part', startMs: Math.round((item.durationMs ?? 0) / 3) },
              { title: 'Ending', startMs: Math.round(((item.durationMs ?? 0) * 2) / 3) },
            ]
          : [],
      onDuplicate: noop,
      onImportLink: () => {},
      readClipboardLink: async () => 'https://example.com/clips/beach.mp4',
      onSaveToPhotos: noop,
      onSetCoverFrame: noop,
      onPickCover: async () => false,
      onResetCover: noop,
      canMakeSmaller: () => true,
      canChooseStrength: () => true,
      // Pretends to re-encode: a short progress run, then about 45% saved.
      onMakeSmaller: async (item, _quality, onProgress) => {
        for (let i = 1; i <= 10; i++) {
          await new Promise((r) => setTimeout(r, 120));
          onProgress(i / 10);
        }
        return {
          kind: 'done',
          before: item.sizeBytes,
          after: Math.round(item.sizeBytes * 0.55),
        };
      },
      onEditVideo: async (item, _plan, _mode, onProgress) => {
        for (let i = 1; i <= 10; i++) {
          await new Promise((r) => setTimeout(r, 120));
          onProgress(i / 10);
        }
        return {
          kind: 'done',
          before: item.sizeBytes,
          after: Math.round(item.sizeBytes * 0.4),
        };
      },
      onCancelMakeSmaller: () => {},
      getImportQuality: async () => null,
      setImportQuality: noop,
      onOpenMap: () => {},
      onExportBackup: noop,
      onExportSpreadsheet: noop,
      onImportBackup: noop,
      getSecurity: async () => security,
      setPasscode: async (kind) => setSecurity((s) => ({ ...s, passcodeKind: kind })),
      clearPasscode: async () =>
        setSecurity((s) => ({
          ...s,
          passcodeKind: null,
          hasFakePasscode: false,
        })),
      setFakePasscode: async (code) => setSecurity((s) => ({ ...s, hasFakePasscode: code !== null })),
      setFaceId: async (enabled) => setSecurity((s) => ({ ...s, faceId: enabled })),
      checkPasscode: async (code) => (code === '123456' ? 'real' : code === '000000' ? 'fake' : 'wrong'),
      recordPlay: noop,
      loadPlays: async () => fixturePlays(),
      loadBookmarks: async (id) => FIXTURE_BOOKMARKS.filter((b) => b.videoId === id),
      addBookmark: noop,
      renameBookmark: noop,
      deleteBookmark: noop,
      countBookmarks: async () => FIXTURE_BOOKMARKS.length,
      setResume: noop,
      setPrefs: async (next) => setPrefs(next),
      appIcon: () => null,
      setAppIcon: noop,
      canChangeAppIcon: () => true,
      getWrappedReminder: async () => true,
      setWrappedReminder: async () => true,
      getOnThisDayReminder: async () => true,
      setOnThisDayReminder: async () => true,
      getYearWrappedReminder: async () => true,
      setYearWrappedReminder: async () => true,
      searchBookmarks: async () => [],
      renameTag: noop,
      mergeTags: noop,
      deleteTag: noop,
      setTagColor: noop,
      deleteUnusedTags: async () => 0,
      listAutoBackups: async () => [
        { name: 'ReelVault info 2026-10-12.json', uri: 'file:///b1', at: new Date(2026, 9, 12).getTime(), size: 48_000 },
        { name: 'ReelVault info 2026-10-05.json', uri: 'file:///b2', at: new Date(2026, 9, 5).getTime(), size: 46_500 },
      ],
      backupNow: async () => ({ name: 'ReelVault info 2026-10-19.json', uri: 'file:///b0', at: Date.now(), size: 48_200 }),
      restoreAutoBackup: async () => ({ matched: 12, total: 12, plays: 0 }),
      getAppStorage: async () => ({ videos: 2.1e9, deleted: 3.4e8, covers: 1.8e7, filmstrips: 4.2e7, temporary: 9.6e7, database: 2.3e6, audio: 4.1e8, manga: 1.9e9, measured: true }),
      tidyStorage: async () => ({ freed: 1.24e8, covers: 41, files: 7 }),
      emptyRecentlyDeleted: async () => 3,
      getMonthWrappedReminder: async () => true,
      setMonthWrappedReminder: async () => true,
      getWeeklySummary: async () => true,
      colorsOf: async (item) => {
        const palette = ['#2E7D5B', '#B4561E', '#3550A8', '#9B2C55', '#6B5BD2'];
        const n = [...item.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
        return { dominant: palette[n % palette.length], average: '#555555' };
      },
      setWeeklySummary: async () => true,
      onRemoveTagMany: noop,
      deletePlays: noop,
      pickMetadataFile: async () => ({ name: 'HashPhotos Metadata.csv', file: FIXTURE_META }),
      applyMetadata: noop,
      passcodeLog: async () => [
        { at: Date.now() - 3_600_000, kind: 'wrong' },
        { at: Date.now() - 26 * 3_600_000, kind: 'fake' },
        { at: Date.now() - 3 * 86_400_000, kind: 'wrong' },
      ],
      clearPasscodeLog: noop,
      wifi: {
        start: async () => ({ url: 'http://192.168.1.24:8080', code: '4821' }),
        stop: noop,
      },
      ovCreateSeries: async () => 'fixture-series-1',
      ovAddToSeries: noop,
      ovRemoveFromSeries: noop,
      ovReorder: noop,
      ovEpisodeName: noop,
      ovUpdateSeries: noop,
      ovSeriesCover: async () => true,
      ovDeleteSeries: noop,
      ovUpdateKept: noop,
      ovKeptCover: async () => true,
      ovForget: noop,
      loadOvExtra: async () => fixtureOvExtra(),
      saveOvExtra: noop,
    }),
    [security],
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

  const category: Category | 'search' = cat === 'movie' || cat === 'show' || cat === 'anime' || cat === 'search' ? cat : 'videos';
  const palette = themeFor(resolveScheme(viewOptions.theme, 'dark'), viewOptions);
  const bridge = useMemo(() => fixtureBridge(first), []);
  const audioData = useMemo(() => fixtureAudioData(), []);
  const mangaData = useMemo(() => fixtureMangaData(), []);

  if (!inBrowser) return null;

  if (category !== 'videos') {
    return (
      <ThemeContext.Provider value={palette}>
        <TabBarSpace.Provider value={MOCK_TAB_SPACE}>
          {category === 'search' ? <SearchPreview q={q} /> : <SimklPreview category={category} surface={sview ?? 'list'} look={viewOptions.look} />}
          <TabBarMock active={category} />
        </TabBarSpace.Provider>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={palette}>
      <TabBarSpace.Provider value={MOCK_TAB_SPACE}>
        <AudioPlaybackProvider items={audioData.items} actions={audioData.actions} enabled={false}>
        {view?.startsWith('audio-player') || view === 'audio-read' ? <AudioPreviewStart book={view === 'audio-read'} items={audioData.items} /> : null}
        <VaultScreen
          audio={audioData}
          manga={mangaData}
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
      simkl={bridge}
      prefs={prefs}
      wrappedRequest={view === 'wrapped-story'}
      resume={new Map([[(FIXTURE_ITEMS.find((v) => (v.durationMs ?? 0) >= 300_000) ?? FIXTURE_ITEMS[0]).id, 6 * 60_000]])}
          overview={FIXTURE_OVERVIEW}
          devInitialState={VIEWS[view ?? 'grid'] ?? {}}
        />
        </AudioPlaybackProvider>
        {!VIEWS[view ?? 'grid']?.viewerId && <TabBarMock active="videos" />}
      </TabBarSpace.Provider>
    </ThemeContext.Provider>
  );
}

/** Starts an item in the (silent) preview player, so the player screens have something to show. */
function AudioPreviewStart({ book, items }: { book: boolean; items: import('@/features/vault/ui/audio/audioTypes').AudioUiItem[] }) {
  const pb = useAudioPlayback();
  useEffect(() => {
    const it = book ? items.find((i) => i.kind === 'book') : items.find((i) => i.id === 'aud-2');
    if (it) pb.open(it, { autoplay: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
