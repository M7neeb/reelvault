/**
 * The Books shelf: the book you are reading at the top, ready to carry on,
 * then everything else. Books are .epub files kept on the phone, so they read
 * with no connection. Hold a book to mark it finished or remove it.
 * Presentational only (see the note at the top of types.ts).
 */

import { useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { displayTitle, fmtLeft, fmtProgress, isStarted, minutesLeft, progressOf, shelfOrder } from '../../books/bookLogic';
import { useTabBarSpace } from '../chrome';
import { tick } from '../haptics';
import Icon from '../Icon';
import IconButton from '../IconButton';
import { ModeSwitch, type VideosMode } from '../overviewParts';
import { OptionsSheet } from '../prompts';
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

export default function BooksScreen({
  items,
  loaded,
  status,
  busy,
  actions,
  onOpen,
  onMode,
}: {
  items: BookUi[];
  loaded: boolean;
  status: string;
  busy: boolean;
  actions: BookActions;
  onOpen: (b: BookUi) => void;
  onMode: (m: VideosMode) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const [menuFor, setMenuFor] = useState<BookUi | null>(null);

  const shelf = useMemo(() => shelfOrder(items), [items]);
  const current = shelf.find((b) => isStarted(b) && !b.finishedAt) ?? null;
  const rest = current ? shelf.filter((b) => b.id !== current.id) : shelf;

  const add = () => actions.importFiles().catch(failed);

  const header = (
    <View style={{ paddingTop: insets.top + 8 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Books</Text>
        <IconButton icon="plus" label="Add a book" onPress={add} />
      </View>
      <View style={styles.modeRow}>
        <ModeSwitch mode="books" onChange={onMode} />
      </View>
      {!!status && (
        <Animated.Text entering={FadeIn} exiting={FadeOut} style={styles.status} numberOfLines={3}>
          {status}
        </Animated.Text>
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

      {rest.length > 0 && <Text style={styles.section}>{current ? 'On your shelf' : 'Your shelf'}</Text>}
    </View>
  );

  const empty = loaded ? (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No books yet</Text>
      <Text style={styles.emptyText}>
        Add an .epub from Files, or open one in ReelVault from Safari, Mail or a chat. Books stay on this phone, so they read without a connection.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={add} disabled={busy}>
        <Text style={styles.emptyBtnText}>Add a book</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <View style={styles.screen}>
      <FlatList
        data={rest}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={header}
        ListEmptyComponent={current ? null : empty}
        contentContainerStyle={{ paddingBottom: tabSpace + 24 }}
        renderItem={({ item: b }) => {
          const pr = progressOf(b);
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => onOpen(b)}
              onLongPress={() => {
                tick();
                setMenuFor(b);
              }}
              accessibilityLabel={`${displayTitle(b)}${b.author ? ` by ${b.author}` : ''}, ${fmtProgress(pr, isStarted(b))}`}>
              <BookCover book={b} width={52} radius={3} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {displayTitle(b)}
                </Text>
                {!!b.author && (
                  <Text style={styles.author} numberOfLines={1}>
                    {b.author}
                  </Text>
                )}
                <Text style={[styles.meta, b.finishedAt ? styles.done : null]}>{fmtProgress(pr, isStarted(b))}</Text>
              </View>
              <Icon name="forward" size={14} color={p.textMuted} />
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />

      {menuFor && (
        <OptionsSheet
          title={displayTitle(menuFor)}
          onClose={() => setMenuFor(null)}
          options={[
            { label: 'Read', onPress: () => onOpen(menuFor) },
            menuFor.finishedAt
              ? { label: 'Mark as not finished', onPress: () => void actions.setFinished(menuFor.id, false).catch(failed) }
              : { label: 'Mark as finished', onPress: () => void actions.setFinished(menuFor.id, true).catch(failed) },
            {
              label: 'Remove from the phone',
              danger: true,
              onPress: () =>
                Alert.alert(`Remove ${displayTitle(menuFor)}?`, 'The book and your place in it are deleted from this phone. You can add the .epub again later.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => void actions.remove(menuFor.id).catch(failed) },
                ]),
            },
          ]}
        />
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, paddingTop: 6 },
    title: { flex: 1, color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
    modeRow: { paddingHorizontal: SIDE, paddingTop: 10 },
    status: { color: p.textSecondary, fontSize: 13, paddingHorizontal: SIDE, paddingTop: 10 },
    current: { flexDirection: 'row', gap: 16, marginHorizontal: SIDE, marginTop: 22, paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: p.separator },
    currentText: { flex: 1, paddingTop: 2 },
    currentLabel: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    currentTitle: { color: p.text, fontSize: 22, fontWeight: '700', lineHeight: 27, marginTop: 4, letterSpacing: -0.3 },
    author: { color: p.textSecondary, fontSize: 14, marginTop: 3 },
    bar: { height: 3, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginTop: 14 },
    barFill: { height: 3, borderRadius: 2, backgroundColor: p.accent },
    meta: { color: p.textSecondary, fontSize: 13, marginTop: 6, fontVariant: ['tabular-nums'] },
    done: { color: p.success },
    carryOn: { alignSelf: 'flex-start', backgroundColor: p.text, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9, marginTop: 14 },
    carryOnText: { color: p.bg, fontSize: 15, fontWeight: '700' },
    section: { color: p.text, fontSize: 20, fontWeight: '800', paddingHorizontal: SIDE, marginTop: 24, marginBottom: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: SIDE, paddingVertical: 12 },
    rowText: { flex: 1 },
    rowTitle: { color: p.text, fontSize: 16, fontWeight: '700', lineHeight: 21 },
    sep: { height: 1, backgroundColor: p.separator, marginLeft: SIDE + 52 + 14 },
    cover: { overflow: 'hidden', backgroundColor: p.tile },
    plainCover: { backgroundColor: p.elevated, borderWidth: 1, borderColor: p.border, justifyContent: 'space-between' },
    plainTitle: { color: p.text, fontWeight: '700' },
    plainSmall: { alignItems: 'center', justifyContent: 'center' },
    plainInitial: { color: p.textSecondary, fontWeight: '600', fontFamily: Platform.select({ ios: 'Charter', web: 'Charter, Georgia, serif', default: 'serif' }) },
    plainAuthor: { color: p.textSecondary },
    empty: { paddingHorizontal: SIDE + 8, paddingTop: 48, gap: 12 },
    emptyTitle: { color: p.text, fontSize: 22, fontWeight: '800' },
    emptyText: { color: p.textSecondary, fontSize: 15, lineHeight: 22 },
    emptyBtn: { alignSelf: 'flex-start', backgroundColor: p.text, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 8 },
    emptyBtnText: { color: p.bg, fontSize: 16, fontWeight: '700' },
  });
