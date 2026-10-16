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
import { AppState, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarSheet, OverviewSheet, TimelineSheet } from './browse';
import { confirmAction, notify, plural } from './confirm';
import DateSheet from './DateSheet';
import { filterLabel, isPrivateView, isSpecial, type Filter } from './filters';
import Grid, { type GridMode } from './Grid';
import { nextSize } from './layout';
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
import { SlideshowModal, CompareModal } from './playback';
import { OptionsSheet, PromptSheet, type OptionItem } from './prompts';
import SearchSheet from './SearchSheet';
import { PasscodeSheet, SettingsSheet, type PasscodeMode } from './security';
import { BulkEditSheet, newSmartFilterDraft, SmartFilterSheet, ViewOptionsSheet } from './sheets';
import Sidebar from './Sidebar';
import { paletteFor, sheet, ThemeContext, useStyles, type Palette } from './theme';
import {
  SORTS,
  type GroupBy,
  type PasscodeKind,
  type SecurityState,
  type SmartFilter,
  type SmartRule,
  type UiAlbum,
  type UiFolder,
  type UiTag,
  type VaultItem,
  type VaultScreenProps,
  type ViewOptions,
} from './types';
import ViewerModal from './ViewerModal';

/** Glyph on the round thumbnail-size button, per size. */
const SIZE_GLYPH: Record<ViewOptions['size'], string> = {
  small: '▪',
  medium: '▩',
  large: '▦',
  xlarge: '▤',
  fit: '▬',
};

/** Picks the light or dark colours, then renders the screen inside them. */
export default function VaultScreen(props: VaultScreenProps) {
  const system = useColorScheme();
  const palette = paletteFor(resolveScheme(props.viewOptions.theme, system));
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
  devInitialState: dev,
}: VaultScreenProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VaultItem[] | null>(null);
  const [selectMode, setSelectMode] = useState(dev?.selectMode ?? false);
  const [selected, setSelected] = useState<string[]>(dev?.selectedIds ?? []);
  const [searchOpen, setSearchOpen] = useState(dev?.searchOpen ?? false);
  const [sidebarOpen, setSidebarOpen] = useState(dev?.sidebarOpen ?? false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(dev?.viewOptionsOpen ?? false);
  const [bulkOpen, setBulkOpen] = useState(dev?.bulkOpen ?? false);
  const [settingsOpen, setSettingsOpen] = useState(dev?.settingsOpen ?? false);
  const [calendarOpen, setCalendarOpen] = useState(dev?.calendarOpen ?? false);
  const [timelineOpen, setTimelineOpen] = useState(dev?.timelineOpen ?? false);
  const [overviewOpen, setOverviewOpen] = useState(dev?.overviewOpen ?? false);
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

  useEffect(() => {
    actions
      .getSecurity()
      .then(setSecurity)
      .catch((e) => console.log(`[SECURITY] state failed: ${String(e)}`));
  }, [actions]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      actions
        .search(q)
        .then((r) => {
          if (!cancelled) setResults(r);
          console.log(`[SEARCH] "${q}" → ${r.length}`);
        })
        .catch((e) => console.log(`[SEARCH] failed: ${String(e)}`));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, actions]);

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

  const shown = useMemo(() => {
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

  function refreshSecurity() {
    actions.getSecurity().then(setSecurity).catch(fail('SECURITY'));
  }

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
  function startImport() {
    if (freeGb === null) {
      actions.onImport();
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
      actions.onImport,
      { label: 'Choose videos', destructive: false }
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

  const listHeader = (
    <View style={[styles.listHeader, { paddingTop: insets.top + 56 }]}>
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
      {!results && !special && (
        <View style={styles.sortRow}>
          <TouchableOpacity style={styles.chip} onPress={() => setViewOptionsOpen(true)}>
            <Text style={styles.chipText}>
              Sorted by {sortLabel}
              {viewOptions.groupBy !== 'none' ? ` · by ${viewOptions.groupBy}` : ''} ›
            </Text>
          </TouchableOpacity>
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
      <Grid
        items={shown}
        viewOptions={viewOptions}
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
      />

      <View style={[styles.floatingHeader, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.circleBtn}
          accessibilityLabel="Thumbnail size"
          onPress={() => setViewOptions({ ...viewOptions, size: nextSize(viewOptions.size) })}
          onLongPress={() => setViewOptionsOpen(true)}>
          <Text style={styles.circleIcon}>{SIZE_GLYPH[viewOptions.size]}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.circleBtn}
            accessibilityLabel="View options"
            onPress={() => setViewOptionsOpen(true)}>
            <Text style={styles.circleIcon}>•••</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.circleBtn}
            accessibilityLabel={selectMode ? 'Cancel selection' : 'Select'}
            onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}>
            <Text style={styles.circleIcon}>{selectMode ? '✕' : '✓'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {selectMode ? (
        <View style={styles.actionBar}>
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
                <Text style={styles.actionGhostText}>•••</Text>
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
        </View>
      ) : (
        <>
          <TouchableOpacity style={styles.floatingLeft} onPress={() => setSidebarOpen(true)} accessibilityLabel="Library">
            <Text style={styles.circleIcon}>•••</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.floatingSearch} onPress={() => setSearchOpen(true)} accessibilityLabel="Search">
            <Text style={styles.circleIcon}>🔍</Text>
          </TouchableOpacity>
        </>
      )}

      {searchOpen && (
        <SearchSheet
          value={query}
          tags={allTags}
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
          albums={privateOpen ? albums : publicAlbums}
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
          onSettings={() => {
            setSidebarOpen(false);
            refreshSecurity();
            setSettingsOpen(true);
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
          onClose={() => setBulkOpen(false)}
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

      {overviewOpen && <OverviewSheet items={publicItems} onClose={() => setOverviewOpen(false)} />}

      {settingsOpen && (
        <SettingsSheet
          security={security}
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
              if ((await actions.checkPasscode(code)) === 'real') {
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
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {playing && (
        <ViewerModal
          item={playing}
          actions={actions}
          albums={playing.isPrivate ? privateAlbums : publicAlbums}
          enableVideo={enableVideo}
          initialInfoOpen={dev?.infoOpen}
          initialMenuOpen={dev?.menuOpen}
          onSlideshow={(item) => {
            const start = Math.max(0, shown.findIndex((v) => v.id === item.id));
            setPlaying(null);
            setSlideshow({ items: shown, start });
          }}
          onNearby={(item) => {
            setPlaying(null);
            setFilter({ kind: 'nearby', id: item.id });
          }}
          onClose={() => setPlaying(null)}
        />
      )}

      {slideshow && (
        <SlideshowModal
          items={slideshow.items}
          startIndex={slideshow.start}
          enableVideo={enableVideo}
          onClose={() => setSlideshow(null)}
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

    floatingHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingBottom: 8,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: p.headerBg,
    },
    headerTitle: { flex: 1, color: p.text, fontSize: 17, fontWeight: '700', textAlign: 'center', paddingHorizontal: 8 },
    headerRight: { flexDirection: 'row', gap: 8 },
    circleBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.circle,
    },
    circleIcon: { color: p.icon, fontSize: 15, fontWeight: '700' },

    listHeader: { paddingBottom: 8, gap: 6 },
    subRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
    },
    subText: { color: p.textSecondary, fontSize: 13 },
    pill: { backgroundColor: p.accent, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
    dangerPill: { backgroundColor: p.danger, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
    pillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    note: { color: p.textSecondary, fontSize: 12, paddingHorizontal: 4 },
    sortRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', paddingHorizontal: 4, paddingTop: 2 },
    chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: p.card },
    chipText: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    empty: { color: p.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },

    floatingSearch: {
      position: 'absolute',
      right: 18,
      bottom: 28,
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.floating,
    },
    floatingLeft: {
      position: 'absolute',
      left: 18,
      bottom: 28,
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.floating,
    },
    actionBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingBottom: 30,
      paddingTop: 12,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: p.panel,
      borderTopWidth: 1,
      borderTopColor: p.separator,
    },
    actionCount: { color: p.text, fontWeight: '600' },
    actionGroup: { flexDirection: 'row', gap: 8 },
    actionBtn: { backgroundColor: p.danger, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
    actionBtnBlue: { backgroundColor: p.accent, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
    actionBtnGhost: { backgroundColor: p.card, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
    actionGhostText: { color: p.text, fontWeight: '800' },
    actionDisabled: { opacity: 0.4 },
    actionBtnText: { color: '#fff', fontWeight: '700' },
  });
