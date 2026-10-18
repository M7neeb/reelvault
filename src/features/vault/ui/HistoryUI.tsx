/**
 * History: everything you watched, day by day (plays close together are one
 * sitting), with what you last watched playing at the top - and Stats: when
 * you watch, your streaks, what you rewatch, how much of a video you finish,
 * month by month. Presentational only (see types.ts).
 */

import { useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';

import { historyDays, hourLabel, watchStats, WEEKDAYS } from '../history';
import { friendlyName } from '../names';
import { fmtMs, type VaultPlay } from '../stats';
import { tick } from './haptics';
import Icon from './Icon';
import { Bars, Card, gradient, Ring, SectionTitle, ShareBar, StatTile } from './insightParts';
import { LiveCard } from './live';
import { enterUp, PressableScale } from './motion';
import { Segment } from './sheets';
import { Aurora, CountUp, GrowBar } from './storyKit';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

type Thumbs = Map<string, VaultItem['thumbSource']>;

const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const shortMs = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : fmtMs(ms));

export default function HistoryTab({
  items,
  plays,
  thumbs,
  initialStats = false,
  onOpen,
  onDelete,
}: {
  items: VaultItem[];
  plays: VaultPlay[];
  thumbs: Thumbs;
  initialStats?: boolean;
  onOpen: (id: string) => void;
  /** Remove one sitting from the history (its plays). */
  onDelete: (videoId: string, from: number, to: number) => void;
}) {
  const [view, setView] = useState<'history' | 'stats'>(initialStats ? 'stats' : 'history');
  return (
    <>
      <Animated.View entering={enterUp(0)}>
        <Segment
          options={[
            { key: 'history', label: 'History' },
            { key: 'stats', label: 'Stats' },
          ]}
          value={view}
          onChange={(v) => {
            tick();
            setView(v);
          }}
        />
      </Animated.View>
      {view === 'history' ? <HistoryList items={items} plays={plays} thumbs={thumbs} onOpen={onOpen} onDelete={onDelete} /> : <Stats items={items} plays={plays} thumbs={thumbs} onOpen={onOpen} />}
    </>
  );
}

/* ---------------------------------------------------------------- history */

function HistoryList({ items, plays, thumbs, onOpen, onDelete }: { items: VaultItem[]; plays: VaultPlay[]; thumbs: Thumbs; onOpen: (id: string) => void; onDelete: (videoId: string, from: number, to: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [range, setRange] = useState<'all' | 'week' | 'month'>('all');
  const [shown, setShown] = useState(14);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);
  const now = Date.now();
  const days = useMemo(() => historyDays(plays, now, new Set(byId.keys())), [plays, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cutoff = range === 'week' ? now - 7 * 86_400_000 : range === 'month' ? now - 30 * 86_400_000 : 0;
  const list = days.filter((d) => d.key >= cutoff - 86_400_000).map((d) => ({ ...d, sittings: d.sittings.filter((s) => !removed.has(`${s.videoId}:${s.at}`)) })).filter((d) => d.sittings.length);
  const total = list.reduce((a, d) => a + d.sittings.reduce((b, s) => b + s.ms, 0), 0);
  const count = list.reduce((a, d) => a + d.sittings.length, 0);
  const last = days[0]?.sittings[0];
  const lastVideo = last ? byId.get(last.videoId) : undefined;
  const fortnight = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime();
      const ms = plays.filter((x) => x.startedAt >= start && x.startedAt < start + 86_400_000 && byId.has(x.videoId)).reduce((a, x) => a + x.watchedMs, 0);
      out.push({ label: new Date(start).toLocaleDateString(undefined, { weekday: 'narrow' }), value: ms, current: i === 0, detail: new Date(start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) });
    }
    return out;
  }, [plays, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (videoId: string, at: number, ms: number) => {
    const go = () => {
      setRemoved((r) => new Set([...r, `${videoId}:${at}`]));
      onDelete(videoId, at - 1, at + Math.max(ms, 1) + 20 * 60_000);
    };
    if (Platform.OS === 'web') return go();
    Alert.alert('Remove from history?', 'This sitting no longer counts for your stats, Wrapped and badges.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: go },
    ]);
  };

  if (!days.length) {
    return (
      <Card>
        <View style={styles.empty}>
          <Icon name="history" size={36} color={p.textMuted} />
          <Text style={styles.emptyTitle}>Nothing watched yet</Text>
          <Text style={styles.emptyText}>Everything you watch here shows up on this page, day by day.</Text>
        </View>
      </Card>
    );
  }

  return (
    <>
      {last && lastVideo && (
        <Animated.View entering={enterUp(1)}>
          <PressableScale onPress={() => onOpen(last.videoId)} scaleTo={0.97} style={[styles.lastCard, { height: Math.min(260, (width - 32) * 0.62) }]} accessibilityLabel={`Watch ${friendlyName(lastVideo)} again`}>
            <LiveCard id="history-last" uri={lastVideo.uri} durationMs={lastVideo.durationMs} cover={thumbs.get(last.videoId)} radius={0} priority={2} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.82) 100%)', 'rgba(0,0,0,0.35)')]} />
            <View style={styles.lastBody} pointerEvents="none">
              <Text style={styles.lastKicker}>LAST WATCHED · {days[0].title.toUpperCase()} {time(last.at)}</Text>
              <Text style={styles.lastTitle} numberOfLines={2}>
                {friendlyName(lastVideo)}
              </Text>
              <Text style={styles.lastSub}>
                {shortMs(last.ms)} watched{lastVideo.durationMs ? ` of ${shortMs(lastVideo.durationMs)}` : ''}
              </Text>
              {!!lastVideo.durationMs && (
                <View style={{ marginTop: 6 }}>
                  <GrowBar share={Math.min(1, last.ms / lastVideo.durationMs)} color="#fff" height={4} />
                </View>
              )}
            </View>
          </PressableScale>
        </Animated.View>
      )}

      <Card index={2} title="The last two weeks" sub={`${fmtMs(fortnight.reduce((a, d) => a + d.value, 0))} watched`}>
        <Bars data={fortnight} height={80} format={(v) => (v ? shortMs(v) : 'nothing')} />
      </Card>

      <Animated.View entering={enterUp(3)}>
        <Segment
          options={[
            { key: 'all', label: 'Everything' },
            { key: 'week', label: '7 days' },
            { key: 'month', label: '30 days' },
          ]}
          value={range}
          onChange={setRange}
        />
      </Animated.View>
      <Text style={styles.summary}>
        {count} {count === 1 ? 'sitting' : 'sittings'} · {fmtMs(total)}
      </Text>

      {list.slice(0, shown).map((d, di) => (
        <Animated.View key={d.key} entering={enterUp(4 + Math.min(di, 4))} style={styles.day}>
          <View style={styles.dayHead}>
            <Text style={styles.dayTitle}>{d.title}</Text>
            <Text style={styles.dayMs}>{fmtMs(d.sittings.reduce((a, s) => a + s.ms, 0))}</Text>
          </View>
          {d.sittings.map((s) => {
            const v = byId.get(s.videoId);
            if (!v) return null;
            const share = v.durationMs ? Math.min(1, s.ms / v.durationMs) : null;
            return (
              <TouchableOpacity key={`${s.videoId}:${s.at}`} style={styles.row} onPress={() => onOpen(s.videoId)} onLongPress={() => remove(s.videoId, s.at, s.ms)} delayLongPress={350}>
                <View style={styles.thumb}>
                  <Image source={thumbs.get(s.videoId)} style={StyleSheet.absoluteFill} contentFit="cover" />
                  {share !== null && (
                    <View style={styles.thumbBar}>
                      <View style={[styles.thumbFill, { width: `${Math.round(share * 100)}%` }]} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {friendlyName(v)}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {time(s.at)} · {shortMs(s.ms)}
                    {s.plays > 1 ? ` · ${s.plays} times` : ''}
                    {share !== null && share >= 0.95 ? ' · to the end' : ''}
                  </Text>
                </View>
                <TouchableOpacity hitSlop={10} onPress={() => remove(s.videoId, s.at, s.ms)} accessibilityLabel="Remove from history">
                  <Icon name="more" size={16} color={p.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      ))}
      {list.length > shown && (
        <TouchableOpacity style={styles.more} onPress={() => setShown((n) => n + 21)}>
          <Text style={styles.moreText}>Show earlier days</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.foot}>Hold a row to remove it from your history.</Text>
    </>
  );
}

/* ------------------------------------------------------------------ stats */

function Stats({ items, plays, thumbs, onOpen }: { items: VaultItem[]; plays: VaultPlay[]; thumbs: Thumbs; onOpen: (id: string) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const s = useMemo(() => watchStats(items, plays, Date.now()), [items, plays]);
  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);
  const top = s.rewatched[0] ? byId.get(s.rewatched[0].videoId) : undefined;
  const longest = s.longest ? byId.get(s.longest.videoId) : undefined;
  const maxTag = Math.max(1, ...s.topTags.map((t) => t.ms));

  if (!s.plays) {
    return (
      <Card>
        <View style={styles.empty}>
          <Icon name="stats" size={36} color={p.textMuted} />
          <Text style={styles.emptyTitle}>Stats start with your first watch</Text>
          <Text style={styles.emptyText}>When you watch, how long, what you come back to: it all appears here.</Text>
        </View>
      </Card>
    );
  }

  return (
    <>
      <Animated.View entering={enterUp(1)} style={[styles.hero, gradient('linear-gradient(135deg, #FF9F0A 0%, #FF375F 50%, #5E1A3A 100%)')]}>
        <Aurora colors={['#FF9F0A', '#5E1A3A']} accent="#FFD60A" width={width - 32} height={190} />
        <Text style={styles.heroKicker}>ALL YOUR WATCHING{s.firstPlayAt ? ` · SINCE ${new Date(s.firstPlayAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }).toUpperCase()}` : ''}</Text>
        <CountUp to={s.totalMs} format={(n) => fmtMs(n)} style={styles.heroValue} />
        <View style={styles.heroRow}>
          <View style={styles.heroFact}>
            <Text style={styles.heroNum}>{s.sittings}</Text>
            <Text style={styles.heroLabel}>sittings</Text>
          </View>
          <View style={styles.heroFact}>
            <Text style={styles.heroNum}>{s.watched}</Text>
            <Text style={styles.heroLabel}>videos watched</Text>
          </View>
          <View style={styles.heroFact}>
            <Text style={styles.heroNum}>{s.daysActive}</Text>
            <Text style={styles.heroLabel}>days</Text>
          </View>
        </View>
      </Animated.View>

      <View style={styles.tiles}>
        <StatTile icon="fire" value={`${s.currentStreak} ${s.currentStreak === 1 ? 'day' : 'days'}`} label="Current streak" tint="#FF9F0A" index={2} />
        <StatTile icon="trophy" value={`${s.longestStreak} ${s.longestStreak === 1 ? 'day' : 'days'}`} label="Longest streak" tint="#FFD60A" index={3} />
        <StatTile icon="clock" value={shortMs(s.avgSittingMs)} label="An average sitting" tint="#0A84FF" index={4} />
        <StatTile icon="eye" value={`${s.neverWatched}`} label="Videos never watched" tint="#BF5AF2" index={5} />
      </View>

      {s.finishRate !== null && (
        <Card index={6} title="How much you finish" sub="On average, of each video you start">
          <View style={styles.finish}>
            <Ring size={96} stroke={10} progress={s.finishRate} color={p.success}>
              <Text style={styles.finishPct}>{Math.round(s.finishRate * 100)}%</Text>
            </Ring>
            <Text style={styles.finishText}>
              {s.finishRate >= 0.8 ? 'You watch videos to the end.' : s.finishRate >= 0.5 ? 'You watch most of each video.' : 'You often jump in for the best bits.'}
            </Text>
          </View>
        </Card>
      )}

      <Card index={7} title="When you watch" sub={s.peakHour !== null ? `Most often around ${hourLabel(s.peakHour)}` : undefined}>
        <Bars data={s.byHour.map((v, h) => ({ label: h % 6 === 0 ? hourLabel(h) : '', value: v, current: h === s.peakHour, detail: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}` }))} height={90} format={shortMs} everyLabel={1} />
      </Card>

      <Card index={8} title="Your week" sub={s.peakWeekday !== null ? `${WEEKDAYS[s.peakWeekday]} is your day` : undefined}>
        <Bars data={s.byWeekday.map((v, i) => ({ label: WEEKDAYS[i], value: v, current: i === s.peakWeekday }))} height={80} format={shortMs} />
      </Card>

      <Card index={9} title="Month by month" sub="The last twelve months">
        <Bars data={s.months.map((m, i) => ({ label: m.label, value: m.ms, current: i === s.months.length - 1, detail: new Date(m.key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }))} height={90} format={shortMs} />
      </Card>

      {top && (
        <>
          <SectionTitle title="Most rewatched" detail={`${s.rewatched[0].plays} plays`} index={10} />
          <Animated.View entering={enterUp(10)}>
            <PressableScale onPress={() => onOpen(top.id)} scaleTo={0.97} style={[styles.topCard, { height: Math.min(240, (width - 32) * 0.58) }]} accessibilityLabel={`${friendlyName(top)}, your most rewatched video`}>
              <LiveCard id="stats-top" uri={top.uri} durationMs={top.durationMs} cover={thumbs.get(top.id)} radius={0} priority={1} style={StyleSheet.absoluteFill} />
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)', 'rgba(0,0,0,0.35)')]} />
              <View style={styles.lastBody} pointerEvents="none">
                <Text style={styles.lastKicker}>#1 · ON REPEAT</Text>
                <Text style={styles.lastTitle} numberOfLines={2}>
                  {friendlyName(top)}
                </Text>
                <Text style={styles.lastSub}>
                  {s.rewatched[0].plays} plays · {fmtMs(s.rewatched[0].ms)}
                </Text>
              </View>
            </PressableScale>
          </Animated.View>
          <Card index={11}>
            {s.rewatched.slice(1, 8).map((r, i) => {
              const v = byId.get(r.videoId);
              if (!v) return null;
              return (
                <TouchableOpacity key={r.videoId} style={styles.row} onPress={() => onOpen(r.videoId)}>
                  <Text style={styles.rank}>{i + 2}</Text>
                  <View style={styles.thumbSmall}>
                    <Image source={thumbs.get(r.videoId)} style={StyleSheet.absoluteFill} contentFit="cover" />
                  </View>
                  <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
                    {friendlyName(v)}
                  </Text>
                  <Text style={styles.rowSub}>{r.plays}×</Text>
                </TouchableOpacity>
              );
            })}
          </Card>
        </>
      )}

      <View style={styles.tiles}>
        {s.biggestDay && <StatTile icon="calendar" value={fmtMs(s.biggestDay.ms)} label={`Your biggest day: ${new Date(s.biggestDay.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`} tint="#30D158" index={12} />}
        {s.longest && longest && <StatTile icon="hourglass" value={fmtMs(s.longest.ms)} label={`Longest sitting: ${friendlyName(longest)}`} tint="#64D2FF" index={13} />}
      </View>

      {s.topTags.length > 0 && (
        <Card index={14} title="What you watch most" sub="By keyword, by watch time">
          {s.topTags.map((t) => (
            <View key={t.tag} style={{ gap: 5 }}>
              <View style={styles.tagRow}>
                <Text style={styles.rowTitle}>#{t.tag}</Text>
                <Text style={styles.rowSub}>{fmtMs(t.ms)}</Text>
              </View>
              <ShareBar ratio={t.ms / maxTag} />
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
    emptyTitle: { color: p.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 14, textAlign: 'center' },
    lastCard: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' },
    topCard: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' },
    lastBody: { position: 'absolute', left: 16, right: 16, bottom: 14, gap: 3 },
    lastKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    lastTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.6, lineHeight: 27 },
    lastSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
    summary: { color: p.textSecondary, fontSize: 13, fontWeight: '700', marginTop: -4 },
    day: { backgroundColor: p.elevated, borderRadius: 20, padding: 14, gap: 10 },
    dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    dayTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    dayMs: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    thumb: { width: 88, height: 52, borderRadius: 10, overflow: 'hidden', backgroundColor: p.card },
    thumbBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
    thumbFill: { height: 3, backgroundColor: '#FF375F' },
    thumbSmall: { width: 52, height: 34, borderRadius: 8, overflow: 'hidden', backgroundColor: p.card },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    rowSub: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    rank: { color: p.textMuted, fontSize: 15, fontWeight: '900', width: 18, textAlign: 'center' },
    more: { alignSelf: 'center', backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
    moreText: { color: p.link, fontWeight: '700' },
    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center' },
    hero: { borderRadius: 26, padding: 18, gap: 6, overflow: 'hidden' },
    heroKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    heroValue: { color: '#fff', fontSize: 46, fontWeight: '900', letterSpacing: -1.4 },
    heroRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
    heroFact: { flex: 1, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 14, padding: 10 },
    heroNum: { color: '#fff', fontSize: 22, fontWeight: '900' },
    heroLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    finish: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    finishPct: { color: p.text, fontSize: 22, fontWeight: '900' },
    finishText: { color: p.textSoft, fontSize: 15, fontWeight: '600', flex: 1 },
    tagRow: { flexDirection: 'row', justifyContent: 'space-between' },
  });
