/**
 * Wrapped: a story of what you watched in a week, a month, a year or any
 * range you pick, of everything or only your own videos.
 *
 * It plays like Spotify's, but with your own videos playing behind every
 * card (with sound; the speaker button mutes it): a montage to open, a top
 * five counted down to your #1, your comfort video, your biggest day, a
 * throwback, a hidden gem, your taste, your habits, the badges you earned and
 * who that makes you, the age of what you watched and the club you belong
 * to, how it compares with a year before, your club month by month, your
 * reviews, and quick guesses along the way (your #1, your biggest day, your
 * top month, your keyword). There is also a Wrapped for one keyword, album or
 * series. The video is the star: cards with a video show it whole, with the words
 * at the bottom and the name of what is playing at the top (tap it to watch
 * it). Each card moves on by itself; hold to pause, tap right
 * for the next card and left to go back, drag down to close. The last card
 * sums it up and can be shared.
 * Presentational only.
 */

import { LiveCard } from './live';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from './screen';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, FadeInRight, FadeOut, Keyframe, useAnimatedStyle, useSharedValue, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import type { SimklBridge } from '@/features/simkl/ui/types';
import { WEEKDAYS } from '@/features/simkl/insights';

import type { Achievement } from '../achievements';
import type { Memory } from '../memories';
import { highlightAt, monthRanges, storyFacts, yearRange, type RRange, type StoryFacts } from '../recap';
import { fmtBytes, fmtDay, fmtMs, presetRange, recentWeeks, wrapped as buildWrapped, type Range, type VaultPlay, type Wrapped } from '../stats';
import { friendlyName } from '../names';
import { useAudioControlsOptional } from './audio/playback';
import { CLUBS, clubJourney, clubOf, quizFrom, rewatchMeter, videoAge, type ClubKey } from '../wrappedExtras';
import Fade from './Fade';
import { aspectOf, Backdrop, fitFor } from './frame';
import { success, tick, warn } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import { gradient, iconOr, Medallion } from './insightParts';
import { DUR, EASE_OUT, enterUp, PressableScale, SPRING, useReducedMotion } from './motion';
import { Segment } from './sheets';
import { FilmStrips, ImageRiver, Tint } from './scenes';
import { Aurora, Confetti, CountUp, CoverWall, Float, GrowBar, GrowColumn, hexA, Marquee, Pulse, Rays, Tilt, Words } from './storyKit';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

type SimklNumbers = Awaited<ReturnType<SimklBridge['insights']>>;
type Thumbs = Map<string, VaultItem['thumbSource']>;

const minutesText = (min: number) => (min >= 60 ? `${Math.round(min / 6) / 10} h` : `${Math.round(min)} min`);
const hourLabel = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
const longDay = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** The range of the same length right before (for "+20 % on the week before"). */
export function previous(r: Range): Range {
  const len = r.end - r.start;
  return { start: r.start - len, end: r.start, label: 'before' };
}

/* ================================================================ picker */

export function WrappedPicker({
  items,
  plays,
  simkl,
  thumbs,
  groups = [],
  onOpen,
  onOpenGroup,
}: {
  items: VaultItem[];
  plays: VaultPlay[];
  simkl: SimklNumbers | null;
  thumbs: Thumbs;
  /** Keywords, albums and series you watched, for a Wrapped of their own. */
  groups?: WrappedGroup[];
  onOpen: (r: Range, scope: 'everything' | 'videos') => void;
  onOpenGroup?: (g: WrappedGroup) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [scope, setScope] = useState<'everything' | 'videos'>(simkl ? 'everything' : 'videos');
  const [from, setFrom] = useState(() => Date.now() - 14 * 86_400_000);
  const [to, setTo] = useState(() => Date.now());
  const [editing, setEditing] = useState<'from' | 'to' | null>(null);
  const now = Date.now();
  const earliest = Math.min(now, ...plays.map((x) => x.startedAt), ...items.map((v) => v.importedAt));
  const sk = scope === 'everything' ? (simkl ?? undefined) : undefined;
  const make = (r: Range) => buildWrapped(r, items, plays, sk);
  const open = (r: Range) => {
    success();
    onOpen(r, scope);
  };

  const year = useMemo(() => yearRange(new Date(now).getFullYear(), now), []); // eslint-disable-line react-hooks/exhaustive-deps
  const yearW = useMemo(() => make(year), [items, plays, scope, simkl]); // eslint-disable-line react-hooks/exhaustive-deps
  const yearFacts = useMemo(() => storyFacts(year, items, plays, now), [items, plays]); // eslint-disable-line react-hooks/exhaustive-deps
  const months = useMemo(() => monthRanges(now, new Date(now).getMonth() + 1).map((r) => ({ r, w: make(r) })), [items, plays, scope, simkl]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => recentWeeks(now, 9).map((r) => ({ r, w: make(r) })), [items, plays, scope, simkl]); // eslint-disable-line react-hooks/exhaustive-deps
  const [thisWeek, ...past] = weeks;
  const top = (w: Wrapped) => (w.videos.topVideos[0] ? thumbs.get(w.videos.topVideos[0].key) : undefined);
  const yearTop = yearW.videos.topVideos[0] ? items.find((v) => v.id === yearW.videos.topVideos[0].key) : undefined;
  const weekTop = thisWeek.w.videos.topVideos[0] ? items.find((v) => v.id === thisWeek.w.videos.topVideos[0].key) : undefined;
  const maxMonth = Math.max(1, ...months.map((m) => m.w.totalMinutes));

  /** 7 little bars, one per day, for a week card. */
  const spark = (r: Range) => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const s = r.start + i * 86_400_000;
      return plays.filter((x) => x.startedAt >= s && x.startedAt < s + 86_400_000).reduce((a, x) => a + x.watchedMs, 0);
    });
    const max = Math.max(1, ...days);
    return (
      <View style={styles.spark}>
        {days.map((v, i) => (
          <View key={i} style={[styles.sparkBar, { height: 3 + (v / max) * 26, opacity: v ? 1 : 0.35 }]} />
        ))}
      </View>
    );
  };

  return (
    <>
      <Animated.View entering={enterUp(0)}>
        <Segment
          options={[
            { key: 'everything', label: simkl ? 'Everything' : 'Everything (Simkl off)' },
            { key: 'videos', label: 'My videos only' },
          ]}
          value={scope}
          onChange={setScope}
        />
      </Animated.View>

      {/* ── the year ─────────────────────────────────────────── */}
      <Animated.View entering={enterUp(1)}>
        <PressableScale onPress={() => open(year)} style={[styles.yearCard, { minHeight: Math.min(330, width * 0.82) }]} accessibilityLabel={`Play your ${year.label} Wrapped`}>
          <LiveCard
            id="wrapped-year"
            uri={yearTop?.uri}
            durationMs={yearTop?.durationMs}
            cover={top(yearW)}
            radius={0}
            priority={2}
            style={StyleSheet.absoluteFill}
            soundStyle={{ top: 74, right: 18 }}
            video={yearTop}
          />
          {/* Light at the top so the video shows; dark at the bottom for the numbers. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(255,55,95,0.28) 0%, rgba(94,92,230,0.12) 38%, rgba(30,14,80,0.72) 68%, rgba(12,6,36,0.96) 100%)', 'rgba(30,14,80,0.45)')]} />
          <View style={[styles.yearTicker, { top: '38%' }]}>
            <Marquee ms={16000}>
              <Text style={styles.yearTickerText}>{year.label} WRAPPED · </Text>
            </Marquee>
          </View>
          <View style={styles.yearTop}>
            <View>
              <Text style={styles.yearKicker}>YOUR YEAR SO FAR</Text>
              <Text style={styles.yearTitle}>{year.label} Wrapped</Text>
            </View>
            <Pulse>
              <View style={styles.heroPlay}>
                <Icon name="play" size={20} color="#fff" />
              </View>
            </Pulse>
          </View>
          <View style={{ gap: 10 }}>
            <CountUp to={yearW.totalMinutes} format={minutesText} style={styles.heroValue} />
            <View style={styles.yearBars}>
              {months
                .slice()
                .reverse()
                .map(({ r, w }, n) => (
                  <View key={r.start} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                    <GrowColumn ratio={w.totalMinutes / maxMonth} height={58} width="70%" color="rgba(255,255,255,0.85)" radius={4} delay={200 + n * 50} />
                    <Text style={styles.yearBarLabel}>{new Date(r.start).toLocaleDateString(undefined, { month: 'narrow' })}</Text>
                  </View>
                ))}
            </View>
            <Text style={styles.heroSub} numberOfLines={2}>
              {yearW.videos.plays
                ? `${yearFacts.persona.name} · ${yearW.videos.plays} plays · ${yearW.videos.videosWatched} videos · ${yearFacts.activeDays} days`
                : 'Your year is just getting started. Tap to see it anyway.'}
            </Text>
          </View>
        </PressableScale>
      </Animated.View>

      {/* ── this week ────────────────────────────────────────── */}
      <Animated.View entering={enterUp(2)}>
        <PressableScale onPress={() => open(thisWeek.r)} style={[styles.heroCard, { minHeight: 210 }]} accessibilityLabel="Play this week's Wrapped">
          <LiveCard
            id="wrapped-week"
            uri={weekTop?.uri}
            durationMs={weekTop?.durationMs}
            cover={top(thisWeek.w)}
            radius={0}
            priority={1}
            style={StyleSheet.absoluteFill}
            soundStyle={{ top: 60, right: 16 }}
            video={weekTop}
          />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(94,92,230,0.35) 0%, rgba(191,90,242,0.1) 40%, rgba(120,30,90,0.75) 75%, rgba(40,8,40,0.95) 100%)', 'rgba(94,92,230,0.5)')]} />
          <View style={styles.heroTop}>
            <Text style={styles.heroKicker}>THIS WEEK · {fmtDay(thisWeek.r.start).toUpperCase()} – {fmtDay(thisWeek.r.end - 1).toUpperCase()}</Text>
            <View style={styles.heroPlaySmall}>
              <Icon name="play" size={15} color="#fff" />
            </View>
          </View>
          <View>
            <Text style={styles.weekHeroValue}>{minutesText(thisWeek.w.totalMinutes)}</Text>
            <Text style={styles.heroSub} numberOfLines={1}>
              {thisWeek.w.videos.plays ? `${thisWeek.w.videos.plays} plays · ${thisWeek.w.videos.videosWatched} videos · ${thisWeek.w.videos.activeDays} days` : 'Nothing yet this week.'}
            </Text>
          </View>
        </PressableScale>
      </Animated.View>

      {/* ── months ───────────────────────────────────────────── */}
      <Animated.View entering={enterUp(3)} style={styles.sectionRow}>
        <Text style={styles.section}>Months</Text>
        <Text style={styles.sectionDetail}>{new Date(now).getFullYear()}</Text>
      </Animated.View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekRow} style={styles.bleed}>
        {months.map(({ r, w }, i) => {
          const t = top(w);
          return (
            <Animated.View key={r.start} entering={enterUp(4 + i)}>
              <PressableScale style={styles.month} onPress={() => open(r)} accessibilityLabel={`${r.label} Wrapped`}>
                {t ? <Image source={t} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                <View style={[StyleSheet.absoluteFill, gradient(`linear-gradient(180deg, hsla(${(330 + i * 29) % 360},70%,45%,${t ? 0.15 : 0.7}) 0%, hsla(${(330 + i * 29) % 360},60%,18%,0.95) 100%)`, `hsl(${(330 + i * 29) % 360},55%,28%)`)]} />
                <Text style={styles.monthName}>{new Date(r.start).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</Text>
                <Text style={styles.monthValue}>{minutesText(w.totalMinutes)}</Text>
                <Text style={styles.weekSub}>
                  {w.videos.plays} plays{w.simkl?.episodes || w.simkl?.movies ? ` · ${(w.simkl?.episodes ?? 0) + (w.simkl?.movies ?? 0)} on Simkl` : ''}
                </Text>
              </PressableScale>
            </Animated.View>
          );
        })}
      </ScrollView>

      {/* ── weeks ───────────────────────────────────────────── */}
      <Animated.View entering={enterUp(5)} style={styles.sectionRow}>
        <Text style={styles.section}>Weeks</Text>
        <Text style={styles.sectionDetail}>A new one every Monday</Text>
      </Animated.View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekRow} style={styles.bleed}>
        {past.map(({ r, w }, i) => {
          const t = top(w);
          return (
            <Animated.View key={r.start} entering={enterUp(6 + i)}>
              <PressableScale style={styles.week} onPress={() => open(r)} accessibilityLabel={`${r.label} Wrapped`}>
                {t ? <Image source={t} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                <View style={[StyleSheet.absoluteFill, gradient(`linear-gradient(180deg, hsla(${(255 + i * 31) % 360},55%,30%,${t ? 0.55 : 1}) 0%, hsla(${(255 + i * 31) % 360},55%,14%,0.96) 100%)`, `hsl(${(255 + i * 31) % 360},55%,26%)`)]} />
                {spark(r)}
                <Text style={styles.weekLabel}>{r.label}</Text>
                <Text style={styles.weekValue}>{minutesText(w.totalMinutes)}</Text>
                <Text style={styles.weekSub}>
                  {fmtDay(r.start)} – {fmtDay(r.end - 1)}
                </Text>
              </PressableScale>
            </Animated.View>
          );
        })}
      </ScrollView>

      {/* ── one keyword, album or series ─────────────────────── */}
      {groups.length > 0 && onOpenGroup && (
        <>
          <Animated.View entering={enterUp(6)} style={styles.sectionRow}>
            <Text style={styles.section}>Wrapped for…</Text>
            <Text style={styles.sectionDetail}>A keyword, album or series</Text>
          </Animated.View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekRow} style={styles.bleed}>
            {groups.map((g, i) => {
              const t = g.cover ? thumbs.get(g.cover) : undefined;
              const hue = (g.kind === 'keyword' ? 280 : g.kind === 'album' ? 30 : 200) + i * 17;
              return (
                <Animated.View key={g.key} entering={enterUp(7 + i)}>
                  <PressableScale
                    style={styles.month}
                    onPress={() => {
                      success();
                      onOpenGroup(g);
                    }}
                    accessibilityLabel={`${g.name} Wrapped`}>
                    {t ? <Image source={t} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                    <View style={[StyleSheet.absoluteFill, gradient(`linear-gradient(180deg, hsla(${hue % 360},70%,40%,${t ? 0.2 : 0.75}) 0%, hsla(${hue % 360},60%,14%,0.95) 100%)`, `hsl(${hue % 360},55%,26%)`)]} />
                    <Text style={styles.monthName}>{g.kind === 'keyword' ? 'KEYWORD' : g.kind === 'album' ? 'ALBUM' : 'SERIES'}</Text>
                    <Text style={[styles.monthValue, { fontSize: g.name.length > 12 ? 17 : 22 }]} numberOfLines={2}>
                      {g.kind === 'keyword' ? `#${g.name}` : g.name}
                    </Text>
                    <Text style={styles.weekSub}>{minutesText(g.ms / 60000)} watched</Text>
                  </PressableScale>
                </Animated.View>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* ── make one ─────────────────────────────────────────── */}
      <Animated.View entering={enterUp(7)} style={styles.sectionRow}>
        <Text style={styles.section}>Make one</Text>
      </Animated.View>
      <Animated.View entering={enterUp(8)} style={styles.presets}>
        {(['days7', 'days30', 'month', 'year', 'all'] as const).map((k) => {
          const r = presetRange(k, now, earliest);
          return (
            <PressableScale key={k} style={styles.preset} onPress={() => open(r)}>
              <Icon name="sparkle" size={13} color={p.accent} />
              <Text style={styles.presetText}>{r.label}</Text>
            </PressableScale>
          );
        })}
      </Animated.View>
      <Animated.View entering={enterUp(9)} style={styles.card}>
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
          <Animated.View entering={FadeIn.duration(DUR.fast)}>
            <MiniCalendar
              value={editing === 'from' ? from : to}
              onPick={(t) => {
                tick();
                if (editing === 'from') setFrom(Math.min(t, to));
                else setTo(Math.max(t, from));
                setEditing(null);
              }}
            />
          </Animated.View>
        )}
        <PressableScale
          style={styles.primary}
          onPress={() => {
            const end = new Date(to);
            open({ start: from, end: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime(), label: `${fmtDay(from)} – ${fmtDay(to)}` });
          }}>
          <Icon name="sparkle" size={16} color="#fff" />
          <Text style={styles.primaryText}>Make my Wrapped</Text>
        </PressableScale>
      </Animated.View>
      <Text style={styles.foot}>Wrapped plays your videos with sound while it tells their story. Tap the speaker to mute it.</Text>
    </>
  );
}

function MiniCalendar({ value, onPick }: { value: number; onPick: (t: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
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
        <TouchableOpacity onPress={() => setMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1).getTime())} hitSlop={10} accessibilityLabel="Previous month">
          <Icon name="back" size={16} color={p.text} />
        </TouchableOpacity>
        <Text style={styles.calTitle}>{m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <TouchableOpacity onPress={() => setMonth(new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime())} hitSlop={10} accessibilityLabel="Next month">
          <Icon name="forward" size={16} color={p.text} />
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
            <TouchableOpacity key={i} style={[styles.calCell, on && styles.calOn]} disabled={d === null} onPress={() => d !== null && onPick(new Date(m.getFullYear(), m.getMonth(), d).getTime())}>
              <Text style={[styles.calDay, on && styles.calDayOn]}>{d ?? ''}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* ================================================================= story */

type StoryCard = {
  key: string;
  colors: [string, string];
  /** Videos playing behind the card (several = a montage). */
  media: string[];
  ms: number;
  body: ReactNode;
  /** Drawn behind the words: a wall of covers, a ticker, rays. */
  backdrop?: ReactNode;
  /** Has buttons: only the far edges of the screen move to another card. */
  interactive?: boolean;
  /** 'words' cards carry their own pictures (lists, grids): the video behind them stays dim. */
  focus?: 'words';
  /** Where its video starts, as a share of the video (0.15 = 15% in): a random part instead of the usual moment. */
  startFrac?: number;
};

export type StoryInput = {
  range: RRange;
  facts: StoryFacts;
  prev: StoryFacts | null;
  /** For Simkl, imports and the best new video. */
  w: Wrapped;
  /** Badges earned in the range. */
  earned: Achievement[];
  /** Series with episodes watched in the range. */
  series: { name: string; episodes: number; finished: boolean }[];
  /** For long ranges: your #1 of each month, and your club that month. */
  sprint?: { label: string; videoId: string | null; ms: number; club?: ClubKey | null }[];
  /** A Wrapped of one keyword, album or series. */
  subject?: { kind: WrappedGroup['kind']; name: string };
  /** The same range a year before (for Then vs now). */
  lastYear?: StoryFacts | null;
  /** Reviews you wrote (in the range, or of the subject). */
  reviews?: { title: string; text: string; videoId: string | null; rating: number }[];
};

/** A keyword, album or series that can have its own Wrapped. */
export type WrappedGroup = { key: string; kind: 'keyword' | 'album' | 'series'; name: string; ids: string[]; cover: string | null; ms: number };

/** What plays behind the cards: your videos (with sound) on the phone, their covers with a slow zoom in the preview. */
function StoryMedia({
  card,
  items,
  starts,
  enableVideo,
  muted,
  paused,
  onCurrent,
}: {
  card: StoryCard;
  items: Map<string, VaultItem>;
  starts: Map<string, number>;
  enableVideo: boolean;
  muted: boolean;
  paused: boolean;
  /** The video playing now (for the label at the top). */
  onCurrent?: (id: string | null) => void;
}) {
  const reduce = useReducedMotion();
  const player = useVideoPlayer(null, (pl) => {
    pl.loop = true;
    pl.volume = 1;
  });
  const [clip, setClip] = useState(0);
  const ids = card.media.filter((id) => items.has(id));
  const current = ids.length ? ids[clip % ids.length] : null;
  const item = current ? items.get(current) : undefined;

  useEffect(() => setClip(0), [card.key]);
  useEffect(() => onCurrent?.(current), [current]); // eslint-disable-line react-hooks/exhaustive-deps
  // A montage changes clip every 2.6 s.
  useEffect(() => {
    if (ids.length < 2 || paused) return;
    const t = setInterval(() => setClip((c) => c + 1), 2600);
    return () => clearInterval(t);
  }, [card.key, ids.length, paused]);

  useEffect(() => {
    if (!enableVideo) return;
    if (!item?.uri) {
      player.pause();
      return;
    }
    let live = true;
    let fade: ReturnType<typeof setInterval> | null = null;
    player.volume = 0;
    player
      .replaceAsync({ uri: item.uri })
      .then(() => {
        if (!live) return;
        player.currentTime = (card.startFrac !== undefined && item.durationMs ? item.durationMs * card.startFrac : (starts.get(item.id) ?? highlightAt(item.durationMs))) / 1000;
        if (!paused) player.play();
        // Fade the sound in instead of cutting in.
        let v = 0;
        fade = setInterval(() => {
          v = Math.min(1, v + 0.1);
          player.volume = v;
          if (v >= 1 && fade) clearInterval(fade);
        }, 45);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (fade) clearInterval(fade);
    };
  }, [current, card.key, enableVideo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enableVideo) return;
    if (paused) player.pause();
    else if (item?.uri) player.play();
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Preview / covers: a slow Ken Burns zoom.
  const zoom = useSharedValue(1);
  useEffect(() => {
    zoom.value = 1;
    if (!reduce) zoom.value = withTiming(1.06, { duration: card.ms, easing: EASE_OUT });
  }, [card.key, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));
  const { width: sw, height: sh } = useWindowDimensions();
  const fit = fitFor(aspectOf(item), sw / sh);

  return (
    <View style={[StyleSheet.absoluteFill, !item && { opacity: 0 }]} pointerEvents="none">
      {/* The whole video shows, over a blurred copy of itself where it doesn't fill the screen. */}
      {item && (
        <Animated.View key={`b${current}`} entering={FadeIn.duration(DUR.slow)} exiting={FadeOut.duration(DUR.base)} style={StyleSheet.absoluteFill}>
          <Backdrop source={item.thumbSource} dim={0.15} />
        </Animated.View>
      )}
      {enableVideo ? (
        <VideoView pointerEvents="none" player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} />
      ) : item ? (
        <Animated.View key={current} entering={FadeIn.duration(DUR.slow)} exiting={FadeOut.duration(DUR.base)} style={[StyleSheet.absoluteFill, zoomStyle]}>
          <Image source={item.thumbSource} style={StyleSheet.absoluteFill} contentFit={fit} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Each card's words arrive with a slight settle. */
const bodyIn = new Keyframe({
  0: { opacity: 0.4, transform: [{ scale: 1.04 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(420);

/** "Which one did you watch the most?" Tap a cover; the right one lights up. */
function Quiz({ options, answer, thumbs, width, onAnswer, onDone }: { options: { id: string; label: string }[]; answer: string; thumbs: Thumbs; width: number; onAnswer?: (right: boolean) => void; onDone: () => void }) {
  const styles = useStyles(makeStyles);
  const reduce = useReducedMotion();
  const [pick, setPick] = useState<string | null>(null);
  const w = (width - 20) / 3;
  return (
    <View style={{ gap: 14, marginTop: 8 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {options.map((o, n) => {
          const right = pick && o.id === answer;
          const wrong = pick === o.id && o.id !== answer;
          return (
            <Animated.View key={o.id} entering={reduce ? FadeIn : ZoomIn.delay(350 + n * 130).springify().damping(13)}>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={!!pick}
                onPress={() => {
                  setPick(o.id);
                  if (o.id === answer) success();
                  else warn();
                  onAnswer?.(o.id === answer);
                  setTimeout(onDone, 2200);
                }}
                style={[styles.qOpt, { width: w, height: w * 1.4 }, right && styles.qRight, wrong && styles.qWrong, pick && !right && !wrong && { opacity: 0.45 }]}
                accessibilityLabel={o.label}>
                <Image source={thumbs.get(o.id)} style={StyleSheet.absoluteFill} contentFit="cover" />
                {right && (
                  <Animated.View entering={ZoomIn.springify().damping(10)} style={styles.qBadge}>
                    <Icon name="check" size={16} color="#000" />
                  </Animated.View>
                )}
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
      {pick ? (
        <Animated.Text entering={FadeInDown.duration(DUR.slow)} style={styles.sLine}>
          {pick === answer ? 'Spot on. You know yourself well.' : 'Not quite! Let’s see the real one…'}
        </Animated.Text>
      ) : (
        <Animated.Text entering={FadeIn.delay(900)} style={styles.sHint}>
          Tap a cover to guess
        </Animated.Text>
      )}
    </View>
  );
}

/** "Which was your biggest day?" Tap an answer; the right one lights up. */
function TextQuiz({ options, answer, onAnswer, onDone }: { options: { id: string; label: string }[]; answer: string; onAnswer?: (right: boolean) => void; onDone: () => void }) {
  const styles = useStyles(makeStyles);
  const reduce = useReducedMotion();
  const [pick, setPick] = useState<string | null>(null);
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      {options.map((o, n) => {
        const right = !!pick && o.id === answer;
        const wrong = pick === o.id && o.id !== answer;
        return (
          <Animated.View key={o.id} entering={reduce ? FadeIn : FadeInRight.delay(350 + n * 120).springify().damping(15)}>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={!!pick}
              onPress={() => {
                setPick(o.id);
                if (o.id === answer) success();
                else warn();
                onAnswer?.(o.id === answer);
                setTimeout(onDone, 2200);
              }}
              style={[styles.tqOpt, right && styles.tqRight, wrong && styles.tqWrong, !!pick && !right && !wrong && { opacity: 0.45 }]}
              accessibilityLabel={o.label}>
              <Text style={[styles.tqText, right && { color: '#000' }]} numberOfLines={1}>
                {o.label}
              </Text>
              {right && <Icon name="check" size={18} color="#000" />}
              {wrong && <Icon name="close" size={18} color="#fff" />}
            </TouchableOpacity>
          </Animated.View>
        );
      })}
      {pick ? (
        <Animated.Text entering={FadeInDown.duration(DUR.slow)} style={styles.sLine}>
          {pick === answer ? 'Spot on. You know yourself well.' : 'Not quite! Here is the real one…'}
        </Animated.Text>
      ) : (
        <Animated.Text entering={FadeIn.delay(900)} style={styles.sHint}>
          Tap your guess
        </Animated.Text>
      )}
    </View>
  );
}

const weekdayName = (i: number) => ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][i];

export function WrappedStory({
  input,
  items,
  thumbs,
  enableVideo,
  loadBookmarks,
  memories = [],
  onOpenMemory,
  onEvent,
  onOpenVideo,
  onClose,
}: {
  input: StoryInput;
  items: Map<string, VaultItem>;
  thumbs: Thumbs;
  enableVideo: boolean;
  loadBookmarks: (videoId: string) => Promise<number[]>;
  /** A memory from the same time, shown near the end. */
  memories?: Memory[];
  onOpenMemory?: (m: Memory) => void;
  /** For badges: "quiz-right", "quiz-wrong", "wrapped-end". */
  onEvent?: (k: string) => void;
  onOpenVideo?: (id: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const { facts: f, prev, w, earned, series } = input;
  const name = (id: string) => (items.get(id) ? friendlyName(items.get(id)!) : 'A video');
  /** Moves to the next card (set below, used by the quiz). */
  const advance = useRef<() => void>(() => undefined);
  const endLogged = useRef(false);
  // Your audiobook pauses while the story plays videos with sound, and carries on when it closes.
  const app = useAudioControlsOptional();
  const appRef = useRef(app);
  appRef.current = app;
  useEffect(() => {
    if (!enableVideo) return;
    const was = appRef.current?.playing ?? false;
    if (was) appRef.current?.pause();
    return () => {
      if (was) appRef.current?.resume();
    };
  }, [enableVideo]);

  const cards = useMemo<StoryCard[]>(() => {
    const out: StoryCard[] = [];
    const t = (delay: number) => FadeInDown.delay(80 + delay * 110).duration(DUR.slow).easing(EASE_OUT);
    const kicker = (s: string, i = 0) => (
      <Animated.Text entering={t(i)} style={styles.sKicker}>
        {s}
      </Animated.Text>
    );
    const big = (s: string, i = 1) => (
      <Words text={s} delay={80 + i * 110} style={[styles.sBig, s.length > 22 && { fontSize: 36, lineHeight: 40 }, s.length > 40 && { fontSize: 29, lineHeight: 33 }]} />
    );
    const line = (s: string, i = 2) => (
      <Animated.Text key={s} entering={t(i)} style={styles.sLine}>
        {s}
      </Animated.Text>
    );
    const bars = (rows: { label: string; share: number; sub: string }[], i = 3) => (
      <Animated.View entering={t(i)} style={{ gap: 12, marginTop: 10 }}>
        {rows.map((r, n) => (
          <View key={r.label} style={{ gap: 5 }}>
            <View style={styles.sBarHead}>
              <Text style={styles.sBarLabel}>{r.label}</Text>
              <Text style={styles.sBarValue}>{r.sub}</Text>
            </View>
            <GrowBar share={r.share} delay={250 + i * 110 + n * 130} />
          </View>
        ))}
      </Animated.View>
    );
    const top = f.top;
    const ticker = (text: string, top: `${number}%`, reverse = false) => (
      <View style={[styles.sTicker, { top }]} pointerEvents="none">
        <Marquee ms={20000} reverse={reverse}>
          <Text style={styles.sTickerText}>{text} · </Text>
        </Marquee>
      </View>
    );
    const center = (node: ReactNode) => (
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
        {node}
      </View>
    );
    const allCovers = [...new Set([...top.map((x) => x.id), ...items.keys()])].slice(0, 18).map((id) => thumbs.get(id));
    const v = w.videos;
    const totalMin = w.totalMinutes;
    const change = prev && prev.watchedMs > 0 ? Math.round(((f.watchedMs - prev.watchedMs) / prev.watchedMs) * 100) : null;

    // 1 · hello
    out.push({
      key: 'intro',
      colors: ['#5E5CE6', '#14093D'],
      media: [],
      ms: 6000,
      backdrop: (
        <>
          <CoverWall sources={allCovers} opacity={0.8} />
          <View style={[StyleSheet.absoluteFill, gradient('radial-gradient(circle at 30% 50%, rgba(20,9,61,0.7) 0%, rgba(20,9,61,0.35) 85%)', 'rgba(20,9,61,0.55)')]} />
        </>
      ),
      body: (
        <>
          {kicker(input.subject ? `YOUR ${input.subject.kind.toUpperCase()} WRAPPED` : 'YOUR WRAPPED', 0)}
          {big(input.subject ? (input.subject.kind === 'keyword' ? `#${input.subject.name}` : input.subject.name) : f.range.label, 1)}
          {line(
            input.subject
              ? `${f.range.label}. Every video of it you watched, and how you watched it.`
              : f.plays
                ? 'You watched a lot. Let’s look back at what you loved.'
                : 'A quiet stretch. Here is what it looked like.',
            2
          )}
          <Animated.Text entering={t(4)} style={styles.sHint}>
            Hold to pause · tap to skip
          </Animated.Text>
        </>
      ),
    });

    // 2 · time
    out.push({
      key: 'time',
      colors: ['#0A84FF', '#04182F'],
      media: [],
      ms: 7000,
      backdrop: (
        <>
          {ticker(minutesText(totalMin).toUpperCase(), '10%')}
          {ticker('WATCHED', '78%', true)}
        </>
      ),
      body: (
        <>
          {kicker('YOU WATCHED', 0)}
          <Animated.View entering={t(1)}>
            <CountUp to={totalMin} format={(n) => minutesText(n)} style={styles.sHuge} />
          </Animated.View>
          {line(w.simkl ? 'Your videos and Simkl together.' : 'Of your own videos, right here in ReelVault.', 2)}
          {f.equivalents.map((e, i) => line(e, 3 + i))}
          {change !== null &&
            line(
              change === 0
                ? 'Exactly as much as the time before.'
                : `${w.simkl ? `Your own videos: ${fmtMs(f.watchedMs)}, ` : ''}${change > 0 ? 'up' : 'down'} ${Math.abs(change)} % on the time before (${fmtMs(prev!.watchedMs)}).`,
              5
            )}
        </>
      ),
    });

    // 3 · days
    if (f.plays) {
      const maxT = Math.max(1, ...f.timeline.map((x) => x.ms));
      out.push({
        key: 'days',
        colors: ['#30D158', '#05301A'],
        media: [],
        ms: 7000,
        body: (
          <>
            {kicker('DAYS WITH VIDEOS', 0)}
            {big(`${f.activeDays} of ${f.rangeDays}`, 1)}
            {line(f.activeDays === f.rangeDays ? 'Every single day. That’s commitment.' : `You pressed play on ${Math.round((f.activeDays / f.rangeDays) * 100)} % of the days.`, 2)}
            <Animated.View entering={t(3)} style={styles.sDots}>
              {f.timeline.map((d, n) =>
                f.rangeDays > 62 ? (
                  <GrowColumn key={d.key} ratio={d.ms / maxT} height={76} width={18} color="rgba(255,255,255,0.9)" delay={350 + n * 60} />
                ) : (
                  <Animated.View
                    key={d.key}
                    entering={reduce ? undefined : ZoomIn.delay(350 + n * 18).springify().damping(12)}
                    style={[styles.sDot, d.ms > 0 && styles.sDotOn, f.timeline.length > 14 && { width: 13, height: 13, borderRadius: 4 }]}
                  />
                )
              )}
            </Animated.View>
            {v.bestRun > 1 && line(`Best run: ${v.bestRun} days in a row.`, 4)}
            {f.favouriteWeekday !== null && line(`${weekdayName(f.favouriteWeekday)} were your big days.`, 5)}
          </>
        ),
      });
    }

    // 4 · discovery
    if (f.videos) {
      out.push({
        key: 'discover',
        colors: ['#FF9F0A', '#3A1E00'],
        media: top.slice(0, 3).map((x) => x.id),
        ms: 7000,
        body: (
          <>
            {kicker('NEW & FAMILIAR', 0)}
            {big(`${f.videos} ${f.videos === 1 ? 'video' : 'videos'}`, 1)}
            {line(
              f.firsts === 0
                ? 'All of them old favourites you came back to.'
                : f.returns === 0
                  ? 'Every one of them for the very first time.'
                  : `${f.firsts} for the very first time, and ${f.returns} old ${f.returns === 1 ? 'favourite' : 'favourites'} you came back to.`,
              2
            )}
            <Animated.View entering={t(3)} style={styles.sSplit}>
              <View style={[styles.sSplitA, { flex: Math.max(0.05, f.firsts) }]} />
              <View style={[styles.sSplitB, { flex: Math.max(0.05, f.returns) }]} />
            </Animated.View>
            <Animated.View entering={t(4)} style={styles.sLegend}>
              <Text style={styles.sLegendText}>● New</Text>
              <Text style={[styles.sLegendText, { opacity: 0.6 }]}>● Rewatched</Text>
            </Animated.View>
          </>
        ),
      });
    }

    // Extra guesses along the way: one for a short Wrapped, two for a long one, a different mix each time.
    const seed = Math.floor(f.range.start / 86_400_000);
    const dayQuiz =
      f.rangeDays <= 62 && f.biggestDay
        ? quizFrom(
            f.timeline.map((d) => ({ id: String(d.key), label: new Date(d.key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }), value: d.ms })),
            seed
          )
        : null;
    const monthQuiz = (input.sprint ?? []).length >= 3 ? quizFrom((input.sprint ?? []).map((x) => ({ id: x.label, label: x.label.charAt(0) + x.label.slice(1).toLowerCase(), value: x.ms })), seed) : null;
    const tagQuiz = v.topTags.length >= 3 ? quizFrom(v.topTags.slice(0, 6).map((x) => ({ id: x.label, label: `#${x.label}`, value: x.value })), seed) : null;
    const quizKeys = (['day', 'month', 'tag'] as const).filter((k) => (k === 'day' ? dayQuiz : k === 'month' ? monthQuiz : tagQuiz));
    const rot = seed % Math.max(1, quizKeys.length);
    const asked = new Set([...quizKeys.slice(rot), ...quizKeys.slice(0, rot)].slice(0, f.rangeDays > 62 ? 2 : 1));
    const guess = (key: string, title: string, q: NonNullable<ReturnType<typeof quizFrom>>, colors: [string, string]) =>
      out.push({
        key,
        focus: 'words',
        colors,
        media: [],
        ms: 20000,
        interactive: true,
        backdrop: ticker('GUESS', '8%'),
        body: (
          <>
            {kicker('QUICK QUESTION', 0)}
            {big(title, 1)}
            <TextQuiz options={q.options} answer={q.answer} onAnswer={(right) => onEvent?.(right ? 'quiz-right' : 'quiz-wrong')} onDone={() => advance.current()} />
          </>
        ),
      });

    // 5 · top five, counted down
    for (let r = top.length; r >= 2; r--) {
      const x = top[r - 1];
      out.push({
        key: `rank${r}`,
        colors: ['#FF375F', '#2C0412'],
        media: [x.id],
        ms: 5200,
        body: (
          <>
            {kicker(`YOUR TOP ${top.length} · COUNTING DOWN`, 0)}
            <View style={styles.sRankRow}>
              <Animated.Text entering={reduce ? FadeIn : ZoomIn.springify().damping(14)} style={styles.sRank}>
                #{r}
              </Animated.Text>
              <Tilt rotate={r % 2 ? 6 : -6} delay={260}>
                <View style={styles.sPolaroid}>
                  <Image source={thumbs.get(x.id)} style={styles.sPolaroidImg} contentFit="cover" />
                </View>
              </Tilt>
            </View>
            {big(x.label, 2)}
            {line(`${fmtMs(x.ms)} · ${x.plays} ${x.plays === 1 ? 'play' : 'plays'}`, 3)}
          </>
        ),
      });
    }

    // 6 · a guess, then number one
    if (top.length >= 3) {
      const opts = [top[1], top[0], top[2]];
      if (f.range.start % 2) opts.reverse();
      out.push({
        key: 'quiz',
        focus: 'words',
        colors: ['#FF375F', '#30051A'],
        media: [],
        ms: 20000,
        interactive: true,
        backdrop: ticker('GUESS', '8%'),
        body: (
          <>
            {kicker('QUICK QUESTION', 0)}
            {big('Which one did you watch the most?', 1)}
            <Quiz
              options={opts.map((o) => ({ id: o.id, label: o.label }))}
              answer={top[0].id}
              thumbs={thumbs}
              width={width - 56}
              onAnswer={(right) => onEvent?.(right ? 'quiz-right' : 'quiz-wrong')}
              onDone={() => advance.current()}
            />
          </>
        ),
      });
    }
    if (top[0]) {
      const x = top[0];
      const share = f.watchedMs ? x.ms / f.watchedMs : 0;
      out.push({
        key: 'top1',
        colors: ['#FFD60A', '#3A2E00'],
        media: [x.id],
        ms: 8000,
        backdrop: (
          <>
            {center(<Rays size={Math.max(width, height) * 1.5} opacity={0.14} />)}
            <Confetti />
          </>
        ),
        body: (
          <>
            {kicker('AND YOUR #1 IS…', 0)}
            <Animated.View entering={reduce ? FadeIn : ZoomIn.delay(250).springify().damping(13)} style={[styles.sHeroThumb, { width: width - 56, height: (width - 56) * 0.58 }]}>
              <Image source={thumbs.get(x.id)} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={styles.sCrown}>
                <Icon name="trophy" size={16} color="#000" />
                <Text style={styles.sCrownText}>#1</Text>
              </View>
            </Animated.View>
            {big(x.label, 3)}
            {line(`${Math.round(share * 100)} % of everything you watched. ${x.plays} ${x.plays === 1 ? 'play' : 'plays'}${x.days > 1 ? ` on ${x.days} different days` : ''}.`, 4)}
            {line(`First played ${longDay(x.firstAt)}.`, 5)}
          </>
        ),
      });
      if (top.length >= 3)
        out.push({
          key: 'top5',
        focus: 'words',
          colors: ['#FF9F0A', '#2E1200'],
          media: top.map((y) => y.id),
          ms: 9000,
          body: (
            <>
              {kicker(`YOUR TOP ${top.length}`, 0)}
              <View style={{ gap: 10, marginTop: 6 }}>
                {top.map((y, n) => (
                  <Animated.View key={y.id} entering={reduce ? FadeIn : FadeInRight.delay(250 + n * 140).springify().damping(16)} style={styles.sListRow}>
                    <Text style={[styles.sListRank, n === 0 && { color: '#FFD60A' }]}>{n + 1}</Text>
                    <Image source={thumbs.get(y.id)} style={styles.sListThumb} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sListTitle} numberOfLines={1}>
                        {y.label}
                      </Text>
                      <Text style={styles.sListSub}>
                        {fmtMs(y.ms)} · {y.plays} {y.plays === 1 ? 'play' : 'plays'}
                      </Text>
                    </View>
                  </Animated.View>
                ))}
              </View>
            </>
          ),
        });
    }

    if (monthQuiz && asked.has('month')) guess('quiz-month', 'Which month did you watch the most?', monthQuiz, ['#30D158', '#022814']);

    // 6c · month by month: your #1 of each month
    const sprint = (input.sprint ?? []).filter((x) => x.videoId);
    if (sprint.length >= 3) {
      out.push({
        key: 'sprint',
        focus: 'words',
        colors: ['#30D158', '#022814'],
        media: [...new Set(sprint.map((x) => x.videoId!))].slice(0, 6),
        ms: 9500,
        body: (
          <>
            {kicker('MONTH BY MONTH', 0)}
            {big('Your #1, every month', 1)}
            <View style={styles.sSprint}>
              {(input.sprint ?? []).map((x, n) => (
                <Animated.View key={x.label + n} entering={reduce ? FadeIn : ZoomIn.delay(300 + n * 90).springify().damping(14)} style={styles.sSprintCell}>
                  <View style={styles.sSprintThumb}>{x.videoId ? <Image source={thumbs.get(x.videoId)} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
                  <Text style={styles.sSprintLabel}>{x.label}</Text>
                </Animated.View>
              ))}
            </View>
            {line(`${new Set(sprint.map((x) => x.videoId)).size} different videos took the top spot.`, 4)}
          </>
        ),
      });
    }

    // 7 · comfort video
    if (f.comfort && f.comfort.id !== top[0]?.id) {
      const c = f.comfort;
      out.push({
        key: 'comfort',
        colors: ['#64D2FF', '#02263A'],
        media: [c.id],
        ms: 7000,
        body: (
          <>
            {kicker('YOUR COMFORT VIDEO', 0)}
            {big(c.label, 1)}
            {line(`An old favourite. You came back to it ${c.plays} ${c.plays === 1 ? 'time' : 'times'}.`, 2)}
          </>
        ),
      });
    }

    // 8 · tags
    if (tagQuiz && asked.has('tag')) guess('quiz-tag', 'Which keyword did you watch the most?', tagQuiz, ['#BF5AF2', '#240838']);
    if (v.topTags.length) {
      const tagTop = top.find((x) => items.get(x.id)?.tagNames.includes(v.topTags[0].label));
      out.push({
        key: 'tags',
        colors: ['#BF5AF2', '#240838'],
        media: tagTop ? [tagTop.id] : [],
        ms: 8000,
        body: (
          <>
            {kicker('WHAT YOU WATCHED MOST', 0)}
            {big(`#${v.topTags[0].label}`, 1)}
            {bars(v.topTags.slice(0, 4).map((x) => ({ label: `#${x.label}`, share: f.watchedMs ? x.value / f.watchedMs : 0, sub: fmtMs(x.value) })), 2)}
          </>
        ),
      });
    }

    // 9 · when
    if (f.plays) {
      const lead = [...f.dayparts].sort((a, b) => b.share - a.share)[0];
      const words: Record<string, string> = {
        morning: 'You start your day with a video.',
        afternoon: 'Afternoons are your time.',
        evening: 'Evenings belong to your videos.',
        night: 'You come alive after dark.',
      };
      out.push({
        key: 'when',
        colors: ['#5E5CE6', '#0D0A33'],
        media: [],
        ms: 8000,
        body: (
          <>
            {kicker('WHEN YOU WATCH', 0)}
            {big(words[lead.key], 1)}
            {bars(f.dayparts.map((d) => ({ label: d.label, share: d.share, sub: `${Math.round(d.share * 100)} %` })), 2)}
            {v.peakHour !== null && line(`Your favourite moment to press play: around ${hourLabel(v.peakHour)}.`, 4)}
          </>
        ),
      });
    }

    // 10 · biggest day
    if (dayQuiz && asked.has('day') && f.plays > 2) guess('quiz-day', 'Which was your biggest day?', dayQuiz, ['#FF453A', '#360806']);
    if (f.biggestDay && f.plays > 2) {
      out.push({
        key: 'bigday',
        colors: ['#FF453A', '#360806'],
        media: f.biggestDay.videoId ? [f.biggestDay.videoId] : [],
        ms: 7000,
        body: (
          <>
            {kicker('YOUR BIGGEST DAY', 0)}
            {big(longDay(f.biggestDay.day), 1)}
            {line(`${fmtMs(f.biggestDay.ms)} of watching${f.biggestDay.videoId ? `, mostly ${name(f.biggestDay.videoId)}` : ''}.`, 2)}
          </>
        ),
      });
    }

    // 11 · longest sitting
    if (f.longest && f.longest.ms >= 5 * 60_000) {
      out.push({
        key: 'sitting',
        colors: ['#AC8E68', '#2A2014'],
        media: [f.longest.videoId],
        ms: 6500,
        body: (
          <>
            {kicker('LONGEST SITTING', 0)}
            {big(fmtMs(f.longest.ms), 1)}
            {line(`${name(f.longest.videoId)}, without stopping, on ${longDay(f.longest.at)}.`, 2)}
          </>
        ),
      });
    }

    // 12 · throwback
    if (f.throwback) {
      out.push({
        key: 'throwback',
        colors: ['#FF9F0A', '#2B1300'],
        media: [f.throwback.videoId],
        ms: 7000,
        body: (
          <>
            {kicker('A TRIP BACK IN TIME', 0)}
            {big(`${f.throwback.years} ${f.throwback.years === 1 ? 'year' : 'years'} ago`, 1)}
            {line(`You watched ${name(f.throwback.videoId)}, filmed on ${shortDate(f.throwback.createdAt)}.`, 2)}
          </>
        ),
      });
    }

    // 12b · your era
    if (f.era) {
      const e = f.era;
      const thisYear = e.year === new Date().getFullYear();
      out.push({
        key: 'era',
        colors: ['#64D2FF', '#03203A'],
        media: top.filter((x) => items.get(x.id) && new Date(items.get(x.id)!.createdAt).getFullYear() === e.year).slice(0, 3).map((x) => x.id),
        ms: 7000,
        backdrop: (
          <>
            {ticker(String(e.year), '12%')}
            {ticker(String(e.year), '74%', true)}
          </>
        ),
        body: (
          <>
            {kicker('YOUR VIDEO ERA', 0)}
            <Animated.Text entering={reduce ? FadeIn : ZoomIn.delay(150).springify().damping(13)} style={styles.sRank}>
              {e.year}
            </Animated.Text>
            {line(`${Math.round(e.share * 100)} % of your watch time went to videos filmed in ${e.year}, out of ${e.years} different years.`, 2)}
            {line(thisYear ? 'You live in the now. Fresh videos only.' : `Your heart is still in ${e.year}.`, 3)}
          </>
        ),
      });
    }

    // 13 · taste
    if (f.avgRating !== null) {
      const style = f.avgRating >= 8 ? 'Only the good stuff.' : f.avgRating >= 6 ? 'Picky, but fair.' : 'A tough crowd.';
      out.push({
        key: 'taste',
        colors: ['#FFD60A', '#2E2400'],
        media: f.bestRated ? [f.bestRated.videoId] : [],
        ms: 7000,
        body: (
          <>
            {kicker('YOUR TASTE', 0)}
            {big(`★ ${f.avgRating.toFixed(1)}`, 1)}
            {line(`${style} That’s the average of what you watched.`, 2)}
            {f.bestRated && line(`Highest rated: ${name(f.bestRated.videoId)}, ★ ${f.bestRated.rating}.`, 3)}
            {f.completion !== null && line(`And you finish ${Math.round(f.completion * 100)} % of a video on average.`, 4)}
          </>
        ),
      });
    }

    // 14 · hidden gem
    if (f.gem) {
      const gem = f.gem;
      out.push({
        key: 'gem',
        colors: ['#30D158', '#032611'],
        media: [gem.videoId],
        ms: 7000,
        interactive: !!onOpenVideo,
        body: (
          <>
            {kicker('DON’T FORGET THIS ONE', 0)}
            {big(name(gem.videoId), 1)}
            {line(`You gave it ★ ${gem.rating}, ${gem.lastAt ? `but you haven’t watched it since ${shortDate(gem.lastAt)}` : 'but you’ve never watched it here'}.`, 2)}
            {onOpenVideo && (
              <Animated.View entering={t(3)}>
                <TouchableOpacity style={styles.sButton} onPress={() => onOpenVideo(gem.videoId)}>
                  <Icon name="play" size={14} color="#000" />
                  <Text style={styles.sButtonText}>Watch it now</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </>
        ),
      });
    }

    // 15 · library
    if (v.imported > 0) {
      out.push({
        key: 'library',
        colors: ['#0A84FF', '#021A33'],
        media: v.bestNew ? [v.bestNew.key] : [],
        ms: 6500,
        body: (
          <>
            {kicker('YOUR LIBRARY GREW', 0)}
            {big(`+${v.imported} ${v.imported === 1 ? 'video' : 'videos'}`, 1)}
            {line(`${fmtBytes(v.importedBytes)} of new memories.`, 2)}
            {v.bestNew && line(`Best new one: ${v.bestNew.label}, ★ ${v.bestNew.value}.`, 3)}
          </>
        ),
      });
    }

    // 16 · series
    if (series.length) {
      out.push({
        key: 'series',
        colors: ['#64D2FF', '#022235'],
        media: [],
        ms: 7000,
        body: (
          <>
            {kicker('YOUR SERIES', 0)}
            {big(`${series.reduce((a, s) => a + s.episodes, 0)} episodes`, 1)}
            {series.slice(0, 4).map((s, i) => line(`${s.name}: ${s.episodes} ${s.episodes === 1 ? 'episode' : 'episodes'}${s.finished ? ' · finished ✓' : ''}`, 2 + i))}
          </>
        ),
      });
    }

    // 17 · badges
    if (earned.length) {
      out.push({
        key: 'badges',
        focus: 'words',
        colors: ['#FFD60A', '#3A2600'],
        media: [],
        ms: 7500,
        body: (
          <>
            {kicker('BADGES YOU EARNED', 0)}
            {big(`${earned.length} new`, 1)}
            <View style={styles.sMedals}>
              {earned.slice(0, 6).map((a, i) => (
                <Animated.View key={a.id} entering={reduce ? FadeIn : ZoomIn.delay(250 + i * 120).springify().damping(12)} style={styles.sMedal}>
                  <Medallion icon={a.icon} tier={a.tier} unlocked size={64} />
                  <Text style={styles.sMedalText} numberOfLines={2}>
                    {a.title}
                  </Text>
                </Animated.View>
              ))}
            </View>
          </>
        ),
      });
    }

    // 18 · Simkl
    const s = w.simkl;
    if (s && s.minutes > 0) {
      out.push({
        key: 'simkl',
        colors: ['#64D2FF', '#05324A'],
        media: [],
        ms: 8000,
        body: (
          <>
            {kicker('MOVIES, SHOWS & ANIME', 0)}
            {big(fmtMs(s.minutes * 60000), 1)}
            {line(`${[s.episodes ? `${s.episodes} ${s.episodes === 1 ? 'episode' : 'episodes'}` : null, s.movies ? `${s.movies} ${s.movies === 1 ? 'movie' : 'movies'}` : null].filter(Boolean).join(' and ')} across ${s.titles} ${s.titles === 1 ? 'title' : 'titles'}.`, 2)}
            {s.topTitles.slice(0, 4).map((x, i) => line(`${i + 1}. ${x.label} · ${x.sub}`, 3 + i))}
          </>
        ),
      });
      if (s.topGenres.length)
        out.push({
          key: 'genres',
          colors: ['#FF9F0A', '#331A00'],
          media: [],
          ms: 6500,
          body: (
            <>
              {kicker('YOUR GENRES', 0)}
              {big(s.topGenres[0].label, 1)}
              {bars(
                s.topGenres.slice(0, 4).map((g) => ({ label: g.label, share: s.minutes ? g.value / s.minutes : 0, sub: fmtMs(g.value * 60000) })),
                2
              )}
            </>
          ),
        });
    }

    // 18a · in your words: reviews you wrote
    const reviews = input.reviews ?? [];
    if (reviews.length) {
      const shown = reviews.slice(0, 2);
      out.push({
        key: 'reviews',
        colors: ['#FFD60A', '#2B2100'],
        media: shown.map((r) => r.videoId).filter((x): x is string => !!x),
        ms: 6500 + shown.length * 2500,
        body: (
          <>
            {kicker('IN YOUR WORDS', 0)}
            {big(reviews.length === 1 ? 'Your review' : `${reviews.length} reviews`, 1)}
            {shown.map((r, n) => (
              <Animated.View key={r.title + n} entering={t(2 + n)} style={styles.sReview}>
                <Text style={styles.sReviewText} numberOfLines={5}>
                  “{r.text}”
                </Text>
                <Text style={styles.sReviewBy} numberOfLines={1}>
                  {r.title}
                  {r.rating ? ` · ★ ${r.rating}` : ''}
                </Text>
              </Animated.View>
            ))}
          </>
        ),
      });
    }

    // 18a · then vs now: the same stretch a year before
    const ly = input.lastYear;
    if (ly && ly.plays > 0 && f.plays > 0 && !input.subject) {
      const yearLong = f.rangeDays > 300;
      const nowY = new Date(Math.min(Date.now(), f.range.end - 1)).getFullYear();
      const rows: [string, number, number, (n: number) => string][] = [
        ['Watched', ly.watchedMs, f.watchedMs, fmtMs],
        ['Plays', ly.plays, f.plays, String],
        ['Videos', ly.videos, f.videos, String],
        ['Days with videos', ly.activeDays, f.activeDays, String],
      ];
      const pct = ly.watchedMs ? Math.round(((f.watchedMs - ly.watchedMs) / ly.watchedMs) * 100) : 0;
      const thenTop = ly.top[0];
      out.push({
        key: 'thenvsnow',
        colors: ['#0A84FF', '#1A0538'],
        media: [top[0]?.id, thenTop?.id].filter((x): x is string => !!x && !!items.get(x)),
        ms: 9500,
        body: (
          <>
            {kicker('THEN VS NOW', 0)}
            {big(yearLong ? `${nowY} vs ${nowY - 1}` : 'This time last year', 1)}
            <Animated.View entering={t(2)} style={styles.sTvn}>
              <View style={styles.sTvnRow}>
                <Text style={[styles.sTvnLabel, { opacity: 0 }]}>.</Text>
                <Text style={styles.sTvnHead}>{yearLong ? nowY - 1 : 'Then'}</Text>
                <Text style={styles.sTvnHead}>{yearLong ? nowY : 'Now'}</Text>
              </View>
              {rows.map(([label, a, b, fmt]) => (
                <View key={label} style={styles.sTvnRow}>
                  <Text style={styles.sTvnLabel}>{label}</Text>
                  <Text style={[styles.sTvnValue, { opacity: 0.6 }]}>{fmt(a)}</Text>
                  <Text style={styles.sTvnValue}>
                    {fmt(b)} <Text style={{ color: b > a ? '#30D158' : b < a ? '#FF9F0A' : '#fff' }}>{b > a ? '▲' : b < a ? '▼' : '='}</Text>
                  </Text>
                </View>
              ))}
            </Animated.View>
            {thenTop && top[0] && thenTop.id !== top[0].id && (
              <Animated.View entering={t(3)} style={styles.sTvnPair}>
                {[
                  ['#1 THEN', thenTop.id],
                  ['#1 NOW', top[0].id],
                ].map(([k, id]) => (
                  <View key={k} style={{ flex: 1, gap: 4 }}>
                    <View style={styles.sTvnThumb}>{thumbs.get(id) ? <Image source={thumbs.get(id)} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
                    <Text style={styles.sTvnCap} numberOfLines={1}>
                      {k} · {name(id)}
                    </Text>
                  </View>
                ))}
              </Animated.View>
            )}
            {line(pct === 0 ? 'Just as much as a year before.' : pct > 0 ? `${pct} % more watching than a year before.` : `${-pct} % less than a year before. A calmer stretch.`, 4)}
          </>
        ),
      });
    }

    // 18b · a memory from this time
    const mem = memories[0];
    if (mem && onOpenMemory) {
      out.push({
        key: 'memory',
        colors: ['#FF9F0A', '#3A1400'],
        media: mem.videoIds.slice(0, 4),
        ms: 8000,
        interactive: true,
        body: (
          <>
            {kicker('A MEMORY FROM THIS TIME', 0)}
            {big(mem.title, 1)}
            {line(mem.subtitle, 2)}
            <Animated.View entering={t(3)}>
              <TouchableOpacity style={styles.sButton} onPress={() => onOpenMemory(mem)}>
                <Icon name="memories" size={14} color="#000" />
                <Text style={styles.sButtonText}>Play the memory</Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        ),
      });
    }

    // 18b · the age of what you watched
    const age = videoAge(
      top.map((x) => ({ ms: x.ms, createdAt: items.get(x.id)?.createdAt })),
      Math.min(Date.now(), f.range.end)
    );
    if (age && top.length >= 2) {
      const byAge = [...top].filter((x) => items.get(x.id)).sort((a, b) => items.get(a.id)!.createdAt - items.get(b.id)!.createdAt);
      out.push({
        key: 'age',
        colors: ['#AC8E68', '#1A1108'],
        media: byAge.slice(0, 3).map((x) => x.id),
        ms: 8000,
        body: (
          <>
            {kicker('YOUR VIDEO AGE', 0)}
            {big(age.years < 1 ? `${Math.max(1, Math.round(age.years * 12))} months` : `${age.years} years`, 1)}
            {line(`${age.label}. ${age.blurb}`, 2)}
            <Animated.View entering={t(3)} style={styles.sAgeRow}>
              {byAge.slice(0, 5).map((x) => (
                <View key={x.id} style={styles.sAgeCell}>
                  <View style={styles.sAgeThumb}>
                    <Image source={thumbs.get(x.id)} style={StyleSheet.absoluteFill} contentFit="cover" />
                  </View>
                  <Text style={styles.sAgeYear}>{new Date(items.get(x.id)!.createdAt).getFullYear()}</Text>
                </View>
              ))}
            </Animated.View>
          </>
        ),
      });
    }

    // 18c · the rewatch meter
    const meter = rewatchMeter(f.plays, f.videos);
    if (meter) {
      const filled = Math.min(10, Math.round(meter.perVideo * 2));
      out.push({
        key: 'rewatch',
        colors: ['#FF375F', '#1F0410'],
        media: f.comfort ? [f.comfort.id] : top[0] ? [top[0].id] : [],
        ms: 6500,
        body: (
          <>
            {kicker('THE REWATCH METER', 0)}
            {big(`${meter.perVideo}× each`, 1)}
            <Animated.View entering={t(2)} style={styles.sMeter}>
              {Array.from({ length: 10 }, (_, n) => (
                <Animated.View
                  key={n}
                  entering={reduce ? undefined : ZoomIn.delay(400 + n * 70)}
                  style={[styles.sMeterCell, n < filled && { backgroundColor: n >= 7 ? '#FFD60A' : '#fff' }]}
                />
              ))}
            </Animated.View>
            {line(`${meter.label}. ${f.plays} plays of ${f.videos} ${f.videos === 1 ? 'video' : 'videos'}.`, 3)}
          </>
        ),
      });
    }

    // 18d · your club
    const club = clubOf({
      plays: f.plays,
      firsts: f.firsts,
      returns: f.returns,
      dayparts: f.dayparts,
      completion: f.completion,
      longestMs: f.longest?.ms ?? null,
      biggestDayMs: f.biggestDay?.ms ?? null,
    });
    if (club) {
      out.push({
        key: 'club',
        colors: [club.club.color, '#07060F'],
        media: [],
        ms: 9000,
        focus: 'words',
        body: (
          <>
            {kicker('YOU’RE IN THE', 0)}
            {big(club.club.name, 1)}
            {line(club.club.blurb, 2)}
            <View style={styles.sClubs}>
              {CLUBS.map((c, n) => {
                const mine = c.key === club.club.key;
                return (
                  <Animated.View
                    key={c.key}
                    entering={reduce ? FadeIn : ZoomIn.delay(350 + n * 90)}
                    style={[styles.sClub, mine && { backgroundColor: hexA(c.color, 0.85), borderColor: '#fff' }]}>
                    <Icon name={iconOr(c.icon)} size={16} color="#fff" />
                    <Text style={styles.sClubName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <View style={styles.sClubTrack}>
                      <View style={[styles.sClubFill, { width: `${Math.round(club.fit[c.key] * 100)}%`, backgroundColor: mine ? '#fff' : hexA(c.color, 0.9) }]} />
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          </>
        ),
      });
    }

    // 18e · your club, month by month
    const journey = clubJourney((input.sprint ?? []).map((x) => ({ label: x.label, club: x.club ?? null })));
    if (journey) {
      out.push({
        key: 'clubmonths',
        colors: [journey.last.color, '#07060F'],
        media: [],
        ms: 9500,
        focus: 'words',
        body: (
          <>
            {kicker('YOUR CLUB, MONTH BY MONTH', 0)}
            {big(journey.switches === 0 ? `${journey.most.name}, every month` : journey.first.key === journey.last.key ? `Back to the ${journey.last.name}` : `${journey.first.name} → ${journey.last.name}`, 1)}
            <View style={styles.sSprint}>
              {(input.sprint ?? []).map((x, n) => {
                const c = CLUBS.find((k) => k.key === x.club);
                return (
                  <Animated.View key={x.label + n} entering={reduce ? FadeIn : ZoomIn.delay(300 + n * 80).springify().damping(14)} style={styles.sSprintCell}>
                    <View style={[styles.sClubMonth, { backgroundColor: c ? hexA(c.color, 0.85) : 'rgba(255,255,255,0.1)' }]}>{c ? <Icon name={iconOr(c.icon)} size={16} color="#fff" /> : null}</View>
                    <Text style={styles.sSprintLabel}>{x.label}</Text>
                  </Animated.View>
                );
              })}
            </View>
            {line(
              journey.switches === 0
                ? 'The same club every month. You know your style.'
                : `You switched clubs ${journey.switches} ${journey.switches === 1 ? 'time' : 'times'}. Most months you were in the ${journey.most.name}.`,
              3
            )}
          </>
        ),
      });
    }

    // 19 · persona
    out.push({
      key: 'persona',
      colors: ['#BF5AF2', '#FF375F'],
      media: top.slice(0, 3).map((x) => x.id),
      ms: 8000,
      backdrop: center(<Rays size={Math.max(width, height) * 1.5} opacity={0.1} count={18} />),
      body: (
        <>
          {kicker('ALL OF THAT MAKES YOU', 0)}
          <Animated.View entering={reduce ? FadeIn : ZoomIn.delay(200).springify().damping(13)}>
            <Float style={styles.sIcon}>
              <Icon name={iconOr(f.persona.icon)} size={38} color="#fff" />
            </Float>
          </Animated.View>
          {big(f.persona.name, 2)}
          {line(f.persona.blurb, 3)}
          <Animated.View entering={t(4)} style={styles.sChips}>
            {f.traits.map((x) => (
              <View key={x} style={styles.sChip}>
                <Text style={styles.sChipText}>{x}</Text>
              </View>
            ))}
          </Animated.View>
        </>
      ),
    });

    // 20 · summary
    out.push({
      key: 'summary',
        focus: 'words',
      colors: ['#2C1A4D', '#000000'],
      media: [],
      ms: 14000,
      interactive: true,
      backdrop: (
        <>
          <CoverWall sources={allCovers} opacity={0.28} tilt={12} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        </>
      ),
      body: (
        <>
          <Animated.View entering={t(0)} style={styles.sSummary}>
            <View style={styles.sSummaryHead}>
              {top[0] && <Image source={thumbs.get(top[0].id)} style={styles.sSummaryThumb} contentFit="cover" />}
              <View style={{ flex: 1 }}>
                <Text style={styles.sKicker}>{input.subject ? `MY ${input.subject.name.toUpperCase()} WRAPPED` : `MY WRAPPED · ${f.range.label.toUpperCase()}`}</Text>
                <Text style={styles.sSummaryTitle} numberOfLines={2}>
                  {f.persona.name}
                </Text>
              </View>
            </View>
            {top.length > 1 && (
              <View style={styles.sStrip}>
                {top.map((y, n) => (
                  <View key={y.id} style={styles.sStripItem}>
                    <Image source={thumbs.get(y.id)} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <Text style={styles.sStripRank}>{n + 1}</Text>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.sGrid}>
              {[
                [minutesText(totalMin), 'watched'],
                [String(f.plays), 'plays'],
                [String(f.videos), 'videos'],
                [String(f.activeDays), 'days'],
                [v.topTags[0] ? `#${v.topTags[0].label}` : '–', 'top tag'],
                [f.traits[0] ?? '–', 'signature'],
                [top[0] ? top[0].label : '–', 'my #1'],
              ].map(([a, b]) => (
                <View key={b} style={[styles.sGridCell, b === 'my #1' && { width: '100%' }]}>
                  <Text style={[styles.sGridValue, a.length > 12 && { fontSize: 17 }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
                    {a}
                  </Text>
                  <Text style={styles.sGridLabel}>{b}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
          <Animated.View entering={t(2)}>
            <TouchableOpacity
              style={styles.sShare}
              onPress={() =>
                void Share.share({
                  message: `My ReelVault ${input.subject ? `${input.subject.name} ` : ''}Wrapped (${f.range.label}): ${minutesText(totalMin)} watched, ${f.plays} plays of ${f.videos} videos on ${f.activeDays} days${
                    top[0] ? `. My #1: "${top[0].label}"` : ''
                  }${v.topTags[0] ? `, top tag #${v.topTags[0].label}` : ''}. I'm ${f.persona.name}.`,
                })
              }>
              <Icon name="share" size={16} color="#000" />
              <Text style={styles.sShareText}>Share</Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      ),
    });
    // Every card plays one of your videos: the ones without their own get your most watched in turn,
    // each from a different, random-looking part (so it is never the same opening twice).
    const pool = [...new Set([...top.map((x) => x.id), ...(input.subject ? [] : [...items.keys()])])].filter((id) => items.has(id)).slice(0, 24);
    // Before your #1 is revealed, your top three never play (no spoiler on the intro or the quiz).
    const reveal = out.findIndex((c) => c.key === 'top1');
    const spoil = new Set(top.slice(0, 3).map((x) => x.id));
    let k = 0;
    for (const [n, c] of out.entries()) {
      if (c.media.some((id) => items.has(id)) || !pool.length) continue;
      const cand = reveal >= 0 && n < reveal ? pool.filter((id) => !spoil.has(id)) : pool;
      if (!cand.length) continue;
      // Not the same video as the card before (that would reload it with a black flash).
      const prev = out[n - 1]?.media[0];
      let pick = cand[k % cand.length];
      if (pick === prev && cand.length > 1) pick = cand[(k + 1) % cand.length];
      c.media = [pick];
      c.startFrac = 0.15 + (((k * 37 + c.key.length * 11) % 60) / 100);
      k++;
    }
    return out;
  }, [input, thumbs, width, height, reduce, memories]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where each video's clip starts: its first bookmark, else a quarter of the way in.
  const [starts, setStarts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const ids = [...new Set(cards.flatMap((c) => c.media))];
    Promise.all(
      ids.map((id) =>
        loadBookmarks(id)
          .then((b) => [id, highlightAt(items.get(id)?.durationMs ?? null, b)] as const)
          .catch(() => [id, highlightAt(items.get(id)?.durationMs ?? null)] as const)
      )
    )
      .then((list) => setStarts(new Map(list)))
      .catch(() => undefined);
  }, [cards]); // eslint-disable-line react-hooks/exhaustive-deps

  // The browser preview can open a given card (`/preview?view=wrapped-story&card=6`), paused, for screenshots.
  const previewCard = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('card') : null;
  const [i, setI] = useState(() => Math.min(cards.length - 1, Math.max(0, Number(previewCard ?? 0) || 0)));
  const [paused, setPaused] = useState(previewCard !== null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const iRef = useRef(0);
  iRef.current = i;
  const card = cards[Math.min(i, cards.length - 1)];

  const go = (n: number) => {
    if (n < 0) return setElapsed(0);
    if (n >= cards.length) return onClose();
    if (cards[n].key === 'top1') success();
    else tick();
    if (n === cards.length - 1 && !endLogged.current) {
      endLogged.current = true;
      onEvent?.('wrapped-end');
    }
    setElapsed(0);
    setI(n);
  };
  advance.current = () => go(iRef.current + 1);

  // Each card moves on by itself; holding pauses it.
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setElapsed((e) => {
        const next = e + 50;
        if (next >= cards[iRef.current].ms) {
          setTimeout(() => go(iRef.current + 1), 0);
          return 0;
        }
        return next;
      });
    }, 50);
    return () => clearInterval(id);
  }, [paused, cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag down to close.
  const ty = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-30, 30])
    .onUpdate((e) => {
      'worklet';
      ty.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 120 || e.velocityY > 900) ty.value = withTiming(height, { duration: DUR.base }, (d) => d && scheduleOnRN(onClose));
      else ty.value = withSpring(0, SPRING);
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(250)
    .onEnd((e, ok) => {
      if (!ok || e.y < insets.top + 70) return; // the close and mute buttons live up there
      const last = iRef.current >= cards.length - 1;
      // On cards with buttons only the far edges move, so the buttons can be tapped.
      if (last || cards[iRef.current].interactive) {
        if (e.x < width * 0.2) go(iRef.current - 1);
        else if (!last && e.x > width * 0.85) go(iRef.current + 1);
        return;
      }
      go(e.x < width / 3 ? iRef.current - 1 : iRef.current + 1);
    });
  const hold = Gesture.LongPress()
    .runOnJS(true)
    .minDuration(200)
    .onStart(() => setPaused(true))
    .onFinalize(() => setPaused(false));
  const gestures = Gesture.Race(pan, hold, tap);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }, { scale: 1 - Math.min(0.1, ty.value / 3000) }], borderRadius: Math.min(30, ty.value / 4) }));

  const hasMedia = card.media.some((id) => items.has(id));
  // Cards without a video of their own: your videos as rolling film or a flowing wall, in the card's colours.
  const sceneSources = useMemo(() => [...thumbs.values()].filter(Boolean).slice(0, 30) as NonNullable<VaultItem['thumbSource']>[], [thumbs]);
  // Built once per card (the deck re-renders often for its progress bar).
  const scene = useMemo(
    () =>
      !hasMedia && sceneSources.length > 0 ? (
        <Animated.View key={`sc${i}`} entering={FadeIn.duration(DUR.slow)} style={StyleSheet.absoluteFill} pointerEvents="none">
          {i % 3 === 1 ? <ImageRiver sources={sceneSources} columns={2} aspect={0.62} tilt={-8} speed={1.2} /> : <FilmStrips sources={sceneSources} count={i % 3 === 0 ? 3 : 2} frame={i % 3 === 0 ? 84 : 110} />}
          <Tint colors={card.colors} strength={0.62} />
        </Animated.View>
      ) : null,
    [hasMedia, sceneSources, i, card.colors]
  );
  // A card with a video shows it: light scrims only, the words at the bottom.
  const videoFirst = hasMedia && card.focus !== 'words';
  const [nowId, setNowId] = useState<string | null>(null);
  const nowItem = nowId ? items.get(nowId) : undefined;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
        <GestureDetector gesture={gestures}>
          <Animated.View style={[styles.story, sheetStyle]}>
            <Animated.View key={`bg${i}`} entering={FadeIn.duration(DUR.slow)} style={StyleSheet.absoluteFill}>
              <Aurora colors={card.colors} width={width} height={height} />
            </Animated.View>
            {scene}
            <StoryMedia card={card} items={items} starts={starts} enableVideo={enableVideo} muted={muted} paused={paused} onCurrent={setNowId} />
            {videoFirst && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  // A plain dark shade where the words sit: the video keeps its own colours.
                  gradient('linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0.05) 42%, rgba(0,0,0,0.62) 72%, rgba(0,0,0,0.85) 100%)', 'rgba(0,0,0,0.25)'),
                ]}
              />
            )}
            {hasMedia && !videoFirst && (
              <View style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.55) 50%, rgba(0,0,0,0.82) 100%)', 'rgba(0,0,0,0.55)')]} />
            )}
            {card.backdrop && (
              <Animated.View key={`bd${i}`} entering={FadeIn.duration(DUR.slow)} style={StyleSheet.absoluteFill} pointerEvents="none">
                {card.backdrop}
              </Animated.View>
            )}
            {!videoFirst && <Fade color="0,0,0" from={0} to={0.35} style={StyleSheet.absoluteFill} />}
            {videoFirst && nowItem && (
              <Animated.View key={`now${nowId}`} entering={FadeIn.duration(DUR.slow)} style={[styles.nowWrap, { top: insets.top + 22 }]}>
                <TouchableOpacity
                  style={styles.nowChip}
                  disabled={!onOpenVideo}
                  onPress={() => onOpenVideo?.(nowItem.id)}
                  accessibilityLabel={`Playing ${friendlyName(nowItem)}${onOpenVideo ? '. Tap to watch it' : ''}`}>
                  <View style={styles.nowDot} />
                  <Text style={styles.nowText} numberOfLines={1}>
                    {friendlyName(nowItem)}
                  </Text>
                  {onOpenVideo && <Icon name="forward" size={11} color="rgba(255,255,255,0.8)" />}
                </TouchableOpacity>
              </Animated.View>
            )}
            <View style={[styles.bars, { top: insets.top + 8 }]}>
              {cards.map((c, n) => (
                <View key={c.key} style={styles.bar}>
                  <View style={[styles.barFill, { width: n < i ? '100%' : n === i ? `${(elapsed / card.ms) * 100}%` : '0%' }]} />
                </View>
              ))}
            </View>
            <View style={[styles.storyTop, { top: insets.top + 20 }]}>
              {hasMedia && enableVideo && (
                <IconButton icon={muted ? 'muted' : 'sound'} label={muted ? 'Sound on' : 'Mute'} clear color="#fff" onPress={() => setMuted((m) => !m)} size={36} />
              )}
              <IconButton icon="close" label="Close" clear color="#fff" onPress={onClose} size={36} />
            </View>
            <Animated.View
              key={`b${i}`}
              entering={reduce ? undefined : bodyIn}
              style={[styles.storyBody, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + (videoFirst ? 64 : 40) }, videoFirst && { justifyContent: 'flex-end' }]}>
              {card.body}
            </Animated.View>
            {paused && (
              <Animated.View entering={FadeIn.duration(DUR.fast)} style={[styles.pausePill, { bottom: insets.bottom + 18 }]}>
                <Icon name="pause" size={12} color="#fff" />
                <Text style={styles.pauseText}>Paused</Text>
              </Animated.View>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    tqOpt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 18, paddingVertical: 15, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)' },
    tqRight: { backgroundColor: '#fff', borderColor: '#fff' },
    tqWrong: { backgroundColor: 'rgba(255,69,58,0.55)', borderColor: '#FF453A' },
    tqText: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800' },
    sReview: { marginTop: 12, padding: 16, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.38)', gap: 8 },
    sReviewText: { color: '#fff', fontSize: 18, lineHeight: 25, fontWeight: '600', fontStyle: 'italic' },
    sReviewBy: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '800' },
    sTvn: { marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.35)', gap: 8 },
    sTvnRow: { flexDirection: 'row', alignItems: 'center' },
    sTvnHead: { flex: 1, textAlign: 'right', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
    sTvnLabel: { flex: 1.3, color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
    sTvnValue: { flex: 1, textAlign: 'right', color: '#fff', fontSize: 17, fontWeight: '900' },
    sTvnPair: { flexDirection: 'row', gap: 10, marginTop: 12 },
    sTvnThumb: { height: 86, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)' },
    sTvnCap: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '800' },
    sClubMonth: { width: '100%', aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    bleed: { marginHorizontal: -16 },
    sectionRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10, flexWrap: 'wrap' },
    section: { color: p.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
    sectionDetail: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17 },

    yearCard: { borderRadius: 28, overflow: 'hidden', padding: 20, justifyContent: 'space-between', backgroundColor: '#5E5CE6' },
    yearTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    yearKicker: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    yearTitle: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
    yearBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 76 },
    yearTicker: { position: 'absolute', left: 0, right: 0, opacity: 0.08 },
    yearTickerText: { color: '#fff', fontSize: 64, fontWeight: '900', letterSpacing: -2 },
    yearBarLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '800' },

    heroCard: { borderRadius: 24, overflow: 'hidden', padding: 18, gap: 18, justifyContent: 'space-between', backgroundColor: '#5E5CE6' },
    heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
    heroKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 0.8, flex: 1 },
    heroPlay: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
    heroPlaySmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
    heroValue: { color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: -2 },
    weekHeroValue: { color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: -1.5 },
    heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '700' },

    weekRow: { gap: 10, paddingHorizontal: 16 },
    month: { width: 120, height: 150, borderRadius: 20, padding: 12, justifyContent: 'flex-end', overflow: 'hidden', backgroundColor: p.elevated },
    monthName: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    monthValue: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
    week: { width: 150, height: 176, borderRadius: 20, padding: 14, justifyContent: 'flex-end', gap: 2, overflow: 'hidden' },
    spark: { position: 'absolute', top: 14, left: 14, right: 14, height: 30, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
    sparkBar: { flex: 1, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.8)' },
    weekLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '800' },
    weekValue: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
    weekSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700' },

    presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    preset: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
    presetText: { color: p.text, fontSize: 14, fontWeight: '700' },
    card: { backgroundColor: p.elevated, borderRadius: 20, padding: 16, gap: 12 },
    cardTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rangeBtn: { flex: 1, backgroundColor: p.card, borderRadius: 12, padding: 10, borderWidth: 2, borderColor: 'transparent' },
    rangeOn: { borderColor: p.accent },
    rangeKey: { color: p.textSecondary, fontSize: 11, fontWeight: '700' },
    rangeVal: { color: p.text, fontSize: 15, fontWeight: '700' },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: p.accent, borderRadius: 14, paddingVertical: 14 },
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

    story: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', backgroundColor: '#000' },
    sTicker: { position: 'absolute', left: 0, right: 0, opacity: 0.1 },
    sSprint: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    sSprintCell: { width: '22%', alignItems: 'center', gap: 4 },
    sSprintThumb: { width: '100%', aspectRatio: 0.8, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' },
    sSprintLabel: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
    sTickerText: { color: '#fff', fontSize: 96, fontWeight: '900', letterSpacing: -3 },
    sRankRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sPolaroid: { backgroundColor: '#fff', padding: 6, paddingBottom: 20, borderRadius: 6 },
    sPolaroidImg: { width: 96, height: 120, borderRadius: 3, backgroundColor: '#333' },
    sListRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 16, padding: 8 },
    sListRank: { color: '#fff', fontSize: 26, fontWeight: '900', width: 26, textAlign: 'center' },
    sListThumb: { width: 54, height: 54, borderRadius: 10 },
    sListTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    sListSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
    sStrip: { flexDirection: 'row', gap: 6 },
    sStripItem: { flex: 1, aspectRatio: 0.75, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
    sStripRank: { position: 'absolute', left: 6, bottom: 2, color: '#fff', fontSize: 18, fontWeight: '900' },
    qOpt: { borderRadius: 16, overflow: 'hidden', borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.3)' },
    qRight: { borderColor: '#30D158', borderWidth: 4 },
    qWrong: { borderColor: '#FF453A' },
    qBadge: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' },
    bars: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 3, zIndex: 2 },
    bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    barFill: { height: 3, backgroundColor: '#fff' },
    storyTop: { position: 'absolute', right: 12, zIndex: 3, flexDirection: 'row', gap: 8 },
    nowWrap: { position: 'absolute', left: 14, right: 100, zIndex: 3, alignItems: 'flex-start' },
    nowChip: { flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: '100%', backgroundColor: 'rgba(0,0,0,0.42)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
    nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#30D158' },
    nowText: { color: '#fff', fontSize: 13, fontWeight: '800', flexShrink: 1 },
    sAgeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    sAgeCell: { flex: 1, alignItems: 'center', gap: 5 },
    sAgeThumb: { width: '100%', aspectRatio: 0.8, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)' },
    sAgeYear: { color: '#fff', fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
    sMeter: { flexDirection: 'row', gap: 5, marginTop: 6 },
    sMeterCell: { flex: 1, height: 34, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.16)' },
    sClubs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    sClub: { width: '48%', flexGrow: 1, gap: 6, padding: 11, borderRadius: 16, borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.09)' },
    sClubName: { color: '#fff', fontSize: 14, fontWeight: '900' },
    sClubTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
    sClubFill: { height: 4, borderRadius: 2 },
    storyBody: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
    sKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '900', letterSpacing: 1.4 },
    sHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', marginTop: 20 },
    sHuge: { color: '#fff', fontSize: 78, fontWeight: '900', letterSpacing: -3, lineHeight: 82 },
    sBig: { color: '#fff', fontSize: 44, fontWeight: '900', letterSpacing: -1.5, lineHeight: 48 },
    sRank: { color: '#fff', fontSize: 120, fontWeight: '900', letterSpacing: -6, lineHeight: 124 },
    sLine: { color: 'rgba(255,255,255,0.94)', fontSize: 18, fontWeight: '600', lineHeight: 25 },
    sBarHead: { flexDirection: 'row', justifyContent: 'space-between' },
    sBarLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
    sBarValue: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700' },
    sBarTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
    sBarFill: { height: 10, borderRadius: 5, backgroundColor: '#fff' },
    sDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end', marginTop: 8 },
    sDot: { width: 22, height: 22, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.18)' },
    sDotOn: { backgroundColor: '#fff' },
    sMonthBar: { width: 18, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.9)' },
    sSplit: { flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', gap: 3, marginTop: 8 },
    sSplitA: { backgroundColor: '#fff' },
    sSplitB: { backgroundColor: 'rgba(255,255,255,0.4)' },
    sLegend: { flexDirection: 'row', gap: 16 },
    sLegendText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    sHeroThumb: { borderRadius: 20, overflow: 'hidden', marginVertical: 6, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 3, borderColor: '#FFD60A' },
    sCrown: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFD60A', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    sCrownText: { color: '#000', fontSize: 14, fontWeight: '900' },
    sIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    sChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    sChip: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    sChipText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    sMedals: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
    sMedal: { width: 86, alignItems: 'center', gap: 6 },
    sMedalText: { color: '#fff', fontSize: 12, fontWeight: '800', textAlign: 'center' },
    sButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 10 },
    sButtonText: { color: '#000', fontSize: 15, fontWeight: '800' },
    sSummary: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 26, padding: 18, gap: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
    sSummaryHead: { flexDirection: 'row', gap: 14, alignItems: 'center' },
    sSummaryThumb: { width: 76, height: 76, borderRadius: 16 },
    sSummaryTitle: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
    sGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    sGridCell: { width: '47%', flexGrow: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 12 },
    sGridValue: { color: '#fff', fontSize: 22, fontWeight: '900' },
    sGridLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700' },
    sShare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 14, paddingHorizontal: 34, marginTop: 14, alignSelf: 'center' },
    sShareText: { color: '#000', fontSize: 16, fontWeight: '800' },
    pausePill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    pauseText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  });
