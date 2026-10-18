/**
 * Memories: little films made from your videos, like the Photos app's.
 *
 * The tab shows a "For you" carousel (on this day, your latest trip, a big
 * day…), then rows of moments, themes, months and seasons, and years. A
 * memory plays full screen: a title card over a wall of its covers, then
 * each video as a short clip with its sound, a caption saying when it was
 * filmed, and an end card to replay, favourite, share or hide it. Three moods
 * change how it plays: Gentle (long clips, slow fades, warm), Upbeat (quick
 * cuts with a punch) and Epic (cinema bars, big titles).
 * Hold to pause, tap the sides to skip, drag down to close.
 * Presentational only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { memoryClips, memoryLength, memorySections, MOODS, type Clip, type Memory, type Mood } from '../memories';
import { friendlyName } from '../names';
import Fade from './Fade';
import { success, tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import { gradient, SectionTitle } from './insightParts';
import { DUR, EASE_OUT, enterUp, PressableScale, SPRING, useReducedMotion } from './motion';
import { Aurora, CoverWall, Float, hexA, KenBurns, Letterbox, Pulse, Tilt, Words } from './storyKit';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

type Thumbs = Map<string, VaultItem['thumbSource']>;

/** A colour pair per kind of memory. */
export const TONES: [string, string][] = [
  ['#FF9F0A', '#3A1400'],
  ['#0A84FF', '#001A3D'],
  ['#FF375F', '#33020F'],
  ['#30D158', '#012A12'],
  ['#BF5AF2', '#22053A'],
  ['#FFB340', '#3A2A00'],
  ['#64D2FF', '#012738'],
  ['#FF6482', '#3A0716'],
  ['#FFD60A', '#3B1E00'],
  ['#5E5CE6', '#0E0B3A'],
  ['#AC8E68', '#1E160C'],
];
const toneOf = (m: Memory) => TONES[m.tone % TONES.length];
const longDate = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const spanText = (m: Memory) => {
  const a = new Date(m.start);
  const b = new Date(m.end);
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  if (a.toDateString() === b.toDateString()) return a.toLocaleDateString(undefined, o);
  if (a.getFullYear() !== b.getFullYear()) return `${a.getFullYear()} – ${b.getFullYear()}`;
  return `${a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString(undefined, o)}`;
};
const agoText = (t: number) => {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365.25);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
};
const bigNumber = (m: Memory) => (m.kind === 'onThisDay' ? m.title.match(/^\d+/)?.[0] ?? null : m.kind === 'year' ? String(new Date(m.start).getFullYear()).slice(2) : null);

/* -------------------------------------------------------------- the tab */

export function MemoriesTab({
  list,
  items,
  thumbs,
  favs,
  hidden,
  onPlay,
  onFav,
  onUnhideAll,
}: {
  list: Memory[];
  items: Map<string, VaultItem>;
  thumbs: Thumbs;
  favs: string[];
  hidden: string[];
  onPlay: (m: Memory) => void;
  onFav: (id: string) => void;
  onUnhideAll: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const s = useMemo(() => memorySections(list, hidden, favs), [list, hidden, favs]);
  const [page, setPage] = useState(0);
  const cardW = width - 32;

  if (!s.featured.length)
    return (
      <Animated.View entering={enterUp(0)} style={styles.empty}>
        <Float>
          <View style={styles.emptyIcon}>
            <Icon name="memories" size={34} color="#fff" />
          </View>
        </Float>
        <Text style={styles.emptyTitle}>Your memories will show up here</Text>
        <Text style={styles.emptyText}>As your library grows, ReelVault turns your videos into little films: trips, big days, on this day, the best of each month and season, and more.</Text>
        {hidden.length > 0 && (
          <TouchableOpacity onPress={onUnhideAll}>
            <Text style={[styles.link, { color: p.accent }]}>Show {hidden.length} hidden</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    );

  const row = (title: string, detail: string, ms: Memory[], kind: 'tall' | 'wide' | 'mosaic', i: number) =>
    ms.length > 0 && (
      <Animated.View entering={enterUp(i)} style={{ gap: 10 }}>
        <SectionTitle title={title} detail={detail} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.row} decelerationRate="fast" snapToInterval={kind === 'tall' ? 162 : 232}>
          {ms.map((m, n) => (
            <MemoryTile key={m.id} m={m} kind={kind} index={n} thumbs={thumbs} fav={favs.includes(m.id)} onPress={() => onPlay(m)} />
          ))}
        </ScrollView>
      </Animated.View>
    );

  return (
    <>
      <Animated.View entering={enterUp(0)} style={{ gap: 10 }}>
        <View style={styles.forYouHead}>
          <Text style={styles.forYou}>For you</Text>
          <Text style={styles.forYouSub}>{list.length - hidden.filter((h) => list.some((m) => m.id === h)).length} memories</Text>
        </View>
        <ScrollView
          horizontal
          pagingEnabled={false}
          snapToInterval={cardW + 10}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          style={styles.bleed}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardW + 10)))}
          scrollEventThrottle={32}>
          {s.featured.map((m, n) => (
            <FeaturedCard key={m.id} m={m} width={cardW} thumbs={thumbs} items={items} fav={favs.includes(m.id)} active={n === page} onPress={() => onPlay(m)} onFav={() => onFav(m.id)} />
          ))}
        </ScrollView>
        <View style={styles.dots}>
          {s.featured.map((m, n) => (
            <Dot key={m.id} on={n === page} />
          ))}
        </View>
      </Animated.View>
      {row('Favourite memories', 'The ones you saved', s.favourites, 'wide', 1)}
      {row('On this day', 'From earlier years', s.onThisDay, 'wide', 2)}
      {row('Moments', 'Trips and big days', s.moments, 'tall', 3)}
      {row('Themes', 'From your tags, ratings and plays', s.themes, 'mosaic', 4)}
      {row('Months & seasons', 'The best of each', s.months, 'tall', 5)}
      {row('Years', 'Whole years, in a minute or two', s.years, 'mosaic', 6)}
      <Text style={styles.foot}>
        Memories are made on your phone from when and where your videos were filmed, their tags and your ratings. Nothing leaves the phone.
        {hidden.length ? ' ' : ''}
      </Text>
      {hidden.length > 0 && (
        <TouchableOpacity onPress={onUnhideAll} style={{ alignSelf: 'center' }}>
          <Text style={[styles.link, { color: p.accent }]}>Show {hidden.length} hidden {hidden.length === 1 ? 'memory' : 'memories'}</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

function Dot({ on }: { on: boolean }) {
  const p = usePalette();
  const w = useSharedValue(on ? 18 : 6);
  useEffect(() => {
    w.value = withSpring(on ? 18 : 6, SPRING);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ width: w.value }));
  return <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: on ? p.text : p.textMuted, opacity: on ? 1 : 0.5 }, anim]} />;
}

/** The big carousel card: the cover moving slowly, its title, a play button. */
function FeaturedCard({ m, width, thumbs, items, fav, active, onPress, onFav }: { m: Memory; width: number; thumbs: Thumbs; items: Map<string, VaultItem>; fav: boolean; active: boolean; onPress: () => void; onFav: () => void }) {
  const styles = useStyles(makeStyles);
  const [a, b] = toneOf(m);
  const h = Math.min(480, width * 1.22);
  const num = bigNumber(m);
  const extra = m.videoIds.filter((id) => id !== m.coverId).slice(0, 3);
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[styles.featured, { width, height: h, backgroundColor: b }]} accessibilityRole="button" accessibilityLabel={`${m.title}. ${m.subtitle}. Play memory`}>
      <KenBurns key={active ? 'on' : 'off'} source={thumbs.get(m.coverId)} ms={14000} seed={m.title.length} />
      <View style={[StyleSheet.absoluteFill, gradient(`linear-gradient(180deg, ${hexA(b, 0)} 30%, ${hexA(b, 0.55)} 62%, ${hexA(b, 0.96)} 100%)`, hexA(b, 0.4))]} />
      {num && (
        <Text style={[styles.bigNum, { color: hexA(a, 0.9) }]} numberOfLines={1}>
          {num}
        </Text>
      )}
      <View style={styles.featuredTop}>
        <View style={[styles.kickerChip, { backgroundColor: hexA(a, 0.92) }]}>
          <Text style={styles.kickerChipText}>{m.kicker}</Text>
        </View>
        <TouchableOpacity onPress={onFav} hitSlop={10} accessibilityLabel={fav ? 'Remove from favourites' : 'Add to favourites'} style={styles.heart}>
          <Icon name={fav ? 'heart' : 'heartOff'} size={18} color={fav ? '#FF375F' : '#fff'} />
        </TouchableOpacity>
      </View>
      <View style={styles.featuredBottom}>
        <View style={styles.stack}>
          {extra.map((id, i) => (
            <Image key={id} source={thumbs.get(id)} style={[styles.stackImg, { marginLeft: i ? -12 : 0, transform: [{ rotate: `${(i - 1) * 6}deg` }] }]} contentFit="cover" />
          ))}
          {m.videoIds.length > extra.length + 1 && <Text style={styles.stackMore}>+{m.videoIds.length - extra.length - 1}</Text>}
        </View>
        <Text style={styles.featuredTitle} numberOfLines={2}>
          {m.title}
        </Text>
        <View style={styles.featuredFoot}>
          <Text style={styles.featuredSub} numberOfLines={1}>
            {m.subtitle}
          </Text>
          <Pulse>
            <View style={styles.playBtn}>
              <Icon name="play" size={18} color="#000" />
            </View>
          </Pulse>
        </View>
        {items.get(m.coverId) && (
          <Text style={styles.featuredCaption} numberOfLines={1}>
            {MOODS[m.mood].label} mood · {m.videoIds.length} {m.videoIds.length === 1 ? 'clip' : 'clips'}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

/** A card in a row: tall (one cover), wide, or a mosaic of four covers. */
function MemoryTile({ m, kind, index, thumbs, fav, onPress }: { m: Memory; kind: 'tall' | 'wide' | 'mosaic'; index: number; thumbs: Thumbs; fav: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const [a, b] = toneOf(m);
  const size = kind === 'tall' ? { width: 152, height: 214 } : { width: 222, height: 160 };
  const four = [m.coverId, ...m.videoIds.filter((id) => id !== m.coverId)].slice(0, 4);
  const num = bigNumber(m);
  return (
    <Animated.View entering={FadeInDown.delay(80 + Math.min(index, 6) * 60).duration(DUR.slow).easing(EASE_OUT)}>
      <PressableScale onPress={onPress} style={[styles.tile, size, { backgroundColor: b }]} accessibilityRole="button" accessibilityLabel={`${m.title}. ${m.subtitle}`}>
        {kind === 'mosaic' && four.length >= 3 ? (
          <View style={styles.mosaic}>
            {four.map((id, i) => (
              <Image key={id} source={thumbs.get(id)} style={[styles.mosaicImg, four.length === 3 && i === 0 && { width: '100%' }]} contentFit="cover" />
            ))}
          </View>
        ) : (
          <Image source={thumbs.get(m.coverId)} style={StyleSheet.absoluteFill} contentFit="cover" />
        )}
        <View style={[StyleSheet.absoluteFill, gradient(`linear-gradient(180deg, ${hexA(b, 0)} 25%, ${hexA(b, 0.7)} 55%, ${hexA(b, 0.97)} 100%)`, hexA(b, 0.4))]} />
        {num && <Text style={[styles.tileNum, { color: hexA(a, 0.92) }]}>{num}</Text>}
        {fav && (
          <View style={styles.tileHeart}>
            <Icon name="heart" size={12} color="#FF375F" />
          </View>
        )}
        <View style={styles.tileText}>
          <View style={styles.tileKickerRow}>
            <View style={[styles.tileDot, { backgroundColor: a }]} />
            <Text style={styles.tileKicker} numberOfLines={1}>
              {m.kicker}
            </Text>
          </View>
          <Text style={styles.tileTitle} numberOfLines={2}>
            {m.title}
          </Text>
          <Text style={styles.tileSub} numberOfLines={1}>
            {spanText(m)}
          </Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

/* ------------------------------------------------------------ the player */

const TITLE_MS = 3600;

/** One video player that moves from clip to clip, with the sound fading in. */
function ClipMedia({ clip, item, thumb, enableVideo, muted, paused, mood, seed }: { clip: Clip | null; item: VaultItem | undefined; thumb: VaultItem['thumbSource'] | undefined; enableVideo: boolean; muted: boolean; paused: boolean; mood: Mood; seed: number }) {
  const reduce = useReducedMotion();
  const player = useVideoPlayer(null, (pl) => {
    pl.loop = true;
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!enableVideo || !clip || !item?.uri) {
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
        player.currentTime = clip.startMs / 1000;
        if (!paused) player.play();
        setTimeout(() => live && setReady(true), 220);
        let v = 0;
        const step = mood === 'upbeat' ? 0.25 : 0.08;
        fade = setInterval(() => {
          v = Math.min(1, v + step);
          player.volume = v;
          if (v >= 1 && fade) clearInterval(fade);
        }, 45);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (fade) clearInterval(fade);
    };
  }, [clip?.videoId, clip?.startMs, enableVideo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enableVideo) return;
    if (paused) player.pause();
    else if (clip && item?.uri) player.play();
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Upbeat cuts land with a little punch; Gentle drifts in slowly.
  const punch = useSharedValue(1);
  useEffect(() => {
    if (reduce || !clip) return;
    punch.value = mood === 'upbeat' ? withSequence(withTiming(1.1, { duration: 1 }), withSpring(1, { damping: 12, stiffness: 180 })) : withSequence(withTiming(1, { duration: 1 }), withTiming(1.06, { duration: clip.ms, easing: EASE_OUT }));
  }, [clip?.videoId, mood]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoom = useAnimatedStyle(() => ({ transform: [{ scale: punch.value }] }));
  const fadeMs = reduce ? 0 : MOODS[mood].fadeMs;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {enableVideo && (
        <Animated.View style={[StyleSheet.absoluteFill, zoom]}>
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        </Animated.View>
      )}
      {clip && (!enableVideo || !ready) && (
        <Animated.View key={clip.videoId} entering={FadeIn.duration(fadeMs)} exiting={FadeOut.duration(fadeMs)} style={StyleSheet.absoluteFill}>
          <KenBurns source={thumb} ms={clip.ms + 1200} seed={seed} />
        </Animated.View>
      )}
    </View>
  );
}

export function MemoryPlayer({
  memory: m,
  items,
  thumbs,
  enableVideo,
  fav,
  loadBookmarks,
  onFav,
  onHide,
  onOpenVideo,
  onClose,
}: {
  memory: Memory;
  items: Map<string, VaultItem>;
  thumbs: Thumbs;
  enableVideo: boolean;
  fav: boolean;
  loadBookmarks: (videoId: string) => Promise<number[]>;
  onFav: () => void;
  onHide: () => void;
  onOpenVideo: (id: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const [a, b] = toneOf(m);
  const [mood, setMood] = useState<Mood>(m.mood);
  const [marks, setMarks] = useState<Map<string, number[]>>(new Map());
  useEffect(() => {
    Promise.all(m.videoIds.map((id) => loadBookmarks(id).then((l) => [id, l] as const).catch(() => [id, [] as number[]] as const)))
      .then((l) => setMarks(new Map(l)))
      .catch(() => undefined);
  }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const clips = useMemo(() => memoryClips(m, items, mood, marks), [m, items, mood, marks]);

  // -1 = the title card, clips.length = the end card. The preview can open a step: `&card=2`.
  const previewCard = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('card') : null;
  const [i, setI] = useState(() => (previewCard !== null ? Math.min(clips.length, Number(previewCard) - 1) : -1));
  const [paused, setPaused] = useState(previewCard !== null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const iRef = useRef(i);
  iRef.current = i;
  const ended = i >= clips.length;
  const durOf = (n: number) => (n < 0 ? TITLE_MS : n < clips.length ? clips[n].ms : Infinity);

  const go = (n: number) => {
    if (n < -1) return setElapsed(0);
    if (n > clips.length) return onClose();
    if (n === clips.length) success();
    else tick();
    setElapsed(0);
    setI(n);
  };
  useEffect(() => {
    if (paused || ended) return;
    const id = setInterval(() => {
      setElapsed((e) => {
        const next = e + 50;
        if (next >= durOf(iRef.current)) {
          setTimeout(() => go(iRef.current + 1), 0);
          return 0;
        }
        return next;
      });
    }, 50);
    return () => clearInterval(id);
  }, [paused, ended, clips.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (!ok || e.y < insets.top + 70) return;
      if (iRef.current >= clips.length) {
        if (e.x < width * 0.2) go(iRef.current - 1);
        return;
      }
      if (e.y > height - insets.bottom - 110 && e.x > width * 0.6) return; // the Open button
      go(e.x < width / 3 ? iRef.current - 1 : iRef.current + 1);
    });
  const hold = Gesture.LongPress()
    .runOnJS(true)
    .minDuration(200)
    .onStart(() => setPaused(true))
    .onFinalize(() => setPaused(false));
  const gestures = Gesture.Race(pan, hold, tap);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }, { scale: 1 - Math.min(0.1, ty.value / 3000) }], borderRadius: Math.min(30, ty.value / 4) }));

  const clip = i >= 0 && i < clips.length ? clips[i] : null;
  const item = clip ? items.get(clip.videoId) : undefined;
  const epic = mood === 'epic';
  const titleFont = mood === 'gentle' ? styles.serif : epic ? styles.wide : null;
  const covers = m.videoIds.map((id) => thumbs.get(id));
  const cycleMood = () => {
    const order: Mood[] = ['gentle', 'upbeat', 'epic'];
    setMood(order[(order.indexOf(mood) + 1) % order.length]);
    tick();
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
        <GestureDetector gesture={gestures}>
          <Animated.View style={[styles.player, sheetStyle]}>
            <Aurora colors={[a, b]} width={width} height={height} />
            <ClipMedia clip={clip} item={item} thumb={clip ? thumbs.get(clip.videoId) : undefined} enableVideo={enableVideo} muted={muted} paused={paused} mood={mood} seed={i} />
            {mood === 'gentle' && clip && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,160,80,0.08)' }]} />}
            {clip && <Fade color="0,0,0" from={0} to={0.75} style={[StyleSheet.absoluteFill, { top: '55%' }]} />}
            <Fade color="0,0,0" from={0.45} to={0} style={[StyleSheet.absoluteFill, { bottom: '78%' }]} />
            <Letterbox on={epic && !!clip} size={Math.round(height * 0.085)} />

            {/* title */}
            {i === -1 && (
              <View style={StyleSheet.absoluteFill} key={`t${mood}`}>
                <CoverWall sources={covers} opacity={0.42} />
                <View style={[StyleSheet.absoluteFill, gradient(`radial-gradient(circle at 50% 55%, ${hexA(b, 0.35)} 0%, ${hexA(b, 0.92)} 75%)`, hexA(b, 0.6))]} />
                <View style={[styles.center, { paddingTop: insets.top + 40 }]}>
                  <Tilt rotate={-3} delay={150}>
                    <View style={styles.titleCover}>
                      <Image source={thumbs.get(m.coverId)} style={StyleSheet.absoluteFill} contentFit="cover" />
                    </View>
                  </Tilt>
                  <Animated.Text entering={FadeIn.delay(300).duration(DUR.slow)} style={[styles.pKicker, { color: a }]}>
                    {m.kicker}
                  </Animated.Text>
                  <Words text={m.title} style={[styles.pTitle, titleFont]} delay={420} />
                  <Animated.Text entering={FadeInDown.delay(900).duration(DUR.slow)} style={styles.pSub}>
                    {spanText(m)} · {clips.length} {clips.length === 1 ? 'clip' : 'clips'} · {memoryLength(clips)}
                  </Animated.Text>
                </View>
              </View>
            )}

            {/* caption over a clip */}
            {clip && item && (
              <View style={[styles.caption, { bottom: insets.bottom + (epic ? height * 0.085 + 12 : 28) }]} pointerEvents="box-none">
                <Animated.View key={clip.videoId} entering={FadeInDown.duration(DUR.slow).easing(EASE_OUT)} style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.capWhen, { color: a }]}>{agoText(item.createdAt).toUpperCase()}</Text>
                  <Text style={[styles.capTitle, titleFont]} numberOfLines={2}>
                    {friendlyName(item)}
                  </Text>
                  <Text style={styles.capDate}>{longDate(item.createdAt)}</Text>
                </Animated.View>
                <TouchableOpacity style={styles.openBtn} onPress={() => onOpenVideo(item.id)} accessibilityLabel="Open this video">
                  <Icon name="play" size={12} color="#000" />
                  <Text style={styles.openText}>Open</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* the end */}
            {ended && (
              <View style={StyleSheet.absoluteFill}>
                <CoverWall sources={covers} opacity={0.3} tilt={10} />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(b, 0.78) }]} />
                <View style={[styles.center, { paddingTop: insets.top + 50 }]}>
                  <Animated.Text entering={FadeIn.duration(DUR.slow)} style={[styles.pKicker, { color: a }]}>
                    THE END
                  </Animated.Text>
                  <Words text={m.title} style={[styles.pTitle, titleFont]} delay={150} />
                  <Animated.Text entering={FadeInDown.delay(500).duration(DUR.slow)} style={styles.pSub}>
                    {m.total} {m.total === 1 ? 'video' : 'videos'} · {spanText(m)}
                  </Animated.Text>
                  <Animated.View entering={FadeInDown.delay(700).duration(DUR.slow)} style={styles.endRow}>
                    <EndButton icon="rewatch" label="Replay" onPress={() => go(-1)} />
                    <EndButton icon={fav ? 'heart' : 'heartOff'} label={fav ? 'Saved' : 'Favourite'} tint={fav ? '#FF375F' : undefined} onPress={onFav} />
                    <EndButton
                      icon="share"
                      label="Share"
                      onPress={() => void Share.share({ message: `A memory from ReelVault: ${m.title} (${spanText(m)}), ${m.total} ${m.total === 1 ? 'video' : 'videos'}.` })}
                    />
                    <EndButton
                      icon="eyeOff"
                      label="Hide"
                      onPress={() => {
                        onHide();
                        onClose();
                      }}
                    />
                  </Animated.View>
                </View>
              </View>
            )}

            <View style={[styles.bars, { top: insets.top + 8 }]}>
              {[-1, ...clips.map((_, n) => n)].map((n) => (
                <View key={n} style={styles.bar}>
                  <View style={[styles.barFill, { width: n < i ? '100%' : n === i ? `${Math.min(100, (elapsed / durOf(n)) * 100)}%` : '0%' }]} />
                </View>
              ))}
            </View>
            <View style={[styles.top, { top: insets.top + 20 }]}>
              <TouchableOpacity onPress={cycleMood} style={styles.moodChip} accessibilityLabel={`Mood: ${MOODS[mood].label}. Change`}>
                <Icon name="wand" size={13} color="#fff" />
                <Text style={styles.moodText}>{MOODS[mood].label}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              {enableVideo && <IconButton icon={muted ? 'muted' : 'sound'} label={muted ? 'Sound on' : 'Mute'} clear color="#fff" onPress={() => setMuted((x) => !x)} size={36} />}
              <IconButton icon="close" label="Close" clear color="#fff" onPress={onClose} size={36} />
            </View>
            {paused && !ended && (
              <Animated.View entering={FadeIn.duration(DUR.fast)} style={[styles.pausePill, { top: insets.top + 66 }]}>
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

function EndButton({ icon, label, tint, onPress }: { icon: 'rewatch' | 'heart' | 'heartOff' | 'share' | 'eyeOff'; label: string; tint?: string; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <PressableScale onPress={onPress} style={styles.endBtn} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.endIcon}>
        <Icon name={icon} size={20} color={tint ?? '#fff'} />
      </View>
      <Text style={styles.endLabel}>{label}</Text>
    </PressableScale>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    bleed: { marginHorizontal: -16 },
    row: { paddingHorizontal: 16, gap: 10 },
    forYouHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    forYou: { color: p.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.8 },
    forYouSub: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    dots: { flexDirection: 'row', gap: 5, alignSelf: 'center', alignItems: 'center' },
    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17, marginTop: 6 },
    link: { fontSize: 14, fontWeight: '700', paddingVertical: 8 },

    empty: { alignItems: 'center', gap: 12, paddingVertical: 50, paddingHorizontal: 20 },
    emptyIcon: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center', ...gradient('linear-gradient(135deg, #FF9F0A 0%, #FF375F 100%)') },
    emptyTitle: { color: p.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },

    featured: { borderRadius: 30, overflow: 'hidden', justifyContent: 'space-between' },
    featuredTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    kickerChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    kickerChipText: { color: '#000', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    heart: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    bigNum: { position: 'absolute', right: 18, top: 44, fontSize: 180, fontWeight: '900', letterSpacing: -10, lineHeight: 190, opacity: 0.85, mixBlendMode: 'overlay' } as never,
    featuredBottom: { padding: 18, gap: 6 },
    stack: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    stackImg: { width: 38, height: 50, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
    stackMore: { color: '#fff', fontSize: 13, fontWeight: '800', marginLeft: 8 },
    featuredTitle: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: -1, lineHeight: 35 },
    featuredFoot: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    featuredSub: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '700', flex: 1 },
    featuredCaption: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700' },
    playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },

    tile: { borderRadius: 22, overflow: 'hidden', justifyContent: 'flex-end' },
    mosaic: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
    mosaicImg: { width: '49.5%', height: '49.5%' } as never,
    tileNum: { position: 'absolute', right: 6, top: -4, fontSize: 78, fontWeight: '900', letterSpacing: -4, mixBlendMode: 'overlay' } as never,
    tileHeart: { position: 'absolute', top: 10, left: 10, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    tileText: { padding: 12, gap: 1 },
    tileKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    tileDot: { width: 6, height: 6, borderRadius: 3 },
    tileKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '900', letterSpacing: 1, flexShrink: 1 },
    tileTitle: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: -0.3, lineHeight: 20 },
    tileSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700' },

    player: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', backgroundColor: '#000' },
    center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
    titleCover: { width: 132, height: 176, borderRadius: 18, overflow: 'hidden', borderWidth: 4, borderColor: '#fff', marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.1)' },
    pKicker: { fontSize: 13, fontWeight: '900', letterSpacing: 1.6 },
    pTitle: { color: '#fff', fontSize: 42, fontWeight: '900', letterSpacing: -1.4, lineHeight: 46 },
    serif: { fontFamily: Platform.select({ ios: 'Georgia', default: 'Georgia, serif' }), fontWeight: '700', letterSpacing: -0.6, fontStyle: 'italic' },
    wide: { textTransform: 'uppercase', letterSpacing: 1, fontWeight: '900' },
    pSub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '700' },
    caption: { position: 'absolute', left: 22, right: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
    capWhen: { fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
    capTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
    capDate: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
    openBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    openText: { color: '#000', fontSize: 13, fontWeight: '800' },
    endRow: { flexDirection: 'row', gap: 10, marginTop: 18, flexWrap: 'wrap' },
    endBtn: { alignItems: 'center', gap: 6, width: 70 },
    endIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
    endLabel: { color: '#fff', fontSize: 12, fontWeight: '800' },
    bars: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 3, zIndex: 2 },
    bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    barFill: { height: 3, backgroundColor: '#fff' },
    top: { position: 'absolute', left: 14, right: 12, zIndex: 3, flexDirection: 'row', gap: 8, alignItems: 'center' },
    moodChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
    moodText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    pausePill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    pauseText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  });
