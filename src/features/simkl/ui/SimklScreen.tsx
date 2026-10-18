/**
 * Movies, Shows or Anime from Simkl. From the top: a large title with glass
 * buttons (Pick for me, calendar, stats, settings); Up Next cards with the
 * show's backdrop and a one-tap "watched" (shows, anime) or your Plan to
 * Watch shelf (movies); your lists; then the library with status chips, a
 * sort menu, a filter box and rows (or a poster grid).
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTabBarSpace } from '@/features/vault/ui/chrome';
import Fade from '@/features/vault/ui/Fade';
import Glass from '@/features/vault/ui/Glass';
import { success, tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import IconButton from '@/features/vault/ui/IconButton';
import { OptionsSheet } from '@/features/vault/ui/prompts';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { fmtRating } from '../insights';
import {
  episodesLeft,
  fanartUrl,
  filterItems,
  parseEpisodeCode,
  posterUrl,
  SIMKL_TYPES,
  sortItems,
  sortsFor,
  STATUS_LABELS,
  statusesFor,
  upNext,
  type SimklSort,
} from '../logic';
import { AccountSheet } from './AccountSheet';
import { CalendarModal } from './browse';
import { ConnectCard } from './ConnectCard';
import DetailModal from './DetailModal';
import DiscoverModal from './DiscoverModal';
import InsightsModal from './InsightsModal';
import { ListEditor, ListModal, ListShelf } from './ListsUI';
import { RatingsLine } from './parts';
import Poster, { hueFor } from './Poster';
import { fmtAgo, fmtDay } from './time';
import { ImportSheet, PickModal } from './ToolsUI';
import type { CatalogTitle, SimklItem, SimklList, SimklScreenProps, SimklStatus, SimklType } from './types';

const SIDE = 16;
const GAP = 10;
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

const SORT_HINT: Partial<Record<SimklSort, string>> = {
  aired: 'Unwatched first, newest aired on top',
  seen: 'Most recently watched first',
  added: 'Newest additions first',
  rank: 'Simkl rank, best first',
  imdb: 'IMDb rating, highest first',
  mine: 'Your rating, highest first',
};

export default function SimklScreen(props: SimklScreenProps) {
  const { category, configured, connected, items, syncing, status, actions, devInitialState: dev } = props;
  const lists = props.lists ?? [];
  const look = props.look ?? 'standard';
  const hideSpoilers = props.prefs?.hideSpoilers ?? false;
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
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
  const [sortMenu, setSortMenu] = useState(false);
  const [open, setOpen] = useState<CatalogTitle | null>(() => {
    const it = dev?.detailId ? items.find((i) => i.simklId === dev.detailId) : undefined;
    return it ? asTitle(it) : null;
  });
  const [discover, setDiscover] = useState(dev?.discoverOpen ?? false);
  const [calendar, setCalendar] = useState(dev?.calendarOpen ?? false);
  const [stats, setStats] = useState<null | 'overview' | 'review'>(dev?.statsOpen ? 'overview' : (dev?.insightsTab ?? null));
  const [account, setAccount] = useState(dev?.accountOpen ?? false);
  const [pick, setPick] = useState(dev?.pickOpen ?? false);
  const [importing, setImporting] = useState(dev?.importOpen ?? false);
  const [openList, setOpenList] = useState<SimklList | null>(() => lists.find((l) => l.id === dev?.listOpen) ?? null);
  const [newList, setNewList] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const filter = statusBy[category];
  const sort = sortBy[category];
  const typeInfo = SIMKL_TYPES.find((t) => t.key === category)!;
  const ofType = useMemo(() => items.filter((i) => i.type === category), [items, category]);
  const shown = useMemo(() => sortItems(filterItems(items, { type: category, status: filter, query }), sort), [items, category, filter, query, sort]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ofType.length };
    for (const i of ofType) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [ofType]);
  const next = useMemo(
    () =>
      category === 'movie'
        ? []
        : upNext(ofType).sort((a, b) => (b.nextDate ?? b.lastWatchedAt ?? '').localeCompare(a.nextDate ?? a.lastWatchedAt ?? '')),
    [ofType, category]
  );
  const planned = useMemo(
    () =>
      category === 'movie'
        ? ofType.filter((i) => i.status === 'plantowatch').sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
        : [],
    [ofType, category]
  );
  const library = useMemo(() => new Set(items.map((i) => i.simklId)), [items]);
  const libraryMap = useMemo(() => new Map(items.map((i) => [i.simklId, i])), [items]);
  const openItem = open ? (items.find((i) => i.simklId === open.simklId) ?? null) : null;
  const liveList = openList ? (lists.find((l) => l.id === openList.id) ?? null) : null;

  // A tapped notification: open that title once it is in the list.
  useEffect(() => {
    const req = props.openRequest;
    if (!req || req.type !== category) return;
    const it = items.find((i) => i.simklId === req.simklId);
    if (it) setOpen(asTitle(it));
    props.onOpenHandled?.();
  }, [props.openRequest, category, items]); // eslint-disable-line react-hooks/exhaustive-deps

  async function watchedNext(item: SimklItem) {
    const ep = parseEpisodeCode(item.nextToWatch);
    if (!ep) return;
    setBusyId(item.simklId);
    try {
      await actions.setEpisodes(item, [ep], true);
      success();
      // Simkl works out the next episode; a sync brings it back onto the card.
      void actions.sync(true);
    } catch {
      // The status line says what went wrong.
    } finally {
      setBusyId(null);
    }
  }

  const cols = look === 'simple' ? 2 : look === 'compact' ? 4 : 3;
  const posterW = Math.floor((width - SIDE * 2 - GAP * (cols - 1)) / cols);
  const posterH = Math.round(posterW * 1.48);
  const cardW = Math.min(width - SIDE * 2 - 28, 420);
  const statusLabel = filter === 'all' ? 'All' : STATUS_LABELS[filter];
  const sortLabel = sortsFor(category).find((s) => s.key === sort)?.label ?? '';

  const header = (
    <View style={{ paddingTop: insets.top + 8 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{typeInfo.plural}</Text>
        {connected && (
          <View style={styles.buttons}>
            <IconButton icon="dice" label="Pick something for me" onPress={() => setPick(true)} />
            <IconButton icon="calendar" label={category === 'movie' ? 'Upcoming releases' : 'Upcoming episodes'} onPress={() => setCalendar(true)} />
            <IconButton icon="stats" label="Stats and review" onPress={() => setStats('overview')} />
            <IconButton icon="more" label="Simkl settings" onPress={() => setAccount(true)} />
          </View>
        )}
      </View>

      {!configured && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Simkl isn't set up in this build</Text>
          <Text style={styles.body}>This build has no Simkl app id yet. Once one is added, sign in here to see your movies, shows and anime.</Text>
        </View>
      )}
      {configured && !connected && (
        <View style={{ paddingHorizontal: SIDE }}>
          <ConnectCard actions={actions} initialCode={dev?.connectCode} />
        </View>
      )}

      {connected && (
        <>
          {!!status && <Text style={styles.note}>{status}</Text>}

          {next.length > 0 && (
            <>
              <SectionHead title="Up Next" detail={`${next.length}`} />
              <FlatList
                horizontal
                data={next}
                keyExtractor={(i) => String(i.simklId)}
                showsHorizontalScrollIndicator={false}
                snapToInterval={cardW + 12}
                decelerationRate="fast"
                contentContainerStyle={styles.carousel}
                renderItem={({ item }) => (
                  <UpNextCard
                    item={item}
                    width={cardW}
                    busy={busyId === item.simklId}
                    hideSpoilers={hideSpoilers}
                    onOpen={() => setOpen(asTitle(item))}
                    onWatched={() => void watchedNext(item)}
                  />
                )}
              />
            </>
          )}

          {planned.length > 0 && (
            <>
              <SectionHead title="Plan to Watch" detail={`${planned.length}`} action="Pick one" onAction={() => setPick(true)} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
                {planned.slice(0, 20).map((i) => (
                  <TouchableOpacity key={i.simklId} style={{ width: 112 }} onPress={() => setOpen(asTitle(i))} accessibilityLabel={i.title}>
                    <Poster path={i.poster} title={i.title} width={112} height={166} radius={10}>
                      {i.imdbRating !== null && (
                        <View style={styles.imdbBadge}>
                          <Text style={styles.imdbBadgeText}>{i.imdbRating.toFixed(1)}</Text>
                        </View>
                      )}
                    </Poster>
                    <Text style={styles.shelfTitle} numberOfLines={1}>
                      {i.title}
                    </Text>
                    <Text style={styles.shelfSub}>{[i.year, i.runtime ? `${i.runtime} min` : null].filter(Boolean).join(' · ')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {look !== 'simple' && look !== 'compact' && (
            <>
              <SectionHead title="My Lists" detail={lists.length ? `${lists.length}` : undefined} />
              <ListShelf lists={lists} onOpen={setOpenList} onNew={() => setNewList(true)} />
            </>
          )}

          <SectionHead
            title="Library"
            detail={`${ofType.length}`}
            action={look === 'simple' || look === 'desktop' ? undefined : grid ? 'List' : 'Grid'}
            actionIcon={grid ? 'list' : 'grid'}
            onAction={() => {
              tick();
              setGrid(!grid);
            }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {(['all', ...statusesFor(category)] as const).map((s) => {
              const on = s === filter;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => {
                    tick();
                    setStatusBy({ ...statusBy, [category]: s });
                  }}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{s === 'all' ? 'All' : STATUS_LABELS[s]}</Text>
                  <Text style={[styles.chipCount, on && styles.chipTextOn]}>{counts[s] ?? 0}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {look !== 'simple' && (
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <Icon name="search" size={16} color={p.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder={`Filter your ${typeInfo.plural.toLowerCase()}`}
                placeholderTextColor={p.textMuted}
                value={query}
                onChangeText={setQuery}
                keyboardAppearance={p.scheme}
                clearButtonMode="while-editing"
                autoCorrect={false}
              />
            </View>
            <TouchableOpacity style={styles.sortBtn} onPress={() => setSortMenu(true)} accessibilityLabel={`Sorted by ${sortLabel}`}>
              <Icon name="sort" size={15} color={p.text} />
              <Text style={styles.sortText}>{sortLabel}</Text>
            </TouchableOpacity>
          </View>
          )}
          {!!SORT_HINT[sort] && !query && look !== 'simple' && look !== 'compact' && <Text style={styles.hint}>{SORT_HINT[sort]}</Text>}
          {look === 'desktop' && shown.length > 0 && (
            <View style={styles.thead}>
              <Text style={[styles.th, { flex: 3 }]}>Title</Text>
              <Text style={[styles.th, { flex: 1.3 }]}>{category === 'movie' ? 'Year' : 'Next'}</Text>
              <Text style={[styles.th, styles.thRight, { flex: 1 }]}>{category === 'movie' ? 'Min' : 'Left'}</Text>
              <Text style={[styles.th, styles.thRight, { flex: 1 }]}>IMDb</Text>
              <Text style={[styles.th, styles.thRight, { flex: 0.8 }]}>★</Text>
            </View>
          )}
          {shown.length === 0 && (
            <View style={styles.emptyBox}>
              <Icon name={category === 'movie' ? 'movie' : category === 'anime' ? 'anime' : 'tv'} size={34} color={p.textMuted} />
              <Text style={styles.empty}>
                {ofType.length === 0
                  ? `No ${typeInfo.plural.toLowerCase()} on your Simkl yet.`
                  : query
                    ? 'Nothing matches.'
                    : `Nothing in ${statusLabel}.`}
              </Text>
              {ofType.length === 0 && (
                <View style={styles.emptyActions}>
                  <TouchableOpacity style={styles.emptyBtn} onPress={() => setDiscover(true)}>
                    <Icon name="trending" size={15} color="#fff" />
                    <Text style={styles.emptyBtnText}>See what's trending</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.emptyBtn, styles.emptyBtnGhost]} onPress={() => setImporting(true)}>
                    <Icon name="import" size={15} color={p.text} />
                    <Text style={[styles.emptyBtnText, { color: p.text }]}>Import</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
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

  const refresh = connected ? <RefreshControl refreshing={syncing} onRefresh={() => void actions.sync(true)} tintColor={p.textSecondary} /> : undefined;
  const bottom = Math.max(insets.bottom, tabSpace) + 20;

  return (
    <View style={styles.screen}>
      <StatusBar style={p.scheme === 'dark' ? 'light' : 'dark'} />
      {(grid || look === 'simple') && look !== 'desktop' ? (
        <FlatList
          key="grid"
          data={connected ? shown : []}
          numColumns={cols}
          keyExtractor={(i) => String(i.simklId)}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={{ paddingBottom: bottom }}
          refreshControl={refresh}
          renderItem={({ item }) => <GridPoster item={item} width={posterW} height={posterH} bare={look === 'simple' || look === 'compact'} onPress={() => setOpen(asTitle(item))} />}
        />
      ) : (
        <FlatList
          key="list"
          data={connected ? shown : []}
          keyExtractor={(i) => String(i.simklId)}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          contentContainerStyle={{ paddingBottom: bottom }}
          refreshControl={refresh}
          renderItem={({ item, index }) =>
            look === 'desktop' ? (
              <TableRow item={item} odd={index % 2 === 1} onPress={() => setOpen(asTitle(item))} />
            ) : look === 'compact' ? (
              <CompactRow item={item} onPress={() => setOpen(asTitle(item))} />
            ) : (
              <Row item={item} sort={sort} detailed={look === 'detailed'} onPress={() => setOpen(asTitle(item))} />
            )
          }
        />
      )}

      {sortMenu && (
        <OptionsSheet
          title="Sort by"
          options={sortsFor(category).map((s) => ({
            label: s.label,
            hint: s.key === sort ? '✓' : undefined,
            onPress: () => setSortBy({ ...sortBy, [category]: s.key }),
          }))}
          onClose={() => setSortMenu(false)}
        />
      )}
      {open && (
        <DetailModal
          item={openItem}
          title={open}
          actions={actions}
          lists={lists}
          library={libraryMap}
          hideSpoilers={hideSpoilers}
          initialEpisodesOpen={dev?.episodesOpen}
          initialRewatchOpen={dev?.rewatchOpen}
          initialRatingOpen={dev?.ratingOpen}
          initialListsOpen={dev?.addToListOpen}
          onOpen={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
      {discover && <DiscoverModal type={category} library={library} actions={actions} onOpen={setOpen} onClose={() => setDiscover(false)} />}
      {calendar && <CalendarModal type={category} items={ofType} allItems={items} actions={actions} onOpen={setOpen} onClose={() => setCalendar(false)} />}
      {stats && <InsightsModal items={items} actions={actions} initialTab={stats} onClose={() => setStats(null)} />}
      {pick && (
        <PickModal
          type={category}
          items={items}
          onOpen={(i) => {
            setPick(false);
            setOpen(asTitle(i));
          }}
          onClose={() => setPick(false)}
        />
      )}
      {importing && <ImportSheet actions={actions} onClose={() => setImporting(false)} />}
      {liveList && <ListModal list={liveList} actions={actions} onOpenTitle={setOpen} onClose={() => setOpenList(null)} />}
      {newList && <ListEditor list={null} actions={actions} onClose={() => setNewList(false)} />}
      {account && (
        <AccountSheet
          lastSyncAt={props.lastSyncAt}
          syncing={syncing}
          count={items.length}
          actions={actions}
          prefs={props.prefs ?? { hideSpoilers: false }}
          onStats={() => {
            setAccount(false);
            setStats('overview');
          }}
          onReview={() => {
            setAccount(false);
            setStats('review');
          }}
          onImport={() => {
            setAccount(false);
            setImporting(true);
          }}
          onClose={() => setAccount(false)}
        />
      )}
    </View>
  );
}

function SectionHead({
  title,
  detail,
  action,
  actionIcon,
  onAction,
}: {
  title: string;
  detail?: string;
  action?: string;
  actionIcon?: 'grid' | 'list';
  onAction?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!detail && <Text style={styles.sectionDetail}>{detail}</Text>}
      {!!action && (
        <TouchableOpacity style={styles.sectionAction} onPress={onAction} hitSlop={8}>
          {actionIcon && <Icon name={actionIcon} size={14} color={p.link} />}
          <Text style={styles.sectionActionText}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** A wide card: the show's backdrop, the next episode, and a one-tap "watched". */
function UpNextCard({
  item,
  width,
  busy,
  hideSpoilers,
  onOpen,
  onWatched,
}: {
  item: SimklItem;
  width: number;
  busy: boolean;
  hideSpoilers: boolean;
  onOpen: () => void;
  onWatched: () => void;
}) {
  const styles = useStyles(makeStyles);
  const fanart = fanartUrl(item.fanart ?? null);
  const art = fanart ?? (item.poster ? posterUrl(item.poster, '_m') : null);
  const left = episodesLeft(item);
  const progress = item.totalEpisodes > 0 ? Math.min(1, item.watchedEpisodes / item.totalEpisodes) : 0;
  const when = item.nextDate ? `Aired ${fmtDay(item.nextDate)}` : item.lastWatchedAt ? `Watched ${fmtAgo(item.lastWatchedAt)}` : null;
  return (
    <TouchableOpacity style={[styles.upCard, { width }]} onPress={onOpen} activeOpacity={0.9} accessibilityLabel={`${item.title}, ${item.nextToWatch}`}>
      {art ? (
        <Image source={{ uri: art }} style={StyleFill} contentFit="cover" transition={200} blurRadius={fanart ? 0 : 24} recyclingKey={art} />
      ) : (
        <View style={[StyleFill, { backgroundColor: `hsl(${hueFor(item.title)}, 38%, 24%)` }]} />
      )}
      <Fade color="0,0,0" from={0} to={0.88} style={[StyleFill, { top: '25%' }]} />
      {!fanart && (
        <View style={styles.upPoster}>
          <Poster path={item.poster} title={item.title} width={64} height={95} radius={8} />
        </View>
      )}
      <View style={styles.upBody}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.upTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.upEp} numberOfLines={1}>
            <Text style={styles.upCode}>{item.nextToWatch}</Text>
            {!hideSpoilers && item.nextTitle ? `  ${item.nextTitle}` : ''}
          </Text>
          <Text style={styles.upMeta} numberOfLines={1}>
            {[left > 0 ? `${left} left` : null, when].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <TouchableOpacity onPress={onWatched} disabled={busy} accessibilityLabel={`Mark ${item.nextToWatch} watched`} hitSlop={8}>
          <Glass interactive clear fallback="rgba(255,255,255,0.22)" style={[styles.upCheck, busy && { opacity: 0.5 }]}>
            <Icon name="check" size={22} color="#fff" weight="bold" />
          </Glass>
        </TouchableOpacity>
      </View>
      <View style={styles.upTrack}>
        <View style={[styles.upFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
    </TouchableOpacity>
  );
}

/** One title in the list: poster, next episode, progress, date, ratings. */
function Row({ item, sort, detailed, onPress }: { item: SimklItem; sort: SimklSort; detailed?: boolean; onPress: () => void }) {
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
      <Poster path={item.poster} title={item.title} width={66} height={98} radius={9} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {isMovie ? (
          <Text style={styles.rowMeta}>
            {[item.year, item.runtime ? `${item.runtime} min` : null, STATUS_LABELS[item.status]].filter(Boolean).join('  ·  ')}
          </Text>
        ) : (
          <View style={styles.rowLine}>
            {item.nextToWatch ? <Text style={styles.rowNext}>{item.nextToWatch}</Text> : <Text style={styles.rowDone}>Caught up</Text>}
            {left > 0 && <Text style={styles.rowLeft}>{left} left</Text>}
            {!!date && <Text style={styles.rowDate}>{date}</Text>}
          </View>
        )}
        {!isMovie && item.totalEpisodes > 0 && (
          <View style={styles.rowTrack}>
            <View style={[styles.rowFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
        {isMovie && !!date && <Text style={styles.rowDate}>{date}</Text>}
        <RatingsLine imdb={item.imdbRating} mal={item.type === 'anime' ? item.malRating : null} simkl={item.simklRating} mine={item.rating} />
        {detailed && (
          <Text style={styles.rowDate} numberOfLines={2}>
            {[
              STATUS_LABELS[item.status],
              item.year ? String(item.year) : null,
              item.runtime ? `${item.runtime} min${isMovie ? '' : ' / ep'}` : null,
              !isMovie && item.totalEpisodes ? `${item.watchedEpisodes}/${item.totalEpisodes} episodes` : null,
              item.rank ? `#${item.rank} on Simkl` : null,
              item.addedAt ? `added ${fmtAgo(item.addedAt)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}
        {detailed && !!item.memo && (
          <Text style={styles.rowMemo} numberOfLines={2}>
            “{item.memo}”
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

/** Compact layout: one short line per title. */
function CompactRow({ item, onPress }: { item: SimklItem; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const left = episodesLeft(item);
  return (
    <TouchableOpacity style={styles.crow} onPress={onPress} accessibilityLabel={item.title}>
      <Poster path={item.poster} title={item.title} width={30} height={44} radius={5} size="_cm" hideTitle />
      <Text style={styles.ctitle} numberOfLines={1}>
        {item.title}
      </Text>
      {item.type !== 'movie' && item.nextToWatch ? <Text style={styles.cnext}>{item.nextToWatch}</Text> : null}
      {left > 0 && <Text style={styles.cleft}>{left}</Text>}
      {item.rating !== null && <Text style={styles.cmine}>★{fmtRating(item.rating)}</Text>}
    </TouchableOpacity>
  );
}

/** Desktop layout: a table row with columns. */
function TableRow({ item, odd, onPress }: { item: SimklItem; odd: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const isMovie = item.type === 'movie';
  return (
    <TouchableOpacity style={[styles.trow, odd && styles.trowAlt]} onPress={onPress} accessibilityLabel={item.title}>
      <View style={{ flex: 3, flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 6 }}>
        <Poster path={item.poster} title={item.title} width={22} height={32} radius={3} size="_cm" hideTitle />
        <Text style={styles.tname} numberOfLines={1}>
          {item.title}
        </Text>
      </View>
      <Text style={[styles.td, { flex: 1.3, color: isMovie ? p.textSoft : p.link }]} numberOfLines={1}>
        {isMovie ? (item.year ?? '–') : (item.nextToWatch ?? '✓')}
      </Text>
      <Text style={[styles.td, styles.thRight, { flex: 1 }]}>{isMovie ? (item.runtime ?? '–') : episodesLeft(item) || '–'}</Text>
      <Text style={[styles.td, styles.thRight, { flex: 1 }]}>{item.imdbRating?.toFixed(1) ?? '–'}</Text>
      <Text style={[styles.td, styles.thRight, { flex: 0.8, color: item.rating ? p.rating : p.textMuted }]}>{item.rating !== null ? fmtRating(item.rating) : '–'}</Text>
    </TouchableOpacity>
  );
}

function GridPoster({ item, width, height, bare, onPress }: { item: SimklItem; width: number; height: number; bare?: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const progress = item.totalEpisodes > 0 ? Math.min(1, item.watchedEpisodes / item.totalEpisodes) : 0;
  return (
    <TouchableOpacity style={{ width }} onPress={onPress} accessibilityLabel={item.title}>
      <Poster path={item.poster} title={item.title} width={width} height={height} radius={10}>
        {!bare && item.rating !== null && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>★ {fmtRating(item.rating)}</Text>
          </View>
        )}
        {!bare && item.imdbRating !== null && (
          <View style={styles.imdbBadge}>
            <Text style={styles.imdbBadgeText}>{item.imdbRating.toFixed(1)}</Text>
          </View>
        )}
        {item.type !== 'movie' && item.totalEpisodes > 0 && (
          <View style={styles.gridTrack}>
            <View style={[styles.gridFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
      </Poster>
      <Text style={styles.gridTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.gridSub} numberOfLines={1}>
        {item.type === 'movie' ? (item.year ?? '') : (item.nextToWatch ?? 'Caught up')}
      </Text>
    </TouchableOpacity>
  );
}

const StyleFill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, paddingBottom: 4 },
    title: { flex: 1, color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
    buttons: { flexDirection: 'row', gap: 8 },
    card: { backgroundColor: p.elevated, borderRadius: 16, padding: 16, gap: 8, marginHorizontal: SIDE },
    cardTitle: { color: p.text, fontSize: 17, fontWeight: '700' },
    body: { color: p.textSoft, fontSize: 14 },
    note: { color: p.link, fontSize: 13, fontWeight: '600', paddingHorizontal: SIDE, paddingTop: 4 },

    sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: SIDE, paddingTop: 22, paddingBottom: 10 },
    sectionTitle: { color: p.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
    sectionDetail: { color: p.textSecondary, fontSize: 15, fontWeight: '600' },
    sectionAction: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
    sectionActionText: { color: p.link, fontSize: 15, fontWeight: '600' },

    carousel: { gap: 12, paddingHorizontal: SIDE },
    upCard: { height: 200, borderRadius: 20, overflow: 'hidden', backgroundColor: p.elevated, justifyContent: 'flex-end' },
    upPoster: { position: 'absolute', top: 14, left: 14, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    upBody: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
    upTitle: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    upEp: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '600' },
    upCode: { color: '#fff', fontWeight: '800', fontVariant: ['tabular-nums'] },
    upMeta: { color: 'rgba(255,255,255,0.66)', fontSize: 12, fontWeight: '600' },
    upCheck: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
    upTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
    upFill: { height: 4, backgroundColor: p.accent },

    shelf: { gap: 12, paddingHorizontal: SIDE },
    shelfTitle: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
    shelfSub: { color: p.textSecondary, fontSize: 12 },

    chips: { gap: 8, paddingHorizontal: SIDE, paddingBottom: 12 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    chipCount: { color: p.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    chipTextOn: { color: p.bg },

    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: SIDE },
    search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.elevated, borderRadius: 12, paddingHorizontal: 12 },
    searchInput: { flex: 1, color: p.text, fontSize: 16, paddingVertical: 10 },
    sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
    sortText: { color: p.text, fontSize: 14, fontWeight: '600' },
    hint: { color: p.textSecondary, fontSize: 12, paddingHorizontal: SIDE, paddingTop: 8, paddingBottom: 2 },
    emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 34, paddingHorizontal: 30 },
    empty: { color: p.textSecondary, fontSize: 15, textAlign: 'center' },
    emptyActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    emptyBtnGhost: { backgroundColor: p.elevated },
    emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

    row: { flexDirection: 'row', gap: 14, paddingHorizontal: SIDE, paddingVertical: 10 },
    rowText: { flex: 1, gap: 4, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: p.separator, paddingBottom: 10 },
    rowTitle: { color: p.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
    rowLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
    rowNext: { color: p.link, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
    rowDone: { color: p.success, fontSize: 14, fontWeight: '700' },
    rowLeft: { color: p.textSoft, fontSize: 14, fontWeight: '600' },
    rowMeta: { color: p.textSoft, fontSize: 14, fontWeight: '600' },
    rowDate: { color: p.textSecondary, fontSize: 12 },
    rowTrack: { height: 4, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginVertical: 2 },
    rowFill: { height: 4, borderRadius: 2, backgroundColor: p.accent },

    gridRow: { gap: GAP, paddingHorizontal: SIDE, marginTop: 14 },
    badge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { color: p.rating, fontSize: 11, fontWeight: '800' },
    imdbBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: '#F5C518', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
    imdbBadgeText: { color: '#000', fontSize: 11, fontWeight: '900' },
    gridTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.55)' },
    gridFill: { height: 4, backgroundColor: p.accent },
    gridTitle: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
    gridSub: { color: p.textSecondary, fontSize: 12 },

    rowMemo: { color: p.textSoft, fontSize: 12, fontStyle: 'italic' },
    crow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SIDE, paddingVertical: 5 },
    ctitle: { flex: 1, color: p.text, fontSize: 15, fontWeight: '600' },
    cnext: { color: p.link, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    cleft: { color: p.textSecondary, fontSize: 12, fontWeight: '700', minWidth: 18, textAlign: 'right' },
    cmine: { color: p.rating, fontSize: 12, fontWeight: '800' },
    thead: { flexDirection: 'row', marginTop: 12, paddingHorizontal: SIDE, paddingVertical: 7, backgroundColor: p.panel, borderBottomWidth: 1, borderBottomColor: p.border },
    th: { color: p.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    thRight: { textAlign: 'right' },
    trow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, height: 42 },
    trowAlt: { backgroundColor: p.elevated },
    tname: { flex: 1, color: p.text, fontSize: 13, fontWeight: '600' },
    td: { color: p.textSoft, fontSize: 12, fontVariant: ['tabular-nums'] },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 22 },
    footerIcon: { width: 16, height: 16, borderRadius: 3 },
    footerText: { color: p.textSecondary, fontSize: 12 },
  });
