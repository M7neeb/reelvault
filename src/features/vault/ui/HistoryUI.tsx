/**
 * History: everything you watched, three ways.
 *
 * - Timeline: what you last watched playing at the top, the videos you did
 *   not finish (pick up where you left off), the last two weeks, then day by
 *   day (plays close together are one sitting), each day with a 24-hour strip
 *   of when you watched. Search by name, narrow to 7 or 30 days, hold a row
 *   (or a day) to remove it from your history.
 * - Calendar: a month at a glance, each day coloured by how much you watched;
 *   tap a day for what you watched then.
 * - Stats: when you watch (a punch card of hours and days), your streaks,
 *   what you rewatch, how much of a video you finish, month by month.
 * Presentational only (see types.ts).
 */

import { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useWindowDimensions } from './screen';
import { Image } from 'expo-image';
import Animated, { FadeIn } from 'react-native-reanimated';

import { historyDays, hourLabel, monthGrid, punchCard, unfinished, watchStats, WEEKDAYS, type Sitting } from '../history';
import { friendlyName } from '../names';
import { fmtMs, type VaultPlay } from '../stats';
import { tick } from './haptics';
import Icon from './Icon';
import { Bars, Card, gradient, Ring, SectionTitle, ShareBar, StatTile } from './insightParts';
import { LiveCard } from './live';
import { DUR, enterUp, PressableScale } from './motion';
import { Segment } from './sheets';
import { Aurora, CountUp, GrowBar } from './storyKit';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

type Thumbs = Map<string, VaultItem['thumbSource']>;

const DAY = 86_400_000;
const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const shortMs = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : fmtMs(ms));
const agoShort = (t: number) => {
  const d = Math.floor((Date.now() - t) / DAY);
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function HistoryTab({
  items,
  plays,
  thumbs,
  initialStats = false,
  onOpen,
  onDelete,
  frozenDays = [],
}: {
  /** Days a streak freeze covered. */
  frozenDays?: number[];
  items: VaultItem[];
  plays: VaultPlay[];
  thumbs: Thumbs;
  initialStats?: boolean;
  onOpen: (id: string) => void;
  /** Remove one sitting from the history (its plays). */
  onDelete: (videoId: string, from: number, to: number) => void;
}) {
  const [view, setView] = useState<'history' | 'calendar' | 'stats'>(initialStats ? 'stats' : 'history');
  return (
    <>
      <Animated.View entering={enterUp(0)}>
        <Segment
          options={[
            { key: 'history', label: 'Timeline' },
            { key: 'calendar', label: 'Calendar' },
            { key: 'stats', label: 'Stats' },
          ]}
          value={view}
          onChange={(v) => {
            tick();
            setView(v);
          }}
        />
      </Animated.View>
      {view === 'history' && <HistoryList items={items} plays={plays} thumbs={thumbs} onOpen={onOpen} onDelete={onDelete} />}
      {view === 'calendar' && <CalendarView items={items} plays={plays} thumbs={thumbs} onOpen={onOpen} />}
      {view === 'stats' && <Stats items={items} plays={plays} thumbs={thumbs} onOpen={onOpen} frozenDays={frozenDays} />}
    </>
  );
}

/* ---------------------------------------------------------------- pieces */

/** When in the day you watched: a 24-hour track with a mark for each sitting. */
function DayStrip({ sittings, dayKey }: { sittings: Sitting[]; dayKey: number }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <View style={styles.strip} accessibilityLabel={`Watched at ${sittings.map((s) => time(s.at)).join(', ')}`}>
      {[6, 12, 18].map((h) => (
        <View key={h} style={[styles.stripTick, { left: `${(h / 24) * 100}%` }]} />
      ))}
      {sittings.map((s) => {
        const start = Math.max(0, (s.at - dayKey) / DAY);
        const w = Math.max(0.012, Math.min(1 - start, s.ms / DAY));
        return <View key={`${s.videoId}${s.at}`} style={[styles.stripMark, { left: `${start * 100}%`, width: `${w * 100}%`, backgroundColor: p.accent }]} />;
      })}
    </View>
  );
}

function SittingRow({ s, v, thumbs, onOpen, onRemove }: { s: Sitting; v: VaultItem; thumbs: Thumbs; onOpen: (id: string) => void; onRemove?: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const share = v.durationMs ? Math.min(1, s.ms / v.durationMs) : null;
  return (
    <TouchableOpacity style={styles.row} onPress={() => onOpen(s.videoId)} onLongPress={onRemove} delayLongPress={350}>
      <View style={styles.thumb}>
        <Image source={thumbs.get(s.videoId)} style={StyleSheet.absoluteFill} contentFit="cover" />
        {share !== null && (
          <View style={styles.thumbBar}>
            <View style={[styles.thumbFill, { width: `${Math.round(share * 100)}%` }]} />
          </View>
        )}
        {s.plays > 1 && (
          <View style={styles.thumbBadge}>
            <Text style={styles.thumbBadgeText}>{s.plays}×</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {friendlyName(v)}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {time(s.at)} · {shortMs(s.ms)}
          {share !== null && share >= 0.95 ? ' · to the end' : share !== null ? ` · ${Math.round(share * 100)} %` : ''}
        </Text>
      </View>
      {onRemove && (
        <TouchableOpacity hitSlop={10} onPress={onRemove} accessibilityLabel="Remove from history">
          <Icon name="more" size={16} color={p.textMuted} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

/* ---------------------------------------------------------------- timeline */

function HistoryList({ items, plays, thumbs, onOpen, onDelete }: { items: VaultItem[]; plays: VaultPlay[]; thumbs: Thumbs; onOpen: (id: string) => void; onDelete: (videoId: string, from: number, to: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [range, setRange] = useState<'all' | 'week' | 'month'>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(14);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);
  const now = Date.now();
  const days = useMemo(() => historyDays(plays, now, new Set(byId.keys())), [plays, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(() => unfinished(items, plays, 12), [items, plays]);
  const cutoff = range === 'week' ? now - 7 * DAY : range === 'month' ? now - 30 * DAY : 0;
  const q = query.trim().toLowerCase();
  const list = days
    .filter((d) => d.key >= cutoff - DAY)
    .map((d) => ({
      ...d,
      sittings: d.sittings.filter((s) => !removed.has(`${s.videoId}:${s.at}`) && (!q || friendlyName(byId.get(s.videoId)!).toLowerCase().includes(q))),
    }))
    .filter((d) => d.sittings.length);
  const total = list.reduce((a, d) => a + d.sittings.reduce((b, s) => b + s.ms, 0), 0);
  const count = list.reduce((a, d) => a + d.sittings.length, 0);
  const last = days[0]?.sittings[0];
  const lastVideo = last ? byId.get(last.videoId) : undefined;
  const fortnight = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime();
      const ms = plays.filter((x) => x.startedAt >= start && x.startedAt < start + DAY && byId.has(x.videoId)).reduce((a, x) => a + x.watchedMs, 0);
      out.push({ label: new Date(start).toLocaleDateString(undefined, { weekday: 'narrow' }), value: ms, current: i === 0, detail: new Date(start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) });
    }
    return out;
  }, [plays, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const avgDay = fortnight.slice(0, 13).reduce((a, d) => a + d.value, 0) / 13;
  const today = fortnight[13]?.value ?? 0;

  const ask = (title: string, body: string, go: () => void) => {
    if (Platform.OS === 'web') return go();
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: go },
    ]);
  };
  const remove = (videoId: string, at: number, ms: number) =>
    ask('Remove from history?', 'This sitting no longer counts for your stats, Wrapped and badges.', () => {
      setRemoved((r) => new Set([...r, `${videoId}:${at}`]));
      onDelete(videoId, at - 1, at + Math.max(ms, 1) + 20 * 60_000);
    });
  const removeDay = (sittings: Sitting[], title: string) =>
    ask(`Remove ${title.toLowerCase() === 'today' || title.toLowerCase() === 'yesterday' ? title.toLowerCase() : title} from history?`, `${sittings.length} ${sittings.length === 1 ? 'sitting' : 'sittings'} stop counting for your stats, Wrapped and badges.`, () => {
      setRemoved((r) => new Set([...r, ...sittings.map((s) => `${s.videoId}:${s.at}`)]));
      for (const s of sittings) onDelete(s.videoId, s.at - 1, s.at + Math.max(s.ms, 1) + 20 * 60_000);
    });

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
          <PressableScale onPress={() => onOpen(last.videoId)} scaleTo={0.97} style={[styles.lastCard, { height: Math.min(300, (width - 32) * 0.7) }]} accessibilityLabel={`Watch ${friendlyName(lastVideo)} again`}>
            <LiveCard id="history-last" uri={lastVideo.uri} durationMs={lastVideo.durationMs} cover={thumbs.get(last.videoId)} radius={0} priority={2} style={StyleSheet.absoluteFill} video={lastVideo} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.85) 100%)', 'rgba(0,0,0,0.3)')]} />
            <View style={styles.lastTop} pointerEvents="none">
              <View style={styles.liveChip}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LAST WATCHED</Text>
              </View>
            </View>
            <View style={styles.lastBody} pointerEvents="none">
              <Text style={styles.lastKicker}>
                {days[0].title.toUpperCase()} · {time(last.at)}
              </Text>
              <Text style={styles.lastTitle} numberOfLines={2}>
                {friendlyName(lastVideo)}
              </Text>
              <View style={styles.lastFoot}>
                <Text style={styles.lastSub}>
                  {shortMs(last.ms)} watched{lastVideo.durationMs ? ` of ${shortMs(lastVideo.durationMs)}` : ''}
                </Text>
                <View style={styles.againBtn}>
                  <Icon name="play" size={11} color="#000" />
                  <Text style={styles.againText}>Watch again</Text>
                </View>
              </View>
              {!!lastVideo.durationMs && (
                <View style={{ marginTop: 6 }}>
                  <GrowBar share={Math.min(1, last.ms / lastVideo.durationMs)} color="#fff" height={4} />
                </View>
              )}
            </View>
          </PressableScale>
        </Animated.View>
      )}

      {open.length > 0 && (
        <>
          <SectionTitle index={2} title="Pick up where you left off" detail={`${open.length}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hrow}>
            {open.map(({ video: v, share, at }, i) => (
              <Animated.View key={v.id} entering={enterUp(3 + i)}>
                <PressableScale onPress={() => onOpen(v.id)} style={styles.openCard} accessibilityLabel={`${friendlyName(v)}, ${Math.round(share * 100)} % watched`}>
                  <View style={styles.openMedia}>
                    <LiveCard id={`open-${v.id}`} uri={v.uri} durationMs={v.durationMs} startMs={Math.max(0, share * (v.durationMs ?? 0) - 4000)} cover={thumbs.get(v.id)} radius={0} style={StyleSheet.absoluteFill} video={v} soundStyle={{ top: 6, right: 6 }} />
                    <View style={styles.openBar}>
                      <View style={[styles.openFill, { width: `${Math.round(share * 100)}%` }]} />
                    </View>
                  </View>
                  <Text style={styles.openTitle} numberOfLines={1}>
                    {friendlyName(v)}
                  </Text>
                  <Text style={styles.openSub} numberOfLines={1}>
                    {Math.round(share * 100)} % · {v.durationMs ? `${shortMs(Math.max(0, v.durationMs * (1 - share)))} left` : ''} · {agoShort(at)}
                  </Text>
                </PressableScale>
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      <Card index={4} title="The last two weeks" sub={`${fmtMs(fortnight.reduce((a, d) => a + d.value, 0))} watched`}>
        <Bars data={fortnight} height={80} format={(v) => (v ? shortMs(v) : 'nothing')} />
        <View style={styles.todayRow}>
          <Icon name={today >= avgDay ? 'trending' : 'clock'} size={14} color={today >= avgDay ? p.success : p.textSecondary} />
          <Text style={styles.rowSub}>
            {today ? `Today ${shortMs(today)}` : 'Nothing yet today'} · usually {avgDay ? shortMs(avgDay) : 'nothing'} a day
          </Text>
        </View>
      </Card>

      <Animated.View entering={enterUp(5)} style={styles.searchBox}>
        <Icon name="search" size={15} color={p.textMuted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search your history" placeholderTextColor={p.textMuted} style={styles.searchInput} returnKeyType="search" clearButtonMode="while-editing" />
      </Animated.View>
      <Animated.View entering={enterUp(5)}>
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
        {q ? ` · matching “${query.trim()}”` : ''}
      </Text>

      {list.slice(0, shown).map((d, di) => (
        <Animated.View key={d.key} entering={enterUp(6 + Math.min(di, 4))} style={styles.day}>
          <TouchableOpacity style={styles.dayHead} onLongPress={() => removeDay(d.sittings, d.title)} delayLongPress={450} activeOpacity={0.8}>
            <Text style={styles.dayTitle}>{d.title}</Text>
            <Text style={styles.dayMs}>
              {d.sittings.length} · {fmtMs(d.sittings.reduce((a, s) => a + s.ms, 0))}
            </Text>
          </TouchableOpacity>
          <DayStrip sittings={d.sittings} dayKey={d.key} />
          {d.sittings.map((s) => {
            const v = byId.get(s.videoId);
            if (!v) return null;
            return <SittingRow key={`${s.videoId}:${s.at}`} s={s} v={v} thumbs={thumbs} onOpen={onOpen} onRemove={() => remove(s.videoId, s.at, s.ms)} />;
          })}
        </Animated.View>
      ))}
      {list.length === 0 && <Text style={[styles.foot, { paddingVertical: 20 }]}>Nothing matches.</Text>}
      {list.length > shown && (
        <TouchableOpacity style={styles.more} onPress={() => setShown((n) => n + 21)}>
          <Text style={styles.moreText}>Show earlier days</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.foot}>Hold a row, or a day’s title, to remove it from your history.</Text>
    </>
  );
}

/* ---------------------------------------------------------------- calendar */

function CalendarView({ items, plays, thumbs, onOpen }: { items: VaultItem[]; plays: VaultPlay[]; thumbs: Thumbs; onOpen: (id: string) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);
  const known = useMemo(() => new Set(byId.keys()), [byId]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const cells = useMemo(() => monthGrid(month.y, month.m, plays, known), [month, plays, known]);
  const days = useMemo(() => historyDays(plays, Date.now(), known), [plays, known]);
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...cells.map((c) => c?.ms ?? 0));
  const monthMs = cells.reduce((a, c) => a + (c?.ms ?? 0), 0);
  const active = cells.filter((c) => c && c.ms > 0).length;
  const day = picked !== null ? days.find((d) => d.key === picked) : undefined;
  const todayKey = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
  const step = (n: number) => {
    tick();
    setPicked(null);
    setMonth(({ y, m }) => {
      const d = new Date(y, m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };
  const atNow = month.y === new Date().getFullYear() && month.m === new Date().getMonth();

  return (
    <>
      <Card index={1}>
        <View style={styles.calHead}>
          <TouchableOpacity onPress={() => step(-1)} hitSlop={10} accessibilityLabel="Previous month">
            <Icon name="back" size={18} color={p.text} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.calTitle}>{new Date(month.y, month.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
            <Text style={styles.rowSub}>
              {monthMs ? `${fmtMs(monthMs)} · ${active} ${active === 1 ? 'day' : 'days'}` : 'Nothing watched'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => !atNow && step(1)} hitSlop={10} disabled={atNow} accessibilityLabel="Next month">
            <Icon name="forward" size={18} color={atNow ? p.textMuted : p.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.calGrid}>
          {WEEKDAYS.map((w) => (
            <Text key={w} style={styles.calDow}>
              {w[0]}
            </Text>
          ))}
          {cells.map((c, i) =>
            c ? (
              <TouchableOpacity
                key={c.key}
                style={styles.calCellWrap}
                disabled={!c.ms}
                onPress={() => {
                  tick();
                  setPicked(picked === c.key ? null : c.key);
                }}
                accessibilityLabel={`${c.day}: ${c.ms ? shortMs(c.ms) : 'nothing'}`}>
                <View
                  style={[
                    styles.calCell,
                    c.ms > 0 && { backgroundColor: `rgba(10,132,255,${0.18 + 0.82 * (c.ms / max)})` },
                    c.key === todayKey && { borderWidth: 2, borderColor: p.text },
                    picked === c.key && { borderWidth: 2, borderColor: p.rating },
                  ]}>
                  <Text style={[styles.calDay, c.ms / max > 0.5 && { color: '#fff', fontWeight: '900' }]}>{c.day}</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View key={`pad${i}`} style={styles.calCellWrap} />
            )
          )}
        </View>
        <View style={styles.legend}>
          <Text style={styles.rowSub}>Less</Text>
          {[0.18, 0.4, 0.62, 0.84, 1].map((a) => (
            <View key={a} style={[styles.legendCell, { backgroundColor: `rgba(10,132,255,${a})` }]} />
          ))}
          <Text style={styles.rowSub}>More</Text>
        </View>
      </Card>
      {day ? (
        <Animated.View key={day.key} entering={FadeIn.duration(DUR.base)} style={styles.day}>
          <View style={styles.dayHead}>
            <Text style={styles.dayTitle}>{day.title}</Text>
            <Text style={styles.dayMs}>{fmtMs(day.sittings.reduce((a, s) => a + s.ms, 0))}</Text>
          </View>
          <DayStrip sittings={day.sittings} dayKey={day.key} />
          {day.sittings.map((s) => {
            const v = byId.get(s.videoId);
            return v ? <SittingRow key={`${s.videoId}:${s.at}`} s={s} v={v} thumbs={thumbs} onOpen={onOpen} /> : null;
          })}
        </Animated.View>
      ) : (
        <Text style={styles.foot}>Tap a coloured day to see what you watched.</Text>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ stats */

function Stats({ items, plays, thumbs, onOpen, frozenDays = [] }: { items: VaultItem[]; plays: VaultPlay[]; thumbs: Thumbs; onOpen: (id: string) => void; frozenDays?: number[] }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const s = useMemo(() => watchStats(items, plays, Date.now(), frozenDays), [items, plays, frozenDays]);
  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);
  const punch = useMemo(() => punchCard(plays, new Set(byId.keys())), [plays, byId]);
  const top = s.rewatched[0] ? byId.get(s.rewatched[0].videoId) : undefined;
  const longest = s.longest ? byId.get(s.longest.videoId) : undefined;
  const maxTag = Math.max(1, ...s.topTags.map((t) => t.ms));
  const cell = Math.floor((width - 32 - 32 - 30) / 24);

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

      <Card index={6} title="Your watching clock" sub={s.peakHour !== null && s.peakWeekday !== null ? `Busiest: ${WEEKDAYS[s.peakWeekday]}s around ${hourLabel(s.peakHour)}` : 'Hours across, days down'}>
        <View style={{ gap: 3 }}>
          {punch.grid.map((row, d) => (
            <View key={d} style={styles.punchRow}>
              <Text style={styles.punchDay}>{WEEKDAYS[d].slice(0, 2)}</Text>
              {row.map((ms, h) => (
                <View
                  key={h}
                  style={[styles.punchCell, { width: cell, height: cell, backgroundColor: ms ? `rgba(191,90,242,${0.2 + 0.8 * (ms / Math.max(1, punch.max))})` : p.card }]}
                  accessibilityLabel={ms ? `${WEEKDAYS[d]} ${hourLabel(h)}: ${shortMs(ms)}` : undefined}
                />
              ))}
            </View>
          ))}
          <View style={[styles.punchRow, { marginTop: 2 }]}>
            <Text style={styles.punchDay} />
            {Array.from({ length: 24 }, (_, h) => (
              <Text key={h} style={[styles.punchHour, { width: cell }]}>
                {h % 6 === 0 ? (h === 0 ? '0' : String(h)) : ''}
              </Text>
            ))}
          </View>
        </View>
      </Card>

      {s.finishRate !== null && (
        <Card index={7} title="How much you finish" sub="On average, of each video you start">
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

      <Card index={8} title="When you watch" sub={s.peakHour !== null ? `Most often around ${hourLabel(s.peakHour)}` : undefined}>
        <Bars data={s.byHour.map((v, h) => ({ label: h % 6 === 0 ? hourLabel(h) : '', value: v, current: h === s.peakHour, detail: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}` }))} height={90} format={shortMs} everyLabel={1} />
      </Card>

      <Card index={9} title="Your week" sub={s.peakWeekday !== null ? `${WEEKDAYS[s.peakWeekday]} is your day` : undefined}>
        <Bars data={s.byWeekday.map((v, i) => ({ label: WEEKDAYS[i], value: v, current: i === s.peakWeekday }))} height={80} format={shortMs} />
      </Card>

      <Card index={10} title="Month by month" sub="The last twelve months">
        <Bars data={s.months.map((m, i) => ({ label: m.label, value: m.ms, current: i === s.months.length - 1, detail: new Date(m.key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }))} height={90} format={shortMs} />
      </Card>

      {top && (
        <>
          <SectionTitle title="Most rewatched" detail={`${s.rewatched[0].plays} plays`} index={11} />
          <Animated.View entering={enterUp(11)}>
            <PressableScale onPress={() => onOpen(top.id)} scaleTo={0.97} style={[styles.topCard, { height: Math.min(260, (width - 32) * 0.62) }]} accessibilityLabel={`${friendlyName(top)}, your most rewatched video`}>
              <LiveCard id="stats-top" uri={top.uri} durationMs={top.durationMs} cover={thumbs.get(top.id)} radius={0} priority={1} style={StyleSheet.absoluteFill} video={top} />
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.85) 100%)', 'rgba(0,0,0,0.3)')]} />
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
          {s.rewatched.length > 1 && (
            <View style={styles.wall}>
              {s.rewatched.slice(1, 10).map((r, i) => {
                const v = byId.get(r.videoId);
                if (!v) return null;
                return (
                  <Animated.View key={r.videoId} entering={enterUp(12 + i)} style={styles.wallCell}>
                    <PressableScale onPress={() => onOpen(r.videoId)} style={styles.wallThumb} accessibilityLabel={`${i + 2}. ${friendlyName(v)}, ${r.plays} plays`}>
                      <Image source={thumbs.get(r.videoId)} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.75) 100%)', 'rgba(0,0,0,0.2)')]} />
                      <Text style={styles.wallRank}>{i + 2}</Text>
                      <Text style={styles.wallPlays}>{r.plays}×</Text>
                    </PressableScale>
                    <Text style={styles.wallName} numberOfLines={1}>
                      {friendlyName(v)}
                    </Text>
                  </Animated.View>
                );
              })}
            </View>
          )}
        </>
      )}

      <View style={styles.tiles}>
        {s.biggestDay && <StatTile icon="calendar" value={fmtMs(s.biggestDay.ms)} label={`Your biggest day: ${new Date(s.biggestDay.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`} tint="#30D158" index={14} />}
        {s.longest && longest && <StatTile icon="hourglass" value={fmtMs(s.longest.ms)} label={`Longest sitting: ${friendlyName(longest)}`} tint="#64D2FF" index={15} />}
      </View>

      {s.topTags.length > 0 && (
        <Card index={16} title="What you watch most" sub="By keyword, by watch time">
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
    bleed: { marginHorizontal: -16 },
    hrow: { gap: 10, paddingHorizontal: 16 },
    empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
    emptyTitle: { color: p.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 14, textAlign: 'center' },
    lastCard: { borderRadius: 26, overflow: 'hidden', backgroundColor: '#000' },
    lastTop: { position: 'absolute', top: 14, left: 14 },
    liveChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF375F' },
    liveText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
    topCard: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' },
    lastBody: { position: 'absolute', left: 16, right: 16, bottom: 14, gap: 3 },
    lastKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    lastTitle: { color: '#fff', fontSize: 25, fontWeight: '900', letterSpacing: -0.6, lineHeight: 28 },
    lastFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    lastSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700', flexShrink: 1 },
    againBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
    againText: { color: '#000', fontSize: 12, fontWeight: '900' },
    openCard: { width: 170, gap: 4 },
    openMedia: { width: 170, height: 104, borderRadius: 14, overflow: 'hidden', backgroundColor: p.card },
    openBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
    openFill: { height: 4, backgroundColor: '#FF375F' },
    openTitle: { color: p.text, fontSize: 14, fontWeight: '800', marginTop: 2 },
    openSub: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    todayRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.elevated, borderRadius: 14, paddingHorizontal: 12, height: 42 },
    searchInput: { flex: 1, color: p.text, fontSize: 15 },
    summary: { color: p.textSecondary, fontSize: 13, fontWeight: '700', marginTop: -4 },
    day: { backgroundColor: p.elevated, borderRadius: 20, padding: 14, gap: 10 },
    dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    dayTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    dayMs: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    strip: { height: 8, borderRadius: 4, backgroundColor: p.card, overflow: 'hidden', marginTop: -2 },
    stripTick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: p.separator },
    stripMark: { position: 'absolute', top: 0, bottom: 0, borderRadius: 4, minWidth: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    thumb: { width: 92, height: 54, borderRadius: 10, overflow: 'hidden', backgroundColor: p.card },
    thumbBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
    thumbFill: { height: 3, backgroundColor: '#FF375F' },
    thumbBadge: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
    thumbBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    rowSub: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    more: { alignSelf: 'center', backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
    moreText: { color: p.link, fontWeight: '700' },
    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center' },
    calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
    calTitle: { color: p.text, fontSize: 18, fontWeight: '800' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calDow: { width: '14.28%', textAlign: 'center', color: p.textSecondary, fontSize: 11, fontWeight: '800', paddingBottom: 6 },
    calCellWrap: { width: '14.28%', aspectRatio: 1, padding: 3 },
    calCell: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: p.card },
    calDay: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
    legendCell: { width: 12, height: 12, borderRadius: 3 },
    punchRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
    punchDay: { width: 26, color: p.textSecondary, fontSize: 11, fontWeight: '800' },
    punchCell: { borderRadius: 3 },
    punchHour: { color: p.textMuted, fontSize: 9, fontWeight: '700' },
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
    wall: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    wallCell: { width: '31%', flexGrow: 1, gap: 4 },
    wallThumb: { aspectRatio: 0.8, borderRadius: 14, overflow: 'hidden', backgroundColor: p.card },
    wallRank: { position: 'absolute', top: 6, left: 8, color: '#fff', fontSize: 20, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
    wallPlays: { position: 'absolute', bottom: 6, right: 8, color: '#fff', fontSize: 12, fontWeight: '900' },
    wallName: { color: p.text, fontSize: 12, fontWeight: '700' },
  });
