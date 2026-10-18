/**
 * VaultScreen - the entire ReelVault UI, as a pure presentational component.
 *
 * RULE: no native imports in this file or anything it pulls in. No expo-sqlite,
 * no expo-file-system, no expo-document-picker, no expo-local-authentication.
 * It receives plain data and callbacks, which is what allows the identical
 * component to be rendered in a browser (`src/app/preview.tsx`) for design checks.
 *
 * `expo-video` is the one exception: it has a real web implementation, and the
 * viewer needs it for playback. `enableVideo=false` skips mounting it, which is
 * what the browser preview does.
 *
 * Layout of this file: the theme wrapper, then the screen (state, what may be
 * seen, what is shown, actions, render), then the header pill. The grid,
 * sidebar, viewer and every sheet live in their own files next to this one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import type { VideoLink } from '@/features/simkl/ui/types';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarSheet, OverviewSheet, TimelineSheet } from './browse';
import { useTabBarSpace } from './chrome';
import Fade from './Fade';
import Glass from './Glass';
import Icon from './Icon';
import IconButton from './IconButton';
import { confirmAction, notify, plural } from './confirm';
import DateSheet from './DateSheet';
import { filterLabel, isPrivateView, isSpecial, type Filter } from './filters';
import Grid, { type GridMode } from './Grid';
import {
  dayKey,
  describeRule,
  extraCopies,
  groupSimilar,
  matchesRule,
  nearby,
  RECENTLY_DELETED_DAYS,
  resolveScheme,
  safeBatchGb,
} from './logic';
import { setWatchInfo, watchInfoOf } from './logic';
import { CompareModal } from './playback';
import { SlideshowModal } from './slideshow';
import { DuplicateReview } from './dupReview';
import { MetaImportSheet } from './metaImportUI';
import { WifiScreen } from './wifiUI';
import { isSmartSearch, parseSearch } from './query';
import { tick } from './haptics';
import { albumsByWatching, notInAYear, randomPick, sortByWatching, type WatchSort } from '../history';
import type { VaultPlay } from '../stats';
import { OptionsSheet, PromptSheet, type OptionItem } from './prompts';
import SearchSheet from './SearchSheet';
import { PasscodeSheet, SettingsSheet, type PasscodeMode } from './security';
import { BulkEditSheet, newSmartFilterDraft, SmartFilterSheet, ViewOptionsSheet } from './sheets';
import Sidebar from './Sidebar';
import { paletteFor, rgbOf, sheet, ThemeContext, usePalette, useStyles, withAccent, type Palette } from './theme';
import {
  SORTS,
  WATCH_SORTS,
  type CompressQuality,
  type GroupBy,
  type ImportSource,
  type OverviewData,
  type PasscodeKind,
  type SecurityState,
  type SmartFilter,
  type SmartRule,
  type UiAlbum,
  type UiFolder,
  type UiTag,
  type VaultItem,
  type VaultPrefs,
  type VaultScreenProps,
  type ViewOptions,
} from './types';
import { MapModal } from './MapModal';
import { SmallerSheet } from './smaller';
import ViewerModal from './ViewerModal';
import VideoInsightsModal, { type InsightsTab } from './InsightsUI';
import OverviewScreen from './OverviewScreen';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { DUR } from './motion';
import { ModeSwitch } from './overviewParts';
import PersonaliseSheet from './PersonaliseSheet';
import { DesktopTable, DetailedList } from './VideoList';
import { DEFAULT_VAULT_PREFS } from './types';
import { Image as ThumbImage } from 'expo-image';
import { fmtClock } from '../stats';
import { friendlyName } from '../names';

const EMPTY_RESUME = new Map<string, number>();
const EMPTY_OVERVIEW: OverviewData = { kept: [], series: [], members: [] };

/** Picks the light or dark colours, then renders the screen inside them. */
export default function VaultScreen(props: VaultScreenProps) {
  const system = useColorScheme();
  const palette = withAccent(paletteFor(resolveScheme(props.viewOptions.theme, system)), props.viewOptions.accent);
  return (
    <ThemeContext.Provider value={palette}>
      <StatusBar style={palette.scheme === 'dark' ? 'light' : 'dark'} />
      <VaultScreenBody {...props} />
    </ThemeContext.Provider>
  );
}

type Prompt = {
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
};

type PasscodeRequest = {
  mode: PasscodeMode;
  onCheck?: (code: string) => Promise<'ok' | 'wrong'>;
  onFaceId?: () => Promise<boolean>;
  onCreate?: (code: string) => Promise<void>;
};

function VaultScreenBody({
  items,
  allTags,
  tagMap,
  deletedItems,
  duplicateGroups,
  smartFilters,
  albums,
  folders,
  viewOptions,
  freeGb,
  busy,
  status,
  actions,
  enableVideo = true,
  simkl,
  resume = EMPTY_RESUME,
  prefs = DEFAULT_VAULT_PREFS,
  wrappedRequest,
  onWrappedHandled,
  openRequest,
  onOpenRequestHandled,
  overview = EMPTY_OVERVIEW,
  devInitialState: dev,
}: VaultScreenProps) {
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const styles = useStyles(makeStyles);
  const p = usePalette();

  // Videos linked to a Simkl movie or episode.
  const [links, setLinks] = useState<Map<string, VideoLink>>(new Map());
  const reloadLinks = () => {
    simkl
      ?.links()
      .then(setLinks)
      .catch(() => undefined);
  };
  useEffect(reloadLinks, [simkl]); // eslint-disable-line react-hooks/exhaustive-deps
  const linkedIds = useMemo(() => new Set(links.keys()), [links]);

  const [insights, setInsights] = useState<InsightsTab | null>(dev?.insightsTab ?? null);
  const [openWrapped, setOpenWrapped] = useState(false);
  const [personalise, setPersonalise] = useState(dev?.personaliseOpen ?? false);
  // Play counts for the Detailed layout.
  const [playCounts, setPlayCounts] = useState<Map<string, number>>(new Map());
  // Every play, for sorting by watching, the year-old shelf and the random pick.
  const [allPlays, setAllPlays] = useState<VaultPlay[]>([]);
  // Smart filters with watch rules (never watched, not watched in a year…) read this.
  useMemo(() => setWatchInfo(watchInfoOf(allPlays)), [allPlays]);
  const loadPlayCounts = () => {
    actions
      .loadPlays()
      .then((ps) => {
        const m = new Map<string, number>();
        for (const x of ps) m.set(x.videoId, (m.get(x.videoId) ?? 0) + 1);
        setPlayCounts(m);
        setAllPlays(ps);
      })
      .catch(() => undefined);
  };
  useEffect(loadPlayCounts, [actions]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Monday notification was tapped: last week's Wrapped.
  useEffect(() => {
    if (!wrappedRequest) return;
    setInsights('wrapped');
    setOpenWrapped(true);
    onWrappedHandled?.();
  }, [wrappedRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // An On this day or yearly Wrapped notification was tapped.
  const [memoryKind, setMemoryKind] = useState<'onThisDay' | undefined>(undefined);
  const [openYear, setOpenYear] = useState(false);
  const [openMonth, setOpenMonth] = useState(false);
  useEffect(() => {
    if (!openRequest) return;
    if (openRequest === 'onThisDay') {
      setMemoryKind('onThisDay');
      setInsights('memories');
    } else {
      if (openRequest === 'monthWrapped') setOpenMonth(true);
      else setOpenYear(true);
      setOpenWrapped(true);
      setInsights('wrapped');
    }
    onOpenRequestHandled?.();
  }, [openRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VaultItem[] | null>(null);
  const [selectMode, setSelectMode] = useState(dev?.selectMode ?? false);
  const [selected, setSelected] = useState<string[]>(dev?.selectedIds ?? []);
  const [searchOpen, setSearchOpen] = useState(dev?.searchOpen ?? false);
  const [sidebarOpen, setSidebarOpen] = useState(dev?.sidebarOpen ?? false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(dev?.viewOptionsOpen ?? false);
  const [bulkOpen, setBulkOpen] = useState(dev?.bulkOpen ?? false);
  const [settingsOpen, setSettingsOpen] = useState(dev?.settingsOpen ?? false);
  const [smallerFor, setSmallerFor] = useState<VaultItem[] | null>(
    dev?.smallerOpen && dev.selectedIds?.length ? items.filter((v) => (dev.selectedIds ?? []).includes(v.id)) : null
  );
  const [importQuality, setImportQualityState] = useState<CompressQuality | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(dev?.calendarOpen ?? false);
  const [timelineOpen, setTimelineOpen] = useState(dev?.timelineOpen ?? false);
  const [overviewOpen, setOverviewOpen] = useState(dev?.overviewOpen ?? false);
  const [mapOpen, setMapOpen] = useState(dev?.mapOpen ?? false);
  const [privateUnlocked, setPrivateUnlocked] = useState(dev?.privateUnlocked ?? false);
  /** Opened with the fake passcode: Private looks empty. */
  const [decoy, setDecoy] = useState(false);
  const [security, setSecurity] = useState<SecurityState | null>(null);
  const [passcode, setPasscode] = useState<PasscodeRequest | null>(
    dev?.passcodeOpen ? { mode: { kind: 'unlock', passcode: '6', faceId: true }, onCheck: async () => 'wrong' } : null
  );
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [options, setOptions] = useState<{ title: string; options: OptionItem[] } | null>(null);
  const [dateFor, setDateFor] = useState<string[] | null>(null);
  const [slideshow, setSlideshow] = useState<{ items: VaultItem[]; start: number } | null>(null);
  const [compare, setCompare] = useState<[VaultItem, VaultItem] | null>(null);
  const [dupReview, setDupReview] = useState<'duplicates' | 'similar' | null>(dev?.dupReviewOpen ? 'similar' : null);
  const [metaOpen, setMetaOpen] = useState(dev?.metaImportOpen ?? false);
  const [wifiOpen, setWifiOpen] = useState(dev?.wifiOpen ?? false);
  const [jumpTo, setJumpTo] = useState<{ key: string; nonce: number } | null>(null);
  /** The filter editor: a Smart Filter (`save`) or a one-off search (`search`). */
  const [editingSmart, setEditingSmart] = useState<{
    id?: number;
    name: string;
    rule: SmartRule;
    mode: 'save' | 'search';
  } | null>(
    dev?.smartEditorOpen ? { name: 'Best travel clips', rule: { minRating: 8, tags: ['holiday'] }, mode: 'save' } : null
  );
  const [filter, setFilter] = useState<Filter>(
    dev?.albumId !== undefined
      ? { kind: 'album', id: dev.albumId }
      : dev?.filter
        ? { kind: dev.filter }
        : { kind: 'all' }
  );
  const [playing, setPlaying] = useState<VaultItem | null>(
    () => items.find((i) => i.id === dev?.viewerId) ?? null
  );
  /** What swiping in the viewer moves through: a series' episodes, else the list on screen. */
  const [playList, setPlayList] = useState<VaultItem[] | null>(null);

  useEffect(() => {
    actions
      .getSecurity()
      .then(setSecurity)
      .catch((e) => console.log(`[SECURITY] state failed: ${String(e)}`));
  }, [actions]);

  // Smarter search: words like "2024", "8+", "long", "#holiday" or "unwatched" are filters; the rest is searched as text.
  const parsedSearch = useMemo(() => parseSearch(query, allTags.map((t) => t.name), Date.now()), [query, allTags]);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const smart = isSmartSearch(parsedSearch);
    const t = setTimeout(() => {
      (parsedSearch.text ? actions.search(parsedSearch.text) : Promise.resolve(items))
        .then((r) => {
          const out = smart
            ? r.filter(
                (v) =>
                  matchesRule(v, parsedSearch.rule) &&
                  (!parsedSearch.watch || (parsedSearch.watch === 'watched') === (playCounts.get(v.id) ?? 0) > 0)
              )
            : r;
          if (!cancelled) setResults(out);
          console.log(`[SEARCH] "${q}" → ${out.length}`);
        })
        .catch((e) => console.log(`[SEARCH] failed: ${String(e)}`));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, parsedSearch, actions, items, playCounts]);

  useEffect(() => {
    if (dev?.slideshowOpen && items.length) setSlideshow({ items: items.filter((v) => !v.isPrivate), start: 0 });
    if (dev?.compareOpen && items.length > 1) setCompare([items[0], items[1]]);
    // Preview only, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------- what may be seen at all */

  // Private videos never appear anywhere except the unlocked Private area:
  // not in lists, counts, search, duplicates, smart filters or albums.
  const publicItems = useMemo(() => items.filter((v) => !v.isPrivate), [items]);
  const privateOpen = privateUnlocked && !decoy;
  const privateItems = useMemo(() => (privateOpen ? items.filter((v) => v.isPrivate) : []), [items, privateOpen]);
  const publicIds = useMemo(() => new Set(publicItems.map((v) => v.id)), [publicItems]);
  const publicAlbums = useMemo(() => albums.filter((a) => !a.isPrivate), [albums]);
  const privateAlbums = useMemo(() => (privateOpen ? albums.filter((a) => a.isPrivate) : []), [albums, privateOpen]);
  const albumNames = useMemo(() => new Map(albums.map((a) => [a.id, a.name])), [albums]);

  const visibleGroups = useMemo(
    () => duplicateGroups.map((g) => g.filter((id) => publicIds.has(id))).filter((g) => g.length > 1),
    [duplicateGroups, publicIds]
  );
  const similarGroups = useMemo(() => groupSimilar(publicItems), [publicItems]);

  const tagCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [name, ids] of Object.entries(tagMap)) out[name] = ids.filter((id) => publicIds.has(id)).length;
    return out;
  }, [tagMap, publicIds]);

  const visibleTrash = useMemo(
    () => deletedItems.filter((v) => privateOpen || !v.isPrivate),
    [deletedItems, privateOpen]
  );
  const hiddenTrash = deletedItems.length - visibleTrash.length;

  /* ------------------------------------------------------ what is shown now */

  const inPrivate = isPrivateView(filter, albums);
  const special = isSpecial(filter) || filter.kind === 'rule';

  const pool = useMemo(() => {
    if (inPrivate) {
      if (!privateOpen) return [];
      return results ? results.filter((v) => v.isPrivate) : privateItems;
    }
    return results && !special ? results.filter((v) => !v.isPrivate) : publicItems;
  }, [inPrivate, privateOpen, results, special, privateItems, publicItems]);

  const groups = filter.kind === 'similar' ? similarGroups : visibleGroups;
  const dupRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const group of groups) group.forEach((id, i) => m.set(id, i));
    return m;
  }, [groups]);

  const shownRaw = useMemo(() => {
    const byGroups = (gs: string[][]) => {
      const byId = new Map(publicItems.map((v) => [v.id, v]));
      return gs.flat().flatMap((id) => {
        const v = byId.get(id);
        return v ? [v] : [];
      });
    };
    switch (filter.kind) {
      case 'deleted':
        return visibleTrash;
      case 'duplicates':
        return byGroups(visibleGroups);
      case 'similar':
        return byGroups(similarGroups);
      case 'favorites':
        return pool.filter((v) => v.rating >= 8);
      case 'rated':
        return pool.filter((v) => v.rating > 0);
      case 'untagged':
        return pool.filter((v) => !(v.tagCount > 0));
      case 'picks':
        return pool.filter((v) => v.flag === 1);
      case 'rejects':
        return pool.filter((v) => v.flag === -1);
      case 'tray':
        return pool.filter((v) => v.inTray);
      case 'located':
        return pool.filter((v) => v.meta?.location);
      case 'uncategorized': {
        const counted = new Set(albums.filter((a) => !a.excludeUncategorized).map((a) => a.id));
        return pool.filter((v) => !v.albumIds.some((id) => counted.has(id)));
      }
      case 'tag': {
        const ids = new Set(tagMap[filter.tag] ?? []);
        return pool.filter((v) => ids.has(v.id));
      }
      case 'status':
        return pool.filter((v) => v.status === filter.status);
      case 'smart': {
        const rule = smartFilters.find((s) => s.id === filter.id)?.rule;
        return rule ? pool.filter((v) => matchesRule(v, rule)) : [];
      }
      case 'rule':
        return pool.filter((v) => matchesRule(v, filter.rule));
      case 'album':
        return pool.filter((v) => v.albumIds.includes(filter.id));
      case 'day':
        return pool.filter((v) => dayKey(v.createdAt) === filter.day);
      case 'nearby': {
        const target = pool.find((v) => v.id === filter.id);
        return target ? [target, ...nearby(pool, target)] : [];
      }
      default:
        return pool;
    }
  }, [filter, pool, visibleTrash, visibleGroups, similarGroups, publicItems, albums, tagMap, smartFilters]);
  // Most / least / last watched are sorted here, from your plays (duplicates and Recently Deleted keep their order).
  const shown = useMemo(
    () =>
      WATCH_SORTS.includes(viewOptions.sort) && !['deleted', 'duplicates', 'similar'].includes(filter.kind)
        ? sortByWatching(shownRaw, allPlays, viewOptions.sort as WatchSort)
        : shownRaw,
    [shownRaw, allPlays, viewOptions.sort, filter.kind]
  );

  // "Haven't watched in a year" and the random pick.
  const forgotten = useMemo(
    () => (filter.kind === 'all' && !results ? notInAYear(publicItems, allPlays, Date.now(), 16) : []),
    [filter.kind, results, publicItems, allPlays]
  );
  /** Albums as the sidebar lists them: A to Z (as stored), by how much their videos are watched, or by last use. */
  function sortAlbums(list: UiAlbum[]): UiAlbum[] {
    if (prefs.albumSort === 'watched') return albumsByWatching(list, (id) => items.filter((v) => v.albumIds.includes(id)).map((v) => v.id), allPlays);
    if (prefs.albumSort === 'recent') return [...list].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    return list;
  }

  function playRandom() {
    tick();
    const from = shown.length ? shown : publicItems;
    const order: VaultItem[] = [];
    let left = [...from];
    // A weighted shuffle: what you rarely watch comes up more, and swiping keeps it random.
    while (left.length && order.length < 60) {
      const pick = randomPick(left, allPlays, Date.now(), Math.random, order[order.length - 1]?.id);
      if (!pick) break;
      order.push(pick);
      left = left.filter((v) => v.id !== pick.id);
    }
    if (!order.length) return;
    setPlayList(order);
    setPlaying(order[0]);
  }

  const activeSmart = filter.kind === 'smart' ? smartFilters.find((s) => s.id === filter.id) : undefined;
  const activeAlbum = filter.kind === 'album' ? albums.find((a) => a.id === filter.id) : undefined;
  const mode: GridMode =
    filter.kind === 'deleted'
      ? 'trash'
      : filter.kind === 'duplicates' || filter.kind === 'similar'
        ? 'duplicates'
        : 'normal';

  /* ----------------------------------------------------------------- actions */

  function fail(label: string) {
    return (e: unknown) => console.log(`[${label}] failed: ${String(e)}`);
  }

  function setViewOptions(next: ViewOptions) {
    actions.onViewOptionsChange(next).catch(fail('VIEW'));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected([]);
  }

  useEffect(() => {
    if (dev?.importMenuOpen) startImport();
    // Preview only, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshSecurity() {
    actions.getSecurity().then(setSecurity).catch(fail('SECURITY'));
  }

  useEffect(() => {
    if (settingsOpen) actions.getImportQuality().then(setImportQualityState).catch(fail('SETTINGS'));
  }, [settingsOpen, actions]);

  /** Face ID / passcode, then `then`. With a ReelVault passcode the passcode screen decides. */
  async function requestUnlock(then: () => void) {
    if (privateUnlocked) return then();
    const sec = security ?? (await actions.getSecurity());
    if (sec.passcodeKind) {
      setPasscode({
        mode: { kind: 'unlock', passcode: sec.passcodeKind, faceId: sec.faceId },
        onCheck: async (code) => {
          const result = await actions.checkPasscode(code);
          if (result === 'wrong') return 'wrong';
          setPrivateUnlocked(true);
          setDecoy(result === 'fake');
          then();
          return 'ok';
        },
        onFaceId: async () => {
          const res = await actions.unlockPrivate();
          if (res.ok) {
            setPrivateUnlocked(true);
            setDecoy(false);
            then();
          }
          return res.ok;
        },
      });
      return;
    }
    const res = await actions.unlockPrivate();
    if (!res.ok) {
      if (res.message) notify('Private stays locked', res.message);
      return;
    }
    setPrivateUnlocked(true);
    setDecoy(false);
    then();
  }

  function pickFilter(f: Filter) {
    setSidebarOpen(false);
    exitSelect();
    if (isPrivateView(f, albums)) {
      void requestUnlock(() => setFilter(f));
      return;
    }
    setFilter(f);
  }

  function lockPrivate() {
    setPrivateUnlocked(false);
    setDecoy(false);
    setFilter((f) => (isPrivateView(f, albums) ? { kind: 'all' } : f));
    setPlaying((v) => (v?.isPrivate ? null : v));
    setSlideshow((s) => (s?.items.some((v) => v.isPrivate) ? null : s));
    setSelected((ids) => ids.filter((id) => publicIds.has(id)));
  }

  // Leaving the app locks the Private album again.
  const lockRef = useRef(lockPrivate);
  useEffect(() => {
    lockRef.current = lockPrivate;
  });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') lockRef.current();
    });
    return () => sub.remove();
  }, []);

  const selectedItems = shown.filter((v) => selected.includes(v.id));

  function confirmBatchDelete() {
    if (!selectedItems.length) return;
    confirmAction(
      `Delete ${plural(selectedItems.length, 'video')}?`,
      `They move to Recently Deleted and can be restored for ${RECENTLY_DELETED_DAYS} days.`,
      () => {
        actions.onDeleteMany(selectedItems).then(exitSelect).catch(fail('DELETE'));
      }
    );
  }

  function restoreSelected() {
    if (!selectedItems.length) return;
    actions.onRestoreMany(selectedItems).then(exitSelect).catch(fail('RESTORE'));
  }

  function confirmPurge(list: VaultItem[]) {
    if (!list.length) return;
    confirmAction(
      `Delete ${plural(list.length, 'video')} for good?`,
      'This removes the files from your iPhone. It cannot be undone.',
      () => {
        actions.onPurgeMany(list).then(exitSelect).catch(fail('PURGE'));
      },
      { label: 'Delete for good' }
    );
  }

  /** Select every copy except the original in each duplicate / similar group. */
  function selectCopies() {
    setSelectMode(true);
    setSelected(extraCopies(groups));
  }

  /** Space check before the picker opens: the picker itself needs room for a temp copy. */
  /** "+ Import": where the videos come from. */
  function startImport() {
    setOptions({
      title: 'Import',
      options: [
        { label: 'From Photos', hint: 'Original files', onPress: () => importWithSpaceCheck('photos') },
        { label: 'From Files', hint: 'HashPhotos exports', onPress: () => importWithSpaceCheck('files') },
        { label: 'Record with Camera', onPress: () => actions.onImport('camera') },
        { label: 'Paste Link…', hint: 'Direct video link', onPress: pasteLink },
        { label: 'Whole Folder from Files…', hint: 'Copies', onPress: actions.onImportFolder },
        { label: 'From Computer (Wi-Fi)…', hint: 'Drop videos in a browser', onPress: () => setWifiOpen(true) },
        { label: 'HashPhotos Info…', hint: 'Keywords, ratings', onPress: () => setMetaOpen(true) },
      ],
    });
  }

  function importWithSpaceCheck(source: ImportSource) {
    if (freeGb === null) {
      actions.onImport(source);
      return;
    }
    const batch = safeBatchGb(freeGb);
    if (batch < 0.1) {
      notify('Not enough free space', `Only ${freeGb} GB is free. Free up some space on your iPhone first, then import.`);
      return;
    }
    confirmAction(
      `Import up to ${batch} GB`,
      `${freeGb} GB is free. Pick at most ${batch} GB of videos this time, so the phone ` +
        "doesn't run full. Videos already in ReelVault are skipped.",
      () => actions.onImport(source),
      { label: 'Choose videos', destructive: false }
    );
  }

  function pasteLink() {
    actions
      .readClipboardLink()
      .catch(() => null)
      .then((initial) =>
        setPrompt({
          title: 'Paste Link',
          message: 'A link straight to a video file (.mp4, .mov…). Pages like YouTube or Instagram do not work.',
          initial: initial ?? '',
          placeholder: 'https://…',
          confirmLabel: 'Download',
          onSubmit: (url) => actions.onImportLink(url.trim()),
        })
      );
  }

  function onPressTile(item: VaultItem) {
    if (mode === 'trash') {
      // Deleted videos are not played - tapping selects them for restore.
      setSelectMode(true);
      toggleSelect(item.id);
    } else if (selectMode) toggleSelect(item.id);
    else {
      console.log(`[VAULT] open ${item.filename}`);
      setPlaying(item);
    }
  }

  /** Long-press a thumbnail: start selecting with it. */
  function onLongPressTile(item: VaultItem) {
    setSelectMode(true);
    setSelected((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]));
  }

  function newAlbum(opts: { folderId?: number | null; isPrivate?: boolean }, thenAdd?: string[]) {
    setPrompt({
      title: opts.isPrivate ? 'New Private Album' : 'New Album',
      message: opts.isPrivate ? 'Only shown while Private is unlocked.' : undefined,
      placeholder: 'Album name',
      confirmLabel: 'Create',
      onSubmit: (name) => {
        actions
          .onCreateAlbum(name, opts)
          .then((id) => (thenAdd?.length ? actions.onAddToAlbums(thenAdd, [id]) : undefined))
          .catch(fail('ALBUM'));
      },
    });
  }

  function folderPicker(title: string, current: number | null, onPick: (folderId: number | null) => void) {
    setOptions({
      title,
      options: [
        { label: 'No folder', hint: current === null ? '✓' : undefined, onPress: () => onPick(null) },
        ...folders.map((f) => ({ label: f.name, hint: current === f.id ? '✓' : undefined, onPress: () => onPick(f.id) })),
      ],
    });
  }

  function albumOptions(album: UiAlbum) {
    const videosIn = (album.isPrivate ? privateItems : publicItems).filter((v) => v.albumIds.includes(album.id));
    setOptions({
      title: album.name,
      options: [
        {
          label: 'Rename',
          onPress: () =>
            setPrompt({
              title: 'Rename Album',
              initial: album.name,
              onSubmit: (name) => actions.onUpdateAlbum(album.id, { name }).catch(fail('ALBUM')),
            }),
        },
        {
          label: album.pinned ? 'Unpin' : 'Pin to top',
          onPress: () => actions.onUpdateAlbum(album.id, { pinned: !album.pinned }).catch(fail('ALBUM')),
        },
        ...(!album.isPrivate
          ? [
              {
                label: 'Move to folder…',
                onPress: () =>
                  folderPicker(`Move "${album.name}"`, album.folderId, (folderId) =>
                    actions.onUpdateAlbum(album.id, { folderId }).catch(fail('ALBUM'))
                  ),
              },
              {
                label: album.excludeUncategorized ? 'Count as categorized' : 'Keep its videos in Uncategorized',
                onPress: () =>
                  actions
                    .onUpdateAlbum(album.id, { excludeUncategorized: !album.excludeUncategorized })
                    .catch(fail('ALBUM')),
              },
            ]
          : []),
        {
          label: 'Add album name as keyword',
          hint: plural(videosIn.length, 'video'),
          onPress: () => actions.onAlbumNameToKeyword(album.id).catch(fail('ALBUM')),
        },
        ...(videosIn.length ? [{ label: 'Slideshow', onPress: () => setSlideshow({ items: videosIn, start: 0 }) }] : []),
        {
          label: 'Delete album',
          danger: true,
          onPress: () =>
            confirmAction(`Delete "${album.name}"?`, 'Only the album goes; its videos stay in the library.', () => {
              actions
                .onDeleteAlbum(album.id)
                .then(() => setFilter((f) => (f.kind === 'album' && f.id === album.id ? { kind: 'all' } : f)))
                .catch(fail('ALBUM'));
            }),
        },
      ],
    });
  }

  function folderOptions(folder: UiFolder) {
    setOptions({
      title: folder.name,
      options: [
        { label: 'New album in this folder', onPress: () => newAlbum({ folderId: folder.id }) },
        {
          label: 'Rename',
          onPress: () =>
            setPrompt({
              title: 'Rename Folder',
              initial: folder.name,
              onSubmit: (name) => actions.onRenameFolder(folder.id, name).catch(fail('FOLDER')),
            }),
        },
        {
          label: 'Delete folder',
          danger: true,
          onPress: () =>
            confirmAction(`Delete "${folder.name}"?`, 'Its albums and smart filters move to the top level.', () => {
              actions.onDeleteFolder(folder.id).catch(fail('FOLDER'));
            }),
        },
      ],
    });
  }

  function smartOptions(s: SmartFilter) {
    setOptions({
      title: s.name,
      options: [
        { label: 'Edit', onPress: () => setEditingSmart({ ...s, mode: 'save' }) },
        {
          label: 'Move to folder…',
          onPress: () =>
            folderPicker(`Move "${s.name}"`, s.folderId, (folderId) =>
              actions.onMoveSmartFilter(s.id, folderId).catch(fail('SMART'))
            ),
        },
        {
          label: 'Delete',
          danger: true,
          onPress: () =>
            confirmAction(`Delete "${s.name}"?`, 'Only the filter goes; no videos are touched.', () => {
              actions.onDeleteSmartFilter(s.id).catch(fail('SMART'));
            }),
        },
      ],
    });
  }

  function tagOptions(t: UiTag) {
    setOptions({
      title: `# ${t.name}`,
      options: [
        { label: t.pinned ? 'Unpin keyword' : 'Pin keyword to top', onPress: () => actions.onPinTag(t.id, !t.pinned).catch(fail('TAG')) },
        { label: 'Show videos', onPress: () => pickFilter({ kind: 'tag', tag: t.name }) },
      ],
    });
  }

  /** The "•••" in the selection bar: everything that needs a selection. */
  function selectionOptions() {
    const list = selectedItems;
    const opts: OptionItem[] = [
      {
        label: 'Select all',
        hint: plural(shown.length, 'video'),
        onPress: () => setSelected(shown.map((v) => v.id)),
      },
    ];
    if (list.length === 2) {
      opts.push({ label: 'Compare and Pick', onPress: () => setCompare([list[0], list[1]]) });
    }
    if (list.length) {
      opts.push({ label: 'Slideshow', onPress: () => setSlideshow({ items: list, start: 0 }) });
      opts.push({ label: 'Adjust date & time…', onPress: () => setDateFor(list.map((v) => v.id)) });
      opts.push({ label: 'Save to Photos', hint: 'Copies', onPress: () => actions.onSaveToPhotos(list).catch(fail('PHOTOS')) });
      opts.push({ label: 'Make Smaller…', onPress: () => setSmallerFor(list) });
    }
    if (list.length && activeAlbum) {
      opts.push({
        label: `Remove from "${activeAlbum.name}"`,
        onPress: () => actions.onRemoveFromAlbum(list.map((v) => v.id), activeAlbum.id).then(exitSelect).catch(fail('ALBUM')),
      });
    }
    if (list.length && filter.kind === 'tray') {
      opts.push({
        label: 'Remove from Tray',
        onPress: () => actions.onSetTray(list.map((v) => v.id), false).then(exitSelect).catch(fail('TRAY')),
      });
    }
    setOptions({ title: plural(list.length, 'video') + ' selected', options: opts });
  }

  /** Timeline: group the grid by month or day if it isn't, then scroll there. */
  function jumpToPeriod(key: string, by: Exclude<GroupBy, 'none'>) {
    if (filter.kind !== 'all') setFilter({ kind: 'all' });
    if (viewOptions.groupBy !== by) setViewOptions({ ...viewOptions, groupBy: by, sort: 'recent' });
    setTimeout(() => setJumpTo({ key, nonce: Date.now() }), 60);
  }

  /* -- settings: passcode flows ------------------------------------------- */

  function verifyCurrent(then: () => void) {
    const kind = security?.passcodeKind;
    if (!kind) return then();
    setPasscode({
      mode: { kind: 'unlock', passcode: kind, faceId: false },
      onCheck: async (code) => {
        if ((await actions.checkPasscode(code)) !== 'real') return 'wrong';
        setTimeout(then, 300);
        return 'ok';
      },
    });
  }

  function createPasscode(kind: PasscodeKind, label: string, save: (code: string) => Promise<void>) {
    setPasscode({
      mode: { kind: 'create', passcode: kind, label },
      onCreate: async (code) => {
        await save(code);
        refreshSecurity();
      },
    });
  }

  const title = results && !special ? 'Search' : filterLabel(filter, smartFilters, albums);
  const sortLabel = SORTS.find((s) => s.key === viewOptions.sort)?.label ?? 'Recent';
  const bulkAlbums = inPrivate ? privateAlbums : publicAlbums;

  /* ---------------------------------------------------------------- render */

  const look = viewOptions.look;
  const continuing = !special && !results && look !== 'desktop' ? shown.filter((v) => resume.has(v.id)).slice(0, 12) : [];
  // Pinned: your own shelf at the top of the library (All Videos only).
  const pinnedItems = filter.kind === 'all' && !results ? prefs.pinned.map((id) => publicItems.find((v) => v.id === id)).filter((v): v is VaultItem => !!v) : [];
  const unpin = (id: string) => {
    tick();
    actions.setPrefs({ ...prefs, pinned: prefs.pinned.filter((x) => x !== id) }).catch(fail('PREFS'));
  };
  const gridOptions: ViewOptions =
    look === 'simple'
      ? { ...viewOptions, layout: 'grid', size: 'xlarge', infos: [], showRating: false, showKeywords: false, groupBy: 'none' }
      : look === 'compact'
        ? { ...viewOptions, layout: 'grid', size: 'small', infos: [], showRating: false, showKeywords: false }
        : viewOptions;

  const videosMode = prefs.videosMode;
  function switchMode(m: VaultPrefs['videosMode']) {
    if (selectMode) exitSelect();
    actions.setPrefs({ ...prefs, videosMode: m }).catch(fail('MODE'));
  }

  const listHeader = (
    <View style={[styles.listHeader, { paddingTop: look === 'desktop' ? 8 : insets.top + 56 }]}>
      {!special && !inPrivate && (
        <View style={styles.modeRow}>
          <ModeSwitch mode="watch" onChange={switchMode} />
        </View>
      )}
      <View style={styles.subRow}>
        <Text style={styles.subText}>
          {plural(shown.length, 'video')}
          {freeGb !== null ? ` · ${freeGb} GB free` : ''}
        </Text>
        <HeaderPill
          filter={filter}
          hasCopies={groups.length > 0}
          hasTrash={visibleTrash.length > 0}
          busy={busy}
          inPrivate={inPrivate}
          smart={activeSmart}
          album={activeAlbum}
          onSelectCopies={selectCopies}
          onDeleteAll={() => confirmPurge(visibleTrash)}
          onEditSmart={() => activeSmart && setEditingSmart({ ...activeSmart, mode: 'save' })}
          onEditRule={() =>
            filter.kind === 'rule' && setEditingSmart({ name: '', rule: filter.rule, mode: 'search' })
          }
          onAlbum={() => activeAlbum && albumOptions(activeAlbum)}
          onClearTray={() => actions.onClearTray().catch(fail('TRAY'))}
          onLock={lockPrivate}
          onImport={startImport}
        />
      </View>
      {!!status && <Text style={styles.note}>{status}</Text>}
      {activeSmart && <Text style={styles.note}>{describeRule(activeSmart.rule)}</Text>}
      {filter.kind === 'rule' && <Text style={styles.note}>{describeRule(filter.rule)}</Text>}
      {filter.kind === 'deleted' && (
        <Text style={styles.note}>
          Videos stay here for {RECENTLY_DELETED_DAYS} days, then they are removed for good. Tap videos to select them.
          {hiddenTrash > 0 ? ` ${plural(hiddenTrash, 'private video')} hidden - unlock Private to see.` : ''}
        </Text>
      )}
      {(filter.kind === 'duplicates' || filter.kind === 'similar') && groups.length > 0 && (
        <TouchableOpacity style={styles.reviewBtn} onPress={() => setDupReview(filter.kind as 'duplicates' | 'similar')}>
          <Icon name="sparkle" size={15} color="#fff" />
          <Text style={styles.reviewText}>Review and clean up…</Text>
        </TouchableOpacity>
      )}
      {(filter.kind === 'duplicates' || filter.kind === 'similar') && (
        <Text style={styles.note}>
          {groups.length
            ? `${plural(groups.length, 'group')}. The first in each group is the oldest import (Original); the others are marked Copy.` +
              (filter.kind === 'similar' ? ' Similar = same length and shape, but not the same file.' : '')
            : filter.kind === 'similar'
              ? 'No similar videos found.'
              : 'No duplicates found.'}
        </Text>
      )}
      {filter.kind === 'tray' && (
        <Text style={styles.note}>The Tray keeps a working set while you browse. Add videos from the viewer menu or Edit.</Text>
      )}
      {filter.kind === 'nearby' && <Text style={styles.note}>Videos filmed within 1 km, closest first.</Text>}
      {inPrivate && (
        <Text style={styles.note}>Only you can see these. Private locks again when you leave the app.</Text>
      )}
      {pinnedItems.length > 0 && (
        <View style={styles.continueBox}>
          <View style={styles.shelfHead}>
            <Text style={styles.continueTitle}>Pinned</Text>
            {pinnedItems.length > 1 && (
              <TouchableOpacity onPress={() => setSlideshow({ items: pinnedItems, start: 0 })} hitSlop={8}>
                <Text style={styles.shelfAction}>Slideshow</Text>
              </TouchableOpacity>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.continueRow}>
            {pinnedItems.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={styles.continueCard}
                onPress={() => {
                  setPlayList(pinnedItems);
                  setPlaying(v);
                }}
                onLongPress={() => unpin(v.id)}
                delayLongPress={450}
                accessibilityLabel={`${friendlyName(v)}, pinned. Hold to unpin`}>
                <ThumbImage source={v.thumbSource} style={styles.continueThumb} contentFit="cover" />
                <View style={styles.continuePlay}>
                  <Icon name="pin" size={13} color="#fff" />
                </View>
                <Text style={styles.continueName} numberOfLines={1}>
                  {friendlyName(v)}
                </Text>
                <Text style={styles.continueAt}>{v.rating ? `★ ${v.rating}` : 'Hold to unpin'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {continuing.length > 0 && (
        <View style={styles.continueBox}>
          <Text style={styles.continueTitle}>Continue watching</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.continueRow}>
            {continuing.map((v) => {
              const at = resume.get(v.id) ?? 0;
              return (
                <TouchableOpacity key={v.id} style={styles.continueCard} onPress={() => setPlaying(v)} accessibilityLabel={`Continue ${friendlyName(v)}`}>
                  <ThumbImage source={v.thumbSource} style={styles.continueThumb} contentFit="cover" />
                  <View style={styles.continueTrack}>
                    <View style={[styles.continueFill, { width: `${v.durationMs ? Math.min(100, (at / v.durationMs) * 100) : 0}%` }]} />
                  </View>
                  <View style={styles.continuePlay}>
                    <Icon name="play" size={14} color="#fff" />
                  </View>
                  <Text style={styles.continueName} numberOfLines={1}>
                    {friendlyName(v)}
                  </Text>
                  <Text style={styles.continueAt}>Stopped at {fmtClock(at)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
      {forgotten.length > 0 && look !== 'desktop' && (
        <View style={styles.continueBox}>
          <View style={styles.shelfHead}>
            <Text style={styles.continueTitle}>Haven’t watched in a year</Text>
            <TouchableOpacity onPress={() => setSlideshow({ items: forgotten.map((f) => f.video), start: 0 })} hitSlop={8}>
              <Text style={styles.shelfAction}>Slideshow</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.continueRow}>
            {forgotten.map(({ video: v, why }) => (
              <TouchableOpacity
                key={v.id}
                style={styles.continueCard}
                onPress={() => {
                  setPlayList(forgotten.map((f) => f.video));
                  setPlaying(v);
                }}
                accessibilityLabel={`${friendlyName(v)}. ${why}`}>
                <ThumbImage source={v.thumbSource} style={styles.continueThumb} contentFit="cover" />
                <View style={styles.continuePlay}>
                  <Icon name="history" size={13} color="#fff" />
                </View>
                <Text style={styles.continueName} numberOfLines={1}>
                  {friendlyName(v)}
                </Text>
                <Text style={styles.continueAt} numberOfLines={1}>
                  {why}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {!results && !special && look !== 'simple' && look !== 'desktop' && (
        <View style={styles.sortRow}>
          <TouchableOpacity style={styles.chip} onPress={() => setViewOptionsOpen(true)}>
            <Text style={styles.chipText}>
              Sorted by {sortLabel}
              {viewOptions.groupBy !== 'none' ? ` · by ${viewOptions.groupBy}` : ''} ›
            </Text>
          </TouchableOpacity>
          {shown.length > 1 && (
            <>
              <TouchableOpacity style={[styles.chip, styles.chipRow]} onPress={playRandom} accessibilityLabel="Play a random video">
                <Icon name="dice" size={13} color={p.link} />
                <Text style={styles.chipText}>Random</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.chip, styles.chipRow]} onPress={() => setSlideshow({ items: shown, start: 0 })} accessibilityLabel="Slideshow">
                <Icon name="slideshow" size={13} color={p.link} />
                <Text style={styles.chipText}>Slideshow</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );

  const empty = (
    <Text style={styles.empty}>
      {filter.kind === 'deleted'
        ? 'Recently Deleted is empty.'
        : filter.kind === 'duplicates' || filter.kind === 'similar'
          ? ''
          : filter.kind === 'private'
            ? 'No private videos yet. Select videos, tap Edit, then Move to Private.'
            : filter.kind === 'album'
              ? 'This album is empty. Add videos from the album bar in the viewer, or select videos and tap Edit.'
              : filter.kind === 'tray'
                ? 'The Tray is empty.'
                : results || filter.kind === 'rule'
                  ? 'No matches.'
                  : 'Nothing here yet.'}
    </Text>
  );

  return (
    <View style={styles.screen}>
      {look === 'detailed' && mode === 'normal' ? (
        <DetailedList
          items={shown}
          header={listHeader}
          empty={empty}
          selectMode={selectMode}
          selected={selected}
          labels={prefs.ratingLabels}
          resume={resume}
          linked={linkedIds}
          plays={playCounts}
          onPress={onPressTile}
          onLongPress={onLongPressTile}
        />
      ) : look === 'desktop' && mode === 'normal' ? (
        <View style={{ flex: 1, paddingTop: insets.top + 56 }}>
          <DesktopTable
            items={shown}
            header={listHeader}
            empty={empty}
            selectMode={selectMode}
            selected={selected}
            labels={prefs.ratingLabels}
            resume={resume}
            linked={linkedIds}
            plays={playCounts}
            onPress={onPressTile}
            onLongPress={onLongPressTile}
            sort={viewOptions.sort}
            onSort={(sort) => setViewOptions({ ...viewOptions, sort })}
            filter={filter}
            onFilter={pickFilter}
            onMore={() => setSidebarOpen(true)}
            topInset={8}
          />
        </View>
      ) : (
        <Grid
          items={shown}
          viewOptions={gridOptions}
          header={listHeader}
          empty={empty}
          resetKey={JSON.stringify(filter)}
          selectMode={selectMode}
          selected={selected}
          mode={mode}
          dupRank={dupRank}
          albumNames={albumNames}
          jumpTo={jumpTo}
          onPressTile={onPressTile}
          onLongPressTile={mode === 'normal' ? onLongPressTile : undefined}
          linked={look === 'simple' ? undefined : linkedIds}
          resume={look === 'simple' ? undefined : resume}
        />
      )}

      <Fade color={rgbOf(p.bg)} from={0} to={0.92} reverse style={[styles.headerFade, { height: insets.top + 64 }]} />
      <View style={[styles.floatingHeader, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <IconButton icon="sidebar" label="Library" onPress={() => setSidebarOpen(true)} />
        <TouchableOpacity style={styles.headerTitleWrap} onPress={() => setSidebarOpen(true)} accessibilityLabel="Choose what to show">
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Icon name="down" size={11} color={p.textSecondary} weight="bold" />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <IconButton icon="search" label="Search" onPress={() => setSearchOpen(true)} />
          <IconButton icon="options" label="View options" onPress={() => setViewOptionsOpen(true)} />
          <IconButton
            icon={selectMode ? 'close' : 'select'}
            label={selectMode ? 'Cancel selection' : 'Select'}
            tint={selectMode ? p.accent : undefined}
            onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}
          />
        </View>
      </View>

      {selectMode && (
        <Glass style={[styles.actionBar, { bottom: tabSpace > 0 ? tabSpace + 8 : insets.bottom + 12 }]}>
          <Text style={styles.actionCount}>{selected.length} selected</Text>
          {mode === 'trash' ? (
            <View style={styles.actionGroup}>
              <TouchableOpacity
                style={[styles.actionBtnBlue, !selected.length && styles.actionDisabled]}
                disabled={!selected.length}
                onPress={restoreSelected}>
                <Text style={styles.actionBtnText}>Restore</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, !selected.length && styles.actionDisabled]}
                disabled={!selected.length}
                onPress={() => confirmPurge(selectedItems)}>
                <Text style={styles.actionBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actionGroup}>
              <TouchableOpacity style={styles.actionBtnGhost} onPress={selectionOptions} accessibilityLabel="More">
                <Icon name="more" size={18} color={p.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtnBlue, !selected.length && styles.actionDisabled]}
                disabled={!selected.length}
                onPress={() => setBulkOpen(true)}>
                <Text style={styles.actionBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, !selected.length && styles.actionDisabled]}
                disabled={!selected.length}
                onPress={confirmBatchDelete}>
                <Text style={styles.actionBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </Glass>
      )}

      {searchOpen && (
        <SearchSheet
          value={query}
          tags={allTags}
          chips={query.trim() && isSmartSearch(parsedSearch) ? parsedSearch.chips : []}
          matches={results?.length ?? null}
          onChange={setQuery}
          onClose={() => setSearchOpen(false)}
          onSaveSmart={() => {
            setSearchOpen(false);
            setEditingSmart({ ...newSmartFilterDraft(query), mode: 'save' });
          }}
          onFilters={() => {
            setSearchOpen(false);
            setEditingSmart({ name: '', rule: query.trim() ? { text: query.trim() } : {}, mode: 'search' });
          }}
        />
      )}

      {sidebarOpen && (
        <Sidebar
          items={publicItems}
          privateItems={privateOpen ? privateItems : privateUnlocked ? [] : null}
          tags={allTags}
          tagCounts={tagCounts}
          smartFilters={smartFilters}
          albums={sortAlbums(privateOpen ? albums : publicAlbums)}
          albumSort={prefs.albumSort}
          onAlbumSort={(albumSort) => actions.setPrefs({ ...prefs, albumSort }).catch(fail('PREFS'))}
          folders={folders}
          deletedCount={visibleTrash.length}
          duplicateCount={visibleGroups.flat().length}
          similarCount={similarGroups.flat().length}
          freeGb={freeGb}
          filter={filter}
          onPick={pickFilter}
          onClose={() => setSidebarOpen(false)}
          onNewSmart={() => {
            setSidebarOpen(false);
            setEditingSmart({ ...newSmartFilterDraft(''), mode: 'save' });
          }}
          onNewAlbum={(opts) => newAlbum(opts)}
          onNewFolder={() =>
            setPrompt({
              title: 'New Folder',
              message: 'Folders hold albums and smart filters.',
              placeholder: 'Folder name',
              confirmLabel: 'Create',
              onSubmit: (name) => actions.onCreateFolder(name).catch(fail('FOLDER')),
            })
          }
          onAlbumOptions={albumOptions}
          onFolderOptions={folderOptions}
          onSmartOptions={smartOptions}
          onTagOptions={tagOptions}
          onCalendar={() => {
            setSidebarOpen(false);
            setCalendarOpen(true);
          }}
          onTimeline={() => {
            setSidebarOpen(false);
            setTimelineOpen(true);
          }}
          onOverview={() => {
            setSidebarOpen(false);
            setOverviewOpen(true);
          }}
          onMap={() => {
            setSidebarOpen(false);
            setMapOpen(true);
          }}
          onSettings={() => {
            setSidebarOpen(false);
            refreshSecurity();
            setSettingsOpen(true);
          }}
          onInsights={(tab) => {
            setSidebarOpen(false);
            setInsights(tab);
          }}
          onPersonalise={() => {
            setSidebarOpen(false);
            setPersonalise(true);
          }}
          onImport={() => {
            setSidebarOpen(false);
            startImport();
          }}
        />
      )}

      {viewOptionsOpen && (
        <ViewOptionsSheet options={viewOptions} onChange={setViewOptions} onClose={() => setViewOptionsOpen(false)} />
      )}

      {bulkOpen && (
        <BulkEditSheet
          count={selected.length}
          tags={allTags}
          albums={bulkAlbums}
          privateAction={inPrivate ? 'remove' : 'add'}
          onRate={(n) => actions.onRateMany(selected, n)}
          onFlag={(f) => actions.onSetFlag(selected, f)}
          onAddTag={(name) => actions.onAddTagMany(selected, name)}
          onRemoveTag={(name) => actions.onRemoveTagMany(selected, name)}
          selectedTags={(() => {
            const m = new Map<string, number>();
            for (const v of items) if (selected.includes(v.id)) for (const t of v.tagNames) m.set(t, (m.get(t) ?? 0) + 1);
            return [...m.entries()].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count);
          })()}
          onStatus={(s) => actions.onSetStatus(selected, s)}
          onAddToAlbums={(ids) => actions.onAddToAlbums(selected, ids)}
          onNewAlbum={() => newAlbum({ isPrivate: inPrivate }, selected)}
          onTray={(v) => actions.onSetTray(selected, v)}
          onText={(field, value) => actions.onSetText(selected, field, value)}
          onDate={() => {
            setBulkOpen(false);
            setDateFor(selected);
          }}
          onPrivate={async () => {
            await actions.onSetPrivate(selected, !inPrivate);
            setBulkOpen(false);
            exitSelect();
          }}
          onMakeSmaller={() => {
            setBulkOpen(false);
            setSmallerFor(selectedItems);
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {smallerFor && (
        <SmallerSheet
          items={smallerFor}
          available={actions.canMakeSmaller()}
          onMakeSmaller={actions.onMakeSmaller}
          onCancel={actions.onCancelMakeSmaller}
          onClose={() => setSmallerFor(null)}
        />
      )}

      {editingSmart && (
        <SmartFilterSheet
          initial={editingSmart}
          mode={editingSmart.mode}
          tags={allTags}
          items={inPrivate ? privateItems : publicItems}
          onSave={actions.onSaveSmartFilter}
          onApply={(rule) => {
            setQuery('');
            setFilter({ kind: 'rule', rule });
            exitSelect();
          }}
          onDelete={async (id) => {
            await actions.onDeleteSmartFilter(id);
            if (filter.kind === 'smart' && filter.id === id) setFilter({ kind: 'all' });
          }}
          onClose={() => setEditingSmart(null)}
        />
      )}

      {dateFor && (
        <DateSheet
          count={dateFor.length}
          initial={items.find((v) => v.id === dateFor[0])?.createdAt ?? Date.now()}
          onApply={(change) => actions.onAdjustDates(dateFor, change)}
          onClose={() => setDateFor(null)}
        />
      )}

      {calendarOpen && (
        <CalendarSheet
          items={publicItems}
          onPickDay={(day) => pickFilter({ kind: 'day', day })}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {timelineOpen && <TimelineSheet items={publicItems} onJump={jumpToPeriod} onClose={() => setTimelineOpen(false)} />}

      {mapOpen && (
        <MapModal
          items={publicItems}
          onOpen={(item) => {
            setMapOpen(false);
            setPlaying(item);
          }}
          onClose={() => setMapOpen(false)}
        />
      )}

      {overviewOpen && <OverviewSheet items={publicItems} onClose={() => setOverviewOpen(false)} />}

      {settingsOpen && (
        <SettingsSheet
          security={security}
          loadPasscodeLog={actions.passcodeLog}
          onClearPasscodeLog={actions.clearPasscodeLog}
          onTurnOnPasscode={(kind) =>
            createPasscode(kind, 'Choose a Passcode', (code) => actions.setPasscode(kind, code))
          }
          onChangePasscode={() =>
            verifyCurrent(() => {
              const kind = security?.passcodeKind ?? '6';
              createPasscode(kind, 'New Passcode', (code) => actions.setPasscode(kind, code));
            })
          }
          onTurnOffPasscode={() =>
            verifyCurrent(() => {
              actions.clearPasscode().then(refreshSecurity).catch(fail('SECURITY'));
            })
          }
          onFaceId={(enabled) => actions.setFaceId(enabled).then(refreshSecurity).catch(fail('SECURITY'))}
          onSetFake={() =>
            createPasscode(security?.passcodeKind ?? '6', 'Choose a Fake Passcode', async (code) => {
              if ((await actions.checkPasscode(code, { log: false })) === 'real') {
                notify('Pick a different code', 'The fake passcode must not be your real passcode.');
                return;
              }
              await actions.setFakePasscode(code);
            })
          }
          onRemoveFake={() => actions.setFakePasscode(null).then(refreshSecurity).catch(fail('SECURITY'))}
          onImportFolder={() => {
            setSettingsOpen(false);
            actions.onImportFolder();
          }}
          onExportBackup={() => actions.onExportBackup().catch(fail('BACKUP'))}
          onImportBackup={() => actions.onImportBackup().catch(fail('BACKUP'))}
          canMakeSmaller={actions.canMakeSmaller()}
          importQuality={importQuality}
          onImportQuality={(q) => {
            setImportQualityState(q);
            actions.setImportQuality(q).catch(fail('SETTINGS'));
          }}
          onPersonalise={() => {
            setSettingsOpen(false);
            setPersonalise(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {videosMode === 'overview' && (
        <Animated.View style={StyleSheet.absoluteFill} entering={FadeIn.duration(DUR.base)} exiting={FadeOut.duration(DUR.fast)}>
          <OverviewScreen
            enableVideo={enableVideo}
            items={publicItems}
            deletedItems={deletedItems.filter((v) => !v.isPrivate)}
            data={overview}
            look={look}
            prefs={prefs}
            actions={actions}
            onPlay={(id) => {
              const v = items.find((x) => x.id === id);
              if (!v) return;
              const m = overview.members.find((x) => x.videoId === id);
              const episodes = m
                ? overview.members
                    .filter((x) => x.seriesId === m.seriesId)
                    .sort((a, b) => a.position - b.position)
                    .map((x) => items.find((i) => i.id === x.videoId && !i.deletedAt))
                    .filter((i): i is VaultItem => !!i)
                : null;
              setPlayList(episodes && episodes.length > 1 ? episodes : null);
              setPlaying(v);
            }}
            onMode={switchMode}
            onStats={() => setInsights('dashboard')}
            onPersonalise={() => setPersonalise(true)}
            devKey={dev?.overviewKey}
            devSheet={dev?.overviewSheet}
          />
        </Animated.View>
      )}

      {personalise && (
        <PersonaliseSheet viewOptions={viewOptions} onViewOptions={setViewOptions} prefs={prefs} actions={actions} onClose={() => setPersonalise(false)} />
      )}

      {insights && (
        <VideoInsightsModal
          initialTab={insights}
          initialWrapped={openWrapped}
          initialMemory={dev?.memoryOpen}
          initialMemoryKind={memoryKind}
          initialYear={openYear}
          initialMonth={openMonth}
          initialHistoryStats={dev?.historyStats}
          items={inPrivate ? privateItems : publicItems}
          deleted={visibleTrash}
          albums={albums.length}
          albumList={albums.filter((a) => !a.isPrivate).map((a) => ({ id: a.id, name: a.name }))}
          smartFilters={smartFilters.length}
          overview={overview}
          prefs={prefs}
          enableVideo={enableVideo}
          freeGb={freeGb}
          duplicateGroups={duplicateGroups}
          onFilter={(f) => {
            setInsights(null);
            setOpenWrapped(false);
            pickFilter(f);
          }}
          actions={actions}
          simkl={simkl}
          ratingLabels={prefs.ratingLabels}
          onOpenVideo={(id) => {
            const v = items.find((x) => x.id === id);
            if (v) setPlaying(v);
          }}
          onMakeSmaller={(ids) => {
            setInsights(null);
            setSmallerFor(items.filter((v) => ids.includes(v.id)));
          }}
          onClose={() => {
            setInsights(null);
            setOpenWrapped(false);
          }}
        />
      )}

      {playing && (
        <ViewerModal
          item={playing}
          items={playList ?? (mode === 'normal' ? shown : [])}
          onChangeItem={setPlaying}
          actions={actions}
          albums={playing.isPrivate ? privateAlbums : publicAlbums}
          enableVideo={enableVideo}
          initialInfoOpen={dev?.infoOpen}
          initialMenuOpen={dev?.menuOpen}
          initialSmallerOpen={dev?.smallerOpen}
          initialCoverOpen={dev?.coverPickerOpen}
          initialEditorTab={dev?.editorTab}
          onSlideshow={(item) => {
            const start = Math.max(0, shown.findIndex((v) => v.id === item.id));
            setPlaying(null);
            setSlideshow({ items: shown, start });
          }}
          onNearby={(item) => {
            setPlaying(null);
            setFilter({ kind: 'nearby', id: item.id });
          }}
          simkl={simkl}
          link={links.get(playing.id) ?? null}
          onLinkChanged={reloadLinks}
          resumeAt={resume.get(playing.id) ?? null}
          prefs={prefs}
          onPrefs={(np) => actions.setPrefs(np).catch(fail('PREFS'))}
          onClose={() => {
            setPlaying(null);
            setPlayList(null);
            loadPlayCounts();
          }}
        />
      )}

      {slideshow && (
        <SlideshowModal
          items={slideshow.items}
          startIndex={slideshow.start}
          enableVideo={enableVideo}
          options={prefs.slideshow}
          autoplay={dev?.slideshowPlay}
          onOptions={(o) => actions.setPrefs({ ...prefs, slideshow: o }).catch(fail('PREFS'))}
          onOpenVideo={(item) => {
            setSlideshow(null);
            setPlaying(item);
          }}
          onClose={() => setSlideshow(null)}
        />
      )}

      {dupReview && (
        <DuplicateReview
          groups={dupReview === 'similar' ? similarGroups : visibleGroups}
          items={publicItems}
          plays={playCounts}
          kind={dupReview}
          onOpen={(v) => setPlaying(v)}
          onApply={async (plans) => {
            for (const pl of plans) {
              for (const t of pl.addTags) await actions.onAddTagMany([pl.keep.id], t);
              if (pl.rating) await actions.onRateMany([pl.keep.id], pl.rating);
            }
            await actions.onDeleteMany(plans.flatMap((pl) => pl.remove));
          }}
          onClose={() => setDupReview(null)}
        />
      )}

      {metaOpen && (
        <MetaImportSheet
          items={items}
          actions={actions}
          autoPick={dev?.metaImportOpen}
          onDone={(line) => console.log(`[META] ${line}`)}
          onClose={() => setMetaOpen(false)}
        />
      )}

      {wifiOpen && (
        <WifiScreen
          wifi={actions.wifi}
          onClose={() => {
            setWifiOpen(false);
            loadPlayCounts();
          }}
        />
      )}

      {compare && (
        <CompareModal
          a={compare[0]}
          b={compare[1]}
          enableVideo={enableVideo}
          onKeep={(_keep, drop) => {
            setCompare(null);
            actions.onDeleteMany([drop]).then(exitSelect).catch(fail('COMPARE'));
          }}
          onClose={() => setCompare(null)}
        />
      )}

      {options && <OptionsSheet title={options.title} options={options.options} onClose={() => setOptions(null)} />}

      {prompt && (
        <PromptSheet
          title={prompt.title}
          message={prompt.message}
          initial={prompt.initial}
          placeholder={prompt.placeholder}
          confirmLabel={prompt.confirmLabel}
          onSubmit={prompt.onSubmit}
          onClose={() => setPrompt(null)}
        />
      )}

      {passcode && (
        <PasscodeSheet
          mode={passcode.mode}
          onCheck={passcode.onCheck}
          onFaceId={passcode.onFaceId}
          onCreate={passcode.onCreate}
          onClose={() => setPasscode(null)}
        />
      )}
    </View>
  );
}

/** The one pill at the top right of the list: what it does depends on the view. */
function HeaderPill({
  filter,
  hasCopies,
  hasTrash,
  busy,
  inPrivate,
  smart,
  album,
  onSelectCopies,
  onDeleteAll,
  onEditSmart,
  onEditRule,
  onAlbum,
  onClearTray,
  onLock,
  onImport,
}: {
  filter: Filter;
  hasCopies: boolean;
  hasTrash: boolean;
  busy: boolean;
  inPrivate: boolean;
  smart?: SmartFilter;
  album?: UiAlbum;
  onSelectCopies: () => void;
  onDeleteAll: () => void;
  onEditSmart: () => void;
  onEditRule: () => void;
  onAlbum: () => void;
  onClearTray: () => void;
  onLock: () => void;
  onImport: () => void;
}) {
  const styles = useStyles(makeStyles);
  const pill = (label: string, onPress: () => void, danger = false) => (
    <TouchableOpacity style={danger ? styles.dangerPill : styles.pill} onPress={onPress} disabled={busy && label === '+ Import'}>
      <Text style={styles.pillText}>{label}</Text>
    </TouchableOpacity>
  );
  if (filter.kind === 'duplicates' || filter.kind === 'similar') return hasCopies ? pill('Select copies', onSelectCopies) : null;
  if (filter.kind === 'deleted') return hasTrash ? pill('Delete all', onDeleteAll, true) : null;
  if (inPrivate && !album) return pill('Lock', onLock, true);
  if (album) return pill('Album •••', onAlbum);
  if (smart) return pill('Edit filter', onEditSmart);
  if (filter.kind === 'rule') return pill('Edit filters', onEditRule);
  if (filter.kind === 'tray') return pill('Clear Tray', onClearTray);
  return pill(busy ? '…' : '+ Import', onImport);
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg, overflow: 'hidden' },

    headerFade: { position: 'absolute', top: 0, left: 0, right: 0 },
    continueBox: { gap: 8, paddingTop: 4, paddingBottom: 6 },
    continueTitle: { color: p.text, fontSize: 18, fontWeight: '800', paddingHorizontal: 8 },
    continueRow: { gap: 10, paddingHorizontal: 8 },
    continueCard: { width: 168 },
    continueThumb: { width: 168, height: 95, borderRadius: 12, backgroundColor: p.tile },
    continueTrack: { position: 'absolute', left: 8, right: 8, top: 84, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.5)', overflow: 'hidden' },
    continueFill: { height: 4, backgroundColor: p.accent },
    continuePlay: { position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    continueName: { color: p.text, fontSize: 13, fontWeight: '700', marginTop: 5 },
    continueAt: { color: p.textSecondary, fontSize: 11 },
    floatingHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingBottom: 8,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 6 },
    headerTitle: { flexShrink: 1, color: p.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    headerRight: { flexDirection: 'row', gap: 8 },

    listHeader: { paddingBottom: 8, gap: 6 },
    modeRow: { paddingHorizontal: 12, paddingBottom: 2 },
    subRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
    },
    subText: { color: p.textSecondary, fontSize: 13 },
    pill: { backgroundColor: p.accent, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 999 },
    dangerPill: { backgroundColor: p.danger, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 999 },
    pillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    note: { color: p.textSecondary, fontSize: 12, paddingHorizontal: 4 },
    sortRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', paddingHorizontal: 4, paddingTop: 2 },
    chipRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    shelfHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingRight: 8 },
    shelfAction: { color: p.link, fontSize: 14, fontWeight: '700' },
    reviewBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, marginLeft: 4 },
    reviewText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: p.elevated },
    chipText: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    empty: { color: p.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },

    actionBar: {
      position: 'absolute',
      left: 14,
      right: 14,
      paddingVertical: 8,
      paddingLeft: 18,
      paddingRight: 8,
      borderRadius: 30,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    actionCount: { color: p.text, fontWeight: '600' },
    actionGroup: { flexDirection: 'row', gap: 8 },
    actionBtn: { backgroundColor: p.danger, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
    actionBtnBlue: { backgroundColor: p.accent, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
    actionBtnGhost: { backgroundColor: p.card, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 999 },
    actionDisabled: { opacity: 0.4 },
    actionBtnText: { color: '#fff', fontWeight: '700' },
  });
