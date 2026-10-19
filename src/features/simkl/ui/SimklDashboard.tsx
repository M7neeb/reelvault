/**
 * The Simkl dashboard: your watching at a glance. This week by day (and how
 * it compares with last week), today / this month / this year, your streak,
 * your Wrapped (this year, earlier years, recent months), what is waiting in
 * Up Next and how long it would take to finish, your year in days, the next
 * milestones, your library by status, your top title this month and the last
 * days you watched something. Links to the full stats and the review.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import { Card } from '@/features/vault/ui/insightParts';
import { Modal } from '@/features/vault/ui/screen';
import { GrowColumn } from '@/features/vault/ui/storyKit';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';
import { YearHeatCard } from '@/features/vault/ui/yearHeatUI';

import { posterUrl } from '../logic';
import { fmtMinutesLong, monthWrapRange, simklDash, simklWrap, wrapChoices, yearWrapRange, type SimklWrap } from '../simklWrapped';
import SimklWrapped from './SimklWrapped';
import type { Meta, SimklActions, SimklItem, WatchEvent } from './types';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const poster = (path: string | null) => ({ uri: posterUrl(path, '_m') });

export default function SimklDashboard({
  items,
  actions,
  onOpenTitle,
  onStats,
  onReview,
  initialWrap,
  onClose,
}: {
  items: SimklItem[];
  actions: SimklActions;
  onOpenTitle?: (item: SimklItem) => void;
  onStats: () => void;
  onReview: () => void;
  /** The browser preview opens the Wrapped at once. */
  initialWrap?: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [data, setData] = useState<{ events: WatchEvent[]; meta: Map<number, Meta> } | null>(null);
  const [wrap, setWrap] = useState<SimklWrap | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    actions
      .loadInsights()
      .then(setData)
      .catch(() => setData({ events: [], meta: new Map() }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dash = useMemo(() => (data ? simklDash(data.events, items, data.meta, now) : null), [data, items, now]);
  const choices = useMemo(() => (data ? wrapChoices(data.events, now) : null), [data, now]);
  const byId = useMemo(() => new Map(items.map((i) => [i.simklId, i])), [items]);
  const heatPlays = useMemo(() => (data ? data.events.map((e) => ({ videoId: String(e.simklId), startedAt: e.at, watchedMs: e.minutes * 60_000 })) : []), [data]);

  const openWrap = (range: ReturnType<typeof yearWrapRange>) => {
    if (!data) return;
    tick();
    setWrap(simklWrap(data.events, items, data.meta, range));
  };
  useEffect(() => {
    if (initialWrap && data && !wrap) openWrap(yearWrapRange(new Date(now).getFullYear()));
  }, [initialWrap, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const year = new Date(now).getFullYear();
  const weekMax = dash ? Math.max(1, ...dash.weekDays.map((d) => d.minutes)) : 1;
  const weekChange = dash && dash.lastWeek > 0 && dash.week > 0 ? Math.round(((dash.week - dash.lastWeek) / dash.lastWeek) * 100) : null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.title}>Dashboard</Text>
          <TouchableOpacity style={styles.pill} onPress={onStats}>
            <Text style={styles.pillText}>All stats</Text>
          </TouchableOpacity>
        </View>

        {!dash || !choices || !data ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={p.textSecondary} />
        ) : (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
            <Card index={0} title="This week" sub={weekChange === null ? undefined : weekChange >= 0 ? `${weekChange}% more than last week` : `${-weekChange}% less than last week`}>
              <Text style={styles.heroNum}>{dash.week ? fmtMinutesLong(dash.week) : 'Nothing yet'}</Text>
              <View style={styles.week}>
                {dash.weekDays.map((d, i) => (
                  <View key={d.label} style={styles.weekCell}>
                    <View style={styles.weekBarBox}>
                      <GrowColumn ratio={d.minutes / weekMax} height={90} width={18} delay={i * 50} color={d.today ? p.accent : p.textMuted} />
                    </View>
                    <Text style={[styles.weekLabel, d.today && { color: p.accent }]}>{d.label}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <View style={styles.tiles}>
              {[
                ['Today', dash.today],
                ['This month', dash.month],
                [String(year), dash.year],
              ].map(([label, min]) => (
                <View key={String(label)} style={styles.tile}>
                  <Text style={styles.tileNum} numberOfLines={1} adjustsFontSizeToFit>
                    {Number(min) ? fmtMinutesLong(Number(min)) : '-'}
                  </Text>
                  <Text style={styles.tileLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <Card index={1}>
              <View style={styles.streakRow}>
                <View style={styles.flame}>
                  <Icon name="fire" size={22} color={dash.streak ? '#FF9F0A' : p.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.streakNum}>
                    {dash.streak} {dash.streak === 1 ? 'day' : 'days'} in a row
                  </Text>
                  <Text style={styles.sub}>{dash.streak ? 'Watch something today to keep it going.' : 'Watch something today to start a streak.'} Best: {dash.bestStreak} days.</Text>
                </View>
              </View>
            </Card>

            <TouchableOpacity activeOpacity={0.85} onPress={() => openWrap(yearWrapRange(year))} style={styles.wrapCard} accessibilityLabel={`Open your ${year} Simkl Wrapped`}>
              <View style={styles.wrapGlow} />
              <Text style={styles.wrapKicker}>SIMKL WRAPPED</Text>
              <Text style={styles.wrapTitle}>Your {year} so far</Text>
              <Text style={styles.wrapSub}>Your top titles, binges, genres and the kind of watcher you are. Tap to play.</Text>
            </TouchableOpacity>
            {(choices.years.filter((y) => y !== year).length > 0 || choices.months.length > 0) && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {choices.months.map((m) => (
                  <TouchableOpacity key={`${m.year}-${m.month}`} style={styles.chip} onPress={() => openWrap(monthWrapRange(m.year, m.month))}>
                    <Text style={styles.chipText}>
                      {MONTH[m.month]} {m.year !== year ? m.year : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
                {choices.years
                  .filter((y) => y !== year)
                  .map((y) => (
                    <TouchableOpacity key={y} style={styles.chip} onPress={() => openWrap(yearWrapRange(y))}>
                      <Text style={styles.chipText}>{y}</Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            )}

            <Card index={2} title="Up next" sub={`${dash.counts.watching} watching · ${dash.counts.plan} planned`}>
              <View style={styles.pair}>
                <View style={styles.pairCell}>
                  <Text style={styles.pairNum}>{dash.upNext}</Text>
                  <Text style={styles.sub}>{dash.upNext === 1 ? 'show with an episode waiting' : 'shows with an episode waiting'}</Text>
                </View>
                <View style={styles.pairCell}>
                  <Text style={styles.pairNum}>{dash.leftMinutes ? fmtMinutesLong(dash.leftMinutes) : '-'}</Text>
                  <Text style={styles.sub}>to finish everything you're watching</Text>
                </View>
              </View>
              {dash.planMinutes > 0 && <Text style={styles.sub}>Your plan-to-watch list would take {fmtMinutesLong(dash.planMinutes)}.</Text>}
            </Card>

            <YearHeatCard
              index={3}
              plays={heatPlays}
              nameOf={(id) => byId.get(Number(id))?.title ?? null}
              onOpen={
                onOpenTitle
                  ? (id) => {
                      const it = byId.get(Number(id));
                      if (it) onOpenTitle(it);
                    }
                  : undefined
              }
            />

            <Card index={4} title="Next milestones">
              {dash.milestones.map((m) => (
                <View key={m.label} style={{ gap: 5 }}>
                  <View style={styles.msHead}>
                    <Text style={styles.msLabel}>
                      {m.at.toLocaleString('en-US')} {m.label}
                    </Text>
                    <Text style={styles.sub}>{(m.at - m.now).toLocaleString('en-US')} to go</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.min(100, (m.now / m.at) * 100)}%` }]} />
                  </View>
                </View>
              ))}
            </Card>

            <Card index={5} title="Your library">
              <View style={styles.statusRow}>
                {(
                  [
                    ['Watching', dash.counts.watching, '#0A84FF'],
                    ['Completed', dash.counts.completed, '#30D158'],
                    ['Planned', dash.counts.plan, '#BF5AF2'],
                    ['On hold', dash.counts.hold, '#FF9F0A'],
                    ['Dropped', dash.counts.dropped, '#FF453A'],
                  ] as const
                ).map(([label, n, color]) => (
                  <View key={label} style={styles.statusCell}>
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <Text style={styles.statusNum}>{n}</Text>
                    <Text style={styles.sub}>{label}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.sub}>
                All time: {fmtMinutesLong(dash.totals.minutes)} · {dash.totals.episodes.toLocaleString('en-US')} episodes · {dash.totals.movies.toLocaleString('en-US')} movies
              </Text>
            </Card>

            {dash.topThisMonth && (
              <Card index={6} title="Your top this month">
                <TouchableOpacity
                  style={styles.topRow}
                  disabled={!onOpenTitle}
                  onPress={() => {
                    const it = byId.get(dash.topThisMonth!.simklId);
                    if (it) onOpenTitle?.(it);
                  }}>
                  <Image source={poster(dash.topThisMonth.poster)} style={styles.topImg} contentFit="cover" />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.topTitle} numberOfLines={2}>
                      {dash.topThisMonth.title}
                    </Text>
                    <Text style={styles.sub}>
                      {dash.topThisMonth.type === 'movie'
                        ? fmtMinutesLong(dash.topThisMonth.minutes)
                        : `${dash.topThisMonth.count} ${dash.topThisMonth.count === 1 ? 'episode' : 'episodes'} · ${fmtMinutesLong(dash.topThisMonth.minutes)}`}
                    </Text>
                  </View>
                </TouchableOpacity>
              </Card>
            )}

            {dash.recent.length > 0 && (
              <Card index={7} title="Lately" action={{ label: 'Review', onPress: onReview }}>
                {dash.recent.map((r) => (
                  <View key={r.day} style={{ gap: 6 }}>
                    <Text style={styles.dayLabel}>{new Date(r.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {r.titles.map((t) => (
                        <TouchableOpacity
                          key={t.simklId}
                          style={styles.recentCell}
                          disabled={!onOpenTitle}
                          onPress={() => {
                            const it = byId.get(t.simklId);
                            if (it) onOpenTitle?.(it);
                          }}>
                          <Image source={poster(t.poster)} style={styles.recentImg} contentFit="cover" />
                          {t.count > 1 && (
                            <View style={styles.countBadge}>
                              <Text style={styles.countText}>×{t.count}</Text>
                            </View>
                          )}
                          <Text style={styles.recentLabel} numberOfLines={1}>
                            {t.title}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                ))}
              </Card>
            )}
          </ScrollView>
        )}
      </View>
      {wrap && <SimklWrapped wrap={wrap} onClose={() => setWrap(null)} />}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    title: { color: p.text, fontSize: 26, fontWeight: '800', flex: 1 },
    pill: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    pillText: { color: p.text, fontSize: 14, fontWeight: '700' },
    body: { paddingHorizontal: 16, gap: 14, paddingTop: 6 },
    heroNum: { color: p.text, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
    week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    weekCell: { alignItems: 'center', gap: 6, flex: 1 },
    weekBarBox: { height: 90, justifyContent: 'flex-end' },
    weekLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    tiles: { flexDirection: 'row', gap: 10 },
    tile: { flex: 1, backgroundColor: p.card, borderRadius: 16, padding: 12, gap: 2 },
    tileNum: { color: p.text, fontSize: 18, fontWeight: '800' },
    tileLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    streakRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    flame: { width: 44, height: 44, borderRadius: 22, backgroundColor: p.tile, alignItems: 'center', justifyContent: 'center' },
    streakNum: { color: p.text, fontSize: 18, fontWeight: '800' },
    sub: { color: p.textSecondary, fontSize: 13 },
    wrapCard: { borderRadius: 22, padding: 18, gap: 6, backgroundColor: '#3A0A1C', overflow: 'hidden' },
    wrapGlow: { position: 'absolute', right: -60, top: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: '#FF375F', opacity: 0.45 },
    wrapKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
    wrapTitle: { color: '#fff', fontSize: 26, fontWeight: '900' },
    wrapSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
    chips: { gap: 8, marginTop: -4 },
    chip: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    chipText: { color: p.text, fontSize: 14, fontWeight: '700' },
    pair: { flexDirection: 'row', gap: 12 },
    pairCell: { flex: 1, gap: 2 },
    pairNum: { color: p.text, fontSize: 24, fontWeight: '900' },
    msHead: { flexDirection: 'row', justifyContent: 'space-between' },
    msLabel: { color: p.text, fontSize: 14, fontWeight: '700' },
    track: { height: 8, borderRadius: 4, backgroundColor: p.tile, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4, backgroundColor: p.accent },
    statusRow: { flexDirection: 'row', justifyContent: 'space-between' },
    statusCell: { alignItems: 'center', gap: 2, flex: 1 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusNum: { color: p.text, fontSize: 18, fontWeight: '800' },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    topImg: { width: 64, height: 94, borderRadius: 10, backgroundColor: p.tile },
    topTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    dayLabel: { color: p.text, fontSize: 13, fontWeight: '700' },
    recentCell: { width: 74, gap: 4 },
    recentImg: { width: 74, height: 108, borderRadius: 10, backgroundColor: p.tile },
    recentLabel: { color: p.textSecondary, fontSize: 11, fontWeight: '600' },
    countBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
    countText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  });
