/**
 * The Wrapped tab of the Manga section, built like a shelf of posters:
 * - this year: a big poster with your covers drifting behind it, the numbers,
 *   your top three and a Play button;
 * - all time: a gold poster for your whole story;
 * - weeks: a row of cards to swipe through (this week first), each with a bar
 *   for every day and that week's #1;
 * - this year month by month: a calendar of twelve tiles, each with the cover
 *   of that month's #1, the best month crowned, months still to come waiting;
 * - the years before: a row of posters.
 * Manga or Videos + Manga at the top switches every number. Tap anything to
 * play its Wrapped. Presentational only.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { fmtLength } from '../../audio/audioLogic';
import type { MangaRead } from '../../manga/mangaLogic';
import { mixNumbers, type ReadRange } from '../../manga/mangaInsights';
import { weightOf, wrappedHub, type HubEntry } from '../../manga/wrappedHub';
import { success } from '../haptics';
import Icon from '../Icon';
import { gradient } from '../insightParts';
import { useReducedMotion } from '../motion';
import { CoverWall, GrowBar, GrowColumn } from '../storyKit';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { ThumbSource } from '../types';
import MangaCover from './MangaCover';
import type { MixVideos } from './ReadingStory';
import type { MangaUiSeries } from './mangaTypes';

const orDash = (ms: number) => (ms ? fmtLength(ms) : '0 min');
const hours = (ms: number) => (ms >= 3_600_000 ? `${Math.round(ms / 3_600_000).toLocaleString()} h` : ms ? `${Math.round(ms / 60_000)} min` : '0 min');
const MONTH = (m: number) => new Date(2026, m, 1).toLocaleDateString(undefined, { month: 'short' }).replace('.', '');

type Mix = ReturnType<typeof mixNumbers>;

export function WrappedPicker({ items, reads, videos, now, onOpen }: { items: MangaUiSeries[]; reads: MangaRead[]; videos?: MixVideos | null; now: number; onOpen: (r: ReadRange, mix: boolean) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const reduce = useReducedMotion();
  const [mix, setMix] = useState(false);
  const useMix = mix && !!videos;
  const hub = useMemo(() => wrappedHub(items, reads, now), [items, reads, now]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // Videos + Manga numbers, worked out once per switch (not on every render).
  const mixes = useMemo(() => {
    const out = new Map<number, Mix>();
    if (!useMix || !videos) return out;
    for (const e of [hub.year, hub.all, ...hub.weeks, ...hub.months, ...hub.pastYears]) out.set(e.range.start * 10 + e.range.kind.length, mixNumbers(videos.plays, e.y, reads));
    return out;
  }, [useMix, videos, hub, reads]);
  const mixOf = (e: HubEntry) => mixes.get(e.range.start * 10 + e.range.kind.length) ?? null;
  const line = (e: HubEntry) => {
    const m = mixOf(e);
    if (m) return m.totalMs || e.y.chapters ? `${orDash(m.watchMs)} watching · ${orDash(m.readMs)} reading` : 'Nothing yet';
    return e.y.chapters || e.y.ms ? `${e.y.chapters.toLocaleString()} ch. · ${orDash(e.y.ms)}` : 'Nothing read';
  };
  const weight = (e: HubEntry) => mixOf(e)?.totalMs ?? weightOf(e.y);
  const open = (r: ReadRange) => {
    success();
    onOpen(r, useMix);
  };
  const cover = (id: string | undefined) => (id ? byId.get(id) : undefined);
  const enter = (k: number) => (reduce ? undefined : FadeInDown.delay(60 + k * 90).duration(420));

  // Covers for the year's poster: its top titles first, then everything else you read.
  const wall = useMemo(() => {
    const ids = [...hub.year.y.top.map((t) => t.id), ...items.filter((i) => i.lastReadAt && i.lastReadAt >= hub.year.range.start).map((i) => i.id)];
    return [...new Set(ids)].map((id) => byId.get(id)?.coverSource).filter(Boolean).slice(0, 16) as ThumbSource[];
  }, [hub, items, byId]);

  const maxWeek = Math.max(1, ...hub.weeks.map(weight));
  const maxMonth = Math.max(1, ...hub.months.map(weight));
  const since = new Date(hub.all.range.start);
  const years = Math.max(0, (now - hub.all.range.start) / (365.25 * 86_400_000));
  const tint = useMix ? '#BF5AF2' : '#FF375F';

  return (
    <View style={{ gap: 22 }}>
      {videos && (
        <View style={styles.modeRow}>
          {(
            [
              [false, 'Manga', 'lists'],
              [true, 'Videos + Manga', 'videos'],
            ] as const
          ).map(([k, label, icon]) => (
            <TouchableOpacity key={label} style={[styles.modeBtn, mix === k && styles.modeBtnOn]} onPress={() => setMix(k)} accessibilityState={{ selected: mix === k }}>
              <Icon name={icon} size={14} color={mix === k ? p.text : p.textSecondary} />
              <Text style={[styles.modeText, mix === k && styles.modeTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* This year */}
      <Animated.View entering={enter(0)}>
        <TouchableOpacity activeOpacity={0.9} style={[styles.poster, { backgroundColor: useMix ? '#16052B' : '#1A0509' }]} onPress={() => open(hub.year.range)} accessibilityLabel={`Play your ${hub.year.range.label} Wrapped`}>
          <CoverWall sources={wall} rows={4} tile={78} tilt={-12} opacity={0.55} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient(`linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.92) 100%)`, 'rgba(0,0,0,0.55)')]} />
          <View style={[styles.glow, { backgroundColor: tint }]} />
          <View style={{ gap: 10 }}>
            <Text style={styles.kicker}>{useMix ? 'VIDEOS + MANGA WRAPPED' : 'READING WRAPPED'}</Text>
            <Text style={styles.yearBig}>{hub.year.range.label}</Text>
            <StatRow
              cells={
                mixOf(hub.year)
                  ? [
                      { v: hours(mixOf(hub.year)!.watchMs), l: 'watching' },
                      { v: hours(mixOf(hub.year)!.readMs), l: 'reading' },
                      { v: hub.year.y.chapters.toLocaleString(), l: 'chapters' },
                      { v: String(mixOf(hub.year)!.days), l: 'days' },
                    ]
                  : [
                      { v: hub.year.y.chapters.toLocaleString(), l: 'chapters' },
                      { v: hours(hub.year.y.ms), l: 'reading' },
                      { v: String(hub.year.y.titles), l: 'titles' },
                      { v: String(hub.year.y.days), l: 'days' },
                    ]
              }
            />
            {mixOf(hub.year) && (
              <View style={{ gap: 5 }}>
                <GrowBar share={mixOf(hub.year)!.readShare} track="rgba(255,255,255,0.25)" color="#BF5AF2" height={6} />
                <View style={styles.legend}>
                  <Text style={[styles.legendText, { color: '#D9A8FF' }]}>Reading {Math.round(mixOf(hub.year)!.readShare * 100)}%</Text>
                  <Text style={styles.legendText}>Watching {100 - Math.round(mixOf(hub.year)!.readShare * 100)}%</Text>
                </View>
              </View>
            )}
            {hub.year.y.top.length > 0 && (
              <View style={styles.topRow}>
                <View style={styles.topCovers}>
                  {hub.year.y.top.slice(0, 3).map((t, k) => {
                    const s = cover(t.id);
                    return s ? (
                      <View key={t.id} style={{ marginLeft: k ? -14 : 0, zIndex: 3 - k, transform: [{ rotate: `${(k - 1) * 5}deg` }] }}>
                        <MangaCover series={s} width={k ? 42 : 50} radius={7} />
                        {k === 0 && (
                          <View style={styles.rankBadge}>
                            <Text style={styles.rankBadgeText}>1</Text>
                          </View>
                        )}
                      </View>
                    ) : null;
                  })}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.topRank}>YOUR #1</Text>
                  <Text style={styles.topTitle} numberOfLines={2}>
                    {cover(hub.year.y.top[0].id)?.title ?? ''}
                  </Text>
                  {hub.year.y.top.length > 1 && (
                    <Text style={styles.topMore} numberOfLines={1}>
                      then {hub.year.y.top.slice(1, 3).map((t) => cover(t.id)?.title).filter(Boolean).join(', ')}
                    </Text>
                  )}
                </View>
              </View>
            )}
            <View style={styles.play}>
              <Icon name="play" size={14} color="#000" />
              <Text style={styles.playText}>Play {hub.year.range.label}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {/* All time */}
      <Animated.View entering={enter(1)}>
        <TouchableOpacity activeOpacity={0.9} style={styles.allPoster} onPress={() => open(hub.all.range)} accessibilityLabel="Play your all-time Wrapped">
          <View style={[styles.glow, { backgroundColor: '#FFD60A', opacity: 0.22 }]} />
          <Text style={styles.allInfinity}>∞</Text>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.kicker, { color: '#FFD60A' }]}>{useMix ? 'ALL TIME · VIDEOS + MANGA' : 'ALL TIME WRAPPED'}</Text>
            <Text style={styles.allTitle}>Your whole story</Text>
            <Text style={styles.allSub}>
              Since {since.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              {years >= 1 ? ` · ${years >= 1.95 ? `${Math.floor(years)} years` : 'a year'}` : ''}
            </Text>
            <Text style={styles.allLine}>{line(hub.all)}</Text>
            <View style={[styles.play, { backgroundColor: '#FFD60A', marginTop: 6 }]}>
              <Icon name="play" size={13} color="#000" />
              <Text style={styles.playText}>Play all time</Text>
            </View>
          </View>
          <View style={styles.fan}>
            {hub.all.y.top.slice(0, 3).map((t, k) => {
              const s = cover(t.id);
              return s ? (
                <View key={t.id} style={[styles.fanCover, { transform: [{ rotate: `${(k - 1) * 9}deg` }, { translateX: (k - 1) * 22 }], zIndex: k === 1 ? 3 : 1 }]}>
                  <MangaCover series={s} width={62} radius={8} />
                </View>
              ) : null;
            })}
          </View>
        </TouchableOpacity>
      </Animated.View>

      {/* Weeks */}
      <Animated.View entering={enter(2)} style={{ gap: 10 }}>
        <View style={styles.head}>
          <Text style={styles.headTitle}>Weeks</Text>
          <Text style={styles.headSub}>Swipe for earlier</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }} style={{ marginRight: -16 }}>
          {hub.weeks.map((e, k) => {
            const top = cover(e.y.top[0]?.id);
            const mostDay = Math.max(1, ...e.y.perDay);
            const on = k === 0;
            return (
              <TouchableOpacity key={e.range.start} activeOpacity={0.85} style={[styles.week, on && { backgroundColor: p.accent }]} onPress={() => open(e.range)} accessibilityLabel={`Play ${e.range.label}`}>
                <Text style={[styles.weekLabel, on && { color: '#fff' }]} numberOfLines={1} adjustsFontSizeToFit>
                  {e.range.label}
                </Text>
                <View style={styles.weekBars}>
                  {e.y.perDay.slice(0, 7).map((ms, d) => (
                    <View key={d} style={styles.weekBarCell}>
                      <GrowColumn ratio={ms / mostDay} height={44} width={9} delay={k < 3 ? d * 40 : 0} color={on ? '#fff' : p.accent} radius={3} />
                      <Text style={[styles.weekDay, on && { color: 'rgba(255,255,255,0.8)' }]}>{'MTWTFSS'[d]}</Text>
                    </View>
                  ))}
                </View>
                <Text style={[styles.weekLine, on && { color: '#fff' }]} numberOfLines={1}>
                  {line(e)}
                </Text>
                <GrowBar share={weight(e) / maxWeek} track={on ? 'rgba(255,255,255,0.3)' : p.elevated} color={on ? '#fff' : p.accent} height={4} />
                <View style={styles.weekTop}>
                  {top ? <MangaCover series={top} width={22} radius={4} /> : <Icon name="moon" size={14} color={on ? '#fff' : p.textMuted} />}
                  <Text style={[styles.weekTopText, on && { color: '#fff' }]} numberOfLines={1}>
                    {top ? top.title : 'A quiet week'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>

      {/* Months */}
      <Animated.View entering={enter(3)} style={{ gap: 10 }}>
        <View style={styles.head}>
          <Text style={styles.headTitle}>{hub.year.range.label}, month by month</Text>
          {hub.bestMonth !== null && <Text style={styles.headSub}>Best: {hub.months[hub.bestMonth].range.label}</Text>}
        </View>
        <View style={styles.monthGrid}>
          {hub.months.map((m) => {
            const w = weight(m);
            const top = cover(m.y.top[0]?.id);
            const best = m.month === hub.bestMonth;
            const current = !m.future && m.range.end > now;
            if (m.future)
              return (
                <View key={m.month} style={[styles.month, styles.monthFuture]}>
                  <Text style={styles.monthName}>{MONTH(m.month)}</Text>
                  <Text style={styles.monthSoon}>Soon</Text>
                </View>
              );
            return (
              <TouchableOpacity key={m.month} activeOpacity={0.85} style={[styles.month, best && styles.monthBest, !w && { opacity: 0.5 }]} onPress={() => open(m.range)} accessibilityLabel={`Play ${m.range.label}`}>
                {top?.coverSource && <Image source={top.coverSource} style={[StyleSheet.absoluteFill, { opacity: 0.5 + 0.5 * (w / maxMonth) }]} contentFit="cover" transition={0} />}
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.8) 100%)', 'rgba(0,0,0,0.4)')]} />
                <View style={styles.monthTopRow}>
                  <Text style={[styles.monthName, { color: '#fff' }]}>{MONTH(m.month)}</Text>
                  {best ? <Icon name="trophy" size={14} color="#FFD60A" /> : current ? <View style={styles.nowDot} /> : null}
                </View>
                <View style={{ gap: 4 }}>
                  <Text style={styles.monthValue} numberOfLines={1}>
                    {w ? (mixOf(m) ? hours(mixOf(m)!.totalMs) : m.y.ms ? hours(m.y.ms) : `${m.y.chapters} ch.`) : '—'}
                  </Text>
                  <GrowBar share={w / maxMonth} track="rgba(255,255,255,0.2)" color={best ? '#FFD60A' : '#fff'} height={3} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Animated.View>

      {/* Years before */}
      {hub.pastYears.length > 0 && (
        <Animated.View entering={enter(4)} style={{ gap: 10 }}>
          <View style={styles.head}>
            <Text style={styles.headTitle}>Years before</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }} style={{ marginRight: -16 }}>
            {hub.pastYears.map((e) => {
              const top = cover(e.y.top[0]?.id);
              return (
                <TouchableOpacity key={e.range.label} activeOpacity={0.85} style={styles.pastYear} onPress={() => open(e.range)} accessibilityLabel={`Play your ${e.range.label} Wrapped`}>
                  {top?.coverSource && <Image source={top.coverSource} style={[StyleSheet.absoluteFill, { opacity: 0.6 }]} contentFit="cover" transition={0} />}
                  <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.9) 100%)', 'rgba(0,0,0,0.55)')]} />
                  <Text style={styles.pastYearBig}>{e.range.label}</Text>
                  <Text style={styles.pastYearLine} numberOfLines={2}>
                    {line(e)}
                  </Text>
                  {top && (
                    <Text style={styles.pastYearTop} numberOfLines={1}>
                      #1 {top.title}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

function StatRow({ cells }: { cells: { v: string; l: string }[] }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stats}>
      {cells.map((c) => (
        <View key={c.l} style={styles.stat}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
            {c.v}
          </Text>
          <Text style={styles.statLabel}>{c.l}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    modeRow: { flexDirection: 'row', backgroundColor: p.card, borderRadius: 14, padding: 4 },
    modeBtn: { flex: 1, flexDirection: 'row', gap: 6, borderRadius: 11, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
    modeBtnOn: { backgroundColor: p.elevated },
    modeText: { color: p.textSecondary, fontWeight: '700', fontSize: 14 },
    modeTextOn: { color: p.text },

    poster: { borderRadius: 28, padding: 20, paddingTop: 120, overflow: 'hidden' },
    glow: { position: 'absolute', right: -80, top: -80, width: 260, height: 260, borderRadius: 130, opacity: 0.35 },
    kicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
    yearBig: { color: '#fff', fontSize: 92, fontWeight: '900', letterSpacing: -4, lineHeight: 92, marginVertical: -4 },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
    statValue: { color: '#fff', fontSize: 19, fontWeight: '900' },
    statLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800', marginTop: 1 },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 16, padding: 10 },
    topCovers: { flexDirection: 'row', alignItems: 'center' },
    rankBadge: { position: 'absolute', top: -6, left: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFD60A', alignItems: 'center', justifyContent: 'center' },
    rankBadgeText: { color: '#000', fontSize: 11, fontWeight: '900' },
    topRank: { color: '#FFD60A', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    topTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
    topMore: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
    legend: { flexDirection: 'row', justifyContent: 'space-between' },
    legendText: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '800' },
    play: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
    playText: { color: '#000', fontSize: 15, fontWeight: '900' },

    allPoster: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 24, padding: 18, overflow: 'hidden', backgroundColor: '#14110A', borderWidth: 1, borderColor: 'rgba(255,214,10,0.35)' },
    allInfinity: { position: 'absolute', right: -6, bottom: -60, color: 'rgba(255,214,10,0.08)', fontSize: 220, fontWeight: '900' },
    allTitle: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
    allSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
    allLine: { color: '#fff', fontSize: 15, fontWeight: '800' },
    fan: { width: 110, height: 110, alignItems: 'center', justifyContent: 'center' },
    fanCover: { position: 'absolute', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },

    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    headTitle: { color: p.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
    headSub: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },

    week: { width: 158, gap: 8, backgroundColor: p.card, borderRadius: 20, padding: 14 },
    weekLabel: { color: p.text, fontSize: 15, fontWeight: '900' },
    weekBars: { flexDirection: 'row', height: 60, alignItems: 'flex-end' },
    weekBarCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
    weekDay: { color: p.textMuted, fontSize: 9, fontWeight: '800' },
    weekLine: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    weekTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    weekTopText: { flex: 1, color: p.text, fontSize: 12, fontWeight: '700' },

    monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    month: { width: '31.6%', height: 104, borderRadius: 16, padding: 10, justifyContent: 'space-between', overflow: 'hidden', backgroundColor: p.card },
    monthBest: { borderWidth: 2, borderColor: '#FFD60A' },
    monthFuture: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: p.elevated, borderStyle: 'dashed' },
    monthTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    monthName: { color: p.textMuted, fontSize: 17, fontWeight: '900' },
    monthSoon: { color: p.textMuted, fontSize: 12, fontWeight: '700' },
    monthValue: { color: '#fff', fontSize: 15, fontWeight: '900' },
    nowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#30D158' },

    pastYear: { width: 140, height: 180, borderRadius: 20, padding: 12, justifyContent: 'flex-end', overflow: 'hidden', backgroundColor: p.card, gap: 2 },
    pastYearBig: { color: '#fff', fontSize: 38, fontWeight: '900', letterSpacing: -1.5 },
    pastYearLine: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
    pastYearTop: { color: '#FFD60A', fontSize: 11, fontWeight: '800' },
  });
