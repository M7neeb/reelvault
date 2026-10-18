/**
 * The Videos tab in Overview mode: your videos as titles you rate and track,
 * built like the Movies / Shows / Anime tabs - a spotlight title at the top,
 * how your titles split by status (tap one to filter), your ratings from 1 to
 * 10, continue cards, plan to watch, top rated, status chips, and the library
 * as posters or rows that slide in. Series (videos that
 * belong together) show as one title. Removed videos stay with their rating.
 *
 * The videos play: the spotlight (it moves through up to five titles - what
 * you are watching, your best, what you watched last; tap the dots) and the
 * continue cards play their video with sound, the one most in view. Rate what
 * you watched straight from its card, see what you watched lately, and let
 * Surprise Me pick a title.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hueFor } from '@/features/simkl/ui/Poster';
import { fmtAgo } from '@/features/simkl/ui/time';

import {
  buildOverview,
  continueSeries,
  filterCounts,
  matchesFilter,
  matchesQuery,
  OV_FILTERS,
  OV_SORTS,
  OV_STATUS_LABELS,
  overviewInsights,
  overviewStats,
  playable,
  sortEntries,
  suggestSeries,
  topRated,
  type OvEntry,
  type OvFilter,
  type OvSort,
  type OvVideo,
} from '../overview';
import { fmtMs, ratingLabel } from '../stats';
import { useTabBarSpace } from './chrome';
import Fade from './Fade';
import Glass from './Glass';
import { tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import OverviewDetail, { SeriesMaker } from './OverviewDetail';
import { Cover, fmtStars, ModeSwitch, statusColor, toOvVideo } from './overviewParts';
import { gradient, Ring } from './insightParts';
import { LiveCard, LiveProvider, useLiveScope } from './live';
import { DUR, EASE_OUT, enterUp, PressableScale, useReducedMotion } from './motion';
import { GrowBar, GrowColumn, KenBurns } from './storyKit';
import { OptionsSheet } from './prompts';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { Look, OverviewData, VaultActions, VaultItem, VaultPrefs } from './types';

const SIDE = 16;
const GAP = 10;

export default function OverviewScreen({
  items,
  deletedItems,
  data,
  look,
  prefs,
  actions,
  onPlay,
  onMode,
  onStats,
  onPersonalise,
  devKey,
  devSheet,
  enableVideo = false,
}: {
  /** Play the videos in the cards (off in the browser preview). */
  enableVideo?: boolean;
  items: VaultItem[];
  deletedItems: VaultItem[];
  data: OverviewData;
  look: Look;
  prefs: VaultPrefs;
  actions: VaultActions;
  onPlay: (videoId: string) => void;
  onMode: (m: 'watch' | 'overview') => void;
  onStats: () => void;
  onPersonalise: () => void;
  devKey?: string;
  devSheet?: 'new' | 'edit' | 'add';
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { width } = useWindowDimensions();

  const [filter, setFilter] = useState<OvFilter>('all');
  const [sort, setSort] = useState<OvSort>('recent');
  const [sortMenu, setSortMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [grid, setGrid] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(devKey ?? null);
  const [maker, setMaker] = useState<{ name: string; ids: string[] } | null>(devSheet === 'new' ? { name: '', ids: [] } : null);
  const [plays, setPlays] = useState<{ videoId: string; startedAt: number; watchedMs: number }[]>([]);

  useEffect(() => {
    let live = true;
    actions
      .loadPlays()
      .then((list) => live && setPlays(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [actions, items]);

  const videos = useMemo(() => [...items, ...deletedItems].map(toOvVideo).concat(data.kept), [items, deletedItems, data.kept]);
  const entries = useMemo(() => buildOverview(videos, data.series, data.members, plays), [videos, data.series, data.members, plays]);
  const counts = useMemo(() => filterCounts(entries), [entries]);
  const stats = useMemo(() => overviewStats(entries), [entries]);
  const going = useMemo(() => continueSeries(entries), [entries]);
  const best = useMemo(() => topRated(entries), [entries]);
  const ins = useMemo(() => overviewInsights(entries), [entries]);
  const suggestions = useMemo(
    () => suggestSeries(videos, data.members).filter((s) => !prefs.hiddenSuggestions.includes(s.name)),
    [videos, data.members, prefs.hiddenSuggestions]
  );
  const shown = useMemo(
    () => sortEntries(entries.filter((e) => matchesFilter(e, filter) && matchesQuery(e, query)), sort),
    [entries, filter, query, sort]
  );
  const open = openKey ? (entries.find((e) => e.key === openKey) ?? null) : null;
  const live = useLiveScope({ enableVideo, sound: prefs.liveSound, onSound: (on) => void actions.setPrefs({ ...prefs, liveSound: on }), paused: !!open || !!maker });
  const itemById = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);
  /** The video a title plays: the next episode, or the video itself. */
  const videoOf = (e: OvEntry) => {
    const ep = playable(e);
    return ep ? itemById.get(ep.video.id) : undefined;
  };

  // The spotlight moves through a few titles: what you are watching, your best, what you watched last.
  const spots = useMemo(() => {
    const out: OvEntry[] = [];
    const add = (e: OvEntry | null | undefined) => e && e.cover && !e.gone && !out.some((x) => x.key === e.key) && out.push(e);
    add(ins.spotlight);
    going.slice(0, 2).forEach(add);
    best.slice(0, 2).forEach(add);
    [...entries].filter((e) => e.lastWatchedAt).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0)).slice(0, 2).forEach(add);
    return out.slice(0, 5);
  }, [ins.spotlight, going, best, entries]);
  const [spotAt, setSpotAt] = useState(0);
  useEffect(() => {
    if (spots.length < 2 || open || maker) return;
    const t = setInterval(() => setSpotAt((n) => (n + 1) % spots.length), 9000);
    return () => clearInterval(t);
  }, [spots.length, open, maker, spotAt]);
  const spot = spots[spotAt % Math.max(1, spots.length)];

  // Watched but not rated yet: rate it right here.
  const [justRated, setJustRated] = useState<Set<string>>(new Set());
  const toRate = useMemo(() => entries.filter((e) => !e.gone && e.rating === 0 && e.plays > 0 && !justRated.has(e.key)).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0)).slice(0, 10), [entries, justRated]);
  const rate = (e: OvEntry, n: number) => {
    tick();
    setJustRated((r) => new Set([...r, e.key]));
    const job = e.kind === 'series' ? actions.ovUpdateSeries(e.id, { rating: n }) : actions.onRate(e.id, n);
    job.catch(() => setJustRated((r) => new Set([...r].filter((k) => k !== e.key))));
  };
  const recent = useMemo(() => entries.filter((e) => e.lastWatchedAt && !e.gone).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0)).slice(0, 12), [entries]);
  const surprise = () => {
    const pool = entries.filter((e) => !e.gone && (e.status === 'plantowatch' || e.plays === 0 || (e.kind === 'series' && e.next)));
    const from = pool.length ? pool : entries.filter((e) => !e.gone);
    if (!from.length) return;
    tick();
    setOpenKey(from[Math.floor(Math.random() * from.length)].key);
  };

  const cols = look === 'simple' ? 2 : look === 'compact' ? 4 : 3;
  const asGrid = look === 'simple' || (look !== 'desktop' && look !== 'compact' && look !== 'detailed' && grid);
  const posterW = Math.floor((width - SIDE * 2 - GAP * (cols - 1)) / cols);
  const posterH = Math.round(posterW * 1.42);
  const cardW = Math.min(width - SIDE * 2 - 28, 420);
  const sortLabel = OV_SORTS.find((s) => s.key === sort)?.label ?? '';
  const labels = prefs.ratingLabels;
  const rich = look === 'standard' || look === 'detailed';

  const header = (
    <View style={{ paddingTop: insets.top + 8 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Videos</Text>
        <View style={styles.buttons}>
          <IconButton icon="dice" label="Surprise me" onPress={surprise} />
          <IconButton icon="plus" label="New series" onPress={() => setMaker({ name: '', ids: [] })} />
          <IconButton icon="stats" label="Dashboard, Wrapped and badges" onPress={onStats} />
          <IconButton icon="paint" label="Personalise" onPress={onPersonalise} />
        </View>
      </View>
      <View style={styles.modeRow}>
        <ModeSwitch mode="overview" onChange={onMode} />
      </View>

      {look !== 'simple' && spot && (
        <>
          <Spotlight
            key={spot.key}
            entry={spot}
            video={videoOf(spot)}
            width={width - SIDE * 2}
            onOpen={() => setOpenKey(spot.key)}
            onPlay={() => {
              const ep = playable(spot);
              if (ep) onPlay(ep.video.id);
            }}
          />
          {spots.length > 1 && (
            <View style={styles.spotDots}>
              {spots.map((e, n) => (
                <TouchableOpacity
                  key={e.key}
                  hitSlop={6}
                  onPress={() => {
                    tick();
                    setSpotAt(n);
                  }}
                  accessibilityLabel={`Show ${e.title}`}>
                  <View style={[styles.spotDot, n === spotAt % spots.length && styles.spotDotOn]} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}

      {look !== 'simple' && (
        <Animated.View entering={enterUp(1)} style={styles.stats}>
          <Stat value={String(stats.titles)} label={stats.series ? `titles · ${stats.series} series` : 'titles'} />
          <Stat value={stats.avgRating !== null ? `★ ${fmtStars(stats.avgRating)}` : '–'} label={`average of ${stats.rated} rated`} />
          <Stat value={fmtMs(stats.watchedMs)} label="watched" />
          <View style={styles.stat}>
            <Ring size={40} stroke={5} progress={ins.ratedShare} color={p.rating}>
              <Text style={styles.ringText}>{Math.round(ins.ratedShare * 100)}</Text>
            </Ring>
            <Text style={styles.statLabel}>% rated</Text>
          </View>
        </Animated.View>
      )}

      {look !== 'simple' && entries.length > 0 && (
        <Animated.View entering={enterUp(2)} style={styles.statusCard}>
          <StatusBar parts={ins.statuses} total={Math.max(1, ins.statuses.reduce((a, x) => a + x.count, 0))} />
          <View style={styles.statusLegend}>
            {ins.statuses
              .filter((x) => x.count > 0)
              .map((x) => (
                <TouchableOpacity
                  key={x.key}
                  style={[styles.legendChip, filter === x.key && { backgroundColor: `${STATUS_COLORS[x.key]}33` }]}
                  onPress={() => {
                    tick();
                    setFilter(filter === x.key ? 'all' : x.key);
                  }}>
                  <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS[x.key] }]} />
                  <Text style={styles.legendText}>{x.label}</Text>
                  <Text style={styles.legendCount}>{x.count}</Text>
                </TouchableOpacity>
              ))}
          </View>
          {rich && ins.ratings.some((r) => r.count > 0) && (
            <View style={styles.histo}>
              {ins.ratings.map((r, i) => {
                const max = Math.max(1, ...ins.ratings.map((x) => x.count));
                return (
                  <View key={r.score} style={styles.histoCol}>
                    <Text style={styles.histoCount}>{r.count || ''}</Text>
                    <GrowColumn ratio={r.count / max} height={54} width="70%" color={r.score >= 8 ? p.rating : r.score >= 5 ? `${p.rating}99` : `${p.rating}55`} delay={200 + i * 40} radius={4} />
                    <Text style={styles.histoLabel}>{r.score}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </Animated.View>
      )}

      {going.length > 0 && (
        <>
          <SectionHead title="Continue" detail={`${going.length}`} />
          <FlatList
            horizontal
            data={going}
            keyExtractor={(e) => e.key}
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardW + 12}
            decelerationRate="fast"
            contentContainerStyle={styles.carousel}
            renderItem={({ item }) => (
              <ContinueCard
                entry={item}
                video={videoOf(item)}
                width={cardW}
                onOpen={() => setOpenKey(item.key)}
                onPlay={() => {
                  const ep = playable(item);
                  if (ep) onPlay(ep.video.id);
                }}
              />
            )}
          />
        </>
      )}

      {suggestions.length > 0 && look !== 'simple' && (
        <>
          <SectionHead title="Belong together?" detail={`${suggestions.length}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
            {suggestions.map((s) => {
              const thumbs = s.videoIds
                .slice(0, 3)
                .map((id) => videos.find((v) => v.id === id))
                .filter((v): v is OvVideo => !!v);
              return (
                <View key={s.name} style={[styles.suggest, { width: Math.min(cardW, 320) }]}>
                  <View style={styles.suggestThumbs}>
                    {thumbs.map((v, i) => (
                      <View key={v.id} style={[styles.suggestThumb, { left: i * 18, zIndex: 3 - i, transform: [{ rotate: `${(i - 1) * 4}deg` }] }]}>
                        <Cover source={v.thumb} title={v.title ?? v.filename} width={52} height={70} radius={7} hideTitle />
                      </View>
                    ))}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.suggestTitle} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.suggestSub}>{s.videoIds.length} videos look like one series</Text>
                    <View style={styles.suggestBtns}>
                      <TouchableOpacity style={styles.smallBtn} onPress={() => setMaker({ name: s.name, ids: s.videoIds })}>
                        <Text style={styles.smallBtnText}>Make series</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.smallBtn, styles.smallBtnGhost]}
                        onPress={() => void actions.setPrefs({ ...prefs, hiddenSuggestions: [...prefs.hiddenSuggestions, s.name] })}>
                        <Text style={[styles.smallBtnText, { color: p.textSoft }]}>Hide</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}

      {toRate.length > 0 && look !== 'simple' && (
        <>
          <SectionHead title="Rate what you watched" detail={`${toRate.length}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
            {toRate.map((e, i) => (
              <Animated.View key={e.key} entering={FadeInDown.delay(i * 50).duration(DUR.base).easing(EASE_OUT)} style={styles.rateCard}>
                <TouchableOpacity onPress={() => setOpenKey(e.key)} style={styles.rateHead} accessibilityLabel={`Open ${e.title}`}>
                  <Cover source={e.cover} title={e.title} width={64} height={86} radius={10} hideTitle />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rateTitle} numberOfLines={2}>
                      {e.title}
                    </Text>
                    <Text style={styles.shelfSub} numberOfLines={1}>
                      {e.lastWatchedAt ? `Watched ${fmtAgo(new Date(e.lastWatchedAt).toISOString())}` : `${e.plays} plays`}
                    </Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.rateRow}>
                  {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                    <TouchableOpacity key={n} style={[styles.rateChip, n >= 8 && styles.rateChipHigh]} onPress={() => rate(e, n)} accessibilityLabel={`Rate ${n}`}>
                      <Text style={[styles.rateChipText, n >= 8 && { color: p.rating }]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      {rich && recent.length > 1 && (
        <>
          <SectionHead title="Recently watched" detail={`${recent.length}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {recent.map((e) => (
              <PressableScale key={e.key} style={{ width: 150 }} onPress={() => setOpenKey(e.key)} accessibilityLabel={e.title}>
                <Cover source={e.kind === 'series' ? (e.episodes.find((x) => x.lastWatchedAt === e.lastWatchedAt)?.video.thumb ?? e.cover) : e.cover} title={e.title} width={150} height={92}>
                  {e.rating > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>★ {fmtStars(e.rating)}</Text>
                    </View>
                  )}
                </Cover>
                <Text style={styles.shelfTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={styles.shelfSub} numberOfLines={1}>
                  {e.lastWatchedAt ? fmtAgo(new Date(e.lastWatchedAt).toISOString()) : ''}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>
        </>
      )}

      {rich && ins.planned.length > 0 && (
        <>
          <SectionHead title="Plan to Watch" detail={`${ins.planned.length}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {ins.planned.map((e, i) => (
              <Animated.View key={e.key} entering={FadeInDown.delay(i * 50).duration(DUR.base).easing(EASE_OUT)}>
                <PressableScale style={{ width: 132 }} onPress={() => setOpenKey(e.key)} accessibilityLabel={e.title}>
                  <Cover source={e.cover} title={e.title} width={132} height={88}>
                    <View style={styles.planTag}>
                      <Icon name="bookmark" size={10} color="#fff" />
                    </View>
                  </Cover>
                  <Text style={styles.shelfTitle} numberOfLines={1}>
                    {e.title}
                  </Text>
                  <Text style={styles.shelfSub} numberOfLines={1}>
                    {e.kind === 'series' ? `${e.episodes.length} episodes` : fmtMs(e.totalMs)}
                  </Text>
                </PressableScale>
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      {rich && best.length > 0 && (
        <>
          <SectionHead title="Top Rated" detail={`${best.length}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {best.map((e, i) => (
              <PressableScale key={e.key} style={{ width: 112 }} onPress={() => setOpenKey(e.key)} accessibilityLabel={e.title}>
                <Cover source={e.cover} title={e.title} width={112} height={160}>
                  <View style={styles.rank}>
                    <Text style={styles.rankText}>{i + 1}</Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>★ {fmtStars(e.rating)}</Text>
                  </View>
                </Cover>
                <Text style={styles.shelfTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={styles.shelfSub} numberOfLines={1}>
                  {ratingLabel(e.rating, labels) ?? (e.kind === 'series' ? `${e.episodes.length} episodes` : fmtMs(e.totalMs))}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>
        </>
      )}

      <SectionHead
        title="Library"
        detail={`${entries.length}`}
        action={look === 'standard' ? (grid ? 'List' : 'Grid') : undefined}
        actionIcon={grid ? 'list' : 'grid'}
        onAction={() => {
          tick();
          setGrid(!grid);
        }}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {OV_FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0 || f.key === filter).map((f) => {
          const on = f.key === filter;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => {
                tick();
                setFilter(f.key);
              }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              <Text style={[styles.chipCount, on && styles.chipTextOn]}>{counts[f.key] ?? 0}</Text>
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
              placeholder="Filter titles, episodes, keywords"
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
      {filter === 'removed' && (
        <Text style={styles.hint}>Removed for good from ReelVault. The videos are gone; their ratings and info are kept here.</Text>
      )}
      {look === 'desktop' && shown.length > 0 && (
        <View style={styles.thead}>
          <Text style={[styles.th, { flex: 3 }]}>Title</Text>
          <Text style={[styles.th, { flex: 1.4 }]}>Status</Text>
          <Text style={[styles.th, styles.thRight, { flex: 0.8 }]}>Eps</Text>
          <Text style={[styles.th, styles.thRight, { flex: 1 }]}>Plays</Text>
          <Text style={[styles.th, styles.thRight, { flex: 0.8 }]}>★</Text>
        </View>
      )}
      {shown.length === 0 && (
        <View style={styles.emptyBox}>
          <Icon name="videos" size={34} color={p.textMuted} />
          <Text style={styles.empty}>
            {entries.length === 0 ? 'Import videos in Watch mode, then rate and track them here.' : query ? 'Nothing matches.' : 'Nothing here.'}
          </Text>
        </View>
      )}
    </View>
  );

  const footer = <View style={{ height: (tabSpace > 0 ? tabSpace : insets.bottom) + 30 }} />;

  return (
    <LiveProvider value={live.value}>
    <View style={styles.screen}>
      {asGrid ? (
        <FlatList
          {...live.scrollProps}
          key={`grid-${cols}`}
          data={shown}
          keyExtractor={(e) => e.key}
          numColumns={cols}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          columnWrapperStyle={styles.gridRow}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <Animated.View entering={index < 24 ? FadeInDown.delay(Math.min(index, 18) * 35).duration(DUR.base).easing(EASE_OUT) : undefined}>
              <GridPoster entry={item} width={posterW} height={posterH} bare={look === 'simple'} onPress={() => setOpenKey(item.key)} />
            </Animated.View>
          )}
        />
      ) : (
        <FlatList
          {...live.scrollProps}
          key="list"
          data={shown}
          keyExtractor={(e) => e.key}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) =>
            look === 'desktop' ? (
              <TableRow entry={item} odd={index % 2 === 1} onPress={() => setOpenKey(item.key)} />
            ) : look === 'compact' ? (
              <CompactRow entry={item} onPress={() => setOpenKey(item.key)} />
            ) : (
              <Row entry={item} detailed={look === 'detailed'} labels={labels} onPress={() => setOpenKey(item.key)} />
            )
          }
        />
      )}

      {sortMenu && (
        <OptionsSheet
          title="Sort by"
          options={OV_SORTS.map((s) => ({ label: s.label, hint: s.key === sort ? 'Selected' : undefined, onPress: () => setSort(s.key) }))}
          onClose={() => setSortMenu(false)}
        />
      )}

      {open && (
        <OverviewDetail
          entry={open}
          entries={entries}
          videos={videos}
          items={items}
          members={data.members}
          labels={labels}
          actions={actions}
          devSheet={devSheet === 'edit' || devSheet === 'add' ? devSheet : undefined}
          onPlay={onPlay}
          onOpen={setOpenKey}
          onClose={() => setOpenKey(null)}
        />
      )}

      {maker && (
        <SeriesMaker
          title="New series"
          initialName={maker.name}
          initialIds={maker.ids}
          videos={videos}
          members={data.members}
          series={data.series}
          onClose={() => setMaker(null)}
          onDone={async (name, ids) => {
            const id = await actions.ovCreateSeries(name, ids);
            setMaker(null);
            setOpenKey(`s:${id}`);
          }}
        />
      )}
    </View>
    </LiveProvider>
  );
}

const STATUS_COLORS: Record<string, string> = { watching: '#0A84FF', plantowatch: '#BF5AF2', completed: '#30D158', hold: '#FF9F0A', dropped: '#FF453A' };

/** One bar split by status, growing in from the left. */
function StatusBar({ parts, total }: { parts: { key: string; count: number }[]; total: number }) {
  const styles = useStyles(makeStyles);
  const reduce = useReducedMotion();
  const k = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) k.value = withTiming(1, { duration: 900, easing: EASE_OUT });
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const grow = useAnimatedStyle(() => ({ width: `${k.value * 100}%` }));
  return (
    <View style={styles.statusTrack}>
      <Animated.View style={[{ flexDirection: 'row', height: '100%', gap: 2 }, grow]}>
        {parts
          .filter((x) => x.count > 0)
          .map((x) => (
            <View key={x.key} style={{ flex: x.count / total, backgroundColor: STATUS_COLORS[x.key], borderRadius: 4 }} />
          ))}
      </Animated.View>
    </View>
  );
}

/** The title at the top: its picture moving slowly, what it is, and play. */
function Spotlight({ entry, video, width, onOpen, onPlay }: { entry: OvEntry; video?: VaultItem; width: number; onOpen: () => void; onPlay: () => void }) {
  const styles = useStyles(makeStyles);
  const canPlay = !!playable(entry);
  const kicker = entry.status === 'watching' && entry.next ? 'CONTINUE WATCHING' : entry.rating > 0 ? 'ONE OF YOUR BEST' : 'SPOTLIGHT';
  const progress = entry.episodes.length ? entry.watchedCount / entry.episodes.length : 0;
  return (
    <Animated.View entering={enterUp(0)}>
      <PressableScale style={[styles.spot, { width, height: Math.min(330, width * 0.82) }]} onPress={onOpen} scaleTo={0.98} accessibilityLabel={`${entry.title}. Open`}>
        <LiveCard
          id={`ov-spot-${entry.key}`}
          uri={video?.uri}
          durationMs={video?.durationMs}
          cover={(video?.thumbSource ?? entry.cover ?? undefined) as VaultItem['thumbSource']}
          radius={0}
          priority={3}
          style={styles.fill}
          video={video}
          soundStyle={{ top: 14, right: 14 }}
          under={<KenBurns source={entry.cover ?? undefined} ms={18000} seed={entry.title.length} />}
        />
        <View pointerEvents="none" style={[styles.fill, gradient('linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.6) 68%, rgba(0,0,0,0.94) 100%)', 'rgba(0,0,0,0.35)')]} />
        <View style={styles.spotBody}>
          <Text style={styles.spotKicker}>{kicker}</Text>
          <Text style={styles.spotTitle} numberOfLines={2}>
            {entry.title}
          </Text>
          <Text style={styles.spotMeta} numberOfLines={1}>
            {[entry.rating > 0 ? `★ ${fmtStars(entry.rating)}` : null, entry.kind === 'series' ? `${entry.watchedCount} of ${entry.episodes.length} episodes` : fmtMs(entry.totalMs), OV_STATUS_LABELS[entry.status]].filter(Boolean).join(' · ')}
          </Text>
          {entry.kind === 'series' && entry.episodes.length > 0 && (
            <View style={styles.spotBar}>
              <GrowBar share={progress} color="#fff" track="rgba(255,255,255,0.25)" height={5} delay={300} />
            </View>
          )}
          <View style={styles.spotButtons}>
            {canPlay && (
              <TouchableOpacity style={styles.spotPlay} onPress={onPlay}>
                <Icon name="play" size={15} color="#000" />
                <Text style={styles.spotPlayText}>{entry.next && entry.kind === 'series' ? `Episode ${entry.next.number}` : 'Play'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.spotInfo} onPress={onOpen}>
              <Icon name="info" size={15} color="#fff" />
              <Text style={styles.spotInfoText}>Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, value.length > 7 && { fontSize: 15 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
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

/** A series you are in the middle of: its picture, the next episode, and play. */
function ContinueCard({ entry, video, width, onOpen, onPlay }: { entry: OvEntry; video?: VaultItem; width: number; onOpen: () => void; onPlay: () => void }) {
  const styles = useStyles(makeStyles);
  const next = entry.next;
  const canPlay = !!playable(entry);
  const progress = entry.episodes.length ? entry.watchedCount / entry.episodes.length : 0;
  const art = next?.video.thumb ?? entry.cover;
  return (
    <PressableScale style={[styles.upCard, { width }]} onPress={onOpen} scaleTo={0.98} accessibilityLabel={`${entry.title}, episode ${next?.number}`}>
      {art ? (
        <LiveCard
          id={`ov-up-${entry.key}`}
          uri={video?.uri}
          durationMs={video?.durationMs}
          cover={art as VaultItem['thumbSource']}
          radius={0}
          style={styles.fill}
          video={video}
          soundStyle={{ top: 10, right: 10 }}
        />
      ) : (
        <View style={[styles.fill, { backgroundColor: `hsl(${hueFor(entry.title)}, 38%, 24%)` }]} />
      )}
      <Fade color="0,0,0" from={0} to={0.9} style={[styles.fill, { top: '20%' }]} />
      <View style={styles.upBody}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.upTitle} numberOfLines={1}>
            {entry.title}
          </Text>
          {next && (
            <Text style={styles.upEp} numberOfLines={1}>
              <Text style={styles.upCode}>Ep {next.number}</Text> {next.name}
            </Text>
          )}
          <Text style={styles.upMeta}>
            {entry.watchedCount} of {entry.episodes.length} watched
            {entry.lastWatchedAt ? ` · ${fmtAgo(new Date(entry.lastWatchedAt).toISOString())}` : ''}
          </Text>
        </View>
        {canPlay && (
          <TouchableOpacity onPress={onPlay} accessibilityLabel="Play next episode" hitSlop={8}>
            <Glass interactive clear fallback="rgba(255,255,255,0.22)" style={styles.upPlay}>
              <Icon name="play" size={20} color="#fff" />
            </Glass>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.upTrack}>
        <View style={[styles.upFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
    </PressableScale>
  );
}

function GridPoster({ entry, width, height, bare, onPress }: { entry: OvEntry; width: number; height: number; bare?: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const series = entry.kind === 'series';
  const progress = series && entry.episodes.length ? entry.watchedCount / entry.episodes.length : 0;
  return (
    <PressableScale style={{ width }} onPress={onPress} accessibilityLabel={entry.title}>
      {series && (
        <>
          <View style={[styles.stack2, { width: width - 16 }]} />
          <View style={[styles.stack1, { width: width - 8 }]} />
        </>
      )}
      <Cover source={entry.cover} title={entry.title} width={width} height={height}>
        {entry.gone && (
          <View style={styles.goneVeil}>
            <Text style={styles.goneText}>Removed</Text>
          </View>
        )}
        {!bare && entry.rating > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>★ {fmtStars(entry.rating)}</Text>
          </View>
        )}
        {series && (
          <View style={styles.epBadge}>
            <Icon name="lists" size={10} color="#fff" />
            <Text style={styles.epBadgeText}>{entry.episodes.length}</Text>
          </View>
        )}
        {series && progress > 0 && (
          <View style={styles.gridTrack}>
            <View style={[styles.gridFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
      </Cover>
      {!bare && (
        <>
          <Text style={styles.gridTitle} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={styles.gridSub} numberOfLines={1}>
            {series ? `${entry.watchedCount}/${entry.episodes.length} episodes` : `${OV_STATUS_LABELS[entry.status]}${entry.totalMs ? ` · ${fmtMs(entry.totalMs)}` : ''}`}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

function Row({ entry, detailed, labels, onPress }: { entry: OvEntry; detailed?: boolean; labels: VaultPrefs['ratingLabels']; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const series = entry.kind === 'series';
  const word = ratingLabel(entry.rating, labels);
  const progress = series && entry.episodes.length ? entry.watchedCount / entry.episodes.length : 0;
  return (
    <PressableScale style={styles.row} onPress={onPress} accessibilityLabel={entry.title} scaleTo={0.98}>
      <Cover source={entry.cover} title={entry.title} width={64} height={92} radius={8} hideTitle>
        {entry.gone && <View style={[styles.goneVeil, { justifyContent: 'center' }]} />}
      </Cover>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.title}
        </Text>
        <View style={styles.rowLine}>
          <Text style={[styles.rowStatus, { color: statusColor(p, entry.status) }]}>{OV_STATUS_LABELS[entry.status]}</Text>
          <Text style={styles.rowMeta}>
            {series ? `${entry.watchedCount}/${entry.episodes.length} episodes` : entry.totalMs ? fmtMs(entry.totalMs) : 'Video'}
          </Text>
          {entry.gone && <Text style={styles.rowGone}>Removed</Text>}
        </View>
        {series && (
          <View style={styles.rowTrack}>
            <View style={[styles.rowFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
        <Text style={styles.rowRating} numberOfLines={1}>
          {entry.rating > 0 ? `★ ${fmtStars(entry.rating)}${word ? `  ${word}` : ''}` : 'Not rated'}
          {series && entry.episodeAvg !== null ? <Text style={styles.rowAvg}>{`   episodes ★ ${fmtStars(entry.episodeAvg)}`}</Text> : null}
        </Text>
        {detailed && (
          <Text style={styles.rowDate} numberOfLines={2}>
            {[
              entry.plays ? `${entry.plays} plays · ${fmtMs(entry.watchedMs)} watched` : 'Never played',
              entry.lastWatchedAt ? `last ${fmtAgo(new Date(entry.lastWatchedAt).toISOString())}` : null,
              entry.tags.length ? entry.tags.slice(0, 3).join(', ') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}
        {detailed && !!entry.description && (
          <Text style={styles.rowMemo} numberOfLines={2}>
            {entry.description}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

function CompactRow({ entry, onPress }: { entry: OvEntry; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <TouchableOpacity style={styles.crow} onPress={onPress} accessibilityLabel={entry.title}>
      <Cover source={entry.cover} title={entry.title} width={30} height={42} radius={5} hideTitle />
      <Text style={[styles.ctitle, entry.gone && { color: p.textSecondary }]} numberOfLines={1}>
        {entry.title}
      </Text>
      {entry.kind === 'series' && (
        <Text style={styles.cnext}>
          {entry.watchedCount}/{entry.episodes.length}
        </Text>
      )}
      <View style={[styles.dot, { backgroundColor: statusColor(p, entry.status) }]} />
      {entry.rating > 0 && <Text style={styles.cmine}>★{fmtStars(entry.rating)}</Text>}
    </TouchableOpacity>
  );
}

function TableRow({ entry, odd, onPress }: { entry: OvEntry; odd: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <TouchableOpacity style={[styles.trow, odd && styles.trowAlt]} onPress={onPress} accessibilityLabel={entry.title}>
      <View style={{ flex: 3, flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 6 }}>
        <Cover source={entry.cover} title={entry.title} width={22} height={31} radius={3} hideTitle />
        <Text style={styles.tname} numberOfLines={1}>
          {entry.title}
        </Text>
      </View>
      <Text style={[styles.td, { flex: 1.4, color: statusColor(p, entry.status) }]} numberOfLines={1}>
        {entry.gone ? 'Removed' : OV_STATUS_LABELS[entry.status]}
      </Text>
      <Text style={[styles.td, styles.thRight, { flex: 0.8 }]}>{entry.kind === 'series' ? `${entry.watchedCount}/${entry.episodes.length}` : '–'}</Text>
      <Text style={[styles.td, styles.thRight, { flex: 1 }]}>{entry.plays || '–'}</Text>
      <Text style={[styles.td, styles.thRight, { flex: 0.8, color: entry.rating ? p.rating : p.textMuted }]}>{entry.rating > 0 ? fmtStars(entry.rating) : '–'}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, paddingTop: 6 },
    title: { flex: 1, color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
    buttons: { flexDirection: 'row', gap: 8 },
    modeRow: { paddingHorizontal: SIDE, paddingTop: 10 },

    stats: { flexDirection: 'row', gap: 8, paddingHorizontal: SIDE, paddingTop: 14 },
    ringText: { color: p.text, fontSize: 12, fontWeight: '900' },
    spot: { marginHorizontal: SIDE, marginTop: 14, borderRadius: 26, overflow: 'hidden', backgroundColor: p.elevated, justifyContent: 'flex-end' },
    spotDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
    spotDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: p.textMuted, opacity: 0.5 },
    spotDotOn: { width: 18, backgroundColor: p.text, opacity: 1 },
    rateCard: { width: 260, gap: 10, padding: 12, borderRadius: 18, backgroundColor: p.elevated },
    rateHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    rateTitle: { color: p.text, fontSize: 15, fontWeight: '800' },
    rateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
    rateChip: { width: 42, height: 32, borderRadius: 9, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    rateChipHigh: { borderWidth: 1, borderColor: `${p.rating}66` },
    rateChipText: { color: p.text, fontSize: 14, fontWeight: '800' },
    spotBody: { padding: 18, gap: 5 },
    spotKicker: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
    spotTitle: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -0.8, lineHeight: 33 },
    spotMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
    spotBar: { marginTop: 4, width: '60%' },
    spotButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
    spotPlay: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
    spotPlayText: { color: '#000', fontSize: 15, fontWeight: '800' },
    spotInfo: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11 },
    spotInfoText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    statusCard: { marginHorizontal: SIDE, marginTop: 10, backgroundColor: p.elevated, borderRadius: 18, padding: 14, gap: 12 },
    statusTrack: { height: 12, borderRadius: 6, backgroundColor: p.card, overflow: 'hidden' },
    statusLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    legendChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: p.card },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { color: p.text, fontSize: 12, fontWeight: '700' },
    legendCount: { color: p.textSecondary, fontSize: 12, fontWeight: '800' },
    histo: { flexDirection: 'row', alignItems: 'flex-end', height: 86, gap: 2 },
    histoCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
    histoCount: { color: p.textSecondary, fontSize: 10, fontWeight: '800' },
    histoLabel: { color: p.textMuted, fontSize: 10, fontWeight: '800' },
    planTag: { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#BF5AF2', alignItems: 'center', justifyContent: 'center' },
    stat: { flex: 1, backgroundColor: p.elevated, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
    statValue: { color: p.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
    statLabel: { color: p.textSecondary, fontSize: 11, fontWeight: '600' },

    sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: SIDE, paddingTop: 22, paddingBottom: 10 },
    sectionTitle: { color: p.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
    sectionDetail: { color: p.textSecondary, fontSize: 15, fontWeight: '600' },
    sectionAction: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
    sectionActionText: { color: p.link, fontSize: 15, fontWeight: '600' },

    carousel: { gap: 12, paddingHorizontal: SIDE },
    upCard: { height: 180, borderRadius: 20, overflow: 'hidden', backgroundColor: p.elevated, justifyContent: 'flex-end' },
    upBody: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
    upTitle: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    upEp: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '600' },
    upCode: { color: '#fff', fontWeight: '800' },
    upMeta: { color: 'rgba(255,255,255,0.66)', fontSize: 12, fontWeight: '600' },
    upPlay: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
    upTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
    upFill: { height: 4, backgroundColor: p.accent },

    suggest: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: p.elevated, borderRadius: 18, padding: 14 },
    suggestThumbs: { width: 92, height: 74 },
    suggestThumb: { position: 'absolute', top: 2, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    suggestTitle: { color: p.text, fontSize: 16, fontWeight: '800' },
    suggestSub: { color: p.textSecondary, fontSize: 12 },
    suggestBtns: { flexDirection: 'row', gap: 8, marginTop: 6 },
    smallBtn: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    smallBtnGhost: { backgroundColor: p.card },
    smallBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

    shelf: { gap: 12, paddingHorizontal: SIDE },
    shelfTitle: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
    shelfSub: { color: p.textSecondary, fontSize: 12 },
    rank: { position: 'absolute', bottom: 6, left: 6, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 5, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
    rankText: { color: '#fff', fontSize: 12, fontWeight: '900' },

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
    hint: { color: p.textSecondary, fontSize: 12, paddingHorizontal: SIDE, paddingTop: 8 },
    emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 34, paddingHorizontal: 30 },
    empty: { color: p.textSecondary, fontSize: 15, textAlign: 'center' },

    gridRow: { gap: GAP, paddingHorizontal: SIDE, marginTop: 14 },
    stack1: { position: 'absolute', top: -4, left: 4, height: 10, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: p.textMuted, opacity: 0.55 },
    stack2: { position: 'absolute', top: -8, left: 8, height: 10, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: p.textMuted, opacity: 0.3 },
    badge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { color: p.rating, fontSize: 11, fontWeight: '800' },
    epBadge: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
    epBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    goneVeil: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10 },
    goneText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
    gridTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.55)' },
    gridFill: { height: 4, backgroundColor: p.accent },
    gridTitle: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
    gridSub: { color: p.textSecondary, fontSize: 12 },

    row: { flexDirection: 'row', gap: 14, paddingHorizontal: SIDE, paddingVertical: 9 },
    rowText: { flex: 1, gap: 4, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: p.separator, paddingBottom: 9 },
    rowTitle: { color: p.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
    rowLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
    rowStatus: { fontSize: 14, fontWeight: '700' },
    rowMeta: { color: p.textSoft, fontSize: 14, fontWeight: '600' },
    rowGone: { color: p.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
    rowRating: { color: p.rating, fontSize: 13, fontWeight: '700' },
    rowAvg: { color: p.textSecondary, fontWeight: '600' },
    rowTrack: { height: 4, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginVertical: 2 },
    rowFill: { height: 4, borderRadius: 2, backgroundColor: p.accent },
    rowDate: { color: p.textSecondary, fontSize: 12 },
    rowMemo: { color: p.textSoft, fontSize: 12, fontStyle: 'italic' },

    crow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SIDE, paddingVertical: 5 },
    ctitle: { flex: 1, color: p.text, fontSize: 15, fontWeight: '600' },
    cnext: { color: p.link, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    dot: { width: 8, height: 8, borderRadius: 4 },
    cmine: { color: p.rating, fontSize: 12, fontWeight: '800', minWidth: 30, textAlign: 'right' },

    thead: { flexDirection: 'row', marginTop: 12, paddingHorizontal: SIDE, paddingVertical: 7, backgroundColor: p.panel, borderBottomWidth: 1, borderBottomColor: p.border },
    th: { color: p.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    thRight: { textAlign: 'right' },
    trow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, height: 42 },
    trowAlt: { backgroundColor: p.elevated },
    tname: { flex: 1, color: p.text, fontSize: 13, fontWeight: '600' },
    td: { color: p.textSoft, fontSize: 12, fontVariant: ['tabular-nums'] },
  });
