/**
 * The Books shelf: the book you are reading at the top, ready to carry on,
 * then everything else, with search, a row of chips (status and your
 * keywords) and a choice of order. Tap a book to read it, hold it for its
 * menu. Select several to rate, set a status, add a keyword, make Private
 * or delete. Recently Deleted keeps books for the days set in Settings.
 * Books are .epub files kept on the phone, so they read with no connection.
 * Presentational only (see the note at the top of types.ts).
 */

import { useMemo, useState } from 'react';
import { Alert, FlatList, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BOOK_SORTS,
  BOOK_STATUSES,
  daysLeft,
  displayTitle,
  fmtLeft,
  fmtProgress,
  isStarted,
  matchesBook,
  minutesLeft,
  progressOf,
  shelfTags,
  sortBooks,
  statusOf,
  type BookFilter,
  type BookSort,
} from '../../books/bookLogic';
import { useTabBarSpace } from '../chrome';
import { tick } from '../haptics';
import Icon from '../Icon';
import IconButton from '../IconButton';
import { ModeSwitch, type VideosMode } from '../overviewParts';
import { OptionsSheet, PromptSheet, type OptionItem } from '../prompts';
import RatingPicker from '../RatingPicker';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { BookActions, BookUi } from './bookTypes';

const SIDE = 16;
const failed = (e: unknown) => Alert.alert('That did not work', String(e).replace(/^Error:\s*/, ''));

/** The book's own cover, or a plain one with its title set in type. */
export function BookCover({ book, width, radius = 4 }: { book: Pick<BookUi, 'coverUri' | 'title' | 'filename' | 'author'>; width: number; radius?: number }) {
  const styles = useStyles(makeStyles);
  const height = Math.round(width * 1.5);
  if (book.coverUri)
    return (
      <View style={[styles.cover, { width, height, borderRadius: radius }]}>
        <Image source={{ uri: book.coverUri }} style={{ width, height }} contentFit="cover" transition={120} recyclingKey={book.coverUri} />
      </View>
    );
  // Too narrow to set a title without breaking words: the first letter stands in.
  if (width < 80)
    return (
      <View style={[styles.cover, styles.plainCover, styles.plainSmall, { width, height, borderRadius: radius }]}>
        <Text style={[styles.plainInitial, { fontSize: Math.round(width * 0.46) }]}>{displayTitle(book).replace(/^(the|a|an)\s+/i, '').charAt(0).toUpperCase()}</Text>
      </View>
    );
  return (
    <View style={[styles.cover, styles.plainCover, { width, height, borderRadius: radius, padding: Math.max(6, width * 0.1) }]}>
      <Text style={[styles.plainTitle, { fontSize: Math.max(9, width * 0.13), lineHeight: Math.max(11, width * 0.16) }]} numberOfLines={5}>
        {displayTitle(book)}
      </Text>
      {width >= 80 && !!book.author && (
        <Text style={[styles.plainAuthor, { fontSize: Math.max(8, width * 0.085) }]} numberOfLines={2}>
          {book.author}
        </Text>
      )}
    </View>
  );
}

type Menu = 'more' | 'sort' | 'status' | 'tag' | 'rate' | 'newTag' | null;

export default function BooksScreen({
  items,
  deleted,
  trashDays,
  loaded,
  status,
  busy,
  actions,
  showPrivate,
  onUnlockPrivate,
  sort,
  onSort,
  onOpen,
  onInfo,
  onMode,
  onDashboard,
  initialDeleted = false,
}: {
  items: BookUi[];
  deleted: BookUi[];
  trashDays: number;
  loaded: boolean;
  status: string;
  busy: boolean;
  actions: BookActions;
  showPrivate: boolean;
  onUnlockPrivate?: () => void;
  sort: BookSort;
  onSort: (s: BookSort) => void;
  onOpen: (b: BookUi) => void;
  onInfo: (b: BookUi) => void;
  onMode: (m: VideosMode) => void;
  onDashboard: () => void;
  initialDeleted?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const [menuFor, setMenuFor] = useState<BookUi | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [filter, setFilter] = useState<BookFilter>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [inDeleted, setInDeleted] = useState(initialDeleted);
  // Who the rating, status and keyword sheets act on: the selection, or the one book held.
  const [target, setTarget] = useState<string[]>([]);

  const visible = useMemo(() => items.filter((b) => showPrivate || !b.isPrivate), [items, showPrivate]);
  const privateCount = items.filter((b) => b.isPrivate).length;
  const tags = useMemo(() => shelfTags(visible), [visible]);
  const shown = useMemo(() => {
    const base = inDeleted ? deleted.filter((b) => showPrivate || !b.isPrivate) : visible;
    return sortBooks(
      base.filter((b) => inDeleted || matchesBook(b, filter, query)),
      inDeleted ? 'added' : sort
    );
  }, [inDeleted, deleted, visible, filter, query, sort, showPrivate]);
  const plain = !inDeleted && !filter && !query.trim() && sort === 'shelf' && !selected;
  const current = plain ? (shown.find((b) => isStarted(b) && !b.finishedAt && statusOf(b) === 'reading') ?? null) : null;
  const rest = current ? shown.filter((b) => b.id !== current.id) : shown;

  const ids = selected ? [...selected] : [];
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s ?? []);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const act = (ts: string[], m: Menu) => {
    setTarget(ts);
    setMenu(m);
  };
  const done = () => setSelected(null);

  const add = () => actions.importFiles().catch(failed);
  const chips: { key: string; label: string; count: number; filter: BookFilter }[] = [
    { key: 'all', label: 'All', count: visible.length, filter: null },
    ...BOOK_STATUSES.map((s) => ({ key: s.key, label: s.label, count: visible.filter((b) => statusOf(b) === s.key).length, filter: { status: s.key } as BookFilter })).filter((c) => c.count > 0),
    ...tags.map((t) => ({ key: `#${t.name}`, label: `#${t.name}`, count: t.count, filter: { tag: t.name } as BookFilter })),
  ];
  const chipOn = (f: BookFilter) => JSON.stringify(f) === JSON.stringify(filter);

  const moreOptions: OptionItem[] = [
    { label: 'Sort', hint: BOOK_SORTS.find((s) => s.key === sort)?.label, onPress: () => setTimeout(() => setMenu('sort'), 250) },
    ...(visible.length ? [{ label: 'Select', onPress: () => setSelected(new Set()) }] : []),
    { label: inDeleted ? 'Back to the shelf' : `Recently Deleted${deleted.length ? ` · ${deleted.length}` : ''}`, onPress: () => setInDeleted((x) => !x) },
    ...(privateCount > 0 && !showPrivate && onUnlockPrivate ? [{ label: `Show Private · ${privateCount}`, onPress: onUnlockPrivate }] : []),
    ...(visible.length ? [{ label: 'Reading stats and Wrapped', onPress: onDashboard }] : []),
  ];

  const header = (
    <View style={{ paddingTop: insets.top + 8 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{inDeleted ? 'Recently Deleted' : selected ? `${ids.length} selected` : 'Books'}</Text>
        <View style={styles.buttons}>
          {selected ? (
            <>
              <TouchableOpacity style={styles.pill} onPress={() => setSelected(ids.length === shown.length ? new Set() : new Set(shown.map((b) => b.id)))}>
                <Text style={styles.pillText}>{ids.length === shown.length && shown.length ? 'None' : 'All'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pill} onPress={done}>
                <Text style={styles.pillText}>Done</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {!inDeleted && <IconButton icon="plus" label="Add a book" onPress={add} />}
              {!inDeleted && visible.length > 0 && <IconButton icon="stats" label="Reading stats and Wrapped" onPress={onDashboard} />}
              <IconButton icon="more" label="More" onPress={() => setMenu('more')} />
            </>
          )}
        </View>
      </View>
      {!inDeleted && !selected && (
        <View style={styles.modeRow}>
          <ModeSwitch mode="books" onChange={onMode} />
        </View>
      )}
      {!!status && (
        <Animated.Text entering={FadeIn} exiting={FadeOut} style={styles.status} numberOfLines={3}>
          {status}
        </Animated.Text>
      )}
      {inDeleted && <Text style={styles.status}>Books here are removed for good after {trashDays} {trashDays === 1 ? 'day' : 'days'}. Tap one to restore it.</Text>}

      {!inDeleted && visible.length > 1 && (
        <View style={styles.search}>
          <Icon name="search" size={15} color={p.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Title, author, notes, keyword"
            placeholderTextColor={p.textMuted}
            style={styles.searchInput}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>
      )}

      {!inDeleted && chips.length > 2 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chips.map((c) => {
            const on = chipOn(c.filter);
            return (
              <TouchableOpacity key={c.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setFilter(on && c.filter ? null : c.filter)}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                <Text style={[styles.chipCount, on && styles.chipTextOn]}>{c.count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {current && (
        <TouchableOpacity style={styles.current} activeOpacity={0.8} onPress={() => onOpen(current)} onLongPress={() => setMenuFor(current)} accessibilityLabel={`Carry on reading ${displayTitle(current)}`}>
          <BookCover book={current} width={104} />
          <View style={styles.currentText}>
            <Text style={styles.currentLabel}>Reading now</Text>
            <Text style={styles.currentTitle} numberOfLines={3}>
              {displayTitle(current)}
            </Text>
            {!!current.author && (
              <Text style={styles.author} numberOfLines={1}>
                {current.author}
              </Text>
            )}
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(progressOf(current) * 100)}%` }]} />
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {fmtProgress(progressOf(current), true)}
              {(() => {
                const m = minutesLeft(current);
                return m !== null ? ` · ${fmtLeft(m)}` : '';
              })()}
            </Text>
            <View style={styles.carryOn}>
              <Text style={styles.carryOnText}>Carry on</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {!inDeleted && rest.length > 0 && (
        <TouchableOpacity style={styles.sectionRow} onPress={() => setMenu('sort')} accessibilityLabel="Change the order">
          <Text style={styles.section}>{current ? 'On your shelf' : filter || query.trim() ? `${rest.length} ${rest.length === 1 ? 'book' : 'books'}` : 'Your shelf'}</Text>
          <Text style={styles.sortText}>{BOOK_SORTS.find((s) => s.key === sort)?.label}</Text>
          <Icon name="sort" size={12} color={p.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );

  const empty = !loaded ? null : inDeleted ? (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>Nothing in Recently Deleted.</Text>
    </View>
  ) : visible.length && (filter || query.trim()) ? (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>No book matches that.</Text>
    </View>
  ) : current ? null : (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No books yet</Text>
      <Text style={styles.emptyText}>
        Add an .epub from Files, or open one in ReelVault from Safari, Mail or a chat. Books stay on this phone, so they read without a connection.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={add} disabled={busy}>
        <Text style={styles.emptyBtnText}>Add a book</Text>
      </TouchableOpacity>
    </View>
  );

  const held = menuFor;
  return (
    <View style={styles.screen}>
      <FlatList
        data={rest}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: tabSpace + (selected ? 90 : 24) }}
        keyboardDismissMode="on-drag"
        renderItem={({ item: b }) => {
          const pr = progressOf(b);
          const on = selected?.has(b.id) ?? false;
          const st = statusOf(b);
          const line = inDeleted
            ? `${daysLeft(b.deletedAt ?? Date.now(), trashDays, Date.now())} days left`
            : st === 'dropped'
              ? 'Dropped'
              : st === 'want' && !isStarted(b)
                ? 'Want to read'
                : fmtProgress(pr, isStarted(b));
          return (
            <TouchableOpacity
              style={[styles.row, on && styles.rowSel]}
              onPress={() => (selected ? toggle(b.id) : inDeleted ? setMenuFor(b) : onOpen(b))}
              onLongPress={() => {
                tick();
                if (selected) toggle(b.id);
                else setMenuFor(b);
              }}
              accessibilityLabel={`${displayTitle(b)}${b.author ? ` by ${b.author}` : ''}, ${line}`}>
              {selected && (
                <View style={[styles.check, on && styles.checkOn]}>{on && <Icon name="check" size={12} color="#fff" />}</View>
              )}
              <BookCover book={b} width={52} radius={3} />
              <View style={styles.rowText}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {displayTitle(b)}
                  </Text>
                  {b.isPrivate && <Icon name="lock" size={12} color={p.textMuted} />}
                </View>
                {!!b.author && (
                  <Text style={styles.author} numberOfLines={1}>
                    {b.author}
                  </Text>
                )}
                <Text style={[styles.meta, st === 'finished' && !inDeleted ? styles.done : null]} numberOfLines={1}>
                  {b.rating > 0 && <Text style={styles.rating}>★ {b.rating}  </Text>}
                  {line}
                  {b.tags.length > 0 && <Text style={styles.tags}>{`  ${b.tags.map((t) => `#${t}`).join(' ')}`}</Text>}
                </Text>
              </View>
              {!selected && <Icon name="forward" size={14} color={p.textMuted} />}
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />

      {selected && (
        <Animated.View entering={FadeInDown} exiting={FadeOut} style={[styles.selectBar, { bottom: tabSpace + 10 }]}>
          {inDeleted ? (
            <>
              <TouchableOpacity disabled={!ids.length} onPress={() => void actions.restore(ids).then(done)} style={[styles.selectBtn, { flex: 1 }]}>
                <Text style={styles.selectBtnText}>Restore</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={!ids.length} onPress={() => confirmPurge(ids, () => void actions.purge(ids).then(done))} style={[styles.selectBtn, { flex: 1 }]}>
                <Text style={[styles.selectBtnText, { color: p.danger }]}>Delete for good</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity disabled={!ids.length} onPress={() => act(ids, 'rate')} style={styles.selectBtn}>
                <Text style={[styles.selectBtnText, !ids.length && styles.off]}>Rate</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={!ids.length} onPress={() => act(ids, 'status')} style={styles.selectBtn}>
                <Text style={[styles.selectBtnText, !ids.length && styles.off]}>Status</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={!ids.length} onPress={() => act(ids, 'tag')} style={styles.selectBtn} accessibilityLabel="Add a keyword">
                <Icon name="tag" size={15} color={ids.length ? p.text : p.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!ids.length}
                onPress={() => {
                  const allPrivate = ids.every((id) => items.find((b) => b.id === id)?.isPrivate);
                  void actions.setPrivate(ids, !allPrivate).then(done);
                }}
                style={styles.selectBtn}
                accessibilityLabel="Private">
                <Icon name="lock" size={15} color={ids.length ? p.text : p.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity disabled={!ids.length} onPress={() => void actions.trash(ids).then(done)} style={styles.selectBtn} accessibilityLabel="Delete">
                <Icon name="trash" size={15} color={ids.length ? p.danger : p.textMuted} />
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      )}

      {held && !inDeleted && (
        <OptionsSheet
          title={displayTitle(held)}
          onClose={() => setMenuFor(null)}
          options={[
            { label: isStarted(held) ? 'Carry on reading' : 'Start reading', onPress: () => onOpen(held) },
            { label: 'Details, notes and highlights', onPress: () => onInfo(held) },
            { label: 'Rate', hint: held.rating ? `★ ${held.rating}` : undefined, onPress: () => act([held.id], 'rate') },
            { label: 'Status', hint: BOOK_STATUSES.find((s) => s.key === statusOf(held))?.label, onPress: () => act([held.id], 'status') },
            { label: 'Add a keyword', onPress: () => act([held.id], 'tag') },
            { label: held.isPrivate ? 'Take out of Private' : 'Move to Private', onPress: () => void actions.setPrivate([held.id], !held.isPrivate).catch(failed) },
            { label: 'Delete', danger: true, hint: `Kept ${trashDays} days`, onPress: () => void actions.trash([held.id]).catch(failed) },
          ]}
        />
      )}
      {held && inDeleted && (
        <OptionsSheet
          title={displayTitle(held)}
          onClose={() => setMenuFor(null)}
          options={[
            { label: 'Restore', onPress: () => void actions.restore([held.id]).catch(failed) },
            { label: 'Delete for good', danger: true, hint: 'Removes the book and your highlights', onPress: () => confirmPurge([held.id], () => void actions.purge([held.id]).catch(failed)) },
          ]}
        />
      )}

      {menu === 'more' && <OptionsSheet title="Books" options={moreOptions} onClose={() => setMenu(null)} />}
      {menu === 'sort' && (
        <OptionsSheet title="Order" options={BOOK_SORTS.map((s) => ({ label: s.label, hint: s.key === sort ? '✓' : undefined, onPress: () => onSort(s.key) }))} onClose={() => setMenu(null)} />
      )}
      {menu === 'status' && (
        <OptionsSheet
          title={target.length === 1 ? 'Status' : `Status of ${target.length}`}
          options={[
            ...BOOK_STATUSES.map((s) => ({ label: s.label, onPress: () => void actions.setStatus(target, s.key).then(done) })),
            { label: 'From my reading', hint: 'Reading once started, finished at the end', onPress: () => void actions.setStatus(target, null).then(done) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'tag' && (
        <OptionsSheet
          title="Add a keyword"
          options={[
            ...tags.map((t) => ({ label: `#${t.name}`, hint: `${t.count}`, onPress: () => void actions.addTag(target, t.name).then(done) })),
            { label: 'New keyword…', onPress: () => setTimeout(() => setMenu('newTag'), 250) },
          ]}
          onClose={() => setMenu((m) => (m === 'tag' ? null : m))}
        />
      )}
      {menu === 'newTag' && (
        <PromptSheet
          title="New keyword"
          placeholder="e.g. Russian, classics, book club"
          confirmLabel="Add"
          onSubmit={(t) => void actions.addTag(target, t).then(done)}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'rate' && (
        <RatingPicker
          title={target.length === 1 ? 'Your rating' : `Rate ${target.length}`}
          value={target.length === 1 ? (items.find((b) => b.id === target[0])?.rating ?? null) : null}
          onPick={(r) => void actions.rate(target, r ?? 0).then(done)}
          onClose={() => setMenu(null)}
        />
      )}
    </View>
  );
}

function confirmPurge(ids: string[], go: () => void) {
  Alert.alert(ids.length === 1 ? 'Delete this book for good?' : `Delete ${ids.length} books for good?`, 'The book, your place in it, your bookmarks and highlights are removed from this phone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: go },
  ]);
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, paddingTop: 6, minHeight: 46 },
    title: { flex: 1, color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
    buttons: { flexDirection: 'row', gap: 8 },
    pill: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, height: 34, justifyContent: 'center' },
    pillText: { color: p.text, fontSize: 15, fontWeight: '700' },
    modeRow: { paddingHorizontal: SIDE, paddingTop: 10 },
    status: { color: p.textSecondary, fontSize: 13, paddingHorizontal: SIDE, paddingTop: 10 },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SIDE, marginTop: 14, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, height: 40 },
    searchInput: { flex: 1, color: p.text, fontSize: 16 },
    chips: { gap: 8, paddingHorizontal: SIDE, paddingTop: 12 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    chipCount: { color: p.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    chipTextOn: { color: p.bg },
    current: { flexDirection: 'row', gap: 16, marginHorizontal: SIDE, marginTop: 22, paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: p.separator },
    currentText: { flex: 1, paddingTop: 2 },
    currentLabel: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    currentTitle: { color: p.text, fontSize: 22, fontWeight: '700', lineHeight: 27, marginTop: 4, letterSpacing: -0.3 },
    author: { color: p.textSecondary, fontSize: 14, marginTop: 3 },
    bar: { height: 3, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginTop: 14 },
    barFill: { height: 3, borderRadius: 2, backgroundColor: p.accent },
    meta: { color: p.textSecondary, fontSize: 13, marginTop: 6, fontVariant: ['tabular-nums'] },
    done: { color: p.success },
    rating: { color: p.rating, fontWeight: '800' },
    tags: { color: p.link },
    carryOn: { alignSelf: 'flex-start', backgroundColor: p.text, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9, marginTop: 14 },
    carryOnText: { color: p.bg, fontSize: 15, fontWeight: '700' },
    sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SIDE, marginTop: 22, marginBottom: 4 },
    section: { flex: 1, color: p.text, fontSize: 20, fontWeight: '800' },
    sortText: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: SIDE, paddingVertical: 12 },
    rowSel: { backgroundColor: p.accentSoft },
    rowText: { flex: 1 },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowTitle: { flexShrink: 1, color: p.text, fontSize: 16, fontWeight: '700', lineHeight: 21 },
    check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: p.textMuted, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: p.accent, borderColor: p.accent },
    sep: { height: 1, backgroundColor: p.separator, marginLeft: SIDE + 52 + 14 },
    cover: { overflow: 'hidden', backgroundColor: p.tile },
    plainCover: { backgroundColor: p.elevated, borderWidth: 1, borderColor: p.border, justifyContent: 'space-between' },
    plainTitle: { color: p.text, fontWeight: '700' },
    plainSmall: { alignItems: 'center', justifyContent: 'center' },
    plainInitial: { color: p.textSecondary, fontWeight: '600', fontFamily: Platform.select({ ios: 'Charter', web: 'Charter, Georgia, serif', default: 'serif' }) },
    plainAuthor: { color: p.textSecondary },
    selectBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 18, padding: 8, borderWidth: 1, borderColor: p.border },
    selectBtn: { flex: 1, backgroundColor: p.card, borderRadius: 12, height: 38, alignItems: 'center', justifyContent: 'center' },
    selectBtnText: { color: p.text, fontSize: 15, fontWeight: '700' },
    off: { color: p.textMuted },
    empty: { paddingHorizontal: SIDE + 8, paddingTop: 40, gap: 12 },
    emptyTitle: { color: p.text, fontSize: 22, fontWeight: '800' },
    emptyText: { color: p.textSecondary, fontSize: 15, lineHeight: 22 },
    emptyBtn: { alignSelf: 'flex-start', backgroundColor: p.text, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 8 },
    emptyBtnText: { color: p.bg, fontSize: 16, fontWeight: '700' },
  });
