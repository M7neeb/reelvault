/**
 * One source: search it, or look through its popular and latest titles (a
 * server's folders open like folders). Covers in a grid that loads more as
 * you scroll; titles already in your library carry a tick. Tap a title for
 * its page. Presentational only (see types.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MangaSource, SourceSeries } from '../../manga/sources/types';
import { tick } from '../haptics';
import Icon from '../Icon';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import MangaCover from './MangaCover';
import SourcePreview from './SourcePreview';
import type { BrowseActions } from './mangaTypes';

const SIDE = 16;
const GAP = 12;

type Mode = 'popular' | 'latest' | 'search';
type Frame = { title: string; key: string | null };

export default function SourceScreen({
  source,
  browse,
  libraryIdOf,
  onOpenInLibrary,
  onClose,
  initialOpenKey = null,
}: {
  source: MangaSource;
  browse: BrowseActions;
  /** The library series a title from this source already is. */
  libraryIdOf: (sourceId: string, key: string) => string | null;
  onOpenInLibrary: (seriesId: string) => void;
  onClose: () => void;
  /** The preview opens a title straight away. */
  initialOpenKey?: string | null;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cols = width >= 700 ? 5 : 3;
  const tileW = Math.floor((width - SIDE * 2 - GAP * (cols - 1)) / cols);

  const [mode, setMode] = useState<Mode>('popular');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  // Folders you went into (OPDS); the last one is shown.
  const [stack, setStack] = useState<Frame[]>([{ title: source.name, key: null }]);
  const [items, setItems] = useState<SourceSeries[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SourceSeries | null>(initialOpenKey ? { key: initialOpenKey, title: '', cover: null } : null);
  const run = useRef(0);
  const frame = stack[stack.length - 1];

  const load = useCallback(
    async (n: number) => {
      const id = ++run.current;
      setLoading(true);
      setError(null);
      try {
        const res =
          mode === 'search' && submitted
            ? await source.search(submitted, n)
            : frame.key && source.folder
              ? await source.folder(frame.key, n)
              : mode === 'latest' && source.latest
                ? await source.latest(n)
                : await source.popular(n);
        if (id !== run.current) return;
        setItems((old) => {
          const seen = new Set(n === 1 ? [] : old.map((x) => x.key));
          return [...(n === 1 ? [] : old), ...res.items.filter((x) => !seen.has(x.key))];
        });
        setHasMore(res.hasMore && res.items.length > 0);
        setPage(n);
      } catch (e) {
        if (id === run.current) setError(String(e).replace(/^Error:\s*/, ''));
      } finally {
        if (id === run.current) setLoading(false);
      }
    },
    [source, mode, submitted, frame.key]
  );

  useEffect(() => {
    setItems([]);
    setHasMore(true);
    load(1);
  }, [load]);

  const submit = () => {
    const q = query.trim();
    setSubmitted(q);
    setMode(q ? 'search' : 'popular');
    if (q) setStack((s) => s.slice(0, 1));
  };

  const header = (
    <View style={{ paddingTop: insets.top + 6 }}>
      <View style={styles.bar}>
        <TouchableOpacity
          style={styles.circle}
          onPress={() => (stack.length > 1 ? setStack((s) => s.slice(0, -1)) : onClose())}
          accessibilityLabel="Back">
          <Icon name="back" size={16} color={p.icon} weight="bold" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {frame.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {source.hint}
          </Text>
        </View>
      </View>
      <View style={styles.search}>
        <Icon name="search" size={15} color={p.textSecondary} />
        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (!t && mode === 'search') {
              setSubmitted('');
              setMode('popular');
            }
          }}
          onSubmitEditing={submit}
          placeholder={`Search ${source.name}`}
          placeholderTextColor={p.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
      </View>
      {mode !== 'search' && stack.length === 1 && (
        <View style={styles.tabs}>
          {(['popular', ...(source.canLatest ? ['latest'] : [])] as Mode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.tab, mode === m && styles.tabOn]}
              onPress={() => {
                tick();
                setMode(m);
              }}>
              <Text style={[styles.tabText, mode === m && styles.tabTextOn]}>{m === 'popular' ? (source.folder ? 'Catalog' : 'Popular') : 'Latest'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {mode === 'search' && <Text style={styles.note}>Results for "{submitted}"</Text>}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => load(page === 1 ? 1 : page + 1)}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.screen}>
        <FlatList
          key={cols}
          data={items}
          numColumns={cols}
          keyExtractor={(x) => x.key}
          ListHeaderComponent={header}
          columnWrapperStyle={{ gap: GAP, paddingHorizontal: SIDE }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30, gap: 16 }}
          keyboardDismissMode="on-drag"
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (!loading && hasMore && !error && items.length) load(page + 1);
          }}
          ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 24 }} color={p.textSecondary} /> : null}
          ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>{mode === 'search' ? 'Nothing found.' : 'Nothing here.'}</Text> : null}
          renderItem={({ item }) => {
            const inLib = !item.folder && libraryIdOf(source.id, item.key);
            return (
              <TouchableOpacity
                style={{ width: tileW }}
                onPress={() => {
                  if (item.folder) setStack((s) => [...s, { title: item.title, key: item.key }]);
                  else setOpen(item);
                }}
                accessibilityLabel={`${item.title}${inLib ? ', in your library' : ''}`}>
                {item.folder ? (
                  <View style={[styles.folder, { width: tileW, height: Math.round(tileW * 1.5) }]}>
                    <Icon name="lists" size={Math.round(tileW * 0.28)} color={p.textSecondary} />
                  </View>
                ) : (
                  <View>
                    <MangaCover series={{ coverSource: item.cover, title: item.title }} width={tileW} />
                    {inLib && (
                      <View style={styles.inLib}>
                        <Icon name="check" size={11} color="#fff" weight="bold" />
                      </View>
                    )}
                  </View>
                )}
                <Text style={styles.tileTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {!!item.author && (
                  <Text style={styles.tileMeta} numberOfLines={1}>
                    {item.author}
                  </Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      </View>
      {open && (
        <SourcePreview
          source={source}
          seriesKey={open.key}
          inLibraryId={libraryIdOf(source.id, open.key)}
          browse={browse}
          onOpenInLibrary={onOpenInLibrary}
          onClose={() => setOpen(null)}
        />
      )}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SIDE, paddingBottom: 8 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    title: { color: p.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
    sub: { color: p.textSecondary, fontSize: 12 },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SIDE, marginTop: 6, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, height: 40 },
    searchInput: { flex: 1, color: p.text, fontSize: 16 },
    tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: SIDE, paddingTop: 12, paddingBottom: 4 },
    tab: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    tabOn: { backgroundColor: p.text },
    tabText: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    tabTextOn: { color: p.bg },
    note: { color: p.textSecondary, fontSize: 13, paddingHorizontal: SIDE, paddingTop: 12 },
    errorBox: { marginHorizontal: SIDE, marginTop: 12, backgroundColor: p.card, borderRadius: 12, padding: 12, gap: 6 },
    errorText: { color: p.text, fontSize: 14, lineHeight: 19 },
    retry: { color: p.link, fontSize: 14, fontWeight: '700' },
    empty: { color: p.textSecondary, fontSize: 15, textAlign: 'center', paddingTop: 40 },
    folder: { borderRadius: 10, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    inLib: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    tileTitle: { color: p.text, fontSize: 13, fontWeight: '700', marginTop: 6, lineHeight: 17 },
    tileMeta: { color: p.textSecondary, fontSize: 12, marginTop: 1 },
  });
