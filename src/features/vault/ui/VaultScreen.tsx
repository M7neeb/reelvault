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

import { fmtDateTime, fmtDuration, fmtSize, gbFromBytes } from './format';
import { SORTS, type ThumbSource, type UiTag, type VaultItem, type VaultScreenProps, type VaultSort } from './types';

const COLUMN_OPTIONS = [3, 4, 5];
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
  | { kind: 'tag'; tag: string };

function filterLabel(f: Filter): string {
  switch (f.kind) {
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
  }
}

/** Alert.alert does not exist on web, so route the confirm through whatever fits. */
function confirmDestructive(title: string, message: string | undefined, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // eslint-disable-next-line no-alert
    if (typeof window === 'undefined' || window.confirm(text)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function VaultScreen({
  items,
  allTags,
  tagMap,
  freeGb,
  busy,
  status,
  sort,
  onSortChange,
  actions,
  enableVideo = true,
  devInitialState,
}: VaultScreenProps) {
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VaultItem[] | null>(null);
  const [cols, setCols] = useState(3);
  const [selectMode, setSelectMode] = useState(devInitialState?.selectMode ?? false);
  const [selected, setSelected] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(devInitialState?.searchOpen ?? false);
  const [sidebarOpen, setSidebarOpen] = useState(devInitialState?.sidebarOpen ?? false);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
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

  const base = results ?? items;
  const shown = useMemo(() => {
    switch (filter.kind) {
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
      default:
        return base;
    }
  }, [base, filter, tagMap]);

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected([]);
  }

  function confirmBatchDelete() {
    const victims = items.filter((v) => selected.includes(v.id));
    if (!victims.length) return;
    confirmDestructive(
      `Delete ${victims.length} video${victims.length === 1 ? '' : 's'}?`,
      undefined,
      () => {
        actions
          .onDeleteMany(victims)
          .then(exitSelect)
          .catch((e) => console.log(`[DELETE] batch failed: ${String(e)}`));
      }
    );
  }

  const title = results ? 'Search' : filterLabel(filter);

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
                {shown.length} video{shown.length === 1 ? '' : 's'}
                {freeGb !== null ? ` · ${freeGb} GB free` : ''}
              </Text>
              <TouchableOpacity style={styles.importPill} onPress={actions.onImport} disabled={busy}>
                <Text style={styles.importPillText}>{busy ? '…' : '+ Import'}</Text>
              </TouchableOpacity>
            </View>
            {!!status && <Text style={styles.statusText}>{status}</Text>}
            {!results && (
              <View style={styles.sortRow}>
                {SORTS.map((s) => (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.chip, sort === s.key && styles.chipActive]}
                    onPress={() => onSortChange(s.key)}>
                    <Text style={[styles.chipText, sort === s.key && styles.chipTextActive]}>
                      {s.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>{results ? 'No matches.' : 'Nothing here yet.'}</Text>
        }
        renderItem={({ item }) => {
          const dur = fmtDuration(item.durationMs);
          const isSel = selected.includes(item.id);
          return (
            <TouchableOpacity
              style={[styles.cell, { width: tileSize, height: tileSize }]}
              activeOpacity={0.8}
              onPress={() => {
                if (selectMode) toggleSelect(item.id);
                else {
                  console.log(`[VAULT] open ${item.filename}`);
                  setPlaying(item);
                }
              }}>
              <Image source={item.thumbSource} style={styles.thumb} contentFit="cover" />
              {dur && <Text style={styles.durBadge}>{dur}</Text>}
              {item.tagCount > 0 && (
                <View style={styles.tagBadge}>
                  <Text style={styles.tagBadgeText}>#</Text>
                </View>
              )}
              {item.rating > 0 && <Text style={styles.rateBadge}>{item.rating}/10</Text>}
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
          onPress={() => {
            const i = COLUMN_OPTIONS.indexOf(cols);
            setCols(COLUMN_OPTIONS[(i + 1) % COLUMN_OPTIONS.length]);
          }}>
          <Text style={styles.circleIcon}>{cols === 3 ? '▦' : cols === 4 ? '▩' : '▪'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.circleBtn} onPress={() => setSidebarOpen(true)}>
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
          <TouchableOpacity
            style={[styles.actionBtn, !selected.length && styles.actionDisabled]}
            disabled={!selected.length}
            onPress={confirmBatchDelete}>
            <Text style={styles.actionBtnText}>Delete</Text>
          </TouchableOpacity>
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
        />
      )}

      {sidebarOpen && (
        <Sidebar
          items={items}
          tags={allTags}
          tagMap={tagMap}
          freeGb={freeGb}
          filter={filter}
          onPick={(f) => {
            setFilter(f);
            setSidebarOpen(false);
          }}
          onClose={() => setSidebarOpen(false)}
          onImport={actions.onImport}
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

function Sidebar({
  items,
  tags,
  tagMap,
  freeGb,
  filter,
  onPick,
  onClose,
  onImport,
}: {
  items: VaultItem[];
  tags: UiTag[];
  tagMap: Record<string, string[]>;
  freeGb: number | null;
  filter: Filter;
  onPick: (f: Filter) => void;
  onClose: () => void;
  onImport: () => void;
}) {
  const favorites = items.filter((v) => v.rating >= 8).length;
  const rated = items.filter((v) => v.rating > 0).length;
  const untagged = items.filter((v) => v.tagCount === 0).length;
  const totalBytes = items.reduce((sum, v) => sum + v.sizeBytes, 0);

  function Row({ label, count, f }: { label: string; count: number; f: Filter }) {
    const active = JSON.stringify(f) === JSON.stringify(filter);
    return (
      <TouchableOpacity
        style={[styles.drawerRow, active && styles.drawerRowOn]}
        onPress={() => onPick(f)}>
        <Text style={[styles.drawerLabel, active && styles.drawerLabelOn]}>{label}</Text>
        <Text style={styles.drawerCount}>{count}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.drawerRoot}>
      <TouchableOpacity style={styles.drawerBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.drawer}>
        <Text style={styles.drawerTitle}>ReelVault</Text>
        <ScrollView contentContainerStyle={styles.drawerScroll}>
          <Text style={styles.drawerSection}>Library</Text>
          <Row label="All Videos" count={items.length} f={{ kind: 'all' }} />
          <Row label="★ Favorites" count={favorites} f={{ kind: 'favorites' }} />
          <Row label="Rated" count={rated} f={{ kind: 'rated' }} />
          <Row label="Untagged" count={untagged} f={{ kind: 'untagged' }} />

          <Text style={styles.drawerSection}>Keywords</Text>
          {tags.length === 0 && <Text style={styles.muted}>No keywords yet.</Text>}
          {tags.map((t) => (
            <Row
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
}: {
  value: string;
  tags: UiTag[];
  onChange: (v: string) => void;
  onClose: () => void;
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
  statusText: { color: '#8e939b', fontSize: 12, paddingHorizontal: 4 },
  sortRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', paddingHorizontal: 4, paddingTop: 2 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: '#1c1c1e' },
  chipActive: { backgroundColor: '#0A84FF' },
  chipText: { color: '#8e939b', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  grid: { paddingBottom: 110 },
  cell: { backgroundColor: '#141416' },
  thumb: { width: '100%', height: '100%' },
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
  actionBtn: { backgroundColor: '#c0392b', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
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

  muted: { color: '#5b6472', fontStyle: 'italic' },
});
