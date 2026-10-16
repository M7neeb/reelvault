/**
 * VaultScreen - the entire ReelVault UI, as a pure presentational component.
 *
 * RULE: no native imports in this file or anything it pulls in. No expo-sqlite,
 * no expo-file-system, no expo-document-picker. It receives plain data and
 * callbacks, which is what allows the identical component to be rendered in a
 * browser (`src/app/preview.tsx`) for design checks.
 *
 * `expo-video` is the one exception: it has a real web implementation, and the
 * viewer needs it for playback. `enableVideo=false` skips mounting it, which is
 * what the browser preview does.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ViewerModal from './ViewerModal';
import { BulkEditSheet, newSmartFilterDraft, SmartFilterSheet, ViewOptionsSheet } from './sheets';

import { fmtDuration, gbFromBytes } from './format';
import {
  daysLeft,
  describeRule,
  extraCopies,
  matchesRule,
  RECENTLY_DELETED_DAYS,
  safeBatchGb,
} from './logic';
import {
  SORTS,
  STATUSES,
  type SmartFilter,
  type SmartRule,
  type UiStatus,
  type UiTag,
  type VaultItem,
  type VaultScreenProps,
  type ViewOptions,
} from './types';

const COLUMN_OPTIONS: ViewOptions['columns'][] = [3, 4, 5];
/** Gap between grid tiles, in px. Tiles are sized explicitly from this. */
const GRID_GAP = 3;
const FRAME_W = 52;
const FRAME_H = 36;
const FRAME_GAP = 3;
const SHEET_COLLAPSED = 132;

type Filter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'rated' }
  | { kind: 'untagged' }
  | { kind: 'tag'; tag: string }
  | { kind: 'status'; status: UiStatus }
  | { kind: 'smart'; id: number }
  | { kind: 'duplicates' }
  | { kind: 'deleted' };

function filterLabel(f: Filter, smartFilters: SmartFilter[]): string {
  switch (f.kind) {
    case 'status':
      return STATUSES.find((s) => s.key === f.status)?.label ?? 'Status';
    case 'smart':
      return smartFilters.find((s) => s.id === f.id)?.name ?? 'Smart Filter';
    case 'all':
      return 'All Videos';
    case 'favorites':
      return 'Favorites';
    case 'rated':
      return 'Rated';
    case 'untagged':
      return 'Untagged';
    case 'tag':
      return `# ${f.tag}`;
    case 'duplicates':
      return 'Duplicates';
    case 'deleted':
      return 'Recently Deleted';
  }
}

/** Alert.alert does not exist on web, so route the confirm through whatever fits. */
function confirmAction(
  title: string,
  message: string | undefined,
  onConfirm: () => void,
  { label = 'Delete', destructive = true }: { label?: string; destructive?: boolean } = {}
) {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // eslint-disable-next-line no-alert
    if (typeof window === 'undefined' || window.confirm(text)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: label, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function VaultScreen({
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

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VaultItem[] | null>(null);
  const [selectMode, setSelectMode] = useState(devInitialState?.selectMode ?? false);
  const [selected, setSelected] = useState<string[]>(devInitialState?.selectedIds ?? []);
  const [searchOpen, setSearchOpen] = useState(devInitialState?.searchOpen ?? false);
  const [sidebarOpen, setSidebarOpen] = useState(devInitialState?.sidebarOpen ?? false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(devInitialState?.viewOptionsOpen ?? false);
  const [bulkOpen, setBulkOpen] = useState(devInitialState?.bulkOpen ?? false);
  /** The smart filter being edited (`id` set) or created; null when the editor is closed. */
  const [editingSmart, setEditingSmart] = useState<{ id?: number; name: string; rule: SmartRule } | null>(
    devInitialState?.smartEditorOpen ? { name: 'Best travel clips', rule: { minRating: 8, tags: ['holiday'] } } : null
  );
  const cols = viewOptions.columns;
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

  /** id -> position inside its duplicate group (0 = the original). */
  const dupRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const group of duplicateGroups) group.forEach((id, i) => m.set(id, i));
    return m;
  }, [duplicateGroups]);

  const special = filter.kind === 'deleted' || filter.kind === 'duplicates';
  const base = results && !special ? results : items;
  const shown = useMemo(() => {
    switch (filter.kind) {
      case 'deleted':
        return deletedItems;
      case 'duplicates': {
        const byId = new Map(items.map((v) => [v.id, v]));
        return duplicateGroups.flat().flatMap((id) => {
          const v = byId.get(id);
          return v ? [v] : [];
        });
      }
      case 'favorites':
        return base.filter((v) => v.rating >= 8);
      case 'rated':
        return base.filter((v) => v.rating > 0);
      case 'untagged':
        return base.filter((v) => !(v.tagCount > 0));
      case 'tag': {
        const ids = new Set(tagMap[filter.tag] ?? []);
        return base.filter((v) => ids.has(v.id));
      }
      case 'status':
        return base.filter((v) => v.status === filter.status);
      case 'smart': {
        const rule = smartFilters.find((s) => s.id === filter.id)?.rule;
        return rule ? base.filter((v) => matchesRule(v, rule)) : [];
      }
      default:
        return base;
    }
  }, [base, filter, tagMap, items, deletedItems, duplicateGroups, smartFilters]);

  const activeSmart = filter.kind === 'smart' ? smartFilters.find((s) => s.id === filter.id) : undefined;

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

  function pickFilter(f: Filter) {
    setFilter(f);
    exitSelect();
    setSidebarOpen(false);
  }

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
    setSelected(extraCopies(duplicateGroups));
  }

  /** Space check before the picker opens: the picker itself needs room for a temp copy. */
  function startImport() {
    if (freeGb === null) {
      actions.onImport();
      return;
    }
    const batch = safeBatchGb(freeGb);
    if (batch < 0.1) {
      confirmAction(
        'Not enough free space',
        `Only ${freeGb} GB is free. Free up some space on your iPhone first, then import.`,
        () => {},
        { label: 'OK', destructive: false }
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

  const title = results && !special ? 'Search' : filterLabel(filter, smartFilters);
  const now = Date.now();

  // Explicit tile maths, instead of `flex: 1` + `aspectRatio: 1`.
  //
  // With flex the row came out wider than the screen on web: the last column was
  // clipped, and because that stretched the screen container, every right-anchored
  // control - Import, the select toggle, the search button, the viewer's info
  // button - was pushed off-screen. Sizing each tile from the measured container
  // makes the row sum to exactly the viewport, and makes the tiles genuinely
  // square, which is the whole point of the reference app's grid.
  //
  // The width comes from onLayout rather than useWindowDimensions: the measured
  // container is the truth, and a window-vs-container mismatch silently produced
  // 1px tiles once already.
  const [gridW, setGridW] = useState(0);
  const tileSize = gridW > 0 ? Math.floor((gridW - GRID_GAP * (cols - 1)) / cols) : 0;

  return (
    <View style={styles.screen}>
      <FlatList
        data={shown}
        key={cols}
        keyExtractor={(v) => v.id}
        style={styles.list}
        onLayout={(e) => setGridW(e.nativeEvent.layout.width)}
        numColumns={cols}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={styles.grid}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={[styles.listHeader, { paddingTop: insets.top + 56 }]}>
            <View style={styles.subRow}>
              <Text style={styles.subText}>
                {plural(shown.length, 'video')}
                {freeGb !== null ? ` · ${freeGb} GB free` : ''}
              </Text>
              {filter.kind === 'duplicates' && duplicateGroups.length > 0 ? (
                <TouchableOpacity style={styles.importPill} onPress={selectCopies}>
                  <Text style={styles.importPillText}>Select copies</Text>
                </TouchableOpacity>
              ) : filter.kind === 'deleted' ? (
                deletedItems.length > 0 && (
                  <TouchableOpacity
                    style={styles.dangerPill}
                    onPress={() => confirmPurge(deletedItems)}>
                    <Text style={styles.importPillText}>Delete all</Text>
                  </TouchableOpacity>
                )
              ) : activeSmart ? (
                <TouchableOpacity
                  style={styles.importPill}
                  onPress={() => setEditingSmart({ ...activeSmart })}>
                  <Text style={styles.importPillText}>Edit filter</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.importPill} onPress={startImport} disabled={busy}>
                  <Text style={styles.importPillText}>{busy ? '…' : '+ Import'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {!!status && <Text style={styles.statusText}>{status}</Text>}
            {activeSmart && <Text style={styles.statusText}>{describeRule(activeSmart.rule)}</Text>}
            {filter.kind === 'deleted' && (
              <Text style={styles.statusText}>
                Videos stay here for {RECENTLY_DELETED_DAYS} days, then they are removed for good.
                Tap videos to select them.
              </Text>
            )}
            {filter.kind === 'duplicates' && (
              <Text style={styles.statusText}>
                {duplicateGroups.length
                  ? `${plural(duplicateGroups.length, 'group')} of the same video. The first in each ` +
                    'group is the original; the others are marked Copy.'
                  : 'No duplicates found.'}
              </Text>
            )}
            {!results && !special && (
              <View style={styles.sortRow}>
                <TouchableOpacity style={styles.chip} onPress={() => setViewOptionsOpen(true)}>
                  <Text style={styles.chipText}>
                    Sorted by {SORTS.find((s) => s.key === viewOptions.sort)?.label ?? 'Recent'} ›
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filter.kind === 'deleted'
              ? 'Recently Deleted is empty.'
              : filter.kind === 'duplicates'
                ? ''
                : results
                  ? 'No matches.'
                  : 'Nothing here yet.'}
          </Text>
        }
        renderItem={({ item }) => {
          const dur = fmtDuration(item.durationMs);
          const isSel = selected.includes(item.id);
          const inTrash = filter.kind === 'deleted';
          const copyRank = filter.kind === 'duplicates' ? dupRank.get(item.id) : undefined;
          return (
            <TouchableOpacity
              style={[styles.cell, { width: tileSize, height: tileSize }]}
              activeOpacity={0.8}
              onPress={() => {
                if (inTrash) {
                  // Deleted videos are not played - tapping selects them for restore.
                  setSelectMode(true);
                  toggleSelect(item.id);
                } else if (selectMode) toggleSelect(item.id);
                else {
                  console.log(`[VAULT] open ${item.filename}`);
                  setPlaying(item);
                }
              }}>
              <Image
                source={item.thumbSource}
                style={[styles.thumb, inTrash && styles.thumbDimmed]}
                contentFit="cover"
              />
              {viewOptions.showDuration && dur && <Text style={styles.durBadge}>{dur}</Text>}
              {viewOptions.showKeywords && item.tagCount > 0 && (
                <View style={styles.tagBadge}>
                  <Text style={styles.tagBadgeText}>#</Text>
                </View>
              )}
              {viewOptions.showRating && item.rating > 0 && (
                <Text style={styles.rateBadge}>{item.rating}/10</Text>
              )}
              {inTrash && item.deletedAt !== null && (
                <Text style={[styles.daysBadge, selectMode && styles.badgeBesideCheck]}>
                  {plural(daysLeft(item.deletedAt, now), 'day')}
                </Text>
              )}
              {copyRank !== undefined && (
                <Text
                  style={[
                    styles.daysBadge,
                    copyRank === 0 && styles.originalBadge,
                    selectMode && styles.badgeBesideCheck,
                  ]}>
                  {copyRank === 0 ? 'Original' : 'Copy'}
                </Text>
              )}
              {selectMode && (
                <View style={[styles.check, isSel && styles.checkOn]}>
                  {isSel && <Text style={styles.checkMark}>✓</Text>}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />

      <View
        style={[styles.floatingHeader, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none">
        <TouchableOpacity
          style={styles.circleBtn}
          accessibilityLabel="Thumbnail size"
          onPress={() => {
            const i = COLUMN_OPTIONS.indexOf(cols);
            setViewOptions({ ...viewOptions, columns: COLUMN_OPTIONS[(i + 1) % COLUMN_OPTIONS.length] });
          }}>
          <Text style={styles.circleIcon}>{cols === 3 ? '▦' : cols === 4 ? '▩' : '▪'}</Text>
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
            onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}>
            <Text style={styles.circleIcon}>{selectMode ? '✕' : '✓'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {selectMode ? (
        <View style={styles.actionBar}>
          <Text style={styles.actionCount}>{selected.length} selected</Text>
          {filter.kind === 'deleted' ? (
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
          <TouchableOpacity style={styles.floatingSearch} onPress={() => setSearchOpen(true)}>
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
          items={items}
          tags={allTags}
          tagMap={tagMap}
          smartFilters={smartFilters}
          deletedCount={deletedItems.length}
          duplicateCount={duplicateGroups.flat().length}
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
          onRate={(n) => actions.onRateMany(selected, n)}
          onAddTag={(name) => actions.onAddTagMany(selected, name)}
          onStatus={(s) => actions.onSetStatus(selected, s)}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {editingSmart && (
        <SmartFilterSheet
          initial={editingSmart}
          tags={allTags}
          items={items}
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

/* ------------------------------------------------------------------ sidebar */

function DrawerRow({
  label,
  hint,
  count,
  f,
  current,
  onPick,
}: {
  label: string;
  /** Optional second line, e.g. what a smart filter checks. */
  hint?: string;
  count: number;
  f: Filter;
  current: Filter;
  onPick: (f: Filter) => void;
}) {
  const active = JSON.stringify(f) === JSON.stringify(current);
  return (
    <TouchableOpacity style={[styles.drawerRow, active && styles.drawerRowOn]} onPress={() => onPick(f)}>
      <View style={styles.drawerRowText}>
        <Text style={[styles.drawerLabel, active && styles.drawerLabelOn]} numberOfLines={1}>
          {label}
        </Text>
        {!!hint && (
          <Text style={styles.drawerHint} numberOfLines={1}>
            {hint}
          </Text>
        )}
      </View>
      <Text style={styles.drawerCount}>{count}</Text>
    </TouchableOpacity>
  );
}

function Sidebar({
  items,
  tags,
  tagMap,
  smartFilters,
  deletedCount,
  duplicateCount,
  freeGb,
  filter,
  onPick,
  onClose,
  onNewSmart,
  onImport,
}: {
  items: VaultItem[];
  tags: UiTag[];
  tagMap: Record<string, string[]>;
  smartFilters: SmartFilter[];
  deletedCount: number;
  duplicateCount: number;
  freeGb: number | null;
  filter: Filter;
  onPick: (f: Filter) => void;
  onClose: () => void;
  onNewSmart: () => void;
  onImport: () => void;
}) {
  const favorites = items.filter((v) => v.rating >= 8).length;
  const rated = items.filter((v) => v.rating > 0).length;
  const untagged = items.filter((v) => v.tagCount === 0).length;
  const totalBytes = items.reduce((sum, v) => sum + v.sizeBytes, 0);
  const row = { current: filter, onPick };

  return (
    <View style={styles.drawerRoot}>
      <TouchableOpacity style={styles.drawerBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.drawer}>
        <Text style={styles.drawerTitle}>ReelVault</Text>
        <ScrollView contentContainerStyle={styles.drawerScroll}>
          <Text style={styles.drawerSection}>Library</Text>
          <DrawerRow {...row} label="All Videos" count={items.length} f={{ kind: 'all' }} />
          <DrawerRow {...row} label="★ Favorites" count={favorites} f={{ kind: 'favorites' }} />
          <DrawerRow {...row} label="Rated" count={rated} f={{ kind: 'rated' }} />
          <DrawerRow {...row} label="Untagged" count={untagged} f={{ kind: 'untagged' }} />
          <DrawerRow {...row} label="Duplicates" count={duplicateCount} f={{ kind: 'duplicates' }} />
          <DrawerRow {...row} label="Recently Deleted" count={deletedCount} f={{ kind: 'deleted' }} />

          <Text style={styles.drawerSection}>Smart Filters</Text>
          {smartFilters.map((s) => (
            <DrawerRow
              {...row}
              key={s.id}
              label={s.name}
              hint={describeRule(s.rule)}
              count={items.filter((v) => matchesRule(v, s.rule)).length}
              f={{ kind: 'smart', id: s.id }}
            />
          ))}
          <TouchableOpacity style={styles.drawerRow} onPress={onNewSmart}>
            <Text style={styles.drawerAdd}>+ New Smart Filter</Text>
          </TouchableOpacity>

          <Text style={styles.drawerSection}>Status</Text>
          {STATUSES.map((s) => (
            <DrawerRow
              {...row}
              key={s.key}
              label={s.label}
              count={items.filter((v) => v.status === s.key).length}
              f={{ kind: 'status', status: s.key }}
            />
          ))}

          <Text style={styles.drawerSection}>Keywords</Text>
          {tags.length === 0 && <Text style={styles.muted}>No keywords yet.</Text>}
          {tags.map((t) => (
            <DrawerRow
              {...row}
              key={t.id}
              label={`# ${t.name}`}
              count={(tagMap[t.name] ?? []).length}
              f={{ kind: 'tag', tag: t.name }}
            />
          ))}

          <Text style={styles.drawerSection}>Storage</Text>
          <Text style={styles.drawerStat}>{gbFromBytes(totalBytes)} GB in ReelVault</Text>
          <Text style={styles.drawerStat}>
            {freeGb !== null ? `${freeGb} GB free on device` : 'Device space unavailable'}
          </Text>
          {freeGb !== null && (
            <Text style={styles.drawerStat}>Safe import batch: up to {safeBatchGb(freeGb)} GB</Text>
          )}
        </ScrollView>

        <View style={styles.drawerFooter}>
          <TouchableOpacity style={styles.drawerAction} onPress={onImport}>
            <Text style={styles.drawerActionText}>+ Import</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.drawerActionGhost} onPress={onClose}>
            <Text style={styles.drawerActionGhostText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------- search */

function SearchSheet({
  value,
  tags,
  onChange,
  onClose,
  onSaveSmart,
}: {
  value: string;
  tags: UiTag[];
  onChange: (v: string) => void;
  onClose: () => void;
  /** Turn the current search into a Smart Filter. */
  onSaveSmart: () => void;
}) {
  const [draft, setDraft] = useState(value);

  function commit(next: string) {
    setDraft(next);
    onChange(next);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <TouchableOpacity style={styles.circleBtnDark} onPress={onClose}>
                <Text style={styles.circleIcon}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>Search</Text>
              <TouchableOpacity style={styles.searchBtn} onPress={onClose}>
                <Text style={styles.searchBtnText}>Search</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.sheetInput}
              placeholder="name, notes or keyword…"
              placeholderTextColor="#5b6472"
              value={draft}
              onChangeText={commit}
              autoCapitalize="none"
              autoFocus
              returnKeyType="search"
              onSubmitEditing={onClose}
            />

            {!!draft.trim() && (
              <TouchableOpacity style={styles.saveSmart} onPress={onSaveSmart}>
                <Text style={styles.saveSmartText}>Save as Smart Filter</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.section}>Keywords</Text>
            <ScrollView contentContainerStyle={styles.tagCloud} keyboardShouldPersistTaps="handled">
              {tags.length === 0 && <Text style={styles.muted}>No keywords yet.</Text>}
              {tags.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.cloudChip}
                  onPress={() => commit(draft ? `${draft} ${t.name}` : t.name)}>
                  <Text style={styles.cloudChipText}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* -------------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  list: { flex: 1 },
  kav: { flex: 1 },

  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 56,
    paddingBottom: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerRight: { flexDirection: 'row', gap: 8 },
  circleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,120,128,0.32)',
  },
  circleBtnDark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,120,128,0.28)',
  },
  circleBtnOn: { backgroundColor: '#0A84FF' },
  circleIcon: { color: '#fff', fontSize: 15, fontWeight: '700' },

  listHeader: { paddingTop: 112, paddingBottom: 8, gap: 6 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  subText: { color: '#8e939b', fontSize: 13 },
  importPill: { backgroundColor: '#0A84FF', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  importPillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  dangerPill: { backgroundColor: '#c0392b', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  statusText: { color: '#8e939b', fontSize: 12, paddingHorizontal: 4 },
  sortRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', paddingHorizontal: 4, paddingTop: 2 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: '#1c1c1e' },
  chipActive: { backgroundColor: '#0A84FF' },
  chipText: { color: '#8e939b', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  grid: { paddingBottom: 110 },
  cell: { backgroundColor: '#141416' },
  thumb: { width: '100%', height: '100%' },
  thumbDimmed: { opacity: 0.55 },
  daysBadge: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  originalBadge: { backgroundColor: '#0A84FF' },
  /** Select mode puts its circle in the bottom-left corner; sit next to it. */
  badgeBesideCheck: { left: 28, bottom: 5 },
  durBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tagBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  tagBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  rateBadge: {
    position: 'absolute',
    top: 3,
    left: 3,
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: '#F5A623',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  check: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#fff',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: '#0A84FF', borderColor: '#0A84FF' },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '800' },
  empty: { color: '#5b6472', fontStyle: 'italic', textAlign: 'center', marginTop: 40 },

  floatingSearch: {
    position: 'absolute',
    right: 18,
    bottom: 28,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,120,128,0.42)',
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
    backgroundColor: 'rgba(120,120,128,0.42)',
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
    backgroundColor: 'rgba(18,18,20,0.96)',
  },
  actionCount: { color: '#fff', fontWeight: '600' },
  actionGroup: { flexDirection: 'row', gap: 8 },
  actionBtn: { backgroundColor: '#c0392b', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
  actionBtnBlue: { backgroundColor: '#0A84FF', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
  actionDisabled: { opacity: 0.4 },
  actionBtnText: { color: '#fff', fontWeight: '700' },

  drawerRoot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  drawerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 300,
    backgroundColor: '#151517',
    paddingTop: 62,
    paddingBottom: 24,
  },
  drawerTitle: { color: '#fff', fontSize: 22, fontWeight: '800', paddingHorizontal: 18, paddingBottom: 12 },
  drawerScroll: { paddingHorizontal: 12, paddingBottom: 24, gap: 2 },
  drawerSection: {
    color: '#8e939b',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 6,
  },
  drawerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  drawerRowOn: { backgroundColor: 'rgba(10,132,255,0.22)' },
  drawerRowText: { flex: 1, paddingRight: 8 },
  drawerHint: { color: '#8e939b', fontSize: 12, marginTop: 2 },
  drawerAdd: { color: '#4aa8ff', fontSize: 15, fontWeight: '600' },
  drawerLabel: { color: '#e7e9ec', fontSize: 15 },
  drawerLabelOn: { color: '#fff', fontWeight: '700' },
  drawerCount: { color: '#8e939b', fontSize: 14 },
  drawerStat: { color: '#8e939b', fontSize: 13, paddingHorizontal: 12, paddingVertical: 3 },
  drawerFooter: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  drawerAction: { flex: 1, backgroundColor: '#0A84FF', padding: 12, borderRadius: 12, alignItems: 'center' },
  drawerActionText: { color: '#fff', fontWeight: '700' },
  drawerActionGhost: {
    flex: 1,
    backgroundColor: '#242427',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  drawerActionGhostText: { color: '#e7e9ec', fontWeight: '700' },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: '#151517',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 12,
    maxHeight: '75%',
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  searchBtn: { backgroundColor: '#0A84FF', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  sheetInput: {
    backgroundColor: '#1f1f22',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#fff',
  },
  section: { color: '#8e939b', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  tagCloud: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 12 },
  cloudChip: {
    borderWidth: 1,
    borderColor: '#0A84FF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cloudChipText: { color: '#4aa8ff', fontSize: 13, fontWeight: '600' },
  saveSmart: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f1f22',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveSmartText: { color: '#4aa8ff', fontWeight: '700', fontSize: 13 },

  muted: { color: '#5b6472', fontStyle: 'italic' },
});
