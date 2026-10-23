/**
 * My Videos, in six tabs:
 * - Dashboard: weekly goal, things the app noticed, watch time for a period
 *   against the time before, memories, favourites to rediscover, habits,
 *   taste, ratings and how complete the library is (DashboardUI);
 * - History: everything you watched, day by day, and Stats (HistoryUI);
 * - Memories: your videos made into little films (MemoriesUI);
 * - Wrapped: your year, months, weeks or any range, as a story that plays
 *   your videos (WrappedUI);
 * - Badges: level, showcase, records, journey, ladders, one-offs and monthly
 *   challenges (BadgesUI);
 * - Storage: what takes the space, how it grew, and ways to free some.
 * Presentational only: plays and Simkl numbers come in through callbacks.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from './screen';
import { Image } from 'expo-image';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RankedBars } from '@/features/simkl/ui/charts';
import type { SimklBridge } from '@/features/simkl/ui/types';

import { achievements, summarize, type AchEvent, type AchInput, listeningFrom, readingFrom, type AchListening, type AchReading } from '../achievements';
import { buildOverview } from '../overview';
import { customMemory, homeOf, memories as buildMemories, type CustomMemory, type Memory } from '../memories';
import { growth, journey, levelFor, monthRanges, personalRecords, spaceForecast, spaceGrade, spaceIdeas, storyFacts, treemap, yearRange } from '../recap';
import { fmtBytes, fmtMs, recentWeeks, storageStats, wrapped as buildWrapped, type Range, type RatingLabels, type VaultPlay } from '../stats';
import Badges from './BadgesUI';
import Dashboard from './DashboardUI';
import HistoryTab from './HistoryUI';
import { LiveProvider, useLiveScope } from './live';
import type { Filter } from './filters';
import { tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import type { IconName } from './icons';
import { Bars, Card, gradient, Ring, StatTile } from './insightParts';
import { DUR, enterUp, PressableScale, SPRING } from './motion';
import { MemoriesTab, MemoryPlayer } from './MemoriesUI';
import { AppSpaceCard, ImportShrinkCard, SpacePlanner, TrashCard } from './storageParts';
import { settleFreezes } from '../streakFreeze';
import { Aurora, CountUp, GrowBar } from './storyKit';
import { toOvVideo } from './overviewParts';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import { DEFAULT_VAULT_PREFS, type OverviewData, type VaultActions, type VaultItem, type VaultPrefs } from './types';
import { previous, WrappedPicker, WrappedStory, type StoryInput, type WrappedGroup } from './WrappedUI';
import { clubFor, yearBefore } from '../wrappedExtras';
import { EMPTY_OV_EXTRA, type OvExtra } from '../ovExtra';
import { playable } from '../overview';

/** Adds to a list in a map (in place: building lists by copying gets slow with thousands of videos). */
function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export type InsightsTab = 'dashboard' | 'history' | 'memories' | 'wrapped' | 'badges' | 'storage';

type SimklNumbers = Awaited<ReturnType<SimklBridge['insights']>>;

const TABS: { key: InsightsTab; label: string; icon: IconName; color: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', color: '#0A84FF' },
  { key: 'history', label: 'History', icon: 'history', color: '#30B0C7' },
  { key: 'memories', label: 'Memories', icon: 'memories', color: '#FF375F' },
  { key: 'wrapped', label: 'Wrapped', icon: 'sparkle', color: '#BF5AF2' },
  { key: 'badges', label: 'Badges', icon: 'trophy', color: '#FF9F0A' },
  { key: 'storage', label: 'Storage', icon: 'storage', color: '#30D158' },
];

/** The tab bar: icons in coloured squares, a pill that slides to the chosen one. */
function TabStrip({ value, onChange, dots = {} }: { value: InsightsTab; onChange: (t: InsightsTab) => void; dots?: Partial<Record<InsightsTab, number>> }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [w, setW] = useState(0);
  const idx = TABS.findIndex((t) => t.key === value);
  const x = useSharedValue(0);
  useEffect(() => {
    if (w) x.value = withSpring(idx * (w / TABS.length), SPRING);
  }, [idx, w]); // eslint-disable-line react-hooks/exhaustive-deps
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={styles.tabs} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {w > 0 && <Animated.View style={[styles.tabPill, { width: w / TABS.length }, pill]} />}
      {TABS.map((t) => {
        const on = t.key === value;
        return (
          <TouchableOpacity key={t.key} style={styles.tab} onPress={() => onChange(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={[styles.tabIcon, { backgroundColor: on ? t.color : `${t.color}22` }]}>
              <Icon name={t.icon} size={14} color={on ? '#fff' : t.color} />
              {!!dots[t.key] && (
                <Animated.View entering={ZoomIn.springify()} style={styles.tabDot}>
                  <Text style={styles.tabDotText}>{dots[t.key]! > 9 ? '9+' : dots[t.key]}</Text>
                </Animated.View>
              )}
            </View>
            <Text style={[styles.tabText, on && { color: p.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type ReadingSeries = { isPrivate: boolean; deletedAt: number | null; rating: number; status: string | null; finishedAt: number | null; chapters: { readAt: number | null; pageCount: number }[] };
type ListeningItem = { isPrivate: boolean; kind: string; deletedAt: number | null; rating: number; finishedAt: number | null };

export default function VideoInsightsModal({
  initialTab = 'dashboard',
  items,
  deleted,
  albums,
  albumList = [],
  smartFilters = 0,
  overview,
  prefs = DEFAULT_VAULT_PREFS,
  enableVideo = true,
  freeGb = null,
  duplicateGroups = [],
  actions,
  simkl,
  ratingLabels,
  initialWrapped,
  initialMemory,
  initialMemoryKind,
  initialYear,
  initialMonth,
  initialWeek,
  initialHistoryStats,
  onOpenVideo,
  onMakeSmaller,
  onFilter,
  onClose,
  reading,
  listening,
}: {
  /** The Manga section, for the Reading badges. */
  reading?: { items: ReadingSeries[]; loadReads: () => Promise<{ startedAt: number; readMs: number; pages: number }[]> };
  /** The Audio section, for the Listening badges. */
  listening?: { items: ListeningItem[]; loadPlays: () => Promise<{ startedAt: number; listenedMs: number }[]> };
  initialTab?: InsightsTab;
  items: VaultItem[];
  deleted: VaultItem[];
  albums: number;
  /** Album names, for making a memory from one. */
  albumList?: { id: number; name: string }[];
  smartFilters?: number;
  /** Series and removed videos, for their badges and Wrapped. */
  overview?: OverviewData;
  prefs?: VaultPrefs;
  /** Play videos in Wrapped (off in the browser preview). */
  enableVideo?: boolean;
  freeGb?: number | null;
  duplicateGroups?: string[][];
  actions: VaultActions;
  simkl?: SimklBridge;
  ratingLabels: RatingLabels;
  /** Open straight into last week's Wrapped (from the Monday notification). */
  initialWrapped?: boolean;
  /** Play the first memory straight away (the browser preview). */
  initialMemory?: boolean;
  /** Play the first memory of this kind (the On this day notification). */
  /** onThisDay: that memory (the notification); today: it, or the top memory for you (a quick link). */
  initialMemoryKind?: 'onThisDay' | 'today';
  /** Open this year's Wrapped (the 1 December notification). */
  initialYear?: boolean;
  /** Open last month's Wrapped (the monthly notification was tapped). */
  initialMonth?: boolean;
  /** Open this week's Wrapped (the Sunday summary was tapped). */
  initialWeek?: boolean;
  /** Open History on Stats (the browser preview). */
  initialHistoryStats?: boolean;
  onOpenVideo: (id: string) => void;
  onMakeSmaller: (ids: string[]) => void;
  /** Close and show these videos in the library (Recently Deleted, duplicates…). */
  onFilter?: (f: Filter) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [tab, setTab] = useState<InsightsTab>(initialTab);
  const [plays, setPlays] = useState<VaultPlay[] | null>(null);
  // Streak freezes: earned for good weeks, spent on a missed day (settled once the plays are in).
  useEffect(() => {
    if (!plays) return;
    const known = new Set(items.map((v) => v.id));
    const next = settleFreezes(plays.filter((x) => known.has(x.videoId)).map((x) => x.startedAt), prefsRef.current.freezes, Date.now());
    if (next !== prefsRef.current.freezes) savePrefs({ freezes: next });
  }, [plays]); // eslint-disable-line react-hooks/exhaustive-deps
  const [bookmarks, setBookmarks] = useState(0);
  const [readingIn, setReadingIn] = useState<AchReading | null>(null);
  const [listeningIn, setListeningIn] = useState<AchListening | null>(null);
  useEffect(() => {
    if (!reading) return;
    const mine = reading.items.filter((s) => !s.isPrivate);
    reading
      .loadReads()
      .then((r) => setReadingIn(readingFrom(mine, r)))
      .catch(() => setReadingIn(readingFrom(mine, [])));
  }, [reading?.items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!listening) return;
    const mine = listening.items.filter((a) => !a.isPrivate);
    listening
      .loadPlays()
      .then((x) => setListeningIn(listeningFrom(mine, x)))
      .catch(() => setListeningIn(listeningFrom(mine, [])));
  }, [listening?.items]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sk, setSk] = useState<SimklNumbers | null>(null);
  const [story, setStory] = useState<StoryInput | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  // Changes go through one ref so two quick changes (a favourite and its badge event) never undo each other.
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const savePrefs = (patch: Partial<VaultPrefs> | ((p: VaultPrefs) => Partial<VaultPrefs>)) => {
    const cur = prefsRef.current;
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
    prefsRef.current = next;
    void actions.setPrefs(next);
  };
  const logEvent = (k: string, v?: string) => savePrefs((cur) => ({ events: [...cur.events, { k, at: Date.now(), ...(v ? { v } : {}) } as AchEvent].slice(-3000) }));

  const live = useLiveScope({ enableVideo, sound: prefs.liveSound, onSound: (on) => savePrefs({ liveSound: on }), paused: !!memory || !!story });

  const [ovx, setOvx] = useState<OvExtra>(EMPTY_OV_EXTRA);
  useEffect(() => {
    actions.loadOvExtra().then(setOvx).catch(() => undefined);
  }, [actions]);
  useEffect(() => {
    actions.loadPlays().then(setPlays).catch(() => setPlays([]));
    actions.countBookmarks().then(setBookmarks).catch(() => undefined);
    if (simkl?.connected) simkl.insights().then(setSk).catch(() => undefined);
  }, [actions, simkl]);

  const thumbs = useMemo(() => new Map(items.map((v) => [v.id, v.thumbSource])), [items]);
  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);

  const entries = useMemo(
    () => (overview && plays ? buildOverview(items.map(toOvVideo).concat(overview.kept), overview.series, overview.members, plays) : []),
    [overview, items, plays]
  );

  const located = useMemo(() => items.map((v) => ({ ...v, location: v.meta?.location ?? null })), [items]);
  const memoryList = useMemo(() => {
    if (!plays) return [];
    const mine = prefs.customMemories.map((c) => customMemory(c, located, plays)).filter((m): m is Memory => !!m);
    return [...mine, ...buildMemories(located, plays, Date.now())];
  }, [located, plays, prefs.customMemories]);
  const home = useMemo(() => homeOf(located), [located]);
  const achInput = useMemo<AchInput | null>(() => {
    if (!plays) return null;
    return {
      videos: located,
      plays,
      bookmarks,
      albums,
      smartFilters,
      series: overview?.series.length ?? 0,
      seriesFinished: entries.filter((e) => e.kind === 'series' && e.episodes.length > 0 && e.watchedCount === e.episodes.length).length,
      kept: overview?.kept.length ?? 0,
      simkl: sk
        ? {
            episodes: sk.events.filter((e) => e.type !== 'movie').length,
            movies: sk.events.filter((e) => e.type === 'movie').length,
            completed: sk.items.filter((i) => i.type !== 'movie' && i.status === 'completed').length,
            rewatches: sk.events.filter((e) => e.rewatch).length,
            lists: sk.lists ?? 0,
            times: sk.events.map((e) => e.at),
          }
        : null,
      memories: { total: memoryList.filter((m) => m.kind !== 'custom').length, trips: memoryList.filter((m) => m.kind === 'trip').length },
      home,
      reading: readingIn,
      listening: listeningIn,
      events: prefs.events,
      now: Date.now(),
    };
  }, [plays, located, bookmarks, albums, smartFilters, overview, sk, entries, memoryList, home, prefs.events, readingIn, listeningIn]);
  const badgeList = useMemo(() => (achInput ? achievements(achInput) : []), [achInput]);
  const badgeAll = useMemo(() => (achInput ? achievements(achInput, { everyStep: true }) : []), [achInput]);
  // Badges earned since you last looked. The very first time, everything already earned counts as seen.
  const fresh = useMemo(() => (prefs.badgesSeen === null ? [] : badgeList.filter((a) => a.unlocked && !prefs.badgesSeen!.includes(a.id))), [badgeList, prefs.badgesSeen]);
  useEffect(() => {
    if (plays && prefs.badgesSeen === null && badgeList.length) savePrefs({ badgesSeen: badgeList.filter((a) => a.unlocked).map((a) => a.id) });
  }, [plays, badgeList]); // eslint-disable-line react-hooks/exhaustive-deps
  const markBadgesSeen = () => savePrefs((cur) => ({ badgesSeen: [...new Set([...(cur.badgesSeen ?? []), ...badgeList.filter((a) => a.unlocked).map((a) => a.id)])] }));
  const newMemories = memoryList.filter((m) => !prefs.memoriesSeen.includes(m.id) && !prefs.memoryHidden.includes(m.id) && m.kind !== 'custom').length;
  const tags = useMemo(() => [...new Set(items.flatMap((v) => v.tagNames))].sort((a, b) => a.localeCompare(b)), [items]);
  const level = useMemo(() => {
    const s = summarize(badgeList);
    const watched = (plays ?? []).filter((x) => byId.has(x.videoId)).reduce((a, x) => a + x.watchedMs, 0);
    return levelFor(s.points, watched, items.length);
  }, [badgeList, plays, items, byId]);
  const records = useMemo(() => personalRecords(items, plays ?? [], fmtMs), [items, plays]);
  const milestones = useMemo(
    () =>
      journey(
        items,
        plays ?? [],
        badgeList.filter((a) => a.unlocked && a.earnedAt !== null).map((a) => ({ at: a.earnedAt!, title: a.title, videoId: a.videoId, icon: a.icon }))
      ),
    [items, plays, badgeList]
  );

  // The browser preview can open a memory straight away (`/preview?view=memory`).
  useEffect(() => {
    if (initialMemory && memoryList.length && !memory) setMemory(memoryList.find((m) => m.kind !== 'custom') ?? memoryList[0]);
  }, [initialMemory, memoryList]); // eslint-disable-line react-hooks/exhaustive-deps
  // From the On this day notification: today's memory, if there still is one.
  const askedKind = useRef(false);
  useEffect(() => {
    if (!initialMemoryKind || askedKind.current || !plays) return;
    askedKind.current = true;
    const m =
      initialMemoryKind === 'today'
        ? (memoryList.find((x) => x.kind === 'onThisDay') ?? memoryList.find((x) => x.kind !== 'custom' && x.kind !== 'mix'))
        : memoryList.find((x) => x.kind === initialMemoryKind);
    if (m) openMemory(m);
  }, [initialMemoryKind, memoryList, plays]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const favMemory = (id: string) => {
    tick();
    const adding = !prefsRef.current.memoryFavs.includes(id);
    savePrefs((cur) => ({ memoryFavs: toggleIn(cur.memoryFavs, id) }));
    if (adding) logEvent('memory-fav');
  };
  const openMemory = (m: Memory) => {
    setMemory(m);
    if (!prefsRef.current.memoriesSeen.includes(m.id)) savePrefs((cur) => ({ memoriesSeen: [...cur.memoriesSeen, m.id].slice(-1000) }));
  };

  /** Keywords, albums and series you watched, most watched first: each can have a Wrapped of its own. */
  const wrappedGroups = useMemo<WrappedGroup[]>(() => {
    if (!plays) return [];
    const msOf = new Map<string, number>();
    for (const x of plays) msOf.set(x.videoId, (msOf.get(x.videoId) ?? 0) + x.watchedMs);
    const make = (key: string, kind: WrappedGroup['kind'], name: string, ids: string[]): WrappedGroup | null => {
      const watched = ids.filter((id) => (msOf.get(id) ?? 0) > 0);
      if (watched.length < 2) return null;
      const best = [...watched].sort((a, b) => (msOf.get(b) ?? 0) - (msOf.get(a) ?? 0))[0];
      return { key, kind, name, ids, cover: best, ms: watched.reduce((a, id) => a + (msOf.get(id) ?? 0), 0) };
    };
    const byTag = new Map<string, string[]>();
    for (const v of items) for (const t of v.tagNames) push(byTag, t, v.id);
    const out: WrappedGroup[] = [];
    for (const [t, ids] of byTag) {
      const g = make(`k:${t}`, 'keyword', t, ids);
      if (g) out.push(g);
    }
    for (const a of albumList) {
      const g = make(`a:${a.id}`, 'album', a.name, items.filter((v) => v.albumIds.includes(a.id)).map((v) => v.id));
      if (g) out.push(g);
    }
    for (const e of entries)
      if (e.kind === 'series') {
        const g = make(`s:${e.id}`, 'series', e.title, e.episodes.map((ep) => ep.video.id));
        if (g) out.push(g);
      }
    return out.sort((a, b) => b.ms - a.ms).slice(0, 14);
  }, [plays, items, albumList, entries]);

  /** Reviews you wrote, as the story shows them. */
  const reviewsFor = (keep: (key: string, at: number) => boolean) =>
    Object.entries(ovx.reviews)
      .filter(([key, r]) => keep(key, r.at))
      .sort((a, b) => b[1].at - a[1].at)
      .flatMap(([key, r]) => {
        const e = entries.find((x) => x.key === key);
        if (!e) return [];
        const ep = playable(e);
        return [{ title: e.title, text: r.text, videoId: ep && byId.has(ep.video.id) ? ep.video.id : null, rating: e.rating }];
      });

  /** A Wrapped of one keyword, album or series: from its first play to now. */
  const openGroup = (g: WrappedGroup) => {
    if (!plays) return;
    const ids = new Set(g.ids);
    const first = Math.min(...plays.filter((x) => ids.has(x.videoId)).map((x) => x.startedAt));
    const d = new Date(first);
    const r: Range = { start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), end: Date.now() + 1, label: `Since ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` };
    openStory(r, 'videos', g);
  };

  /** Everything the story needs for a range (of one keyword, album or series, when `group` is given). */
  const openStory = (r: Range, scope: 'everything' | 'videos', group?: WrappedGroup) => {
    if (!plays) return;
    const now = Date.now();
    const only = group ? new Set(group.ids) : null;
    const items_ = only ? items.filter((v) => only.has(v.id)) : items;
    const plays_ = only ? plays.filter((x) => only.has(x.videoId)) : plays;
    const skUse = scope === 'everything' && !group ? (sk ?? undefined) : undefined;
    const series = entries
      .filter((e) => e.kind === 'series')
      .map((e) => ({
        name: e.title,
        episodes: new Set(plays_.filter((x) => x.startedAt >= r.start && x.startedAt < r.end && e.episodes.some((ep) => ep.video.id === x.videoId)).map((x) => x.videoId)).size,
        finished: e.episodes.length > 0 && e.watchedCount === e.episodes.length,
      }))
      .filter((s) => s.episodes > 0)
      .sort((a, b) => b.episodes - a.episodes);
    const prevR = previous(r);
    // Year-long ranges: the #1 of each month, oldest first.
    const sprint =
      r.end - r.start > 62 * 86_400_000
        ? monthRanges(Math.min(Date.now(), r.end - 1), 12)
            .filter((m) => m.start >= r.start - 86_400_000 && m.start < r.end)
            .reverse()
            .map((m) => {
              const f = storyFacts(m, items_, plays_, now);
              return { label: new Date(m.start).toLocaleDateString(undefined, { month: 'short' }).toUpperCase(), videoId: f.top[0]?.id ?? null, ms: f.watchedMs, club: clubFor(f)?.key ?? null };
            })
        : undefined;
    const ly = yearBefore(r);
    const groupKeys = only ? new Set(entries.filter((e) => e.episodes.some((ep) => only.has(ep.video.id))).map((e) => e.key)) : null;
    setStory({
      sprint,
      range: r,
      facts: storyFacts(r, items_, plays_, now),
      prev: prevR.start >= 0 && !group ? storyFacts(prevR, items_, plays_, now) : null,
      w: buildWrapped(r, items_, plays_, skUse),
      earned: group ? [] : badgeList.filter((a) => a.unlocked && a.earnedAt !== null && a.earnedAt >= r.start && a.earnedAt < r.end),
      series,
      subject: group ? { kind: group.kind, name: group.name } : undefined,
      lastYear: group ? null : storyFacts(ly, items_, plays_, now),
      reviews: reviewsFor((key, at) => (groupKeys ? groupKeys.has(key) : at >= r.start && at < r.end)),
    });
  };

  useEffect(() => {
    if (initialWrapped && plays) {
      const [, last] = recentWeeks(Date.now(), 2);
      // The browser preview can ask for the year instead (`&range=year`).
      const year = initialYear || (Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('range') === 'year');
      const n = new Date();
      const lastMonth = { start: new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime(), end: new Date(n.getFullYear(), n.getMonth(), 1).getTime(), label: new Date(n.getFullYear(), n.getMonth() - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
      const [thisWeek] = recentWeeks(Date.now(), 1);
      openStory(year ? yearRange(new Date().getFullYear(), Date.now()) : initialMonth ? lastMonth : initialWeek ? thisWeek : last, sk ? 'everything' : 'videos');
    }
  }, [initialWrapped, plays]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerKicker}>REELVAULT</Text>
            <Text style={styles.headerTitle}>My Videos</Text>
          </View>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        <View style={styles.tabsWrap}>
          <TabStrip
            value={tab}
            dots={{ badges: fresh.length, memories: Math.min(newMemories, 9) }}
            onChange={(k) => {
              tick();
              setTab(k);
            }}
          />
        </View>
        {plays === null ? (
          <ActivityIndicator color={p.textSecondary} style={{ marginTop: 40 }} />
        ) : (
          <LiveProvider value={live.value}>
          <ScrollView key={tab} contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]} {...live.scrollProps}>
            <Animated.View entering={FadeIn.duration(DUR.fast)} style={{ gap: 14 }}>
              {tab === 'dashboard' && (
                <Dashboard
                  freezes={prefs.freezes}
                  items={items}
                  plays={plays}
                  labels={ratingLabels}
                  thumbs={thumbs}
                  goalMin={prefs.weeklyGoalMin}
                  memory={memoryList.find((m) => !prefs.memoryHidden.includes(m.id) && m.kind !== 'custom') ?? null}
                  onMemory={openMemory}
                  onAllMemories={() => setTab('memories')}
                  onGoal={(min) => savePrefs({ weeklyGoalMin: min })}
                  onOpen={onOpenVideo}
                />
              )}
              {tab === 'history' && (
                <HistoryTab
                  frozenDays={prefs.freezes.used}
                  items={items}
                  plays={plays}
                  thumbs={thumbs}
                  initialStats={initialHistoryStats}
                  onOpen={onOpenVideo}
                  onDelete={(videoId, from, to) => {
                    setPlays((list) => (list ?? []).filter((x) => !(x.videoId === videoId && x.startedAt >= from && x.startedAt <= to)));
                    actions.deletePlays(videoId, from, to).catch((e) => console.log(`[HISTORY] remove failed: ${String(e)}`));
                  }}
                />
              )}
              {tab === 'memories' && (
                <MemoriesTab
                  list={memoryList}
                  items={byId}
                  thumbs={thumbs}
                  favs={prefs.memoryFavs}
                  hidden={prefs.memoryHidden}
                  seen={prefs.memoriesSeen}
                  tags={tags}
                  albums={albumList}
                  onPlay={openMemory}
                  onFav={favMemory}
                  onUnhideAll={() => savePrefs({ memoryHidden: [] })}
                  onCreate={(c: CustomMemory) => {
                    savePrefs((cur) => ({ customMemories: [c, ...cur.customMemories] }));
                    logEvent('custom-memory');
                  }}
                  onDeleteCustom={(id) => savePrefs((cur) => ({ customMemories: cur.customMemories.filter((c) => c.id !== id) }))}
                />
              )}
              {tab === 'wrapped' && <WrappedPicker items={items} plays={plays} simkl={sk} thumbs={thumbs} groups={wrappedGroups} onOpen={(r, scope) => openStory(r, scope)} onOpenGroup={openGroup} />}
              {tab === 'badges' && (
                <Badges
                  list={badgeList}
                  all={badgeAll}
                  simkl={!!sk}
                  level={level}
                  records={records}
                  milestones={milestones}
                  thumbs={thumbs}
                  showcase={prefs.showcase}
                  fresh={fresh}
                  onSeen={markBadgesSeen}
                  onShowcase={(ids) => savePrefs({ showcase: ids })}
                  onOpenVideo={onOpenVideo}
                />
              )}
              {tab === 'storage' && (
                <Storage
                  actions={actions}
                  trashDays={prefs.trashDays}
                  onTrashDays={(d) => savePrefs({ trashDays: d })}
                  items={items}
                  deleted={deleted}
                  plays={plays}
                  thumbs={thumbs}
                  freeGb={freeGb}
                  duplicateGroups={duplicateGroups}
                  onOpen={onOpenVideo}
                  onMakeSmaller={onMakeSmaller}
                  onFilter={onFilter}
                />
              )}
            </Animated.View>
          </ScrollView>
          </LiveProvider>
        )}
      </View>
      {memory && (
        <MemoryPlayer
          key={memory.id}
          memory={memory}
          items={byId}
          thumbs={thumbs}
          enableVideo={enableVideo}
          fav={prefs.memoryFavs.includes(memory.id)}
          loadBookmarks={(id) => actions.loadBookmarks(id).then((list) => list.map((b) => b.atMs))}
          onFav={() => favMemory(memory.id)}
          onHide={() => savePrefs((cur) => ({ memoryHidden: [...cur.memoryHidden, memory.id] }))}
          onDelete={memory.kind === 'custom' ? () => savePrefs((cur) => ({ customMemories: cur.customMemories.filter((c) => c.id !== memory.id) })) : undefined}
          onEvent={logEvent}
          onOpenVideo={(id) => {
            setMemory(null);
            onOpenVideo(id);
          }}
          next={(() => {
            const shown = memoryList.filter((m) => !prefs.memoryHidden.includes(m.id) && m.kind !== 'custom');
            const at = shown.findIndex((m) => m.id === memory.id);
            return shown.length > 1 ? shown[(at + 1) % shown.length] : null;
          })()}
          onNext={(m) => openMemory(m)}
          onClose={() => setMemory(null)}
        />
      )}
      {story && (
        <WrappedStory
          input={story}
          items={byId}
          thumbs={thumbs}
          enableVideo={enableVideo}
          loadBookmarks={(id) => actions.loadBookmarks(id).then((list) => list.map((b) => b.atMs))}
          onEvent={logEvent}
          memories={memoryList.filter((m) => m.kind !== 'custom' && m.end >= story.range.start && m.start < story.range.end).slice(0, 1)}
          onOpenMemory={(m) => {
            setStory(null);
            openMemory(m);
          }}
          onOpenVideo={(id) => {
            setStory(null);
            onOpenVideo(id);
          }}
          onClose={() => setStory(null)}
        />
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------------- storage */

const QUALITY_COLORS: Record<string, string> = { '4K': '#0A84FF', '1080p': '#5E5CE6', '720p': '#30D158', Smaller: '#FF9F0A', Unknown: '#8E8E93' };
const GB = 1024 ** 3;

function Storage({
  actions,
  trashDays,
  onTrashDays,
  items,
  deleted,
  plays,
  thumbs,
  freeGb,
  duplicateGroups,
  onOpen,
  onMakeSmaller,
  onFilter,
}: {
  actions: VaultActions;
  trashDays: number;
  onTrashDays: (days: number) => void;
  items: VaultItem[];
  deleted: VaultItem[];
  plays: VaultPlay[];
  thumbs: Map<string, VaultItem['thumbSource']>;
  freeGb: number | null;
  duplicateGroups: string[][];
  onOpen: (id: string) => void;
  onMakeSmaller: (ids: string[]) => void;
  onFilter?: (f: Filter) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const now = Date.now();
  const s = useMemo(() => storageStats(items, deleted), [items, deleted]);
  const ideas = useMemo(() => spaceIdeas(items, deleted, duplicateGroups, plays, now), [items, deleted, duplicateGroups, plays]); // eslint-disable-line react-hooks/exhaustive-deps
  const grow = useMemo(() => growth(items, now, 12), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const byTag = useMemo(() => {
    const m = new Map<string, { bytes: number; n: number }>();
    for (const v of items) for (const t of v.tagNames) m.set(t, { bytes: (m.get(t)?.bytes ?? 0) + v.sizeBytes, n: (m.get(t)?.n ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 6);
  }, [items]);
  const maxBig = Math.max(1, ...s.biggest.map((b) => b.value));
  const appGb = (s.totalBytes + s.deletedBytes) / GB;
  const phoneGb = freeGb !== null ? freeGb + appGb : null;
  const savable = ideas.reduce((a, i) => a + i.bytes, 0);
  const { width } = useWindowDimensions();
  const grade = spaceGrade(s.totalBytes + s.deletedBytes, savable);
  const forecast = spaceForecast(grow, freeGb !== null ? freeGb * GB : null);
  const mapW = width - 32 - 32;
  const mapH = Math.round(mapW * 0.72);
  const tiles = useMemo(() => treemap(s.biggest.slice(0, 9).map((b) => ({ id: b.key, value: b.value })), mapW, mapH), [s.biggest, mapW, mapH]);
  const GRADE_COLORS: Record<string, string> = { A: '#30D158', B: '#7ED957', C: '#FFD60A', D: '#FF9F0A', E: '#FF453A' };

  const act = (i: (typeof ideas)[number]) => {
    if (i.action === 'smaller' || i.action === 'unwatched') return onMakeSmaller(i.ids);
    if (!onFilter) return;
    onFilter(i.action === 'deleted' ? { kind: 'deleted' } : i.action === 'duplicates' ? { kind: 'duplicates' } : { kind: 'rejects' });
  };
  const ideaIcon: Record<string, IconName> = { deleted: 'trash', dups: 'videos', rejects: 'close', smaller: 'sparkle', cold: 'eye' };

  return (
    <>
      {/* ── the phone ─────────────────────────────────────────── */}
      <Animated.View entering={enterUp(0)} style={[styles.storeHero, gradient('linear-gradient(135deg, #1F6F3F 0%, #0B3B2A 60%, #06201A 100%)')]}>
        <Aurora colors={['#1F6F3F', '#06201A']} accent="#64D2FF" width={width - 32} height={220} />
        <View style={styles.storeRow}>
          <Ring size={110} stroke={11} progress={phoneGb ? appGb / phoneGb : 0} color="#30D158" track="rgba(255,255,255,0.18)">
            <Text style={styles.storePct}>{phoneGb ? `${Math.round((appGb / phoneGb) * 100)}%` : '–'}</Text>
            <Text style={styles.storePctLabel}>of your room</Text>
          </Ring>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.storeKicker}>REELVAULT USES</Text>
            <CountUp to={s.totalBytes + s.deletedBytes} format={fmtBytes} style={styles.storeValue} />
            <Text style={styles.storeSub}>
              {s.count} videos{s.count ? ` · ${fmtBytes(s.totalBytes / s.count)} each on average` : ''}
            </Text>
            {freeGb !== null && <Text style={styles.storeSub}>{freeGb} GB still free on the phone</Text>}
          </View>
        </View>
        <View style={styles.storeFoot}>
          <View style={[styles.grade, { backgroundColor: GRADE_COLORS[grade.grade] }]}>
            <Text style={styles.gradeText}>{grade.grade}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.storeFootTitle}>{grade.line}</Text>
            <Text style={styles.storeSub} numberOfLines={2}>
              {forecast.months !== null
                ? `At ${fmtBytes(forecast.perMonth)} a month, the free space lasts about ${forecast.months >= 24 ? `${Math.round(forecast.months / 12)} years` : `${forecast.months} months`}.`
                : forecast.perMonth > 0
                  ? `About ${fmtBytes(forecast.perMonth)} added a month lately.`
                  : 'Nothing added lately.'}
            </Text>
          </View>
        </View>
      </Animated.View>

      {tiles.length > 1 && (
        <Card index={1} title="Your space, as a map" sub="Each box is a video, as big as the space it takes. Tap one to open it.">
          <View style={{ width: mapW, height: mapH, alignSelf: 'center' }}>
            {tiles.map((t, i) => {
              const b = s.biggest.find((x) => x.key === t.id)!;
              return (
                <Animated.View key={t.id} entering={FadeIn.delay(120 + i * 70).duration(DUR.slow)} style={{ position: 'absolute', left: t.x, top: t.y, width: t.w, height: t.h, padding: 1.5 }}>
                  <PressableScale style={styles.tile} onPress={() => onOpen(t.id)} accessibilityLabel={`${b.label}, ${fmtBytes(b.value)}`}>
                    <Image source={thumbs.get(t.id)} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <View style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)', 'rgba(0,0,0,0.3)')]} />
                    {t.w > 56 && t.h > 40 && (
                      <View style={styles.tileText}>
                        <Text style={styles.tileValue} numberOfLines={1}>
                          {fmtBytes(b.value)}
                        </Text>
                        {t.w > 110 && t.h > 70 && (
                          <Text style={styles.tileLabel} numberOfLines={1}>
                            {b.label}
                          </Text>
                        )}
                      </View>
                    )}
                  </PressableScale>
                </Animated.View>
              );
            })}
          </View>
        </Card>
      )}

      {/* ── keeping it small ─────────────────────────────────── */}
      <SpacePlanner ideas={ideas} freeBytes={freeGb !== null ? freeGb * GB : null} onStep={act} index={1} />
      <AppSpaceCard actions={actions} index={1} />
      <TrashCard days={trashDays} onDays={onTrashDays} count={deleted.length} bytes={s.deletedBytes} onEmpty={actions.emptyRecentlyDeleted} index={1} />
      <ImportShrinkCard actions={actions} index={1} />

      <Card index={1} title="What takes the space">
        <View style={styles.stack}>
          {s.byQuality.map((g, i) => (
            <View key={g.key} style={{ flex: Math.max(0.02, g.value / Math.max(1, s.totalBytes)) }}>
              <GrowBar share={1} color={QUALITY_COLORS[g.key] ?? '#8E8E93'} track="transparent" height={14} delay={150 + i * 120} />
            </View>
          ))}
        </View>
        <View style={styles.legend}>
          {s.byQuality.map((g) => (
            <View key={g.key} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: QUALITY_COLORS[g.key] ?? '#8E8E93' }]} />
              <Text style={styles.legendText}>
                {g.label} · {fmtBytes(g.value)} · {g.sub}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {/* ── free up space ─────────────────────────────────────── */}
      {ideas.length > 0 && (
        <Card index={2} title="Free up space" sub={`Up to ${fmtBytes(savable)} you could get back`}>
          {ideas.map((i) => (
            <PressableScale key={i.key} style={styles.idea} onPress={() => act(i)} accessibilityLabel={`${i.title}, ${fmtBytes(i.bytes)}`}>
              <View style={styles.ideaIcon}>
                <Icon name={ideaIcon[i.key] ?? 'storage'} size={16} color="#30D158" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ideaTitle}>{i.title}</Text>
                <Text style={styles.muted} numberOfLines={2}>
                  {i.count} {i.count === 1 ? 'video' : 'videos'} · {i.detail}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.ideaBytes}>{fmtBytes(i.bytes)}</Text>
                <Icon name="forward" size={12} color={p.textMuted} />
              </View>
            </PressableScale>
          ))}
        </Card>
      )}

      <View style={styles.tiles}>
        <StatTile index={3} icon="sparkle" value={fmtBytes(s.savedBytes)} label="saved by Make Smaller" tint={p.success} />
        <StatTile index={4} icon="trash" value={fmtBytes(s.deletedBytes)} label={`in Recently Deleted (${deleted.length})`} tint={p.danger} />
      </View>

      <Card index={5} title="How your library grew" sub="Space added each month">
        <Bars
          data={grow.map((g) => ({ label: g.label, value: g.bytes, current: g.key === grow[grow.length - 1].key, detail: `${new Date(g.key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · ${g.count} videos` }))}
          format={(v) => (v ? fmtBytes(v) : 'nothing added')}
          height={90}
          highlight="#30D158"
          everyLabel={1}
        />
      </Card>

      <Card index={6} title="Biggest videos">
        {s.biggest.length === 0 ? (
          <Text style={styles.muted}>No videos yet.</Text>
        ) : (
          s.biggest.slice(0, 8).map((r) => (
            <TouchableOpacity key={r.key} style={styles.vrow} onPress={() => onOpen(r.key)}>
              <Image source={thumbs.get(r.key)} style={styles.vthumb} contentFit="cover" />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.vline}>
                  <Text style={styles.vtitle} numberOfLines={1}>
                    {r.label}
                  </Text>
                  <Text style={styles.vvalue}>{fmtBytes(r.value)}</Text>
                </View>
                <GrowBar share={r.value / maxBig} color="#FF9F0A" track={p.card} height={5} />
                <Text style={styles.vsub}>{r.sub}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </Card>
      {byTag.length > 0 && (
        <Card index={7} title="By keyword">
          <RankedBars rows={byTag.map(([t, v]) => ({ label: `#${t} · ${v.n} ${v.n === 1 ? 'video' : 'videos'}`, value: v.bytes }))} format={fmtBytes} />
        </Card>
      )}
      <Card index={8} title="By format">
        <RankedBars rows={s.byCodec.map((g) => ({ label: `${g.label} · ${g.sub}`, value: g.value }))} format={fmtBytes} />
      </Card>
      <Card index={9} title="By year filmed">
        <RankedBars rows={s.byYear.map((g) => ({ label: `${g.label} · ${g.sub}`, value: g.value }))} format={fmtBytes} />
      </Card>
      <Text style={styles.foot}>Nothing is deleted from here. Every button opens the videos so you can choose.</Text>
    </>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 10 },
    headerKicker: { color: p.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
    headerTitle: { color: p.text, fontSize: 32, fontWeight: '900', letterSpacing: -0.8 },
    tabsWrap: { paddingHorizontal: 16, paddingBottom: 10 },
    tabs: { flexDirection: 'row', backgroundColor: p.elevated, borderRadius: 18, padding: 4 },
    tabPill: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 14, backgroundColor: p.card },
    tab: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8 },
    tabIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    tabText: { color: p.textSecondary, fontSize: 11, fontWeight: '800' },
    tabDot: { position: 'absolute', top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: p.elevated },
    tabDotText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    body: { paddingHorizontal: 16, paddingTop: 6 },
    muted: { color: p.textSecondary, fontSize: 12, lineHeight: 16 },
    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

    storeHero: { borderRadius: 26, padding: 18, gap: 16, overflow: 'hidden' },
    storeRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
    storeFoot: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 16, padding: 12 },
    storeFootTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
    grade: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    gradeText: { color: '#000', fontSize: 24, fontWeight: '900' },
    tile: { flex: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: p.card },
    tileText: { position: 'absolute', left: 8, right: 6, bottom: 6 },
    tileValue: { color: '#fff', fontSize: 13, fontWeight: '900' },
    tileLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700' },
    storePct: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.6 },
    storePctLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: '800' },
    storeKicker: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    storeValue: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -1 },
    storeSub: { color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '600' },

    idea: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    ideaIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#30D15826', alignItems: 'center', justifyContent: 'center' },
    ideaTitle: { color: p.text, fontSize: 15, fontWeight: '800' },
    ideaBytes: { color: '#30D158', fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },

    vrow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    vline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    vthumb: { width: 72, height: 46, borderRadius: 9, backgroundColor: p.tile },
    vtitle: { color: p.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
    vsub: { color: p.textSecondary, fontSize: 12 },
    vvalue: { color: p.textSoft, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    sizeTrack: { height: 5, borderRadius: 3, backgroundColor: p.card, overflow: 'hidden' },
    sizeFill: { height: 5, borderRadius: 3, backgroundColor: '#FF9F0A' },

    stack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
  });
