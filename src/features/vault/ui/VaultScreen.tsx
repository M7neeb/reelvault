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
 * Layout of this file: the theme wrapper, then the screen (state + what is
 * shown), then the header pieces. The grid, sidebar and sheets live in their
 * own files next to this one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction, notify, plural } from './confirm';
import { filterLabel, isSpecial, type Filter } from './filters';
import Grid, { type GridMode } from './Grid';
import { nextSize } from './layout';
import { describeRule, extraCopies, matchesRule, RECENTLY_DELETED_DAYS, resolveScheme, safeBatchGb } from './logic';
import SearchSheet from './SearchSheet';
import { BulkEditSheet, newSmartFilterDraft, SmartFilterSheet, ViewOptionsSheet } from './sheets';
import Sidebar from './Sidebar';
import { paletteFor, sheet, ThemeContext, useStyles, type Palette } from './theme';
import { SORTS, type SmartRule, type VaultItem, type VaultScreenProps, type ViewOptions } from './types';
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

function VaultScreenBody({
  items,
  allTags,
  tagMap,
  deletedItems,
  duplicateGroups,
  smartFilters,
  viewOptions,
  freeGb,
  busy,
  status,
  actions,
  enableVideo = true,
  devInitialState,
}: VaultScreenProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VaultItem[] | null>(null);
  const [selectMode, setSelectMode] = useState(devInitialState?.selectMode ?? false);
  const [selected, setSelected] = useState<string[]>(devInitialState?.selectedIds ?? []);
  const [searchOpen, setSearchOpen] = useState(devInitialState?.searchOpen ?? false);
  const [sidebarOpen, setSidebarOpen] = useState(devInitialState?.sidebarOpen ?? false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(devInitialState?.viewOptionsOpen ?? false);
  const [bulkOpen, setBulkOpen] = useState(devInitialState?.bulkOpen ?? false);
  const [privateUnlocked, setPrivateUnlocked] = useState(devInitialState?.privateUnlocked ?? false);
  /** The smart filter being edited (`id` set) or created; null when the editor is closed. */
  const [editingSmart, setEditingSmart] = useState<{ id?: number; name: string; rule: SmartRule } | null>(
    devInitialState?.smartEditorOpen
      ? { name: 'Best travel clips', rule: { minRating: 8, tags: ['holiday'] } }
      : null
  );
  const [filter, setFilter] = useState<Filter>(
    devInitialState?.filter ? { kind: devInitialState.filter } : { kind: 'all' }
  );
  const [playing, setPlaying] = useState<VaultItem | null>(
    () => items.find((i) => i.id === devInitialState?.viewerId) ?? null
  );

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

  /* ------------------------------------------------- what may be seen at all */

  const inPrivate = filter.kind === 'private';
  const special = isSpecial(filter);

  // Private videos never appear anywhere except the unlocked Private album:
  // not in lists, counts, search, duplicates or smart filters.
  const publicItems = useMemo(() => items.filter((v) => !v.isPrivate), [items]);
  const privateItems = useMemo(() => items.filter((v) => v.isPrivate), [items]);
  const publicIds = useMemo(() => new Set(publicItems.map((v) => v.id)), [publicItems]);

  const visibleGroups = useMemo(
    () =>
      duplicateGroups
        .map((g) => g.filter((id) => publicIds.has(id)))
        .filter((g) => g.length > 1),
    [duplicateGroups, publicIds]
  );
  const dupRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const group of visibleGroups) group.forEach((id, i) => m.set(id, i));
    return m;
  }, [visibleGroups]);

  const tagCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [name, ids] of Object.entries(tagMap)) out[name] = ids.filter((id) => publicIds.has(id)).length;
    return out;
  }, [tagMap, publicIds]);

  const visibleTrash = useMemo(
    () => deletedItems.filter((v) => privateUnlocked || !v.isPrivate),
    [deletedItems, privateUnlocked]
  );
  const hiddenTrash = deletedItems.length - visibleTrash.length;

  /* ------------------------------------------------------ what is shown now */

  const pool = useMemo(() => {
    if (inPrivate) {
      if (!privateUnlocked) return [];
      return results ? results.filter((v) => v.isPrivate) : privateItems;
    }
    return results && !special ? results.filter((v) => !v.isPrivate) : publicItems;
  }, [inPrivate, privateUnlocked, results, special, privateItems, publicItems]);

  const shown = useMemo(() => {
    switch (filter.kind) {
      case 'deleted':
        return visibleTrash;
      case 'duplicates': {
        const byId = new Map(publicItems.map((v) => [v.id, v]));
        return visibleGroups.flat().flatMap((id) => {
          const v = byId.get(id);
          return v ? [v] : [];
        });
      }
      case 'favorites':
        return pool.filter((v) => v.rating >= 8);
      case 'rated':
        return pool.filter((v) => v.rating > 0);
      case 'untagged':
        return pool.filter((v) => !(v.tagCount > 0));
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
      default:
        return pool;
    }
  }, [filter, pool, visibleTrash, visibleGroups, publicItems, tagMap, smartFilters]);

  const activeSmart = filter.kind === 'smart' ? smartFilters.find((s) => s.id === filter.id) : undefined;
  const mode: GridMode =
    filter.kind === 'deleted' ? 'trash' : filter.kind === 'duplicates' ? 'duplicates' : 'normal';

  /* ----------------------------------------------------------------- actions */

  function setViewOptions(next: ViewOptions) {
    actions.onViewOptionsChange(next).catch((e) => console.log(`[VIEW] save failed: ${String(e)}`));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected([]);
  }

  async function openPrivate() {
    setSidebarOpen(false);
    if (!privateUnlocked) {
      const res = await actions.unlockPrivate();
      if (!res.ok) {
        if (res.message) notify('Private stays locked', res.message);
        return;
      }
      setPrivateUnlocked(true);
    }
    setFilter({ kind: 'private' });
    exitSelect();
  }

  function pickFilter(f: Filter) {
    if (f.kind === 'private') {
      void openPrivate();
      return;
    }
    setFilter(f);
    exitSelect();
    setSidebarOpen(false);
  }

  function lockPrivate() {
    setPrivateUnlocked(false);
    setFilter((f) => (f.kind === 'private' ? { kind: 'all' } : f));
    setPlaying((v) => (v?.isPrivate ? null : v));
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
        actions
          .onDeleteMany(selectedItems)
          .then(exitSelect)
          .catch((e) => console.log(`[DELETE] batch failed: ${String(e)}`));
      }
    );
  }

  function restoreSelected() {
    if (!selectedItems.length) return;
    actions
      .onRestoreMany(selectedItems)
      .then(exitSelect)
      .catch((e) => console.log(`[RESTORE] failed: ${String(e)}`));
  }

  function confirmPurge(list: VaultItem[]) {
    if (!list.length) return;
    confirmAction(
      `Delete ${plural(list.length, 'video')} for good?`,
      'This removes the files from your iPhone. It cannot be undone.',
      () => {
        actions
          .onPurgeMany(list)
          .then(exitSelect)
          .catch((e) => console.log(`[PURGE] failed: ${String(e)}`));
      },
      { label: 'Delete for good' }
    );
  }

  /** Select every copy except the original in each duplicate group. */
  function selectCopies() {
    setSelectMode(true);
    setSelected(extraCopies(visibleGroups));
  }

  /** Space check before the picker opens: the picker itself needs room for a temp copy. */
  function startImport() {
    if (freeGb === null) {
      actions.onImport();
      return;
    }
    const batch = safeBatchGb(freeGb);
    if (batch < 0.1) {
      notify(
        'Not enough free space',
        `Only ${freeGb} GB is free. Free up some space on your iPhone first, then import.`
      );
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

  const title = results && !special ? 'Search' : filterLabel(filter, smartFilters);
  const sortLabel = SORTS.find((s) => s.key === viewOptions.sort)?.label ?? 'Recent';

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
          hasCopies={visibleGroups.length > 0}
          hasTrash={visibleTrash.length > 0}
          smartEditable={!!activeSmart}
          busy={busy}
          onSelectCopies={selectCopies}
          onDeleteAll={() => confirmPurge(visibleTrash)}
          onEditSmart={() => activeSmart && setEditingSmart({ ...activeSmart })}
          onLock={lockPrivate}
          onImport={startImport}
        />
      </View>
      {!!status && <Text style={styles.note}>{status}</Text>}
      {activeSmart && <Text style={styles.note}>{describeRule(activeSmart.rule)}</Text>}
      {filter.kind === 'deleted' && (
        <Text style={styles.note}>
          Videos stay here for {RECENTLY_DELETED_DAYS} days, then they are removed for good. Tap
          videos to select them.
          {hiddenTrash > 0 ? ` ${plural(hiddenTrash, 'private video')} hidden - unlock Private to see.` : ''}
        </Text>
      )}
      {filter.kind === 'duplicates' && (
        <Text style={styles.note}>
          {visibleGroups.length
            ? `${plural(visibleGroups.length, 'group')} of the same video. The first in each group ` +
              'is the original; the others are marked Copy.'
            : 'No duplicates found.'}
        </Text>
      )}
      {inPrivate && (
        <Text style={styles.note}>
          Only you can see these. Private locks again when you leave the app.
        </Text>
      )}
      {!results && !special && (
        <View style={styles.sortRow}>
          <TouchableOpacity style={styles.chip} onPress={() => setViewOptionsOpen(true)}>
            <Text style={styles.chipText}>Sorted by {sortLabel} ›</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const empty = (
    <Text style={styles.empty}>
      {filter.kind === 'deleted'
        ? 'Recently Deleted is empty.'
        : filter.kind === 'duplicates'
          ? ''
          : inPrivate
            ? 'No private videos yet. Select videos, tap Edit, then Move to Private.'
            : results
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
        onPressTile={onPressTile}
      />

      <View style={[styles.floatingHeader, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.circleBtn}
          accessibilityLabel="Thumbnail size"
          onPress={() => setViewOptions({ ...viewOptions, size: nextSize(viewOptions.size) })}>
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
          <TouchableOpacity
            style={styles.floatingLeft}
            onPress={() => setSidebarOpen(true)}
            accessibilityLabel="Library">
            <Text style={styles.circleIcon}>•••</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.floatingSearch}
            onPress={() => setSearchOpen(true)}
            accessibilityLabel="Search">
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
            setEditingSmart(newSmartFilterDraft(query));
          }}
        />
      )}

      {sidebarOpen && (
        <Sidebar
          items={publicItems}
          tags={allTags}
          tagCounts={tagCounts}
          smartFilters={smartFilters}
          deletedCount={visibleTrash.length}
          duplicateCount={visibleGroups.flat().length}
          privateCount={privateUnlocked ? privateItems.length : null}
          freeGb={freeGb}
          filter={filter}
          onPick={pickFilter}
          onClose={() => setSidebarOpen(false)}
          onNewSmart={() => {
            setSidebarOpen(false);
            setEditingSmart(newSmartFilterDraft(''));
          }}
          onImport={() => {
            setSidebarOpen(false);
            startImport();
          }}
        />
      )}

      {viewOptionsOpen && (
        <ViewOptionsSheet
          options={viewOptions}
          onChange={setViewOptions}
          onClose={() => setViewOptionsOpen(false)}
        />
      )}

      {bulkOpen && (
        <BulkEditSheet
          count={selected.length}
          tags={allTags}
          privateAction={inPrivate ? 'remove' : 'add'}
          onRate={(n) => actions.onRateMany(selected, n)}
          onAddTag={(name) => actions.onAddTagMany(selected, name)}
          onStatus={(s) => actions.onSetStatus(selected, s)}
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
          tags={allTags}
          items={publicItems}
          onSave={actions.onSaveSmartFilter}
          onDelete={async (id) => {
            await actions.onDeleteSmartFilter(id);
            if (filter.kind === 'smart' && filter.id === id) setFilter({ kind: 'all' });
          }}
          onClose={() => setEditingSmart(null)}
        />
      )}

      {playing && (
        <ViewerModal
          item={playing}
          actions={actions}
          enableVideo={enableVideo}
          initialInfoOpen={devInitialState?.infoOpen}
          initialMenuOpen={devInitialState?.menuOpen}
          onClose={() => setPlaying(null)}
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
  smartEditable,
  busy,
  onSelectCopies,
  onDeleteAll,
  onEditSmart,
  onLock,
  onImport,
}: {
  filter: Filter;
  hasCopies: boolean;
  hasTrash: boolean;
  smartEditable: boolean;
  busy: boolean;
  onSelectCopies: () => void;
  onDeleteAll: () => void;
  onEditSmart: () => void;
  onLock: () => void;
  onImport: () => void;
}) {
  const styles = useStyles(makeStyles);
  if (filter.kind === 'duplicates') {
    return hasCopies ? (
      <TouchableOpacity style={styles.pill} onPress={onSelectCopies}>
        <Text style={styles.pillText}>Select copies</Text>
      </TouchableOpacity>
    ) : null;
  }
  if (filter.kind === 'deleted') {
    return hasTrash ? (
      <TouchableOpacity style={styles.dangerPill} onPress={onDeleteAll}>
        <Text style={styles.pillText}>Delete all</Text>
      </TouchableOpacity>
    ) : null;
  }
  if (filter.kind === 'private') {
    return (
      <TouchableOpacity style={styles.dangerPill} onPress={onLock} accessibilityLabel="Lock Private">
        <Text style={styles.pillText}>Lock</Text>
      </TouchableOpacity>
    );
  }
  if (smartEditable) {
    return (
      <TouchableOpacity style={styles.pill} onPress={onEditSmart}>
        <Text style={styles.pillText}>Edit filter</Text>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity style={styles.pill} onPress={onImport} disabled={busy}>
      <Text style={styles.pillText}>{busy ? '…' : '+ Import'}</Text>
    </TouchableOpacity>
  );
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
    actionBtn: { backgroundColor: p.danger, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
    actionBtnBlue: { backgroundColor: p.accent, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
    actionDisabled: { opacity: 0.4 },
    actionBtnText: { color: '#fff', fontWeight: '700' },
  });
