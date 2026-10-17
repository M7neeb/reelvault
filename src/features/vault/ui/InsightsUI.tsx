/**
 * Your videos in numbers, in four tabs:
 * - Dashboard: favourite tag, what you watch most (by tag), most watched and
 *   rewatched videos, your ratings, when you watch;
 * - Wrapped: a story for any week (one is made every week) or any range, of
 *   everything you watched or only your videos;
 * - Badges: tiers you unlock, with progress to the next one;
 * - Storage: what takes the space, and what Make Smaller could save.
 * Presentational only: plays and Simkl numbers come in through callbacks.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarChart, RankedBars } from '@/features/simkl/ui/charts';
import type { SimklBridge } from '@/features/simkl/ui/types';
import { WEEKDAYS } from '@/features/simkl/insights';

import {
  badges as buildBadges,
  fmtBytes,
  fmtDay,
  fmtMs,
  longestStreak,
  presetRange,
  ratingLabel,
  recentWeeks,
  storageStats,
  videoDashboard,
  wrapped as buildWrapped,
  type Badge,
  type Range,
  type RatingLabels,
  type VaultPlay,
  type Wrapped,
} from '../stats';
import Fade from './Fade';
import { success, tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import { Segment } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultActions, VaultItem } from './types';

export type InsightsTab = 'dashboard' | 'wrapped' | 'badges' | 'storage';

type SimklNumbers = Awaited<ReturnType<SimklBridge['insights']>>;

export default function VideoInsightsModal({
  initialTab = 'dashboard',
  items,
  deleted,
  albums,
  actions,
  simkl,
  ratingLabels,
  initialWrapped,
  onOpenVideo,
  onMakeSmaller,
  onClose,
}: {
  initialTab?: InsightsTab;
  items: VaultItem[];
  deleted: VaultItem[];
  albums: number;
  actions: VaultActions;
  simkl?: SimklBridge;
  ratingLabels: RatingLabels;
  /** Open straight into this week's Wrapped (from the Monday notification). */
  initialWrapped?: boolean;
  onOpenVideo: (id: string) => void;
  onMakeSmaller: (ids: string[]) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [tab, setTab] = useState<InsightsTab>(initialTab);
  const [plays, setPlays] = useState<VaultPlay[] | null>(null);
  const [bookmarks, setBookmarks] = useState(0);
  const [sk, setSk] = useState<SimklNumbers | null>(null);
  const [story, setStory] = useState<Wrapped | null>(null);

  useEffect(() => {
    actions.loadPlays().then(setPlays).catch(() => setPlays([]));
    actions.countBookmarks().then(setBookmarks).catch(() => undefined);
    if (simkl?.connected) simkl.insights().then(setSk).catch(() => undefined);
  }, [actions, simkl]);

  const thumbs = useMemo(() => new Map(items.map((v) => [v.id, v.thumbSource])), [items]);

  useEffect(() => {
    if (initialWrapped && plays) {
      const lastWeek = recentWeeks(Date.now(), 2)[1];
      setStory(buildWrapped(lastWeek, items, plays, sk ?? undefined));
    }
  }, [initialWrapped, plays]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <IconButton icon="close" label="Close" onPress={onClose} />
          <Text style={styles.headerTitle}>My Videos</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.segment}>
          <Segment
            options={[
              { key: 'dashboard', label: 'Dashboard' },
              { key: 'wrapped', label: 'Wrapped' },
              { key: 'badges', label: 'Badges' },
              { key: 'storage', label: 'Storage' },
            ]}
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
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
            {tab === 'dashboard' && <Dashboard items={items} plays={plays} labels={ratingLabels} thumbs={thumbs} onOpen={onOpenVideo} />}
            {tab === 'wrapped' && <WrappedPicker items={items} plays={plays} simkl={sk} onOpen={setStory} />}
            {tab === 'badges' && (
              <Badges
                list={buildBadges({
                  videos: items,
                  plays,
                  bookmarks,
                  albums,
                  simklEpisodes: sk?.events.filter((e) => e.type !== 'movie').length ?? 0,
                  simklMovies: sk?.events.filter((e) => e.type === 'movie').length ?? 0,
                  simklCompleted: sk?.items.filter((i) => i.type !== 'movie' && i.status === 'completed').length ?? 0,
                  simklRewatches: sk?.events.filter((e) => e.rewatch).length ?? 0,
                  streakDays: longestStreak([...plays.map((x) => x.startedAt), ...(sk?.events.map((e) => e.at) ?? [])]),
                  lists: sk?.lists ?? 0,
                })}
              />
            )}
            {tab === 'storage' && <Storage items={items} deleted={deleted} thumbs={thumbs} onOpen={onOpenVideo} onMakeSmaller={onMakeSmaller} />}
          </ScrollView>
        )}
      </View>
      {story && <WrappedStory w={story} thumbs={thumbs} onClose={() => setStory(null)} />}
    </Modal>
  );
}

/* --------------------------------------------------------------- dashboard */

function Tile({ value, label }: { value: string; label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function VideoRows({
  rows,
  thumbs,
  format,
  onOpen,
}: {
  rows: { key: string; label: string; value: number; sub?: string }[];
  thumbs: Map<string, VaultItem['thumbSource']>;
  format: (v: number) => string;
  onOpen: (id: string) => void;
}) {
  const styles = useStyles(makeStyles);
  if (!rows.length) return <Text style={styles.muted}>Nothing yet - watch a few of your videos.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {rows.slice(0, 5).map((r, i) => (
        <TouchableOpacity key={r.key} style={styles.vrow} onPress={() => onOpen(r.key)}>
          <Text style={styles.rank}>{i + 1}</Text>
          <Image source={thumbs.get(r.key)} style={styles.vthumb} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={styles.vtitle} numberOfLines={1}>
              {r.label}
            </Text>
            {!!r.sub && <Text style={styles.vsub}>{r.sub}</Text>}
          </View>
          <Text style={styles.vvalue}>{format(r.value)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Dashboard({
  items,
  plays,
  labels,
  thumbs,
  onOpen,
}: {
  items: VaultItem[];
  plays: VaultPlay[];
  labels: RatingLabels;
  thumbs: Map<string, VaultItem['thumbSource']>;
  onOpen: (id: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const d = useMemo(() => videoDashboard(items, plays), [items, plays]);
  const fav = d.favouriteTag;
  const most = d.mostWatchedTag;
  return (
    <>
      <View style={styles.tiles}>
        <Tile value={String(d.videos)} label="videos" />
        <Tile value={fmtMs(d.footageMs)} label="of footage" />
        <Tile value={fmtMs(d.watchedMs)} label="watched here" />
        <Tile value={String(d.plays)} label="plays" />
      </View>

      <View style={styles.heroRow}>
        <View style={[styles.hero, { backgroundColor: 'hsl(330, 45%, 30%)' }]}>
          <Text style={styles.heroKicker}>FAVOURITE TAG</Text>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {fav ? `#${fav.tag}` : '—'}
          </Text>
          <Text style={styles.heroSub}>
            {fav ? (fav.avgRating !== null ? `★ ${fav.avgRating.toFixed(1)} on ${fav.videos} videos` : `${fav.videos} videos`) : 'Tag and rate some videos'}
          </Text>
        </View>
        <View style={[styles.hero, { backgroundColor: 'hsl(212, 55%, 30%)' }]}>
          <Text style={styles.heroKicker}>YOU WATCH MOST</Text>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {most ? `#${most.tag}` : '—'}
          </Text>
          <Text style={styles.heroSub}>{most ? `${fmtMs(most.watchedMs)} · ${most.plays} plays` : 'Play some tagged videos'}</Text>
        </View>
      </View>

      <Card title="Most watched">
        <VideoRows rows={d.mostWatched} thumbs={thumbs} format={(v) => fmtMs(v)} onOpen={onOpen} />
      </Card>
      {d.mostRewatched.length > 0 && (
        <Card title="On repeat">
          <VideoRows rows={d.mostRewatched} thumbs={thumbs} format={(v) => `×${v}`} onOpen={onOpen} />
        </Card>
      )}

      <Card title="Your ratings">
        <Text style={styles.muted}>
          {d.rated} rated{d.avgRating !== null ? ` · average ★ ${d.avgRating.toFixed(1)}` : ''}
          {d.avgRating !== null && ratingLabel(d.avgRating, labels) ? ` (“${ratingLabel(d.avgRating, labels)}”)` : ''}
        </Text>
        <BarChart
          data={d.ratingHistogram.map((value, i) => ({ label: String(i + 1), value }))}
          format={(v) => `${v} ${v === 1 ? 'video' : 'videos'}`}
        />
        {d.topRated.length > 0 && (
          <VideoRows
            rows={d.topRated.map((r) => ({ ...r, sub: ratingLabel(r.value, labels) ?? undefined }))}
            thumbs={thumbs}
            format={(v) => `★ ${Number.isInteger(v) ? v : v.toFixed(1)}`}
            onOpen={onOpen}
          />
        )}
      </Card>

      <Card title="By tag">
        {d.tags.length === 0 ? (
          <Text style={styles.muted}>No tags yet.</Text>
        ) : (
          <View>
            <View style={[styles.trow, styles.thead]}>
              <Text style={[styles.tcell, styles.tname, styles.th]}>Tag</Text>
              <Text style={[styles.tcell, styles.th]}>Videos</Text>
              <Text style={[styles.tcell, styles.th]}>Avg ★</Text>
              <Text style={[styles.tcell, styles.th]}>Watched</Text>
            </View>
            {d.tags.slice(0, 15).map((t) => (
              <View key={t.tag} style={styles.trow}>
                <Text style={[styles.tcell, styles.tname]} numberOfLines={1}>
                  #{t.tag}
                </Text>
                <Text style={styles.tcell}>{t.videos}</Text>
                <Text style={[styles.tcell, { color: p.rating }]}>{t.avgRating !== null ? t.avgRating.toFixed(1) : '–'}</Text>
                <Text style={styles.tcell}>{t.watchedMs ? fmtMs(t.watchedMs) : '–'}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card title="When you watch">
        <BarChart data={d.weekday.map((value, i) => ({ label: WEEKDAYS[i], value }))} format={(v) => fmtMs(v)} />
        <Text style={styles.muted}>
          {d.neverWatched} of {d.videos} videos not watched in ReelVault yet.
        </Text>
      </Card>
    </>
  );
}

/* ----------------------------------------------------------------- wrapped */

function MiniCalendar({ value, onPick }: { value: number; onPick: (t: number) => void }) {
  const styles = useStyles(makeStyles);
  const [month, setMonth] = useState(() => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const m = new Date(month);
  const first = (m.getDay() + 6) % 7;
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const sel = new Date(value);
  return (
    <View style={styles.cal}>
      <View style={styles.calHead}>
        <TouchableOpacity onPress={() => setMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1).getTime())} hitSlop={10}>
          <Icon name="back" size={16} color={styles.calTitle.color as string} />
        </TouchableOpacity>
        <Text style={styles.calTitle}>{m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <TouchableOpacity onPress={() => setMonth(new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime())} hitSlop={10}>
          <Icon name="forward" size={16} color={styles.calTitle.color as string} />
        </TouchableOpacity>
      </View>
      <View style={styles.calGrid}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={styles.calDow}>
            {w[0]}
          </Text>
        ))}
        {cells.map((d, i) => {
          const on = d !== null && sel.getFullYear() === m.getFullYear() && sel.getMonth() === m.getMonth() && sel.getDate() === d;
          return (
            <TouchableOpacity
              key={i}
              style={[styles.calCell, on && styles.calOn]}
              disabled={d === null}
              onPress={() => d !== null && onPick(new Date(m.getFullYear(), m.getMonth(), d).getTime())}>
              <Text style={[styles.calDay, on && styles.calDayOn]}>{d ?? ''}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function WrappedPicker({
  items,
  plays,
  simkl,
  onOpen,
}: {
  items: VaultItem[];
  plays: VaultPlay[];
  simkl: SimklNumbers | null;
  onOpen: (w: Wrapped) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [scope, setScope] = useState<'everything' | 'videos'>(simkl ? 'everything' : 'videos');
  const [from, setFrom] = useState(() => Date.now() - 14 * 86_400_000);
  const [to, setTo] = useState(() => Date.now());
  const [editing, setEditing] = useState<'from' | 'to' | null>(null);
  const now = Date.now();
  const earliest = Math.min(now, ...plays.map((x) => x.startedAt), ...items.map((v) => v.importedAt));
  const make = (r: Range) => buildWrapped(r, items, plays, scope === 'everything' ? (simkl ?? undefined) : undefined);
  const weeks = recentWeeks(now, 8).map((r) => ({ r, w: make(r) }));
  const open = (w: Wrapped) => {
    success();
    onOpen(w);
  };

  return (
    <>
      <Segment
        options={[
          { key: 'everything', label: simkl ? 'Everything' : 'Everything (sign in to Simkl)' },
          { key: 'videos', label: 'My videos only' },
        ]}
        value={scope}
        onChange={setScope}
      />
      <Text style={styles.section}>Every week</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekRow} style={styles.bleed}>
        {weeks.map(({ r, w }, i) => (
          <TouchableOpacity key={r.start} style={[styles.week, { backgroundColor: `hsl(${(250 + i * 37) % 360}, 52%, ${i === 0 ? 38 : 28}%)` }]} onPress={() => open(w)}>
            <Text style={styles.weekLabel}>{r.label}</Text>
            <Text style={styles.weekValue}>{w.totalMinutes >= 60 ? `${Math.round(w.totalMinutes / 6) / 10} h` : `${w.totalMinutes} min`}</Text>
            <Text style={styles.weekSub}>
              {fmtDay(r.start)} – {fmtDay(r.end - 1)}
            </Text>
            <View style={styles.weekPlay}>
              <Icon name="play" size={12} color="#fff" />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.section}>Make one</Text>
      <View style={styles.presets}>
        {(['days7', 'days30', 'month', 'year', 'all'] as const).map((k) => {
          const r = presetRange(k, now, earliest);
          return (
            <TouchableOpacity key={k} style={styles.preset} onPress={() => open(make(r))}>
              <Text style={styles.presetText}>{r.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>From date to date</Text>
        <View style={styles.rangeRow}>
          <TouchableOpacity style={[styles.rangeBtn, editing === 'from' && styles.rangeOn]} onPress={() => setEditing(editing === 'from' ? null : 'from')}>
            <Text style={styles.rangeKey}>From</Text>
            <Text style={styles.rangeVal}>{new Date(from).toLocaleDateString()}</Text>
          </TouchableOpacity>
          <Icon name="forward" size={14} color={p.textMuted} />
          <TouchableOpacity style={[styles.rangeBtn, editing === 'to' && styles.rangeOn]} onPress={() => setEditing(editing === 'to' ? null : 'to')}>
            <Text style={styles.rangeKey}>To</Text>
            <Text style={styles.rangeVal}>{new Date(to).toLocaleDateString()}</Text>
          </TouchableOpacity>
        </View>
        {editing && (
          <MiniCalendar
            value={editing === 'from' ? from : to}
            onPick={(t) => {
              tick();
              if (editing === 'from') setFrom(Math.min(t, to));
              else setTo(Math.max(t, from));
              setEditing(null);
            }}
          />
        )}
        <TouchableOpacity
          style={styles.primary}
          onPress={() => {
            const end = new Date(to);
            open(make({ start: from, end: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime(), label: `${fmtDay(from)} – ${fmtDay(to)}` }));
          }}>
          <Icon name="sparkle" size={16} color="#fff" />
          <Text style={styles.primaryText}>Make my Wrapped</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

/** Full-screen, tap right for the next card, left to go back - like a story. */
function WrappedStory({ w, thumbs, onClose }: { w: Wrapped; thumbs: Map<string, VaultItem['thumbSource']>; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const v = w.videos;
  const s = w.simkl;
  const cards: { hue: number; body: React.ReactNode }[] = [];
  const big = (t: string) => <Text style={styles.sBig}>{t}</Text>;
  const kicker = (t: string) => <Text style={styles.sKicker}>{t}</Text>;
  const line = (t: string) => <Text style={styles.sLine}>{t}</Text>;
  const list = (rows: { key: string; label: string; sub?: string }[], withThumbs = false) => (
    <View style={{ gap: 12, marginTop: 10 }}>
      {rows.map((r, i) => (
        <View key={r.key} style={styles.sRow}>
          <Text style={styles.sRank}>{i + 1}</Text>
          {withThumbs && <Image source={thumbs.get(r.key)} style={styles.sThumb} contentFit="cover" />}
          <View style={{ flex: 1 }}>
            <Text style={styles.sRowTitle} numberOfLines={1}>
              {r.label}
            </Text>
            {!!r.sub && <Text style={styles.sRowSub}>{r.sub}</Text>}
          </View>
        </View>
      ))}
    </View>
  );

  cards.push({
    hue: 262,
    body: (
      <>
        {kicker(`YOUR WRAPPED · ${w.range.label.toUpperCase()}`)}
        {big(w.totalMinutes >= 60 ? `${Math.round(w.totalMinutes / 6) / 10} hours` : `${w.totalMinutes} minutes`)}
        {line(s ? 'of watching, your videos and Simkl together.' : 'of watching your own videos.')}
      </>
    ),
  });
  cards.push({
    hue: 212,
    body: (
      <>
        {kicker('YOUR VIDEOS')}
        {big(fmtMs(v.watchedMs))}
        {line(`${v.plays} plays of ${v.videosWatched} different ${v.videosWatched === 1 ? 'video' : 'videos'}.`)}
        {v.imported > 0 && line(`You added ${v.imported} new (${fmtBytes(v.importedBytes)}).`)}
      </>
    ),
  });
  if (v.topVideos.length)
    cards.push({ hue: 330, body: <>{kicker('MOST WATCHED')}{list(v.topVideos, true)}</> });
  if (v.topTags.length)
    cards.push({ hue: 28, body: <>{kicker('YOUR TOP TAGS')}{big(`#${v.topTags[0].label}`)}{list(v.topTags.slice(1).map((t) => ({ ...t, label: `#${t.label}` })))}</> });
  if (s && s.minutes > 0) {
    cards.push({
      hue: 160,
      body: (
        <>
          {kicker('MOVIES, SHOWS & ANIME')}
          {big(fmtMs(s.minutes * 60000))}
          {line(`${s.episodes} episodes and ${s.movies} movies across ${s.titles} titles.`)}
          {list(s.topTitles)}
        </>
      ),
    });
    if (s.topGenres.length) cards.push({ hue: 190, body: <>{kicker('YOUR GENRES')}{big(s.topGenres[0].label)}{list(s.topGenres.slice(1, 5))}</> });
  }
  cards.push({
    hue: 8,
    body: (
      <>
        {kicker('HIGHLIGHTS')}
        {v.busiestDay && line(`Busiest day: ${new Date(v.busiestDay.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} · ${fmtMs(v.busiestDay.ms)}`)}
        {v.longestSession && line(`Longest sitting: ${v.longestSession.label} · ${fmtMs(v.longestSession.ms)}`)}
        {v.bestNew && line(`Best new video: ${v.bestNew.label} · ★ ${v.bestNew.value}`)}
        {!v.busiestDay && !v.bestNew && line('A quiet one. Next week is yours.')}
      </>
    ),
  });
  cards.push({ hue: 286, body: <>{kicker('THIS MAKES YOU')}{big(v.persona)}{line('See you next week.')}</> });

  const [i, setI] = useState(0);
  const card = cards[Math.min(i, cards.length - 1)];
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.story, { backgroundColor: `hsl(${card.hue}, 55%, 22%)` }]}>
        <View style={[StyleFill, { backgroundColor: `hsl(${(card.hue + 40) % 360}, 70%, 45%)`, opacity: 0.55, transform: [{ rotate: '-18deg' }, { scale: 1.6 }], top: -width * 0.9, height: width * 1.2 }]} />
        <Fade color="0,0,0" from={0} to={0.55} style={StyleFill} />
        <View style={[styles.bars, { top: insets.top + 8 }]}>
          {cards.map((_, n) => (
            <View key={n} style={[styles.bar, n <= i && styles.barOn]} />
          ))}
        </View>
        <View style={[styles.storyClose, { top: insets.top + 20 }]}>
          <IconButton icon="close" label="Close" clear onPress={onClose} size={36} />
        </View>
        <View style={styles.storyBody}>{card.body}</View>
        <View style={styles.taps}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setI(Math.max(0, i - 1))} accessibilityLabel="Previous" />
          <TouchableOpacity
            style={{ flex: 2 }}
            onPress={() => {
              tick();
              if (i >= cards.length - 1) onClose();
              else setI(i + 1);
            }}
            accessibilityLabel="Next"
          />
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ badges */

function Badges({ list }: { list: Badge[] }) {
  const styles = useStyles(makeStyles);
  const groups: Badge['group'][] = ['Videos', 'Watching', 'Simkl'];
  const got = list.filter((b) => b.unlocked).length;
  return (
    <>
      <Text style={styles.muted}>
        {got} unlocked · {list.length - got} to go
      </Text>
      {groups.map((g) => (
        <View key={g} style={{ gap: 10 }}>
          <Text style={styles.section}>{g}</Text>
          <View style={styles.badgeGrid}>
            {list
              .filter((b) => b.group === g)
              .map((b) => (
                <View key={b.id} style={[styles.badge, !b.unlocked && styles.badgeLocked]}>
                  <Text style={[styles.badgeEmoji, !b.unlocked && { opacity: 0.35 }]}>{b.emoji}</Text>
                  <Text style={styles.badgeTitle} numberOfLines={1}>
                    {b.title}
                  </Text>
                  <Text style={styles.badgeDetail} numberOfLines={2}>
                    {b.unlocked ? 'Unlocked' : b.detail}
                  </Text>
                  {!b.unlocked && (
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.min(100, (b.current / b.target) * 100)}%` }]} />
                    </View>
                  )}
                  {!b.unlocked && (
                    <Text style={styles.badgeProgress}>
                      {Math.min(b.current, b.target)} / {b.target}
                    </Text>
                  )}
                </View>
              ))}
          </View>
        </View>
      ))}
    </>
  );
}

/* ----------------------------------------------------------------- storage */

const QUALITY_COLORS: Record<string, string> = { '4K': '#0A84FF', '1080p': '#5E5CE6', '720p': '#30D158', Smaller: '#FF9F0A', Unknown: '#8E8E93' };

function Storage({
  items,
  deleted,
  thumbs,
  onOpen,
  onMakeSmaller,
}: {
  items: VaultItem[];
  deleted: VaultItem[];
  thumbs: Map<string, VaultItem['thumbSource']>;
  onOpen: (id: string) => void;
  onMakeSmaller: (ids: string[]) => void;
}) {
  const styles = useStyles(makeStyles);
  const s = useMemo(() => storageStats(items, deleted), [items, deleted]);
  const h264 = items.filter((v) => /avc|264/i.test(v.meta?.codec ?? '')).map((v) => v.id);
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.kicker}>IN REELVAULT</Text>
        <Text style={styles.bigValue}>{fmtBytes(s.totalBytes)}</Text>
        <Text style={styles.muted}>{s.count} videos</Text>
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
                {g.label} · {fmtBytes(g.value)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.tiles}>
        <Tile value={fmtBytes(s.savedBytes)} label="saved by Make Smaller" />
        <Tile value={fmtBytes(s.couldSaveBytes)} label={`could still save (${s.couldSaveCount} H.264)`} />
        <Tile value={fmtBytes(s.deletedBytes)} label="in Recently Deleted" />
      </View>
      {h264.length > 0 && (
        <TouchableOpacity style={styles.primary} onPress={() => onMakeSmaller(h264)}>
          <Icon name="sparkle" size={16} color="#fff" />
          <Text style={styles.primaryText}>Make the {h264.length} H.264 videos smaller…</Text>
        </TouchableOpacity>
      )}

      <Card title="Biggest videos">
        <VideoRows rows={s.biggest} thumbs={thumbs} format={(v) => fmtBytes(v)} onOpen={onOpen} />
      </Card>
      <Card title="By format">
        <RankedBars rows={s.byCodec.map((g) => ({ label: `${g.label} · ${g.sub}`, value: g.value }))} format={fmtBytes} />
      </Card>
      <Card title="By year filmed">
        <RankedBars rows={s.byYear.map((g) => ({ label: `${g.label} · ${g.sub}`, value: g.value }))} format={fmtBytes} />
      </Card>
    </>
  );
}

const StyleFill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 8 },
    headerTitle: { color: p.text, fontSize: 17, fontWeight: '700' },
    segment: { paddingHorizontal: 16, paddingBottom: 8 },
    body: { paddingHorizontal: 16, gap: 14, paddingTop: 6 },
    bleed: { marginHorizontal: -16 },
    section: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 6 },
    muted: { color: p.textSecondary, fontSize: 13 },
    kicker: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
    bigValue: { color: p.text, fontSize: 40, fontWeight: '900', letterSpacing: -1 },

    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: p.elevated, borderRadius: 16, padding: 14, gap: 2 },
    tileValue: { color: p.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
    tileLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },

    heroRow: { flexDirection: 'row', gap: 10 },
    hero: { flex: 1, borderRadius: 18, padding: 14, gap: 4, minHeight: 112, justifyContent: 'flex-end' },
    heroKicker: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
    heroTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
    heroSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },

    card: { backgroundColor: p.elevated, borderRadius: 18, padding: 14, gap: 12 },
    cardTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    vrow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rank: { color: p.textSecondary, fontSize: 15, fontWeight: '800', width: 18, textAlign: 'center' },
    vthumb: { width: 64, height: 40, borderRadius: 8, backgroundColor: p.tile },
    vtitle: { color: p.text, fontSize: 15, fontWeight: '600' },
    vsub: { color: p.textSecondary, fontSize: 12 },
    vvalue: { color: p.textSoft, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },

    trow: { flexDirection: 'row', paddingVertical: 7, borderTopWidth: 1, borderTopColor: p.separator },
    thead: { borderTopWidth: 0 },
    th: { color: p.textSecondary, fontWeight: '700', fontSize: 12 },
    tcell: { flex: 1, color: p.textSoft, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] },
    tname: { flex: 2, textAlign: 'left', color: p.text, fontWeight: '600' },

    weekRow: { gap: 10, paddingHorizontal: 16 },
    week: { width: 150, height: 170, borderRadius: 20, padding: 14, justifyContent: 'flex-end', gap: 2 },
    weekLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '800' },
    weekValue: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
    weekSub: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '600' },
    weekPlay: { position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
    presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    preset: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    presetText: { color: p.text, fontSize: 14, fontWeight: '700' },
    rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rangeBtn: { flex: 1, backgroundColor: p.card, borderRadius: 12, padding: 10 },
    rangeOn: { borderWidth: 2, borderColor: p.accent, padding: 8 },
    rangeKey: { color: p.textSecondary, fontSize: 11, fontWeight: '700' },
    rangeVal: { color: p.text, fontSize: 15, fontWeight: '700' },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: p.accent, borderRadius: 14, paddingVertical: 13 },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },

    cal: { backgroundColor: p.card, borderRadius: 14, padding: 10, gap: 8 },
    calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
    calTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calDow: { width: '14.28%', textAlign: 'center', color: p.textSecondary, fontSize: 11, fontWeight: '700', paddingBottom: 4 },
    calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
    calOn: { backgroundColor: p.accent },
    calDay: { color: p.text, fontSize: 14, fontWeight: '600' },
    calDayOn: { color: '#fff', fontWeight: '800' },

    story: { flex: 1, overflow: 'hidden' },
    bars: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', gap: 4 },
    bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
    barOn: { backgroundColor: '#fff' },
    storyClose: { position: 'absolute', right: 12 },
    storyBody: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 10 },
    sKicker: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
    sBig: { color: '#fff', fontSize: 46, fontWeight: '900', letterSpacing: -1.5, lineHeight: 50 },
    sLine: { color: 'rgba(255,255,255,0.9)', fontSize: 18, fontWeight: '600', lineHeight: 25 },
    sRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    sRank: { color: 'rgba(255,255,255,0.6)', fontSize: 22, fontWeight: '900', width: 26 },
    sThumb: { width: 64, height: 40, borderRadius: 8 },
    sRowTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
    sRowSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
    taps: { ...StyleFill, flexDirection: 'row', top: 90 },

    badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    badge: { width: '31%', flexGrow: 1, backgroundColor: p.elevated, borderRadius: 16, padding: 12, alignItems: 'center', gap: 3 },
    badgeLocked: { backgroundColor: p.panel },
    badgeEmoji: { fontSize: 34 },
    badgeTitle: { color: p.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
    badgeDetail: { color: p.textSecondary, fontSize: 11, textAlign: 'center' },
    badgeProgress: { color: p.textSecondary, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
    track: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginTop: 4 },
    fill: { height: 4, borderRadius: 2, backgroundColor: p.accent },

    stack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
  });
