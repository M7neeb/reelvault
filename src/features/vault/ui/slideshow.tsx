/**
 * Slideshow: your videos one after another, full screen.
 *
 * First a setup page (order, how much of each video, transition, titles,
 * sound, repeat; remembered), then the show: two players take turns so each
 * video crossfades, zooms or slides into the next with no black gap, story
 * bars at the top, the video's name and date fading in, and taps to move on
 * (left / right third), pause (middle) or close (swipe down). The end card
 * offers Play again. In the browser preview the covers stand in for videos.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyName } from '../names';
import { highlightAt } from '../recap';
import { allowRotation, lockUpright } from '../rotate';
import { success, tick } from './haptics';
import Icon from './Icon';
import { gradient } from './insightParts';
import { PressableScale } from './motion';
import { Aurora, CoverWall, KenBurns, Words } from './storyKit';
import { DEFAULT_SLIDESHOW, type SlideshowOptions, type VaultItem } from './types';

const ORDERS: { key: SlideshowOptions['order']; label: string }[] = [
  { key: 'shown', label: 'As shown' },
  { key: 'shuffle', label: 'Shuffle' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'best', label: 'Best rated' },
];
const CLIPS: { key: number; label: string }[] = [
  { key: 0, label: 'Whole' },
  { key: 5, label: '5 s' },
  { key: 10, label: '10 s' },
  { key: 20, label: '20 s' },
  { key: 30, label: '30 s' },
  { key: 60, label: '1 min' },
];
const TRANSITIONS: { key: SlideshowOptions['transition']; label: string; icon: 'eye' | 'search' | 'forward' | 'close' }[] = [
  { key: 'fade', label: 'Fade', icon: 'eye' },
  { key: 'zoom', label: 'Zoom', icon: 'search' },
  { key: 'slide', label: 'Slide', icon: 'forward' },
  { key: 'none', label: 'Cut', icon: 'close' },
];

const FADE_MS = 700;

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ordered(items: VaultItem[], start: number, order: SlideshowOptions['order']): VaultItem[] {
  switch (order) {
    case 'shuffle':
      return shuffle(items);
    case 'oldest':
      return [...items].sort((a, b) => a.createdAt - b.createdAt);
    case 'best':
      return [...items].sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt);
    default:
      return [...items.slice(start), ...items.slice(0, start)];
  }
}

const fmtLength = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'under a minute' : m < 60 ? `about ${m} min` : `about ${Math.floor(m / 60)} h ${m % 60} min`;
};

export function SlideshowModal({
  items,
  startIndex,
  enableVideo,
  options = DEFAULT_SLIDESHOW,
  autoplay = false,
  onOptions,
  onOpenVideo,
  onClose,
}: {
  items: VaultItem[];
  startIndex: number;
  enableVideo: boolean;
  options?: SlideshowOptions;
  /** Skip the setup page (the browser preview). */
  autoplay?: boolean;
  onOptions?: (o: SlideshowOptions) => void;
  onOpenVideo?: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState(options);
  const [phase, setPhase] = useState<'setup' | 'play' | 'end'>(autoplay ? 'play' : 'setup');
  const [list, setList] = useState<VaultItem[]>(() => ordered(items, startIndex, opts.order));
  const [run, setRun] = useState(0);
  const set = (patch: Partial<SlideshowOptions>) => {
    tick();
    const next = { ...opts, ...patch };
    setOpts(next);
    onOptions?.(next);
  };
  // While it plays, the slideshow turns with the phone; the setup and end pages stay upright.
  useEffect(() => {
    if (phase === 'play') allowRotation();
    else lockUpright();
  }, [phase]);
  useEffect(() => lockUpright, []);
  const play = () => {
    success();
    setList(ordered(items, startIndex, opts.order));
    setRun((n) => n + 1);
    setPhase('play');
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        {phase === 'setup' && <Setup items={items} opts={opts} onSet={set} onPlay={play} onClose={onClose} />}
        {phase === 'play' && (
          <Show
            key={run}
            list={list}
            opts={opts}
            enableVideo={enableVideo}
            onSet={set}
            onSetup={() => setPhase('setup')}
            onEnd={() => (opts.repeat ? play() : setPhase('end'))}
            onOpenVideo={onOpenVideo}
            onClose={onClose}
          />
        )}
        {phase === 'end' && <EndCard list={list} onReplay={play} onSetup={() => setPhase('setup')} onClose={onClose} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

/* ------------------------------------------------------------------ setup */

function Chips<K extends string | number>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity key={String(o.key)} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(o.key)} accessibilityState={{ selected: on }}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Toggle({ label, icon, on, onPress }: { label: string; icon: 'sound' | 'rewatch' | 'edit'; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.toggle, on && styles.toggleOn]} onPress={onPress} accessibilityState={{ checked: on }}>
      <Icon name={icon} size={16} color={on ? '#000' : '#fff'} />
      <Text style={[styles.toggleText, on && { color: '#000' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Setup({ items, opts, onSet, onPlay, onClose }: { items: VaultItem[]; opts: SlideshowOptions; onSet: (p: Partial<SlideshowOptions>) => void; onPlay: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const total = items.reduce((a, v) => a + (opts.clipSec ? Math.min(opts.clipSec * 1000, v.durationMs ?? opts.clipSec * 1000) : (v.durationMs ?? 0)), 0);
  return (
    <View style={{ flex: 1 }}>
      <Aurora colors={['#2B1055', '#000000']} accent="#FF375F" width={width} height={height} />
      <View style={[StyleSheet.absoluteFill, { opacity: 0.35 }]}>
        <CoverWall sources={items.slice(0, 24).map((v) => v.thumbSource)} rows={5} tile={110} />
      </View>
      <View style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.75) 45%, rgba(0,0,0,0.95) 100%)', 'rgba(0,0,0,0.7)')]} />
      <ScrollView contentContainerStyle={[styles.setup, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 110 }]}>
        <View style={styles.setupTop}>
          <TouchableOpacity style={styles.round} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.setupKicker}>SLIDESHOW</Text>
        <Words text={`${items.length} ${items.length === 1 ? 'video' : 'videos'}`} style={styles.setupTitle} />
        <Text style={styles.setupSub}>{total > 0 ? fmtLength(total) : 'Ready when you are'}</Text>

        <Text style={styles.label}>Order</Text>
        <Chips options={ORDERS} value={opts.order} onChange={(order) => onSet({ order })} />
        <Text style={styles.label}>Of each video</Text>
        <Chips options={CLIPS} value={opts.clipSec} onChange={(clipSec) => onSet({ clipSec })} />
        <Text style={styles.hint}>{opts.clipSec ? 'The best part of each: around your bookmarks, else the middle.' : 'Every video plays to its end.'}</Text>
        <Text style={styles.label}>Between videos</Text>
        <View style={styles.chips}>
          {TRANSITIONS.map((t) => {
            const on = opts.transition === t.key;
            return (
              <TouchableOpacity key={t.key} style={[styles.trans, on && styles.chipOn]} onPress={() => onSet({ transition: t.key })}>
                <Icon name={t.icon} size={18} color={on ? '#000' : '#fff'} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.label}>Extras</Text>
        <View style={styles.chips}>
          <Toggle label="Titles" icon="edit" on={opts.titles} onPress={() => onSet({ titles: !opts.titles })} />
          <Toggle label="Sound" icon="sound" on={opts.sound} onPress={() => onSet({ sound: !opts.sound })} />
          <Toggle label="Repeat" icon="rewatch" on={opts.repeat} onPress={() => onSet({ repeat: !opts.repeat })} />
        </View>
      </ScrollView>
      <View style={[styles.playBar, { paddingBottom: insets.bottom + 16 }]}>
        <PressableScale style={styles.playBtn} onPress={onPlay} accessibilityLabel="Play the slideshow">
          <Icon name="play" size={20} color="#000" />
          <Text style={styles.playText}>Play</Text>
        </PressableScale>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------- show */

type Slot = 0 | 1;

function Show({
  list,
  opts,
  enableVideo,
  onSet,
  onSetup,
  onEnd,
  onOpenVideo,
  onClose,
}: {
  list: VaultItem[];
  opts: SlideshowOptions;
  enableVideo: boolean;
  onSet: (p: Partial<SlideshowOptions>) => void;
  onSetup: () => void;
  onEnd: () => void;
  onOpenVideo?: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState<Slot>(0);
  const [layer, setLayer] = useState<[number, number]>([0, list.length > 1 ? 1 : -1]);
  const [paused, setPaused] = useState(false);
  const [controls, setControls] = useState(true);
  const [titleKey, setTitleKey] = useState(0);
  const [progress, setProgress] = useState(0);

  const p0 = useVideoPlayer(null, (pl) => {
    pl.loop = false;
    pl.timeUpdateEventInterval = 0.25;
  });
  const p1 = useVideoPlayer(null, (pl) => {
    pl.loop = false;
    pl.timeUpdateEventInterval = 0.25;
  });
  const players: [VideoPlayer, VideoPlayer] = [p0, p1];

  const op = [useSharedValue(1), useSharedValue(0)];
  const sc = [useSharedValue(1), useSharedValue(1)];
  const tx = [useSharedValue(0), useSharedValue(0)];
  const drag = useSharedValue(0);

  const st = useRef({ index: 0, active: 0 as Slot, busy: false, ends: [0, 0] as [number, number], starts: [0, 0] as [number, number], layer: [0, 1] as [number, number] });

  /** Where a video starts and stops in this show (ms). */
  const clipWindow = useCallback(
    (v: VaultItem) => {
      const d = v.durationMs ?? 0;
      if (!opts.clipSec || !d || d <= opts.clipSec * 1000 + 1500) return { start: 0, end: d || Infinity };
      const start = highlightAt(d, [], opts.clipSec * 1000);
      return { start, end: start + opts.clipSec * 1000 };
    },
    [opts.clipSec]
  );

  /** Puts video `i` into a slot, at its start, paused. */
  const load = useCallback(
    async (slot: Slot, i: number) => {
      const v = list[i];
      st.current.layer[slot] = i;
      setLayer((l) => (slot === 0 ? [i, l[1]] : [l[0], i]));
      if (!enableVideo || !v?.uri) return;
      const w = clipWindow(v);
      st.current.starts[slot] = w.start;
      st.current.ends[slot] = w.end;
      try {
        await players[slot].replaceAsync(v.uri);
        players[slot].muted = !opts.sound;
        players[slot].volume = 1;
        players[slot].currentTime = w.start / 1000;
      } catch (e) {
        console.log(`[SLIDESHOW] could not load ${v.filename}: ${String(e)}`);
      }
    },
    [list, enableVideo, clipWindow, opts.sound] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const animateIn = (to: Slot, from: Slot, back: boolean) => {
    const t = opts.transition;
    const dur = t === 'none' ? 0 : FADE_MS;
    const ease = { duration: dur, easing: Easing.bezier(0.22, 1, 0.36, 1) };
    if (t === 'slide') {
      tx[to].value = back ? -width : width;
      op[to].value = 1;
      tx[to].value = withTiming(0, ease);
      tx[from].value = withTiming(back ? width * 0.35 : -width * 0.35, ease);
      op[from].value = withTiming(0.0, { duration: dur });
    } else {
      tx[to].value = 0;
      sc[to].value = t === 'zoom' ? 1.14 : 1;
      sc[to].value = withTiming(1, { duration: dur + 300, easing: Easing.out(Easing.quad) });
      op[to].value = withTiming(1, { duration: dur });
      op[from].value = withTiming(0, { duration: dur });
      if (t === 'zoom') sc[from].value = withTiming(0.92, { duration: dur });
    }
    return dur;
  };

  const go = useCallback(
    async (target: number) => {
      const s = st.current;
      if (s.busy) return;
      if (target >= list.length) return onEnd();
      if (target < 0) target = 0;
      if (target === s.index) return;
      s.busy = true;
      const from = s.active;
      const to: Slot = from === 0 ? 1 : 0;
      if (s.layer[to] !== target) await load(to, target);
      if (enableVideo && !paused) players[to].play();
      const dur = animateIn(to, from, target < s.index);
      s.active = to;
      s.index = target;
      setActive(to);
      setIndex(target);
      setTitleKey((k) => k + 1);
      setProgress(0);
      setTimeout(() => {
        players[from].pause();
        sc[from].value = 1;
        tx[from].value = 0;
        if (target + 1 < list.length) void load(from, target + 1);
        s.busy = false;
      }, dur + 60);
    },
    [list.length, load, enableVideo, paused, onEnd] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Start: the first video in slot 0, the second waiting in slot 1.
  useEffect(() => {
    (async () => {
      await load(0, 0);
      if (enableVideo) p0.play();
      if (list.length > 1) await load(1, 1);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The clip ends (or the video does): on to the next.
  useEffect(() => {
    const subs = ([0, 1] as Slot[]).flatMap((slot) => [
      players[slot].addListener('timeUpdate', ({ currentTime }) => {
        const s = st.current;
        if (slot !== s.active) return;
        const ms = currentTime * 1000;
        const len = Math.max(1, Math.min(s.ends[slot], (players[slot].duration || Infinity) * 1000) - s.starts[slot]);
        setProgress(Math.max(0, Math.min(1, (ms - s.starts[slot]) / len)));
        if (s.ends[slot] !== Infinity && ms >= s.ends[slot] - (opts.transition === 'none' ? 0 : FADE_MS * 0.6)) void go(s.index + 1);
      }),
      players[slot].addListener('playToEnd', () => {
        if (slot === st.current.active) void go(st.current.index + 1);
      }),
    ]);
    return () => subs.forEach((x) => x.remove());
  }, [go]); // eslint-disable-line react-hooks/exhaustive-deps

  // The browser preview: covers, moving on by a timer.
  useEffect(() => {
    if (enableVideo || paused) return;
    const ms = (opts.clipSec || 5) * 1000;
    const started = Date.now();
    const t = setInterval(() => {
      const f = (Date.now() - started) / ms;
      setProgress(Math.min(1, f));
      if (f >= 1) {
        clearInterval(t);
        void go(st.current.index + 1);
      }
    }, 100);
    return () => clearInterval(t);
  }, [index, paused, enableVideo, opts.clipSec, go]);

  useEffect(() => {
    for (const pl of players) pl.muted = !opts.sound;
  }, [opts.sound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Controls hide themselves after a moment.
  useEffect(() => {
    if (!controls || paused) return;
    const t = setTimeout(() => setControls(false), 2800);
    return () => clearTimeout(t);
  }, [controls, paused, index]);

  const togglePause = () => {
    tick();
    const pl = players[st.current.active];
    if (paused) {
      if (enableVideo) pl.play();
      setPaused(false);
    } else {
      if (enableVideo) pl.pause();
      setPaused(true);
      setControls(true);
    }
  };

  const tap = (x: number) => {
    if (x < width / 3) {
      tick();
      void go(st.current.index - 1);
    } else if (x > (width * 2) / 3) {
      tick();
      void go(st.current.index + 1);
    } else if (controls) togglePause();
    else setControls(true);
  };

  const swipe = Gesture.Pan()
    .activeOffsetY(20)
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 140 || e.velocityY > 900) scheduleOnRN(onClose);
      else drag.value = withTiming(0);
    });
  const tapG = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e) => {
      scheduleOnRN(tap, e.x);
    });
  const gestures = Gesture.Exclusive(swipe, tapG);

  const stage = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }, { scale: 1 - Math.min(0.12, drag.value / 2400) }], borderRadius: drag.value > 4 ? 24 : 0 }));
  const layerStyle = (slot: Slot) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ opacity: op[slot].value, transform: [{ translateX: tx[slot].value }, { scale: sc[slot].value }] }));
  const l0 = layerStyle(0);
  const l1 = layerStyle(1);

  const item = list[index];
  const many = list.length > 40;

  return (
    <GestureDetector gesture={gestures}>
      <Animated.View style={[{ flex: 1, backgroundColor: '#000', overflow: 'hidden' }, stage]}>
        {([0, 1] as Slot[]).map((slot) => {
          const v = list[layer[slot]];
          return (
            <Animated.View key={slot} style={[StyleSheet.absoluteFill, slot === 0 ? l0 : l1, { zIndex: active === slot ? 2 : 1 }]} pointerEvents="none">
              {enableVideo ? (
                <VideoView player={players[slot]} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} allowsPictureInPicture={false} />
              ) : v ? (
                <KenBurns key={`${slot}-${layer[slot]}`} source={v.thumbSource} ms={(opts.clipSec || 5) * 1000 + 2000} seed={layer[slot]} />
              ) : null}
            </Animated.View>
          );
        })}

        <View style={[styles.topShade, { height: insets.top + 110 }, gradient('linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)', 'transparent')]} pointerEvents="none" />
        <View style={[styles.bars, { top: insets.top + 8 }]} pointerEvents="none">
          {many ? (
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${((index + progress) / list.length) * 100}%` }]} />
            </View>
          ) : (
            list.map((v, i) => (
              <View key={`${v.id}-${i}`} style={styles.bar}>
                <View style={[styles.barFill, { width: i < index ? '100%' : i === index ? `${progress * 100}%` : '0%' }]} />
              </View>
            ))
          )}
        </View>

        {opts.titles && item && (
          <Animated.View key={titleKey} entering={FadeIn.duration(500).delay(250)} exiting={FadeOut.duration(250)} style={[styles.caption, { bottom: insets.bottom + 110 }]} pointerEvents="none">
            <Text style={styles.captionDate}>
              {new Date(item.createdAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}
            </Text>
            <Words text={friendlyName(item)} style={styles.captionTitle} delay={300} stagger={60} />
          </Animated.View>
        )}

        {controls && (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View style={[styles.ctlTop, { top: insets.top + 22 }]}>
              <TouchableOpacity style={styles.round} onPress={onClose} accessibilityLabel="Close slideshow">
                <Icon name="close" size={16} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.count}>
                {index + 1} / {list.length}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={styles.round} onPress={() => onSet({ sound: !opts.sound })} accessibilityLabel={opts.sound ? 'Mute' : 'Sound on'}>
                  <Icon name={opts.sound ? 'sound' : 'muted'} size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.round}
                  onPress={() => {
                    players[st.current.active].pause();
                    onSetup();
                  }}
                  accessibilityLabel="Slideshow options">
                  <Icon name="options" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={[styles.ctlBottom, { bottom: insets.bottom + 24 }]}>
              <TouchableOpacity style={[styles.round, index === 0 && { opacity: 0.4 }]} disabled={index === 0} onPress={() => go(index - 1)} accessibilityLabel="Previous video">
                <Icon name="back" size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.roundBig} onPress={togglePause} accessibilityLabel={paused ? 'Play' : 'Pause'}>
                <Icon name={paused ? 'play' : 'pause'} size={24} color="#000" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.round} onPress={() => go(index + 1)} accessibilityLabel="Next video">
                <Icon name="forward" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
            {onOpenVideo && item && (
              <TouchableOpacity
                style={[styles.openBtn, { bottom: insets.bottom + 92 }]}
                onPress={() => {
                  players[st.current.active].pause();
                  onOpenVideo(item);
                }}>
                <Text style={styles.openText}>Open this video</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}
        {paused && !controls && (
          <View style={styles.pausedPill} pointerEvents="none">
            <Icon name="pause" size={14} color="#fff" />
            <Text style={styles.pausedText}>Paused</Text>
          </View>
        )}
        {height < width && <View />}
      </Animated.View>
    </GestureDetector>
  );
}

/* ------------------------------------------------------------------- end */

function EndCard({ list, onReplay, onSetup, onClose }: { list: VaultItem[]; onReplay: () => void; onSetup: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const total = list.length;
  return (
    <View style={{ flex: 1 }}>
      <Aurora colors={['#5E5CE6', '#000000']} accent="#FF375F" width={width} height={height} />
      <View style={[StyleSheet.absoluteFill, { opacity: 0.5 }]}>
        <CoverWall sources={list.slice(0, 24).map((v) => v.thumbSource)} rows={5} tile={120} tilt={-10} />
      </View>
      <View style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 70%)', 'rgba(0,0,0,0.6)')]} />
      <View style={[styles.end, { paddingBottom: insets.bottom + 30 }]}>
        <Text style={styles.setupKicker}>THAT WAS THE SLIDESHOW</Text>
        <Words text={`${total} ${total === 1 ? 'video' : 'videos'}, start to finish`} style={styles.setupTitle} />
        <View style={styles.endThumbs}>
          {list.slice(0, 5).map((v, i) => (
            <Image key={v.id} source={v.thumbSource} style={[styles.endThumb, { transform: [{ rotate: `${(i - 2) * 5}deg` }], marginLeft: i ? -16 : 0 }]} contentFit="cover" />
          ))}
        </View>
        <PressableScale style={styles.playBtn} onPress={onReplay} accessibilityLabel="Play again">
          <Icon name="rewatch" size={18} color="#000" />
          <Text style={styles.playText}>Play again</Text>
        </PressableScale>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={styles.ghost} onPress={onSetup}>
            <Text style={styles.ghostText}>Change options</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={onClose}>
            <Text style={styles.ghostText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  setup: { paddingHorizontal: 20, gap: 10 },
  setupTop: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 18 },
  setupKicker: { color: '#FF375F', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  setupTitle: { color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: -1.2, lineHeight: 44 },
  setupSub: { color: 'rgba(255,255,255,0.75)', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '900', letterSpacing: 1, marginTop: 14, textTransform: 'uppercase' },
  hint: { color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: '#000' },
  trans: { width: 76, height: 70, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  toggleOn: { backgroundColor: '#fff' },
  toggleText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  playBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14 },
  playBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 16, alignSelf: 'stretch' },
  playText: { color: '#000', fontSize: 18, fontWeight: '900' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  roundBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topShade: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 3 },
  bars: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 3, zIndex: 4 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: '#fff' },
  caption: { position: 'absolute', left: 20, right: 20, zIndex: 4, gap: 4 },
  captionDate: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  captionTitle: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -0.8, lineHeight: 34, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 12 },
  ctlTop: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 },
  ctlBottom: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 34, zIndex: 5 },
  count: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  openBtn: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, zIndex: 5 },
  openText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pausedPill: { position: 'absolute', alignSelf: 'center', bottom: 40, flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, zIndex: 5 },
  pausedText: { color: '#fff', fontWeight: '800' },
  end: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 22, gap: 18 },
  endThumbs: { flexDirection: 'row', marginVertical: 6 },
  endThumb: { width: 74, height: 100, borderRadius: 12, borderWidth: 2, borderColor: '#fff' },
  ghost: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  ghostText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
