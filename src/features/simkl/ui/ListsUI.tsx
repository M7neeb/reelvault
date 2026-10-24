/**
 * Your own lists ("Comfort shows", "Watch with Sam"): the shelf on each Simkl
 * tab, the list itself, the "Add to my lists" sheet and the editor. Lists
 * live in ReelVault (Simkl's custom lists are PRO-only and read-only through
 * the API) and can mix movies, shows and anime. "Add many" ticks titles from
 * your library (or pastes a whole list of names) at once; each title can be looked up on Google, and the list keeps
 * which ones you have searched.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Linking, ScrollView, Share, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from '@/features/vault/ui/screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction } from '@/features/vault/ui/confirm';
import { success, tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import IconButton from '@/features/vault/ui/IconButton';
import { OptionsSheet } from '@/features/vault/ui/prompts';
import { SheetFrame } from '@/features/vault/ui/sheets';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { googleUrl, parseTitleLines, pickMatch } from '../bulkAdd';
import { SIMKL_TYPES, STATUS_LABELS, statusesFor, type SimklItem, type SimklStatus } from '../logic';
import Poster from './Poster';
import type { CatalogTitle, ListEntry, SimklActions, SimklList, SimklType } from './types';

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
        {/* Inside the sheet: iOS shows nothing presented beside an open sheet. */}
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
      </SheetFrame>
    </>
  );
}

/* --------------------------------------------------------------- add many */

type AddManyResult = { added: number; already: number; notFound: string[] };

const asTitle = (i: SimklItem): CatalogTitle => ({ simklId: i.simklId, type: i.type, title: i.title, year: i.year, poster: i.poster, slug: i.slug, imdbRating: i.imdbRating, simklRating: i.simklRating, rank: i.rank });

/** Tick titles from your library: no typing. */
function PickFromMine({
  library,
  type,
  inList,
  picked,
  onPicked,
}: {
  library: SimklItem[];
  type: SimklType;
  inList: Set<number>;
  picked: Set<number>;
  onPicked: (next: Set<number>) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [status, setStatus] = useState<SimklStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const ofType = library.filter((i) => i.type === type);
  const statuses = statusesFor(type).filter((s) => ofType.some((i) => i.status === s));
  const q = query.trim().toLowerCase();
  const shown = ofType
    .filter((i) => (status === 'all' || i.status === status) && (!q || i.title.toLowerCase().includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  const free = shown.filter((i) => !inList.has(i.simklId));
  const allOn = free.length > 0 && free.every((i) => picked.has(i.simklId));
  const cols = 4;
  const w = Math.floor((Math.min(width, 700) - 32 - 8 * (cols - 1)) / cols);
  const h = Math.round(w * 1.48);

  function toggle(id: number) {
    tick();
    const n = new Set(picked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onPicked(n);
  }

  if (!ofType.length) return <Text style={styles.sheetHint}>No {SIMKL_TYPES.find((t) => t.key === type)?.plural.toLowerCase()} in your library yet. Use Type names instead.</Text>;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersLeft}>
        {(['all', ...statuses] as const).map((s) => (
          <TouchableOpacity key={s} style={[styles.filter, status === s && styles.filterOn]} onPress={() => setStatus(s)}>
            <Text style={[styles.filterText, status === s && styles.filterTextOn]}>
              {s === 'all' ? `All · ${ofType.length}` : `${STATUS_LABELS[s]} · ${ofType.filter((i) => i.status === s).length}`}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.pickTools}>
        <TextInput
          style={styles.pickSearch}
          value={query}
          onChangeText={setQuery}
          placeholder="Filter (optional)"
          placeholderTextColor={p.textMuted}
          keyboardAppearance={p.scheme}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {free.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              tick();
              const n = new Set(picked);
              for (const i of free) {
                if (allOn) n.delete(i.simklId);
                else n.add(i.simklId);
              }
              onPicked(n);
            }}
            hitSlop={8}>
            <Text style={styles.link}>{allOn ? 'None' : `All ${free.length}`}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.pickGrid}>
        {shown.map((i) => {
          const already = inList.has(i.simklId);
          const on = picked.has(i.simklId);
          return (
            <TouchableOpacity key={i.simklId} style={{ width: w }} disabled={already} onPress={() => toggle(i.simklId)} accessibilityLabel={`${i.title}${already ? ', already in the list' : on ? ', selected' : ''}`}>
              <View style={already ? { opacity: 0.35 } : !on && picked.size ? { opacity: 0.7 } : undefined}>
                <Poster path={i.poster} title={i.title} width={w} height={h} radius={8} />
              </View>
              {!already && (
                <View style={[styles.pickMark, on && styles.pickMarkOn]} pointerEvents="none">
                  {on && <Icon name="check" size={11} color="#fff" weight="bold" />}
                </View>
              )}
              <Text style={styles.pickTitle} numberOfLines={1}>
                {already ? 'In the list' : i.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {!shown.length && <Text style={styles.sheetHint}>Nothing matches.</Text>}
    </>
  );
}

/**
 * Paste a list of names (one per line): each one is searched on Simkl and the
 * best match added to the list. Names with no clear match are listed after.
 */
export function AddManySheet({
  list,
  initialType,
  actions,
  library = [],
  onClose,
}: {
  list: SimklList;
  initialType: SimklType;
  actions: SimklActions;
  /** Your titles, to tick instead of typing names. */
  library?: SimklItem[];
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [type, setType] = useState<SimklType>(initialType);
  const [mode, setMode] = useState<'pick' | 'type'>(library.length ? 'pick' : 'type');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const inList = new Set(list.ids);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [result, setResult] = useState<AddManyResult | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );
  const wanted = parseTitleLines(text);

  async function run() {
    if (!wanted.length || progress) return;
    const found: CatalogTitle[] = [];
    const notFound: string[] = [];
    for (const [i, w] of wanted.entries()) {
      if (!alive.current) return;
      setProgress({ done: i, total: wanted.length, name: w.name });
      try {
        const match = pickMatch(w, await actions.search(type, w.name));
        if (match && !found.some((f) => f.simklId === match.simklId)) found.push(match);
        else if (!match) notFound.push(w.line || w.name);
      } catch {
        notFound.push(w.line || w.name);
      }
      // Gentle on Simkl: a few searches a second.
      await new Promise((res) => setTimeout(res, 250));
    }
    const added = await actions.addManyToList(list.id, found).catch(() => 0);
    if (!alive.current) return;
    success();
    setProgress(null);
    setResult({ added, already: found.length - added, notFound });
  }

  async function addPicked() {
    if (!picked.size || progress) return;
    const titles = library.filter((i) => picked.has(i.simklId)).map(asTitle);
    setProgress({ done: 0, total: titles.length, name: '' });
    const added = await actions.addManyToList(list.id, titles).catch(() => 0);
    if (!alive.current) return;
    success();
    setProgress(null);
    setResult({ added, already: titles.length - added, notFound: [] });
  }

  return (
    <SheetFrame
      title="Add many"
      onClose={onClose}
      action={
        result
          ? { label: 'Done', onPress: onClose }
          : mode === 'pick'
            ? { label: progress ? 'Adding…' : picked.size ? `Add ${picked.size}` : 'Add', onPress: () => void addPicked(), disabled: !picked.size || !!progress }
            : { label: progress ? 'Adding…' : 'Add', onPress: () => void run(), disabled: !wanted.length || !!progress }
      }>
      {result ? (
        <>
          <View style={styles.resultBig}>
            <Text style={styles.resultNum}>{result.added}</Text>
            <Text style={styles.sheetHint}>
              added to {list.name}
              {result.already ? ` · ${result.already} already in it` : ''}
            </Text>
          </View>
          {result.notFound.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>NOT FOUND ON SIMKL ({result.notFound.length})</Text>
              <View style={styles.group}>
                {result.notFound.map((n, i) => (
                  <Text key={`${n}-${i}`} style={[styles.notFound, i > 0 && styles.groupSep]} numberOfLines={2}>
                    {n}
                  </Text>
                ))}
              </View>
              <Text style={styles.sheetHint}>Check the spelling, or try another kind (anime, show or movie), then add them again.</Text>
              <View style={styles.rowActions}>
                <TouchableOpacity
                  onPress={() => {
                    setText(result.notFound.join('\n'));
                    setResult(null);
                  }}
                  hitSlop={8}>
                  <Text style={styles.link}>Try these again</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void Share.share({ message: result.notFound.join('\n') }).catch(() => undefined)} hitSlop={8}>
                  <Text style={styles.link}>Share the list</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </>
      ) : (
        <>
          {library.length > 0 && (
            <View style={styles.modeRow}>
              {(
                [
                  ['pick', 'Pick from mine'],
                  ['type', 'Type names'],
                ] as const
              ).map(([k, label]) => (
                <TouchableOpacity key={k} style={[styles.modeBtn, mode === k && styles.modeBtnOn]} onPress={() => setMode(k)} disabled={!!progress}>
                  <Text style={[styles.modeText, mode === k && styles.modeTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.filtersLeft}>
            {SIMKL_TYPES.map((t) => (
              <TouchableOpacity key={t.key} style={[styles.filter, type === t.key && styles.filterOn]} onPress={() => setType(t.key)} disabled={!!progress}>
                <Text style={[styles.filterText, type === t.key && styles.filterTextOn]}>{t.plural}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {mode === 'pick' ? (
            <>
              <Text style={styles.sheetHint}>Tap the titles to add. {picked.size ? `${picked.size} selected.` : 'You can pick from all three kinds before adding.'}</Text>
              <PickFromMine library={library} type={type} inList={inList} picked={picked} onPicked={setPicked} />
            </>
          ) : (
            <>
          <Text style={styles.sheetHint}>Paste or type names, one per line (numbers, bullets and years like "(2019)" are fine). Each one is looked up on Simkl and added.</Text>
          <TextInput
            style={styles.bigInput}
            value={text}
            onChangeText={setText}
            multiline
            editable={!progress}
            placeholder={type === 'anime' ? 'Naruto\nOne Piece\nSteins;Gate' : type === 'show' ? 'Breaking Bad\nDark\nThe Office' : 'Dune\nInception (2010)\nSpirited Away'}
            placeholderTextColor={p.textMuted}
            keyboardAppearance={p.scheme}
            autoCorrect={false}
          />
          {progress ? (
            <View style={styles.progressRow}>
              <ActivityIndicator color={p.accent} />
              <Text style={styles.sheetHint} numberOfLines={1}>
                Finding {progress.done + 1} of {progress.total}: {progress.name}
              </Text>
            </View>
          ) : (
            <Text style={styles.sheetHint}>{wanted.length ? `${wanted.length} ${wanted.length === 1 ? 'title' : 'titles'}` : ' '}</Text>
          )}
            </>
          )}
        </>
      )}
    </SheetFrame>
  );
}

/* --------------------------------------------------------------- the list */

type Searched = 'all' | 'todo' | 'done';

export function ListModal({
  list,
  type,
  actions,
  onOpenTitle,
  onClose,
  initialAdding = false,
  library,
  children,
}: {
  list: SimklList;
  /** Your titles, for ticking in "Add many". */
  library?: SimklItem[];
  /** Open "Add many" straight away (the browser preview). */
  initialAdding?: boolean;
  /** The tab it was opened from (the kind "Add many" starts with). */
  type: SimklType;
  actions: SimklActions;
  onOpenTitle: (t: CatalogTitle) => void;
  onClose: () => void;
  /** Shown over the list (a title's page): iOS shows nothing presented beside an open page. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [entries, setEntries] = useState<ListEntry[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(initialAdding);
  const [filter, setFilter] = useState<'all' | 'movie' | 'show' | 'anime'>('all');
  const [searched, setSearchedFilter] = useState<Searched>('all');

  useEffect(() => {
    actions
      .listEntries(list.id)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [actions, list.id, list.count]);

  function markSearched(e: ListEntry, on: boolean) {
    setEntries((all) => (all ?? []).map((x) => (x.simklId === e.simklId ? { ...x, searchedAt: on ? new Date().toISOString() : null } : x)));
    actions.setSearched(list.id, e.simklId, on).catch(() => undefined);
  }
  function google(e: ListEntry) {
    tick();
    markSearched(e, true);
    void Linking.openURL(googleUrl(e)).catch(() => undefined);
  }

  const ofKind = (entries ?? []).filter((e) => filter === 'all' || e.type === filter);
  const doneCount = ofKind.filter((e) => e.searchedAt).length;
  const shown = ofKind.filter((e) => searched === 'all' || (searched === 'done' ? !!e.searchedAt : !e.searchedAt));
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
          <IconButton icon="plus" label="Add many" onPress={() => setAdding(true)} />
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
              <Text style={styles.listCount}>
                {entries ? `${entries.length} ${entries.length === 1 ? 'title' : 'titles'}${ofKind.length ? ` · ${doneCount} searched` : ''}` : ' '}
              </Text>
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
              {ofKind.length > 0 && (
                <View style={styles.filters}>
                  {(
                    [
                      ['all', 'Everything'],
                      ['todo', `Not searched · ${ofKind.length - doneCount}`],
                      ['done', `Searched · ${doneCount}`],
                    ] as const
                  ).map(([k, label]) => (
                    <TouchableOpacity key={k} style={[styles.filter, searched === k && styles.filterOn]} onPress={() => setSearchedFilter(k)}>
                      <Text style={[styles.filterText, searched === k && styles.filterTextOn]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            entries === null ? (
              <ActivityIndicator color={p.textSecondary} style={{ marginTop: 30 }} />
            ) : entries.length ? (
              <Text style={styles.empty}>{searched === 'todo' ? 'You have searched every one of these.' : 'Nothing here.'}</Text>
            ) : (
              <View style={{ alignItems: 'center', gap: 14 }}>
                <Text style={styles.empty}>Nothing here yet. Tap Add many to tick titles from your library, or open any title and tap My lists.</Text>
                <TouchableOpacity style={styles.addMany} onPress={() => setAdding(true)}>
                  <Icon name="plus" size={16} color="#fff" weight="bold" />
                  <Text style={styles.addManyText}>Add many</Text>
                </TouchableOpacity>
              </View>
            )
          }
          renderItem={({ item }) => (
            <View style={{ width: w }}>
              <TouchableOpacity onPress={() => onOpenTitle(item)} accessibilityLabel={item.title}>
                <Poster path={item.poster} title={item.title} width={w} height={h} radius={10} />
                {item.searchedAt && (
                  <View style={styles.searchedBadge}>
                    <Icon name="check" size={12} color="#fff" weight="bold" />
                  </View>
                )}
                <Text style={styles.gridTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.gridSub}>
                  {[item.year, SIMKL_TYPES.find((t) => t.key === item.type)?.label].filter(Boolean).join(' · ')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.googleBtn, item.searchedAt && styles.googleBtnDone]}
                onPress={() => google(item)}
                onLongPress={() => {
                  tick();
                  markSearched(item, !item.searchedAt);
                }}
                accessibilityLabel={item.searchedAt ? `Searched. Search ${item.title} on Google again` : `Search ${item.title} on Google`}>
                <Text style={[styles.googleText, item.searchedAt && styles.googleTextDone]}>{item.searchedAt ? '✓ Searched' : 'Google'}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      </View>
      {menu && (
        <OptionsSheet
          title={list.name}
          options={[
            { label: 'Add many titles', onPress: () => setAdding(true) },
            { label: 'Rename or change icon', onPress: () => setEditing(true) },
            {
              label: 'Mark all as not searched',
              onPress: () =>
                confirmAction('Start the searches over?', 'Every title in the list goes back to Not searched.', () => {
                  for (const e of entries ?? []) if (e.searchedAt) markSearched(e, false);
                }),
            },
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
      {adding && <AddManySheet list={list} initialType={type} actions={actions} library={library} onClose={() => setAdding(false)} />}
      {children}
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

    searchedBadge: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: p.success, alignItems: 'center', justifyContent: 'center' },
    googleBtn: { marginTop: 6, borderRadius: 999, paddingVertical: 6, alignItems: 'center', backgroundColor: p.elevated },
    googleBtnDone: { backgroundColor: `${p.success}26` },
    googleText: { color: p.link, fontSize: 12, fontWeight: '800' },
    googleTextDone: { color: p.success },
    addMany: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
    addManyText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    filtersLeft: { flexDirection: 'row', gap: 8 },
    bigInput: { minHeight: 180, maxHeight: 320, backgroundColor: p.card, borderRadius: 12, padding: 14, paddingTop: 12, color: p.text, fontSize: 16, textAlignVertical: 'top' },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    resultBig: { alignItems: 'center', paddingVertical: 6 },
    resultNum: { color: p.text, fontSize: 48, fontWeight: '900', letterSpacing: -1 },
    sectionLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
    notFound: { color: p.text, fontSize: 15, paddingHorizontal: 14, paddingVertical: 10 },
    rowActions: { flexDirection: 'row', gap: 20 },
    link: { color: p.link, fontWeight: '700', fontSize: 15 },
    modeRow: { flexDirection: 'row', backgroundColor: p.card, borderRadius: 12, padding: 3 },
    modeBtn: { flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
    modeBtnOn: { backgroundColor: p.elevated },
    modeText: { color: p.textSecondary, fontWeight: '700', fontSize: 14 },
    modeTextOn: { color: p.text },
    pickTools: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    pickSearch: { flex: 1, backgroundColor: p.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: p.text, fontSize: 15 },
    pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pickTitle: { color: p.textSoft, fontSize: 11, fontWeight: '600', marginTop: 4 },
    pickMark: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    pickMarkOn: { backgroundColor: p.accent, borderColor: p.accent },
  });
