/**
 * Movies, Shows or Anime from Simkl, laid out like the Simkl app: a status
 * menu, sort tabs (Aired / Seen / A-Z / Rank...), a search box and rows with
 * the poster, next episode, episodes left, date and ratings (IMDb, Simkl,
 * yours). A grid view is one tap away. Simkl titles live here only; they are
 * never linked to your own videos.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionsSheet } from '@/features/vault/ui/prompts';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { episodesLeft, filterItems, posterUrl, SIMKL_TYPES, sortItems, sortsFor, STATUS_LABELS, statusesFor, type SimklSort } from '../logic';
import { AccountSheet } from './AccountSheet';
import { fmtRating } from '../insights';
import { CalendarModal } from './browse';
import InsightsModal from './InsightsModal';
import { ConnectCard } from './ConnectCard';
import DetailModal from './DetailModal';
import DiscoverModal from './DiscoverModal';
import { RatingsLine } from './parts';
import { fmtDay, fmtAgo } from './time';
import type { CatalogTitle, SimklItem, SimklScreenProps, SimklStatus, SimklType } from './types';

const SIDE = 16;
const GAP = 8;
const SIMKL_ICON = 'https://us.simkl.in/img_favicon/v2/favicon-192x192.png';

const asTitle = (i: SimklItem): CatalogTitle => ({
  simklId: i.simklId,
  type: i.type,
  title: i.title,
  year: i.year,
  poster: i.poster,
  slug: i.slug,
});

const defaultStatus = (type: SimklType): SimklStatus | 'all' => (type === 'movie' ? 'all' : 'watching');

const TAB_HINT: Partial<Record<SimklSort, string>> = {
  aired: 'Unwatched episodes first, newest aired on top',
  seen: 'Most recently watched first',
  added: 'Newest additions first',
  rank: 'Simkl rank, best first',
  imdb: 'IMDb rating, highest first',
  mine: 'Your rating, highest first',
};

export default function SimklScreen(props: SimklScreenProps) {
  const { category, configured, connected, items, syncing, status, actions, devInitialState: dev } = props;
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();

  // Status and sort are remembered per category while the app is open.
  const [statusBy, setStatusBy] = useState<Record<SimklType, SimklStatus | 'all'>>({
    movie: defaultStatus('movie'),
    show: defaultStatus('show'),
    anime: defaultStatus('anime'),
  });
  const [sortBy, setSortBy] = useState<Record<SimklType, SimklSort>>({ movie: 'seen', show: 'aired', anime: 'aired' });
  const [query, setQuery] = useState('');
  const [grid, setGrid] = useState(dev?.grid ?? false);
  const [statusMenu, setStatusMenu] = useState(false);
  const [open, setOpen] = useState<CatalogTitle | null>(() => {
    const it = dev?.detailId ? items.find((i) => i.simklId === dev.detailId) : undefined;
    return it ? asTitle(it) : null;
  });
  const [discover, setDiscover] = useState(dev?.discoverOpen ?? false);
  const [calendar, setCalendar] = useState(dev?.calendarOpen ?? false);
  const [stats, setStats] = useState<null | 'overview' | 'review'>(
    dev?.statsOpen ? 'overview' : dev?.insightsTab ?? null
  );
  const [account, setAccount] = useState(dev?.accountOpen ?? false);

  const filter = statusBy[category];
  const sort = sortBy[category];
  const typeInfo = SIMKL_TYPES.find((t) => t.key === category)!;
  const ofType = useMemo(() => items.filter((i) => i.type === category), [items, category]);
  const shown = useMemo(
    () => sortItems(filterItems(items, { type: category, status: filter, query }), sort),
    [items, category, filter, query, sort]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ofType.length };
    for (const i of ofType) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [ofType]);
  const library = useMemo(() => new Set(items.map((i) => i.simklId)), [items]);
  const openItem = open ? (items.find((i) => i.simklId === open.simklId) ?? null) : null;

  // A tapped notification: open that title once it is in the list.
  useEffect(() => {
    const req = props.openRequest;
    if (!req || req.type !== category) return;
    const it = items.find((i) => i.simklId === req.simklId);
    if (it) setOpen(asTitle(it));
    props.onOpenHandled?.();
  }, [props.openRequest, category, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = 3;
  const posterW = Math.floor((width - SIDE * 2 - GAP * (cols - 1)) / cols);
  const posterH = Math.round(posterW * 1.47);
  const statusLabel = filter === 'all' ? 'All' : STATUS_LABELS[filter];

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      {props.categoryBar}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{typeInfo.plural}</Text>
        {connected && (
          <View style={styles.buttons}>
            <Round label="⌕" onPress={() => setDiscover(true)} hint="Search Simkl and trending" />
            {category !== 'movie' && <Round label="◷" onPress={() => setCalendar(true)} hint="Upcoming episodes" />}
            <Round label="Σ" onPress={() => setStats('overview')} hint="Stats and review" />
            <Round label="⋯" onPress={() => setAccount(true)} hint="Simkl account, stats and export" />
          </View>
        )}
      </View>

      {!configured && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Simkl isn't set up in this build</Text>
          <Text style={styles.body}>
            This build has no Simkl app id yet. Once one is added, sign in here to see your movies, shows and anime.
          </Text>
        </View>
      )}
      {configured && !connected && <ConnectCard actions={actions} initialCode={dev?.connectCode} />}

      {connected && (
        <>
          <View style={styles.controls}>
            <TouchableOpacity style={styles.statusPill} onPress={() => setStatusMenu(true)} accessibilityLabel="Choose a list">
              <Text style={styles.statusPillText}>
                {statusLabel} <Text style={styles.statusCount}>{counts[filter] ?? 0}</Text>
              </Text>
              <Text style={styles.caret}>▾</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.viewToggle} onPress={() => setGrid(!grid)} accessibilityLabel={grid ? 'Show as list' : 'Show as grid'}>
              <Text style={styles.viewToggleText}>{grid ? '☰' : '▦'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {sortsFor(category).map((s) => {
              const on = s.key === sort;
              return (
                <TouchableOpacity key={s.key} onPress={() => setSortBy({ ...sortBy, [category]: s.key })} style={styles.tab}>
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{s.label.toUpperCase()}</Text>
                  <View style={[styles.tabLine, on && styles.tabLineOn]} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.search}>
            <TextInput
              style={styles.searchInput}
              placeholder={`Search your ${typeInfo.plural.toLowerCase()}`}
              placeholderTextColor={p.textMuted}
              value={query}
              onChangeText={setQuery}
              keyboardAppearance={p.scheme}
              clearButtonMode="while-editing"
              autoCorrect={false}
            />
            <Text style={styles.searchIcon}>⌕</Text>
          </View>
          {!!TAB_HINT[sort] && !query && <Text style={styles.hint}>{TAB_HINT[sort]}</Text>}
          {!!status && <Text style={styles.note}>{status}</Text>}
          {shown.length === 0 && (
            <Text style={styles.empty}>
              {ofType.length === 0
                ? `No ${typeInfo.plural.toLowerCase()} on your Simkl yet. Tap ⌕ to search Simkl or see what is trending.`
                : query
                  ? 'Nothing matches.'
                  : `Nothing in ${statusLabel}.`}
            </Text>
          )}
        </>
      )}
    </View>
  );

  const footer = (
    <TouchableOpacity style={styles.footer} onPress={() => actions.openUrl('https://simkl.com')}>
      <Image source={{ uri: SIMKL_ICON }} style={styles.footerIcon} />
      <Text style={styles.footerText}>Movie, TV and anime data from Simkl</Text>
    </TouchableOpacity>
  );

  const refresh = connected ? (
    <RefreshControl refreshing={syncing} onRefresh={() => void actions.sync(true)} tintColor={p.textSecondary} />
  ) : undefined;

  return (
    <View style={styles.screen}>
      <StatusBar style={p.scheme === 'dark' ? 'light' : 'dark'} />
      {grid ? (
        <FlatList
          key="grid"
          data={connected ? shown : []}
          numColumns={cols}
          keyExtractor={(i) => String(i.simklId)}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={refresh}
          renderItem={({ item }) => (
            <GridPoster item={item} width={posterW} height={posterH} onPress={() => setOpen(asTitle(item))} />
          )}
        />
      ) : (
        <FlatList
          key="list"
          data={connected ? shown : []}
          keyExtractor={(i) => String(i.simklId)}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={refresh}
          renderItem={({ item }) => <Row item={item} sort={sort} onPress={() => setOpen(asTitle(item))} />}
        />
      )}

      {statusMenu && (
        <OptionsSheet
          title={typeInfo.plural}
          options={(['all', ...statusesFor(category)] as const).map((s) => ({
            label: s === 'all' ? 'All' : STATUS_LABELS[s],
            hint: String(counts[s] ?? 0),
            onPress: () => setStatusBy({ ...statusBy, [category]: s }),
          }))}
          onClose={() => setStatusMenu(false)}
        />
      )}
      {open && (
        <DetailModal
          item={openItem}
          title={open}
          actions={actions}
          initialEpisodesOpen={dev?.episodesOpen}
          initialRewatchOpen={dev?.rewatchOpen}
          initialRatingOpen={dev?.ratingOpen}
          onOpen={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
      {discover && (
        <DiscoverModal type={category} library={library} actions={actions} onOpen={setOpen} onClose={() => setDiscover(false)} />
      )}
      {calendar && <CalendarModal type={category} items={ofType} actions={actions} onOpen={setOpen} onClose={() => setCalendar(false)} />}
      {stats && <InsightsModal items={items} actions={actions} initialTab={stats} onClose={() => setStats(null)} />}
      {account && (
        <AccountSheet
          lastSyncAt={props.lastSyncAt}
          syncing={syncing}
          count={items.length}
          actions={actions}
          onStats={() => {
            setAccount(false);
            setStats('overview');
          }}
          onReview={() => {
            setAccount(false);
            setStats('review');
          }}
          onClose={() => setAccount(false)}
        />
      )}
    </View>
  );
}

function Round({ label, onPress, hint }: { label: string; onPress: () => void; hint: string }) {
  const styles = useStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.round} onPress={onPress} accessibilityLabel={hint}>
      <Text style={styles.roundText}>{label}</Text>
    </TouchableOpacity>
  );
}

/** One title in the list: poster with progress, next episode, episodes left, date, ratings. */
function Row({ item, sort, onPress }: { item: SimklItem; sort: SimklSort; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const isMovie = item.type === 'movie';
  const progress = item.totalEpisodes > 0 ? Math.min(1, item.watchedEpisodes / item.totalEpisodes) : 0;
  const left = episodesLeft(item);
  const date =
    sort === 'added'
      ? item.addedAt && `Added ${fmtAgo(item.addedAt)}`
      : !isMovie && item.nextToWatch && item.nextDate && sort === 'aired'
        ? `Aired ${fmtDay(item.nextDate)}`
        : item.lastWatchedAt
          ? `Watched ${fmtAgo(item.lastWatchedAt)}`
          : item.addedAt
            ? `Added ${fmtAgo(item.addedAt)}`
            : null;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityLabel={item.title}>
      <View style={styles.rowPoster}>
        <Image source={{ uri: posterUrl(item.poster, '_c') }} style={styles.rowPosterImg} contentFit="cover" transition={120} />
        {!isMovie && item.totalEpisodes > 0 && (
          <View style={styles.rowTrack}>
            <View style={[styles.rowFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {isMovie ? (
          <Text style={styles.rowMeta}>
            {[item.year, item.runtime ? `${item.runtime} min` : null, item.rank ? `#${item.rank}` : null].filter(Boolean).join('  ·  ')}
          </Text>
        ) : (
          <View style={styles.rowLine}>
            {item.nextToWatch ? <Text style={styles.rowNext}>{item.nextToWatch}</Text> : <Text style={styles.rowDone}>Caught up</Text>}
            {left > 0 && <Text style={styles.rowLeft}>{left} ep left</Text>}
          </View>
        )}
        {!!date && <Text style={styles.rowDate}>{date}</Text>}
        <RatingsLine imdb={item.imdbRating} mal={item.type === 'anime' ? item.malRating : null} simkl={item.simklRating} mine={item.rating} />
      </View>
    </TouchableOpacity>
  );
}

function GridPoster({ item, width, height, onPress }: { item: SimklItem; width: number; height: number; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const progress = item.totalEpisodes > 0 ? Math.min(1, item.watchedEpisodes / item.totalEpisodes) : 0;
  return (
    <TouchableOpacity style={{ width }} onPress={onPress} accessibilityLabel={item.title}>
      <View style={[styles.gridPoster, { width, height }]}>
        <Image source={{ uri: posterUrl(item.poster) }} style={{ width, height }} contentFit="cover" transition={150} />
        {item.rating !== null && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>★ {fmtRating(item.rating)}</Text>
          </View>
        )}
        {item.imdbRating !== null && (
          <View style={styles.imdbBadge}>
            <Text style={styles.imdbBadgeText}>{item.imdbRating.toFixed(1)}</Text>
          </View>
        )}
        {item.type !== 'movie' && item.totalEpisodes > 0 && (
          <View style={styles.rowTrack}>
            <View style={[styles.rowFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
      </View>
      <Text style={styles.gridTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.gridSub} numberOfLines={1}>
        {item.type === 'movie' ? (item.year ?? '') : (item.nextToWatch ?? 'Caught up')}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { paddingHorizontal: SIDE, gap: 10, paddingBottom: 4 },
    titleRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, color: p.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
    buttons: { flexDirection: 'row', gap: 8 },
    round: { width: 38, height: 38, borderRadius: 19, backgroundColor: p.circle, alignItems: 'center', justifyContent: 'center' },
    roundText: { color: p.icon, fontSize: 19, fontWeight: '700' },
    card: { backgroundColor: p.panel, borderRadius: 14, padding: 16, gap: 8 },
    cardTitle: { color: p.text, fontSize: 17, fontWeight: '700' },
    body: { color: p.textSoft, fontSize: 14 },

    controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: p.card,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    statusPillText: { color: p.text, fontSize: 15, fontWeight: '700' },
    statusCount: { color: p.textSecondary, fontWeight: '600' },
    caret: { color: p.textSecondary, fontSize: 12 },
    viewToggle: { marginLeft: 'auto', width: 36, height: 36, borderRadius: 10, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    viewToggleText: { color: p.textSoft, fontSize: 17 },

    tabs: { gap: 20, paddingTop: 2 },
    tab: { alignItems: 'center', paddingTop: 4 },
    tabText: { color: p.textSecondary, fontSize: 14, fontWeight: '700', letterSpacing: 0.6 },
    tabTextOn: { color: p.text },
    tabLine: { height: 3, borderRadius: 2, marginTop: 6, alignSelf: 'stretch', backgroundColor: 'transparent' },
    tabLineOn: { backgroundColor: p.rating },

    search: { flexDirection: 'row', alignItems: 'center', backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 14 },
    searchInput: { flex: 1, color: p.text, fontSize: 16, paddingVertical: 11 },
    searchIcon: { color: p.textSecondary, fontSize: 18 },
    hint: { color: p.textSecondary, fontSize: 13 },
    note: { color: p.link, fontSize: 13, fontWeight: '600' },
    empty: { color: p.textSecondary, fontSize: 14, paddingVertical: 24, textAlign: 'center' },

    row: {
      flexDirection: 'row',
      gap: 14,
      paddingHorizontal: SIDE,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: p.separator,
    },
    rowPoster: { width: 68, height: 100, borderRadius: 6, overflow: 'hidden', backgroundColor: p.tile },
    rowPosterImg: { width: 68, height: 100 },
    rowTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.55)' },
    rowFill: { height: 4, backgroundColor: p.rating },
    rowText: { flex: 1, gap: 4, justifyContent: 'center' },
    rowTitle: { color: p.text, fontSize: 17, fontWeight: '700' },
    rowLine: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
    rowNext: { color: p.link, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
    rowDone: { color: p.textSecondary, fontSize: 14, fontWeight: '600' },
    rowLeft: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    rowMeta: { color: p.textSoft, fontSize: 14, fontWeight: '600' },
    rowDate: { color: p.textSecondary, fontSize: 13 },

    gridRow: { gap: GAP, paddingHorizontal: SIDE, marginTop: 12 },
    gridPoster: { borderRadius: 8, overflow: 'hidden', backgroundColor: p.tile },
    badge: { position: 'absolute', top: 5, left: 5, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
    badgeText: { color: p.rating, fontSize: 11, fontWeight: '800' },
    imdbBadge: { position: 'absolute', top: 5, right: 5, backgroundColor: '#F5C518', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
    imdbBadgeText: { color: '#000', fontSize: 11, fontWeight: '900' },
    gridTitle: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 5 },
    gridSub: { color: p.textSecondary, fontSize: 12 },

    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 20 },
    footerIcon: { width: 16, height: 16, borderRadius: 3 },
    footerText: { color: p.textSecondary, fontSize: 12 },
  });
