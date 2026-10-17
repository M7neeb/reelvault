/**
 * Your own lists ("Comfort shows", "Watch with Sam"): the shelf on each Simkl
 * tab, the list itself, the "Add to my lists" sheet and the editor. Lists
 * live in ReelVault (Simkl's custom lists are PRO-only and read-only through
 * the API) and can mix movies, shows and anime.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction } from '@/features/vault/ui/confirm';
import { success, tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import IconButton from '@/features/vault/ui/IconButton';
import { OptionsSheet } from '@/features/vault/ui/prompts';
import { SheetFrame } from '@/features/vault/ui/sheets';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { SIMKL_TYPES } from '../logic';
import Poster from './Poster';
import type { CatalogTitle, ListEntry, SimklActions, SimklList } from './types';

export const LIST_ICONS = ['🍿', '❤️', '⭐', '🔥', '😂', '😱', '🎬', '📺', '🌙', '🧠', '👀', '🎉', '🧸', '🏆'];

/* -------------------------------------------------------------------- shelf */

/** Cover: up to three posters fanned out, or the list's icon. */
function Cover({ list, size }: { list: SimklList; size: number }) {
  const styles = useStyles(makeStyles);
  const w = Math.round(size * 0.62);
  const h = Math.round(w * 1.48);
  if (!list.covers.length) {
    return (
      <View style={[styles.coverEmpty, { width: size, height: h }]}>
        <Text style={{ fontSize: size * 0.32 }}>{list.icon ?? '🍿'}</Text>
      </View>
    );
  }
  return (
    <View style={{ width: size, height: h }}>
      {[...list.covers].reverse().map((c, i, all) => {
        const n = all.length - 1 - i;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: n === 0 ? (size - w) / 2 : n === 1 ? 0 : size - w,
              top: n === 0 ? 0 : 8,
              transform: [{ rotate: n === 0 ? '0deg' : n === 1 ? '-7deg' : '7deg' }, { scale: n === 0 ? 1 : 0.88 }],
            }}>
            <Poster path={c.poster} title={c.title} width={w} height={h} radius={8} style={styles.coverShadow} hideTitle={n > 0} />
          </View>
        );
      })}
    </View>
  );
}

export function ListShelf({
  lists,
  onOpen,
  onNew,
}: {
  lists: SimklList[];
  onOpen: (l: SimklList) => void;
  onNew: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
      {lists.map((l) => (
        <TouchableOpacity key={l.id} style={styles.shelfItem} onPress={() => onOpen(l)} accessibilityLabel={l.name}>
          <Cover list={l} size={118} />
          <Text style={styles.shelfName} numberOfLines={1}>
            {l.icon ? `${l.icon} ` : ''}
            {l.name}
          </Text>
          <Text style={styles.shelfCount}>{l.count === 1 ? '1 title' : `${l.count} titles`}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.shelfItem} onPress={onNew} accessibilityLabel="New list">
        <View style={styles.newCard}>
          <Icon name="plus" size={26} color={p.accent} />
        </View>
        <Text style={styles.shelfName}>New list</Text>
        <Text style={styles.shelfCount}>Mix anything</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------- editor */

export function ListEditor({
  list,
  actions,
  onDone,
  onClose,
}: {
  /** null = a new list. */
  list: SimklList | null;
  actions: SimklActions;
  onDone?: (id: number) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [name, setName] = useState(list?.name ?? '');
  const [icon, setIcon] = useState<string | null>(list?.icon ?? '🍿');
  const ok = name.trim().length > 0;

  async function save() {
    if (!ok) return;
    onClose();
    if (list) await actions.updateList(list.id, name, icon);
    else onDone?.(await actions.createList(name, icon));
    success();
  }

  return (
    <SheetFrame title={list ? 'Edit list' : 'New list'} onClose={onClose} action={{ label: list ? 'Save' : 'Create', onPress: () => void save(), disabled: !ok }}>
      <View style={styles.editorRow}>
        <View style={styles.editorIcon}>
          <Text style={{ fontSize: 30 }}>{icon ?? '🍿'}</Text>
        </View>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Comfort shows, Watch with Sam…"
          placeholderTextColor={p.textMuted}
          autoFocus={!list}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          keyboardAppearance={p.scheme}
        />
      </View>
      <View style={styles.iconGrid}>
        {LIST_ICONS.map((e) => (
          <TouchableOpacity
            key={e}
            style={[styles.iconCell, icon === e && styles.iconCellOn]}
            onPress={() => {
              tick();
              setIcon(e);
            }}>
            <Text style={{ fontSize: 24 }}>{e}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SheetFrame>
  );
}

/* ------------------------------------------------------ add to my lists */

export function AddToListSheet({
  title,
  lists,
  actions,
  onClose,
}: {
  title: CatalogTitle;
  lists: SimklList[];
  actions: SimklActions;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [inList, setInList] = useState(() => new Set(lists.filter((l) => l.ids.includes(title.simklId)).map((l) => l.id)));
  const [creating, setCreating] = useState(false);

  function toggle(l: SimklList) {
    tick();
    const on = !inList.has(l.id);
    const next = new Set(inList);
    if (on) next.add(l.id);
    else next.delete(l.id);
    setInList(next);
    actions.setInList(l.id, title, on).catch(() => setInList(inList));
  }

  return (
    <>
      <SheetFrame title="My lists" onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
        <Text style={styles.sheetHint} numberOfLines={1}>
          {title.title}
        </Text>
        <View style={styles.group}>
          {lists.map((l, i) => {
            const on = inList.has(l.id);
            return (
              <TouchableOpacity key={l.id} style={[styles.groupRow, i > 0 && styles.groupSep]} onPress={() => toggle(l)}>
                <Text style={styles.rowIcon}>{l.icon ?? '🍿'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{l.name}</Text>
                  <Text style={styles.rowSub}>{l.count + (on && !l.ids.includes(title.simklId) ? 1 : !on && l.ids.includes(title.simklId) ? -1 : 0)} titles</Text>
                </View>
                <Icon name={on ? 'checkCircle' : 'circle'} size={24} color={on ? p.accent : p.textMuted} />
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={[styles.groupRow, lists.length > 0 && styles.groupSep]} onPress={() => setCreating(true)}>
            <View style={styles.plusDot}>
              <Icon name="plus" size={16} color="#fff" weight="bold" />
            </View>
            <Text style={[styles.rowTitle, { color: p.accent }]}>New list</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sheetHint}>Lists are kept in ReelVault and can mix movies, shows and anime.</Text>
      </SheetFrame>
      {creating && (
        <ListEditor
          list={null}
          actions={actions}
          onDone={(id) => {
            setInList(new Set([...inList, id]));
            void actions.setInList(id, title, true);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------- the list */

export function ListModal({
  list,
  actions,
  onOpenTitle,
  onClose,
}: {
  list: SimklList;
  actions: SimklActions;
  onOpenTitle: (t: CatalogTitle) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [entries, setEntries] = useState<ListEntry[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'movie' | 'show' | 'anime'>('all');

  useEffect(() => {
    actions
      .listEntries(list.id)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [actions, list.id, list.count]);

  const shown = (entries ?? []).filter((e) => filter === 'all' || e.type === filter);
  const types = new Set((entries ?? []).map((e) => e.type));
  const cols = 3;
  const w = Math.floor((width - 32 - 16) / cols);
  const h = Math.round(w * 1.48);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.listHeader}>
          <IconButton icon="back" label="Back" onPress={onClose} />
          <View style={{ flex: 1 }} />
          <IconButton icon="more" label="List options" onPress={() => setMenu(true)} />
        </View>
        <FlatList
          data={shown}
          numColumns={cols}
          keyExtractor={(e) => `${e.type}-${e.simklId}`}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListHeaderComponent={
            <View style={styles.listTop}>
              <Text style={styles.listIcon}>{list.icon ?? '🍿'}</Text>
              <Text style={styles.listName}>{list.name}</Text>
              <Text style={styles.listCount}>{entries ? `${entries.length} ${entries.length === 1 ? 'title' : 'titles'}` : ' '}</Text>
              {types.size > 1 && (
                <View style={styles.filters}>
                  {(['all', 'movie', 'show', 'anime'] as const)
                    .filter((t) => t === 'all' || types.has(t))
                    .map((t) => (
                      <TouchableOpacity key={t} style={[styles.filter, filter === t && styles.filterOn]} onPress={() => setFilter(t)}>
                        <Text style={[styles.filterText, filter === t && styles.filterTextOn]}>
                          {t === 'all' ? 'All' : SIMKL_TYPES.find((x) => x.key === t)!.plural}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            entries === null ? (
              <ActivityIndicator color={p.textSecondary} style={{ marginTop: 30 }} />
            ) : (
              <Text style={styles.empty}>Nothing here yet. Open any title and tap My lists to add it.</Text>
            )
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: w }} onPress={() => onOpenTitle(item)} accessibilityLabel={item.title}>
              <Poster path={item.poster} title={item.title} width={w} height={h} radius={10} />
              <Text style={styles.gridTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.gridSub}>
                {[item.year, SIMKL_TYPES.find((t) => t.key === item.type)?.label].filter(Boolean).join(' · ')}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>
      {menu && (
        <OptionsSheet
          title={list.name}
          options={[
            { label: 'Rename or change icon', onPress: () => setEditing(true) },
            {
              label: 'Delete list',
              danger: true,
              onPress: () =>
                confirmAction(`Delete "${list.name}"?`, 'Only the list goes. The titles stay in your library.', () => {
                  void actions.deleteList(list.id).then(onClose);
                }, { label: 'Delete', destructive: true }),
            },
          ]}
          onClose={() => setMenu(false)}
        />
      )}
      {editing && <ListEditor list={list} actions={actions} onClose={() => setEditing(false)} />}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    shelf: { gap: 14, paddingHorizontal: 16, paddingVertical: 4 },
    shelfItem: { width: 118 },
    shelfName: { color: p.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
    shelfCount: { color: p.textSecondary, fontSize: 12 },
    coverEmpty: { borderRadius: 14, backgroundColor: p.elevated, alignItems: 'center', justifyContent: 'center' },
    coverShadow: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    newCard: {
      width: 118,
      height: Math.round(118 * 0.62 * 1.48),
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    editorRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    editorIcon: { width: 56, height: 56, borderRadius: 14, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    input: { flex: 1, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: p.text, fontSize: 17 },
    iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    iconCell: { width: 48, height: 48, borderRadius: 12, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    iconCellOn: { borderWidth: 2, borderColor: p.accent },

    sheetHint: { color: p.textSecondary, fontSize: 13 },
    group: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    groupSep: { borderTopWidth: 1, borderTopColor: p.separator },
    rowIcon: { fontSize: 22, width: 28, textAlign: 'center' },
    rowTitle: { color: p.text, fontSize: 16, fontWeight: '600' },
    rowSub: { color: p.textSecondary, fontSize: 12 },
    plusDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },

    screen: { flex: 1, backgroundColor: p.bg },
    listHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 6 },
    listTop: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, gap: 4 },
    listIcon: { fontSize: 52 },
    listName: { color: p.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
    listCount: { color: p.textSecondary, fontSize: 14 },
    filters: { flexDirection: 'row', gap: 8, marginTop: 10 },
    filter: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    filterOn: { backgroundColor: p.accent },
    filterText: { color: p.textSoft, fontWeight: '700', fontSize: 13 },
    filterTextOn: { color: '#fff' },
    gridRow: { gap: 8, paddingHorizontal: 16, marginBottom: 16 },
    gridTitle: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
    gridSub: { color: p.textSecondary, fontSize: 12 },
    empty: { color: p.textSecondary, textAlign: 'center', marginTop: 30, paddingHorizontal: 30, fontSize: 15 },
  });
