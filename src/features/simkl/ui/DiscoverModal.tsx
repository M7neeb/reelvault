/**
 * Find titles to add: search Simkl, or browse what is trending on Simkl
 * today / this week / this month. Section titles say "Simkl" (API rule 6).
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { posterUrl, SIMKL_TYPES } from '../logic';
import { IMDB_YELLOW } from './parts';
import type { CatalogTitle, SimklActions, SimklType, Timeframe } from './types';

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

export default function DiscoverModal({
  type,
  library,
  actions,
  onOpen,
  onClose,
}: {
  type: SimklType;
  /** Simkl ids already in the library (marked with a tick). */
  library: Set<number>;
  actions: SimklActions;
  onOpen: (title: CatalogTitle) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();

  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>('week');
  const [rows, setRows] = useState<CatalogTitle[] | null>(null);
  const [error, setError] = useState('');
  const plural = SIMKL_TYPES.find((t) => t.key === type)!.plural;

  useEffect(() => {
    let live = true;
    setRows(null);
    setError('');
    const job = submitted ? actions.search(type, submitted) : actions.trending(type, timeframe);
    job
      .then((r) => live && setRows(r))
      .catch((e) => {
        if (!live) return;
        setRows([]);
        setError(String(e?.message ?? e));
      });
    return () => {
      live = false;
    };
  }, [actions, type, submitted, timeframe]);

  const cols = 3;
  const w = Math.floor((width - 24 - 16) / cols);
  const h = Math.round(w * 1.47);
  const heading = submitted
    ? `Results for "${submitted}"`
    : `Trending ${plural} on Simkl ${TIMEFRAMES.find((t) => t.key === timeframe)?.label}`;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Text style={styles.circleIcon}>✕</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.search}
            placeholder={`Search ${plural.toLowerCase()} on Simkl`}
            placeholderTextColor={p.textMuted}
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              if (!t.trim()) setSubmitted('');
            }}
            onSubmitEditing={() => setSubmitted(query.trim())}
            returnKeyType="search"
            autoCorrect={false}
            keyboardAppearance={p.scheme}
            clearButtonMode="while-editing"
          />
        </View>
        {!submitted && (
          <View style={styles.tabs}>
            {TIMEFRAMES.map((t) => (
              <TouchableOpacity key={t.key} style={[styles.tab, timeframe === t.key && styles.tabOn]} onPress={() => setTimeframe(t.key)}>
                <Text style={[styles.tabText, timeframe === t.key && styles.tabTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={styles.heading}>{heading}</Text>
        {rows === null ? (
          <ActivityIndicator style={styles.spinner} color={p.textSecondary} />
        ) : (
          <FlatList
            data={rows}
            numColumns={cols}
            keyExtractor={(r) => String(r.simklId)}
            columnWrapperStyle={styles.row}
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            ListEmptyComponent={<Text style={styles.empty}>{error || 'Nothing found.'}</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={{ width: w }} onPress={() => onOpen(item)}>
                <View style={[styles.poster, { width: w, height: h }]}>
                  <Image source={{ uri: posterUrl(item.poster) }} style={{ width: w, height: h }} contentFit="cover" />
                  {item.imdbRating != null && (
                    <View style={styles.imdb}>
                      <Text style={styles.imdbText}>{item.imdbRating.toFixed(1)}</Text>
                    </View>
                  )}
                  {library.has(item.simklId) && (
                    <View style={styles.inLibrary}>
                      <Text style={styles.inLibraryText}>✓</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.sub}>{item.year ?? ''}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.circle, alignItems: 'center', justifyContent: 'center' },
    circleIcon: { color: p.icon, fontSize: 15, fontWeight: '600' },
    search: { flex: 1, backgroundColor: p.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: p.text, fontSize: 15 },
    tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
    tab: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    tabOn: { backgroundColor: p.accent },
    tabText: { color: p.textSoft, fontWeight: '600' },
    tabTextOn: { color: '#fff' },
    heading: { color: p.text, fontSize: 17, fontWeight: '700', paddingHorizontal: 12, paddingVertical: 10 },
    spinner: { marginTop: 40 },
    row: { gap: 8, paddingHorizontal: 12, marginBottom: 12 },
    poster: { borderRadius: 8, overflow: 'hidden', backgroundColor: p.tile },
    inLibrary: {
      position: 'absolute',
      top: 5,
      right: 5,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inLibraryText: { color: '#fff', fontWeight: '800', fontSize: 12 },
    imdb: { position: 'absolute', top: 5, left: 5, backgroundColor: IMDB_YELLOW, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
    imdbText: { color: '#000', fontSize: 11, fontWeight: '900' },
    title: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 5 },
    sub: { color: p.textSecondary, fontSize: 12 },
    empty: { color: p.textSecondary, textAlign: 'center', marginTop: 30, paddingHorizontal: 20 },
  });
