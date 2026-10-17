/**
 * The Search tab: search Simkl for movies, shows and anime at once (or one
 * kind), and, before you type, what is trending on Simkl today / this week /
 * this month - a big banner for the top title, then a shelf per kind.
 * Section titles say "Simkl" (API rule 6).
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTabBarSpace } from '@/features/vault/ui/chrome';
import Fade from '@/features/vault/ui/Fade';
import { tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import { rgbOf, sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { posterUrl, SIMKL_TYPES } from '../logic';
import DetailModal from './DetailModal';
import { IMDB_YELLOW } from './parts';
import Poster, { hueFor } from './Poster';
import type { CatalogTitle, SimklActions, SimklItem, SimklList, SimklPrefs, SimklType, Timeframe } from './types';

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

type Scope = 'all' | SimklType;

export default function SearchScreen({
  connected,
  items,
  lists = [],
  prefs,
  actions,
}: {
  connected: boolean;
  items: SimklItem[];
  lists?: SimklList[];
  prefs?: SimklPrefs;
  actions: SimklActions;
}) {
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();

  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [timeframe, setTimeframe] = useState<Timeframe>('week');
  const [trending, setTrending] = useState<Partial<Record<SimklType, CatalogTitle[]>>>({});
  const [results, setResults] = useState<Partial<Record<SimklType, CatalogTitle[]>> | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<CatalogTitle | null>(null);

  const types: SimklType[] = scope === 'all' ? ['show', 'movie', 'anime'] : [scope];
  const library = useMemo(() => new Map(items.map((i) => [i.simklId, i])), [items]);

  useEffect(() => {
    let live = true;
    for (const t of ['show', 'movie', 'anime'] as const) {
      actions
        .trending(t, timeframe)
        .then((r) => live && setTrending((all) => ({ ...all, [t]: r })))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [actions, timeframe]);

  useEffect(() => {
    if (!submitted) {
      setResults(null);
      return;
    }
    let live = true;
    setResults({});
    setError('');
    Promise.all(
      types.map((t) =>
        actions
          .search(t, submitted)
          .then((r) => [t, r] as const)
          .catch((e) => {
            setError(String(e?.message ?? e));
            return [t, [] as CatalogTitle[]] as const;
          })
      )
    ).then((pairs) => live && setResults(Object.fromEntries(pairs)));
    return () => {
      live = false;
    };
  }, [actions, submitted, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const hero = trending.show?.[0] ?? trending.movie?.[0];
  const heroH = Math.round(width * 0.62);
  const loading = results !== null && types.some((t) => results[t] === undefined);
  const found = results ? types.reduce((n, t) => n + (results[t]?.length ?? 0), 0) : 0;
  const cols = 3;
  const w = Math.floor((width - 32 - 20) / cols);

  return (
    <View style={styles.screen}>
      <StatusBar style={p.scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, tabSpace) + 24 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Search</Text>
        <View style={styles.searchBox}>
          <Icon name="search" size={17} color={p.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Movies, shows and anime on Simkl"
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
        <View style={styles.scopes}>
          {(['all', 'show', 'movie', 'anime'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.scope, scope === s && styles.scopeOn]}
              onPress={() => {
                tick();
                setScope(s);
              }}>
              <Text style={[styles.scopeText, scope === s && styles.scopeTextOn]}>
                {s === 'all' ? 'All' : SIMKL_TYPES.find((t) => t.key === s)!.plural}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {results ? (
          <>
            {!connected && <Text style={styles.note}>Sign in to Simkl on the Movies, Shows or Anime tab to search.</Text>}
            {loading && <ActivityIndicator color={p.textSecondary} style={{ marginTop: 24 }} />}
            {!loading && found === 0 && <Text style={styles.note}>{error || `Nothing on Simkl for "${submitted}".`}</Text>}
            {types.map((t) =>
              results[t]?.length ? (
                <View key={t}>
                  <Text style={styles.section}>{SIMKL_TYPES.find((x) => x.key === t)!.plural}</Text>
                  <View style={styles.grid}>
                    {results[t]!.slice(0, scope === 'all' ? 6 : 30).map((r) => (
                      <Tile key={r.simklId} t={r} w={w} mine={library.get(r.simklId)} onPress={() => setOpen(r)} />
                    ))}
                  </View>
                </View>
              ) : null
            )}
          </>
        ) : (
          <>
            <View style={styles.timeframes}>
              {TIMEFRAMES.map((t) => (
                <TouchableOpacity key={t.key} onPress={() => setTimeframe(t.key)} style={[styles.tf, timeframe === t.key && styles.tfOn]}>
                  <Text style={[styles.tfText, timeframe === t.key && styles.tfTextOn]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {hero && (
              <TouchableOpacity style={[styles.hero, { height: heroH }]} onPress={() => setOpen(hero)} activeOpacity={0.9}>
                {hero.poster ? (
                  <Image source={{ uri: posterUrl(hero.poster, '_m') }} style={Fill} contentFit="cover" blurRadius={30} />
                ) : (
                  <View style={[Fill, { backgroundColor: `hsl(${hueFor(hero.title)}, 40%, 26%)` }]} />
                )}
                <Fade color="0,0,0" from={0.1} to={0.8} style={Fill} />
                <View style={styles.heroBody}>
                  <Poster path={hero.poster} title={hero.title} width={heroH * 0.5} height={heroH * 0.74} radius={12} size="_m" />
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={styles.heroTag}>
                      <Icon name="trending" size={12} color="#fff" />
                      <Text style={styles.heroTagText}>#1 ON SIMKL</Text>
                    </View>
                    <Text style={styles.heroTitle} numberOfLines={3}>
                      {hero.title}
                    </Text>
                    <Text style={styles.heroSub}>
                      {[hero.year, hero.imdbRating ? `IMDb ${hero.imdbRating.toFixed(1)}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            {types.map((t) => {
              const rows = trending[t];
              const label = TIMEFRAMES.find((x) => x.key === timeframe)!.label.toLowerCase();
              return (
                <View key={t}>
                  <Text style={styles.section}>
                    Trending {SIMKL_TYPES.find((x) => x.key === t)!.plural} on Simkl {label === 'today' ? 'today' : label}
                  </Text>
                  {!rows ? (
                    <ActivityIndicator color={p.textSecondary} style={{ marginVertical: 30 }} />
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
                      {rows.slice(0, 20).map((r, i) => (
                        <TouchableOpacity key={r.simklId} style={{ width: 120 }} onPress={() => setOpen(r)} accessibilityLabel={r.title}>
                          <Poster path={r.poster} title={r.title} width={120} height={178} radius={12}>
                            <View style={styles.rank}>
                              <Text style={styles.rankText}>{i + 1}</Text>
                            </View>
                            {library.has(r.simklId) && (
                              <View style={styles.inLib}>
                                <Icon name="check" size={11} color="#fff" weight="bold" />
                              </View>
                            )}
                          </Poster>
                          <Text style={styles.tileTitle} numberOfLines={1}>
                            {r.title}
                          </Text>
                          <Text style={styles.tileSub}>{r.year ?? ''}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {open && (
        <DetailModal
          item={library.get(open.simklId) ?? null}
          title={open}
          actions={actions}
          lists={lists}
          hideSpoilers={prefs?.hideSpoilers}
          onOpen={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </View>
  );
}

function Tile({ t, w, mine, onPress }: { t: CatalogTitle; w: number; mine?: SimklItem; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const h = Math.round(w * 1.48);
  return (
    <TouchableOpacity style={{ width: w }} onPress={onPress} accessibilityLabel={t.title}>
      <Poster path={t.poster} title={t.title} width={w} height={h} radius={10}>
        {t.imdbRating != null && (
          <View style={styles.imdb}>
            <Text style={styles.imdbText}>{t.imdbRating.toFixed(1)}</Text>
          </View>
        )}
        {mine && (
          <View style={styles.inLib}>
            <Icon name="check" size={11} color="#fff" weight="bold" />
          </View>
        )}
      </Poster>
      <Text style={styles.tileTitle} numberOfLines={1}>
        {t.title}
      </Text>
      <Text style={styles.tileSub}>{t.year ?? ''}</Text>
    </TouchableOpacity>
  );
}

const Fill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    title: { color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8, paddingHorizontal: 16, paddingBottom: 8 },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.elevated, borderRadius: 14, marginHorizontal: 16, paddingHorizontal: 12 },
    searchInput: { flex: 1, color: p.text, fontSize: 17, paddingVertical: 12 },
    scopes: { flexDirection: 'row', gap: 6, marginHorizontal: 16, marginTop: 12, backgroundColor: p.elevated, borderRadius: 12, padding: 3 },
    scope: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 9 },
    scopeOn: { backgroundColor: p.card },
    scopeText: { color: p.textSecondary, fontSize: 14, fontWeight: '700' },
    scopeTextOn: { color: p.text },
    note: { color: p.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 30, paddingHorizontal: 30 },

    timeframes: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 16 },
    tf: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    tfOn: { backgroundColor: p.text },
    tfText: { color: p.textSoft, fontWeight: '700', fontSize: 13 },
    tfTextOn: { color: p.bg },

    hero: { marginHorizontal: 16, marginTop: 16, borderRadius: 22, overflow: 'hidden', backgroundColor: p.elevated, justifyContent: 'flex-end' },
    heroBody: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, padding: 16 },
    heroTag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: 'rgba(255,69,58,0.9)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
    heroTagText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
    heroTitle: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
    heroSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },

    section: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 },
    shelf: { gap: 12, paddingHorizontal: 16 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, rowGap: 16 },
    rank: { position: 'absolute', left: 6, top: 6, minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
    rankText: { color: '#fff', fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
    inLib: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    imdb: { position: 'absolute', top: 6, left: 6, backgroundColor: IMDB_YELLOW, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
    imdbText: { color: '#000', fontSize: 11, fontWeight: '900' },
    tileTitle: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
    tileSub: { color: p.textSecondary, fontSize: 12 },
  });
