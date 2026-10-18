/**
 * My Videos, in four tabs:
 * - Dashboard: weekly goal, things the app noticed, watch time for a period
 *   against the time before, memories, favourites to rediscover, habits,
 *   taste, ratings and how complete the library is (DashboardUI);
 * - Wrapped: your year, months, weeks or any range, as a story that plays
 *   your videos (WrappedUI);
 * - Badges: level, showcase, records, journey, ladders, one-offs and monthly
 *   challenges (BadgesUI);
 * - Storage: what takes the space, how it grew, and ways to free some.
 * Presentational only: plays and Simkl numbers come in through callbacks.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RankedBars } from '@/features/simkl/ui/charts';
import type { SimklBridge } from '@/features/simkl/ui/types';

import { achievements, summarize, type AchInput } from '../achievements';
import { buildOverview } from '../overview';
import { growth, journey, levelFor, personalRecords, spaceIdeas, storyFacts } from '../recap';
import { fmtBytes, fmtMs, recentWeeks, storageStats, wrapped as buildWrapped, type Range, type RatingLabels, type VaultPlay } from '../stats';
import Badges from './BadgesUI';
import Dashboard from './DashboardUI';
import type { Filter } from './filters';
import { tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import type { IconName } from './icons';
import { Bars, Card, gradient, Ring, StatTile } from './insightParts';
import { DUR, enterUp, PressableScale, SPRING } from './motion';
import { toOvVideo } from './overviewParts';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import { DEFAULT_VAULT_PREFS, type OverviewData, type VaultActions, type VaultItem, type VaultPrefs } from './types';
import { previous, WrappedPicker, WrappedStory, type StoryInput } from './WrappedUI';

export type InsightsTab = 'dashboard' | 'wrapped' | 'badges' | 'storage';

type SimklNumbers = Awaited<ReturnType<SimklBridge['insights']>>;

const TABS: { key: InsightsTab; label: string; icon: IconName; color: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', color: '#0A84FF' },
  { key: 'wrapped', label: 'Wrapped', icon: 'sparkle', color: '#BF5AF2' },
  { key: 'badges', label: 'Badges', icon: 'trophy', color: '#FF9F0A' },
  { key: 'storage', label: 'Storage', icon: 'storage', color: '#30D158' },
];

/** The tab bar: icons in coloured squares, a pill that slides to the chosen one. */
function TabStrip({ value, onChange }: { value: InsightsTab; onChange: (t: InsightsTab) => void }) {
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
            </View>
            <Text style={[styles.tabText, on && { color: p.text }]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function VideoInsightsModal({
  initialTab = 'dashboard',
  items,
  deleted,
  albums,
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
  onOpenVideo,
  onMakeSmaller,
  onFilter,
  onClose,
}: {
  initialTab?: InsightsTab;
  items: VaultItem[];
  deleted: VaultItem[];
  albums: number;
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
  const [bookmarks, setBookmarks] = useState(0);
  const [sk, setSk] = useState<SimklNumbers | null>(null);
  const [story, setStory] = useState<StoryInput | null>(null);

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

  const achInput = useMemo<AchInput | null>(() => {
    if (!plays) return null;
    return {
      videos: items.map((v) => ({ ...v, location: v.meta?.location ?? null })),
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
      now: Date.now(),
    };
  }, [plays, items, bookmarks, albums, smartFilters, overview, sk, entries]);
  const badgeList = useMemo(() => (achInput ? achievements(achInput) : []), [achInput]);
  const badgeAll = useMemo(() => (achInput ? achievements(achInput, { everyStep: true }) : []), [achInput]);
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

  /** Everything the story needs for a range. */
  const openStory = (r: Range, scope: 'everything' | 'videos') => {
    if (!plays) return;
    const now = Date.now();
    const skUse = scope === 'everything' ? (sk ?? undefined) : undefined;
    const series = entries
      .filter((e) => e.kind === 'series')
      .map((e) => ({
        name: e.title,
        episodes: new Set(plays.filter((x) => x.startedAt >= r.start && x.startedAt < r.end && e.episodes.some((ep) => ep.video.id === x.videoId)).map((x) => x.videoId)).size,
        finished: e.episodes.length > 0 && e.watchedCount === e.episodes.length,
      }))
      .filter((s) => s.episodes > 0)
      .sort((a, b) => b.episodes - a.episodes);
    const prevR = previous(r);
    setStory({
      range: r,
      facts: storyFacts(r, items, plays, now),
      prev: prevR.start >= 0 ? storyFacts(prevR, items, plays, now) : null,
      w: buildWrapped(r, items, plays, skUse),
      earned: badgeList.filter((a) => a.unlocked && a.earnedAt !== null && a.earnedAt >= r.start && a.earnedAt < r.end),
      series,
    });
  };

  useEffect(() => {
    if (initialWrapped && plays) {
      const [, last] = recentWeeks(Date.now(), 2);
      openStory(last, sk ? 'everything' : 'videos');
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
            onChange={(k) => {
              tick();
              setTab(k);
            }}
          />
        </View>
        {plays === null ? (
          <ActivityIndicator color={p.textSecondary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView key={tab} contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}>
            <Animated.View entering={FadeIn.duration(DUR.fast)} style={{ gap: 14 }}>
              {tab === 'dashboard' && (
                <Dashboard
                  items={items}
                  plays={plays}
                  labels={ratingLabels}
                  thumbs={thumbs}
                  goalMin={prefs.weeklyGoalMin}
                  onGoal={(min) => void actions.setPrefs({ ...prefs, weeklyGoalMin: min })}
                  onOpen={onOpenVideo}
                />
              )}
              {tab === 'wrapped' && <WrappedPicker items={items} plays={plays} simkl={sk} thumbs={thumbs} onOpen={openStory} />}
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
                  onShowcase={(ids) => void actions.setPrefs({ ...prefs, showcase: ids })}
                  onOpenVideo={onOpenVideo}
                />
              )}
              {tab === 'storage' && (
                <Storage
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
        )}
      </View>
      {story && (
        <WrappedStory
          input={story}
          items={byId}
          thumbs={thumbs}
          enableVideo={enableVideo}
          loadBookmarks={(id) => actions.loadBookmarks(id).then((list) => list.map((b) => b.atMs))}
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
        <Ring size={110} stroke={11} progress={phoneGb ? appGb / phoneGb : 0} color="#30D158" track="rgba(255,255,255,0.18)">
          <Text style={styles.storePct}>{phoneGb ? `${Math.round((appGb / phoneGb) * 100)}%` : '–'}</Text>
          <Text style={styles.storePctLabel}>of room left</Text>
        </Ring>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.storeKicker}>REELVAULT USES</Text>
          <Text style={styles.storeValue}>{fmtBytes(s.totalBytes + s.deletedBytes)}</Text>
          <Text style={styles.storeSub}>
            {s.count} videos{s.count ? ` · ${fmtBytes(s.totalBytes / s.count)} each on average` : ''}
          </Text>
          {freeGb !== null && <Text style={styles.storeSub}>{freeGb} GB still free on the phone</Text>}
        </View>
      </Animated.View>

      <Card index={1} title="What takes the space">
        <View style={styles.stack}>
          {s.byQuality.map((g) => (
            <View key={g.key} style={{ flex: Math.max(0.02, g.value / Math.max(1, s.totalBytes)), backgroundColor: QUALITY_COLORS[g.key] ?? '#8E8E93' }} />
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
                <View style={styles.sizeTrack}>
                  <View style={[styles.sizeFill, { width: `${(r.value / maxBig) * 100}%` }]} />
                </View>
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
    tabText: { color: p.textSecondary, fontSize: 12, fontWeight: '800' },
    body: { paddingHorizontal: 16, paddingTop: 6 },
    muted: { color: p.textSecondary, fontSize: 12, lineHeight: 16 },
    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

    storeHero: { flexDirection: 'row', alignItems: 'center', gap: 18, borderRadius: 26, padding: 18 },
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
