/**
 * Slideshow: your videos one after another, full screen.
 *
 * First a setup page (a title, which videos, order, how long, transition, music, speed, look,
 * sleep timer; remembered), then the show: two players take turns so each video crossfades,
 * dips, zooms, slides or rises into the next with no black gap, music from your Audio library
 * underneath if you picked some, story bars at the top, the name and date (or a bigger date when
 * a new day starts) fading in, and taps to move on (left / right third), pause (middle) or close
 * (swipe down). The end card offers Play again. In the browser preview the covers stand in for
 * videos.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { GatedModal as Modal } from './screen';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyName } from '../names';
import { highlightAt } from '../recap';
import { allowRotation, restoreRotation } from '../rotate';
import { CLIP_SECONDS, clipWindow, FIT_MINUTES, pickFor, planShow, showLength, SPEEDS, startsDay, STOP_AFTER } from '../slideshowPlan';
import { useAudioControlsOptional } from './audio/playback';
import { success, tick } from './haptics';
import Icon from './Icon';
import { setSpeed } from './logic';
import type { IconName } from './icons';
import { gradient } from './insightParts';
import { PressableScale } from './motion';
import { Aurora, CoverWall, KenBurns, Words } from './storyKit';
import { DEFAULT_SLIDESHOW, type SlideshowOptions, type ThumbSource, type VaultItem } from './types';

/** A piece of music from your Audio library that can play under a show. */
export type ShowMusic = { id: string; title: string; coverSource: ThumbSource | null; trackUris: string[] };

const ORDERS: { key: SlideshowOptions['order']; label: string }[] = [
  { key: 'shown', label: 'As shown' },
  { key: 'shuffle', label: 'Shuffle' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'newest', label: 'Newest first' },
  { key: 'best', label: 'Best rated' },
];
const TRANSITIONS: { key: SlideshowOptions['transition']; label: string; icon: IconName }[] = [
  { key: 'fade', label: 'Fade', icon: 'eye' },
  { key: 'dip', label: 'Dip', icon: 'moon' },
  { key: 'zoom', label: 'Zoom', icon: 'search' },
  { key: 'slide', label: 'Slide', icon: 'forward' },
  { key: 'rise', label: 'Rise', icon: 'arrowUp' },
  { key: 'none', label: 'Cut', icon: 'close' },
];

const FADE_MS = 700;
/** How far the slow zoom goes over one video. */
const DRIFT = 1.08;
/** The video's own sound while music plays with "Video sound" on. */
const UNDER_MUSIC = 0.3;
const INTRO_MS = 3800;

const clipLabel = (s: number) => (s === 0 ? 'Whole' : s < 60 ? `${s} s` : `${s / 60} min`);
const speedLabel = (s: number) => `${s}×`;

export function SlideshowModal({
  items,
  startIndex,
  enableVideo,
  options = DEFAULT_SLIDESHOW,
  music = [],
  autoplay = false,
  onOptions,
  onOpenVideo,
  onClose,
}: {
  items: VaultItem[];
  startIndex: number;
  enableVideo: boolean;
  options?: SlideshowOptions;
  /** Your music (Audio library items that are not books). */
  music?: ShowMusic[];
  /** Skip the setup page (the browser preview). */
  autoplay?: boolean;
  onOptions?: (o: SlideshowOptions) => void;
  onOpenVideo?: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState(options);
  const [plan, setPlan] = useState(() => planShow(items, startIndex, opts));
  // Nothing to show (say, Favourites only and none here): the setup page says why.
  const [phase, setPhase] = useState<'setup' | 'play' | 'end'>(autoplay && plan.list.length ? 'play' : 'setup');
  const [run, setRun] = useState(0);
  const [stopped, setStopped] = useState(false);
  const set = (patch: Partial<SlideshowOptions>) => {
    tick();
    const next = { ...opts, ...patch };
    setOpts(next);
    onOptions?.(next);
  };
  // While it plays, the slideshow turns with the phone; the setup and end pages stay upright.
  useEffect(() => {
    if (phase === 'play') allowRotation();
    else restoreRotation();
  }, [phase]);
  useEffect(() => restoreRotation, []);
  // Your audiobook pauses for the show and carries on when it closes.
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
  const track = music.find((m) => m.id === opts.music && m.trackUris.length) ?? null;
  const play = () => {
    const next = planShow(items, startIndex, opts);
    if (!next.list.length) return;
    success();
    setPlan(next);
    setStopped(false);
    setRun((n) => n + 1);
    setPhase('play');
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        {phase === 'setup' && <Setup items={items} startIndex={startIndex} music={music} opts={opts} onSet={set} onPlay={play} onClose={onClose} />}
        {phase === 'play' && plan.list.length > 0 && (
          <Show
            key={run}
            list={plan.list}
            clipMs={plan.clipMs}
            opts={opts}
            music={track}
            intro={run === 1 || !opts.repeat}
            enableVideo={enableVideo}
            onSet={set}
            onSetup={() => setPhase('setup')}
            onEnd={(byTimer) => {
              if (byTimer) {
                setStopped(true);
                setPhase('end');
              } else if (opts.repeat) play();
              else setPhase('end');
            }}
            onOpenVideo={onOpenVideo}
            onClose={onClose}
          />
        )}
        {phase === 'end' && <EndCard list={plan.list} title={opts.title} stoppedAfter={stopped ? opts.stopAfterMin : 0} onReplay={play} onSetup={() => setPhase('setup')} onClose={onClose} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

/* ------------------------------------------------------------------ setup */

function Chips<K extends string | number>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K | null; onChange: (k: K) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity key={String(o.key)} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Toggle({ label, icon, on, onPress }: { label: string; icon: IconName; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.toggle, on && styles.toggleOn]} onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <Icon name={icon} size={16} color={on ? '#000' : '#fff'} />
      <Text style={[styles.toggleText, on && { color: '#000' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Setup({
  items,
  startIndex,
  music,
  opts,
  onSet,
  onPlay,
  onClose,
}: {
  items: VaultItem[];
  startIndex: number;
  music: ShowMusic[];
  opts: SlideshowOptions;
  onSet: (p: Partial<SlideshowOptions>) => void;
  onPlay: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Shuffling here would only be for the count and length: any order gives the same numbers.
  const plan = useMemo(() => planShow(items, startIndex, { ...opts, order: opts.order === 'shuffle' ? 'shown' : opts.order }), [items, startIndex, opts]);
  const favourites = useMemo(() => pickFor(items, 'favourites').length, [items]);
  const rated = useMemo(() => pickFor(items, 'rated').length, [items]);
  const [title, setTitle] = useState(opts.title);
  const count = plan.list.length;
  const empty = count === 0;
  const sub = empty
    ? opts.pick === 'favourites'
      ? 'None of these are favourites yet. Rate a video 8 or more to make it one.'
      : 'None of these are rated yet.'
    : `${plan.totalMs > 0 ? showLength(plan.totalMs) : 'Ready when you are'}${plan.leftOut ? ` · ${plan.leftOut} left out to fit` : ''}`;
  return (
    <View style={{ flex: 1 }}>
      <Aurora colors={['#2B1055', '#000000']} accent="#FF375F" width={width} height={height} />
      <View style={[StyleSheet.absoluteFill, { opacity: 0.35 }]}>
        <CoverWall sources={items.slice(0, 24).map((v) => v.thumbSource)} rows={5} tile={110} />
      </View>
      <View style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.75) 45%, rgba(0,0,0,0.95) 100%)', 'rgba(0,0,0,0.7)')]} />
      <ScrollView contentContainerStyle={[styles.setup, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 110 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.setupTop}>
          <TouchableOpacity style={styles.round} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.setupKicker}>SLIDESHOW</Text>
        <Words text={`${count} ${count === 1 ? 'video' : 'videos'}`} style={styles.setupTitle} />
        <Text style={styles.setupSub}>{sub}</Text>

        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={() => title.trim() !== opts.title && onSet({ title: title.trim() })}
          placeholder="Give it a title (optional)"
          placeholderTextColor="rgba(255,255,255,0.45)"
          maxLength={60}
          returnKeyType="done"
          style={styles.titleInput}
          accessibilityLabel="Slideshow title, shown at the start"
        />

        <Text style={styles.label}>Videos</Text>
        <Chips
          options={[
            { key: 'all' as const, label: `All · ${items.length}` },
            { key: 'favourites' as const, label: `Favourites · ${favourites}` },
            { key: 'rated' as const, label: `Rated · ${rated}` },
          ]}
          value={opts.pick}
          onChange={(pick) => onSet({ pick })}
        />
        <Text style={styles.label}>Order</Text>
        <Chips options={ORDERS} value={opts.order} onChange={(order) => onSet({ order })} />

        <Text style={styles.label}>Of each video</Text>
        <Chips options={CLIP_SECONDS.map((s) => ({ key: s as number, label: clipLabel(s) }))} value={opts.fitMin ? null : opts.clipSec} onChange={(clipSec) => onSet({ clipSec, fitMin: 0 })} />
        <Text style={styles.label}>Or make the whole show</Text>
        <Chips options={FIT_MINUTES.filter((m) => m > 0).map((m) => ({ key: m as number, label: `${m} min` }))} value={opts.fitMin || null} onChange={(fitMin) => onSet({ fitMin: fitMin === opts.fitMin ? 0 : fitMin })} />
        <Text style={styles.hint}>
          {opts.fitMin
            ? `Every video gets an equal part${plan.clipMs ? ` (about ${Math.round(plan.clipMs / opts.speed / 1000)} s)` : ''}, from its best moment. Tap again to turn it off.`
            : opts.clipSec
              ? 'The best part of each: around your bookmarks, else the middle.'
              : 'Every video plays to its end.'}
        </Text>

        <Text style={styles.label}>Between videos</Text>
        <View style={styles.chips}>
          {TRANSITIONS.map((t) => {
            const on = opts.transition === t.key;
            return (
              <TouchableOpacity key={t.key} style={[styles.trans, on && styles.chipOn]} onPress={() => onSet({ transition: t.key })} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Icon name={t.icon} size={18} color={on ? '#000' : '#fff'} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Music</Text>
        {music.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.musicRow}>
            <TouchableOpacity style={[styles.music, !opts.music && styles.musicOn]} onPress={() => onSet({ music: null })} accessibilityRole="button" accessibilityState={{ selected: !opts.music }}>
              <View style={[styles.musicArt, styles.musicNone]}>
                <Icon name="muted" size={20} color="#fff" />
              </View>
              <Text style={styles.musicTitle} numberOfLines={2}>
                No music
              </Text>
            </TouchableOpacity>
            {music.map((m) => {
              const on = opts.music === m.id;
              return (
                <TouchableOpacity key={m.id} style={[styles.music, on && styles.musicOn]} onPress={() => onSet({ music: m.id })} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Music: ${m.title}`}>
                  {m.coverSource ? (
                    <Image source={m.coverSource} style={styles.musicArt} contentFit="cover" />
                  ) : (
                    <View style={[styles.musicArt, styles.musicNone]}>
                      <Icon name="audio" size={20} color="#fff" />
                    </View>
                  )}
                  <Text style={styles.musicTitle} numberOfLines={2}>
                    {m.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : (
          <Text style={styles.hint}>Add songs in the Audio section and they can play under your slideshows.</Text>
        )}
        {!!opts.music && <Text style={styles.hint}>{opts.sound ? 'The videos’ own sound plays quietly under the music.' : 'Only the music plays. Turn on Video sound to hear both.'}</Text>}

        <Text style={styles.label}>Speed</Text>
        <Chips options={SPEEDS.map((s) => ({ key: s as number, label: speedLabel(s) }))} value={opts.speed} onChange={(speed) => onSet({ speed })} />

        <Text style={styles.label}>Look</Text>
        <View style={styles.chips}>
          <Toggle label="Fill the screen" icon="fill" on={opts.fill} onPress={() => onSet({ fill: !opts.fill })} />
          <Toggle label="Slow zoom" icon="search" on={opts.drift} onPress={() => onSet({ drift: !opts.drift })} />
          <Toggle label="Names" icon="edit" on={opts.titles} onPress={() => onSet({ titles: !opts.titles })} />
          <Toggle label="Date for each day" icon="calendar" on={opts.dayTitles} onPress={() => onSet({ dayTitles: !opts.dayTitles })} />
        </View>

        <Text style={styles.label}>Sound and repeat</Text>
        <View style={styles.chips}>
          <Toggle label="Video sound" icon="sound" on={opts.sound} onPress={() => onSet({ sound: !opts.sound })} />
          <Toggle label="Repeat" icon="rewatch" on={opts.repeat} onPress={() => onSet({ repeat: !opts.repeat })} />
        </View>
        <Text style={styles.label}>Stop after</Text>
        <Chips options={STOP_AFTER.map((m) => ({ key: m as number, label: m ? `${m} min` : 'Off' }))} value={opts.stopAfterMin} onChange={(stopAfterMin) => onSet({ stopAfterMin })} />
      </ScrollView>
      <View style={[styles.playBar, { paddingBottom: insets.bottom + 16 }]}>
        <PressableScale
          style={[styles.playBtn, empty && { opacity: 0.4 }]}
          onPress={() => {
            if (title.trim() !== opts.title) onSet({ title: title.trim() });
            onPlay();
          }}
          disabled={empty}
          accessibilityLabel="Play the slideshow">
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
  clipMs,
  opts,
  music,
  intro,
  enableVideo,
  onSet,
  onSetup,
  onEnd,
  onOpenVideo,
  onClose,
}: {
  list: VaultItem[];
  clipMs: number;
  opts: SlideshowOptions;
  music: ShowMusic | null;
  /** Show the title at the start (not again on every repeat). */
  intro: boolean;
  enableVideo: boolean;
  onSet: (p: Partial<SlideshowOptions>) => void;
  onSetup: () => void;
  /** The show ran out, or the sleep timer stopped it (`byTimer`). */
  onEnd: (byTimer: boolean) => void;
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
  const [showIntro, setShowIntro] = useState(intro && !!opts.title);

  const p0 = useVideoPlayer(null, (pl) => {
    pl.loop = false;
    pl.timeUpdateEventInterval = 0.25;
  });
  const p1 = useVideoPlayer(null, (pl) => {
    pl.loop = false;
    pl.timeUpdateEventInterval = 0.25;
  });
  const players: [VideoPlayer, VideoPlayer] = [p0, p1];
  const tune = useMusic(enableVideo ? music : null, paused);

  const op = [useSharedValue(1), useSharedValue(0)];
  const sc = [useSharedValue(1), useSharedValue(1)];
  const tx = [useSharedValue(0), useSharedValue(0)];
  const ty = [useSharedValue(0), useSharedValue(0)];
  const dr = [useSharedValue(1), useSharedValue(1)];
  const drag = useSharedValue(0);

  const st = useRef({ index: 0, active: 0 as Slot, busy: false, ends: [Infinity, Infinity] as [number, number], starts: [0, 0] as [number, number], layer: [0, 1] as [number, number] });

  const windowOf = useCallback((v: VaultItem) => clipWindow(v.durationMs, clipMs, (d, c) => highlightAt(d, [], c)), [clipMs]);
  /** How long a video stays on screen, on the clock (for the slow zoom). */
  const onScreenMs = useCallback(
    (v: VaultItem) => {
      const w = windowOf(v);
      const media = w.end === Infinity ? (clipMs || 8000) : w.end - w.start;
      return Math.max(1500, media / opts.speed);
    },
    [windowOf, clipMs, opts.speed]
  );
  const videoVolume = tune.playing ? UNDER_MUSIC : 1;

  /** Puts video `i` into a slot, at its start, paused. */
  const load = useCallback(
    async (slot: Slot, i: number) => {
      const v = list[i];
      st.current.layer[slot] = i;
      setLayer((l) => (slot === 0 ? [i, l[1]] : [l[0], i]));
      if (!enableVideo || !v?.uri) return;
      const w = windowOf(v);
      st.current.starts[slot] = w.start;
      st.current.ends[slot] = w.end;
      try {
        await players[slot].replaceAsync(v.uri);
        players[slot].muted = !opts.sound;
        players[slot].volume = videoVolume;
        setSpeed(players[slot], opts.speed);
        players[slot].currentTime = w.start / 1000;
      } catch (e) {
        console.log(`[SLIDESHOW] could not load ${v.filename}: ${String(e)}`);
      }
    },
    [list, enableVideo, windowOf, opts.sound, opts.speed, videoVolume] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  /** How long the current slow zoom runs from 1 to DRIFT, so a pause can carry on at the same pace. */
  const driftMs = useRef<[number, number]>([0, 0]);
  const startDrift = (slot: Slot, v: VaultItem | undefined) => {
    dr[slot].value = 1;
    if (!opts.drift || !v) return;
    driftMs.current[slot] = onScreenMs(v);
    if (!pausedRef.current) dr[slot].value = withTiming(DRIFT, { duration: driftMs.current[slot], easing: Easing.linear });
  };
  // The slow zoom stops with the show and goes on from where it was.
  useEffect(() => {
    if (!opts.drift) return;
    const slot = st.current.active;
    if (paused) cancelAnimation(dr[slot]);
    else {
      const left = driftMs.current[slot] * Math.max(0, (DRIFT - dr[slot].value) / (DRIFT - 1));
      if (left > 0) dr[slot].value = withTiming(DRIFT, { duration: left, easing: Easing.linear });
    }
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const animateIn = (to: Slot, from: Slot, back: boolean) => {
    const t = opts.transition;
    const dur = t === 'none' ? 0 : t === 'dip' ? FADE_MS * 1.4 : FADE_MS;
    const ease = { duration: dur, easing: Easing.bezier(0.22, 1, 0.36, 1) };
    tx[to].value = 0;
    ty[to].value = 0;
    sc[to].value = 1;
    if (t === 'slide') {
      tx[to].value = back ? -width : width;
      op[to].value = 1;
      tx[to].value = withTiming(0, ease);
      tx[from].value = withTiming(back ? width * 0.35 : -width * 0.35, ease);
      op[from].value = withTiming(0, { duration: dur });
    } else if (t === 'rise') {
      ty[to].value = back ? -height : height;
      op[to].value = 1;
      ty[to].value = withTiming(0, ease);
      ty[from].value = withTiming(back ? height * 0.25 : -height * 0.25, ease);
      op[from].value = withTiming(0, { duration: dur });
    } else if (t === 'dip') {
      // Through black: the old one goes out, then the new one comes in.
      op[from].value = withTiming(0, { duration: dur / 2 });
      op[to].value = 0;
      op[to].value = withSequence(withTiming(0, { duration: dur / 2 }), withTiming(1, { duration: dur / 2 }));
    } else {
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
      if (target >= list.length) return onEnd(false);
      if (target < 0) target = 0;
      if (target === s.index) return;
      s.busy = true;
      const from = s.active;
      const to: Slot = from === 0 ? 1 : 0;
      if (s.layer[to] !== target) await load(to, target);
      if (enableVideo && !paused) players[to].play();
      const dur = animateIn(to, from, target < s.index);
      startDrift(to, list[target]);
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
        ty[from].value = 0;
        if (target + 1 < list.length) void load(from, target + 1);
        s.busy = false;
      }, dur + 60);
    },
    [list, load, enableVideo, paused, onEnd] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Start: the first video in slot 0, the second waiting in slot 1.
  useEffect(() => {
    (async () => {
      await load(0, 0);
      if (enableVideo) p0.play();
      startDrift(0, list[0]);
      if (list.length > 1) await load(1, 1);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The title at the start fades away by itself.
  useEffect(() => {
    if (!showIntro) return;
    const t = setTimeout(() => setShowIntro(false), INTRO_MS);
    return () => clearTimeout(t);
  }, [showIntro]);

  // The clip ends (or the video does): on to the next.
  useEffect(() => {
    // Without videos (the browser preview) the timer below moves the show on.
    if (!enableVideo) return;
    const subs = ([0, 1] as Slot[]).flatMap((slot) => [
      players[slot].addListener('timeUpdate', ({ currentTime }) => {
        const s = st.current;
        if (slot !== s.active) return;
        const ms = currentTime * 1000;
        const len = Math.max(1, Math.min(s.ends[slot], (players[slot].duration || Infinity) * 1000) - s.starts[slot]);
        setProgress(Math.max(0, Math.min(1, (ms - s.starts[slot]) / len)));
        // The transition starts a little early so it ends as the clip does (in the video's own time).
        if (s.ends[slot] !== Infinity && ms >= s.ends[slot] - (opts.transition === 'none' ? 0 : FADE_MS * 0.6 * opts.speed)) void go(s.index + 1);
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
    const ms = clipMs ? clipMs / opts.speed : 5000;
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
  }, [index, paused, enableVideo, clipMs, opts.speed, go]);

  useEffect(() => {
    for (const pl of players) {
      pl.muted = !opts.sound;
      pl.volume = videoVolume;
    }
  }, [opts.sound, videoVolume]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sleep timer: the show stops by itself after the time you chose (paused time does not count).
  const played = useRef(0);
  useEffect(() => {
    if (!opts.stopAfterMin || paused) return;
    let last = Date.now();
    const t = setInterval(() => {
      played.current += Date.now() - last;
      last = Date.now();
      if (played.current >= opts.stopAfterMin * 60_000) {
        clearInterval(t);
        for (const pl of players) pl.pause();
        tune.fadeOut(() => onEnd(true));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [opts.stopAfterMin, paused]); // eslint-disable-line react-hooks/exhaustive-deps

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
    useAnimatedStyle(() => ({ opacity: op[slot].value, transform: [{ translateX: tx[slot].value }, { translateY: ty[slot].value }, { scale: sc[slot].value }] }));
  const driftStyle = (slot: Slot) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ transform: [{ scale: dr[slot].value }] }));
  const l0 = layerStyle(0);
  const l1 = layerStyle(1);
  const d0 = driftStyle(0);
  const d1 = driftStyle(1);

  const item = list[index];
  const many = list.length > 40;
  const newDay = opts.dayTitles && startsDay(list, index);
  const caption = item && (opts.titles || newDay) && !showIntro;

  return (
    <GestureDetector gesture={gestures}>
      <Animated.View style={[{ flex: 1, backgroundColor: '#000', overflow: 'hidden' }, stage]}>
        {([0, 1] as Slot[]).map((slot) => {
          const v = list[layer[slot]];
          return (
            <Animated.View key={slot} style={[StyleSheet.absoluteFill, slot === 0 ? l0 : l1, { zIndex: active === slot ? 2 : 1 }]} pointerEvents="none">
              <Animated.View style={[StyleSheet.absoluteFill, slot === 0 ? d0 : d1]}>
                {enableVideo ? (
                  <VideoView player={players[slot]} style={StyleSheet.absoluteFill} contentFit={opts.fill ? 'cover' : 'contain'} nativeControls={false} allowsPictureInPicture={false} />
                ) : v ? (
                  <KenBurns key={`${slot}-${layer[slot]}`} source={v.thumbSource} ms={(clipMs ? clipMs / opts.speed : 5000) + 2000} seed={layer[slot]} />
                ) : null}
              </Animated.View>
            </Animated.View>
          );
        })}

        <View style={[styles.topShade, { height: insets.top + 110 }, gradient('linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)', 'transparent')]} pointerEvents="none" />
        {caption && <View style={[styles.bottomShade, { height: insets.bottom + 260 }, gradient('linear-gradient(0deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 100%)', 'transparent')]} pointerEvents="none" />}
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

        {showIntro && (
          <Animated.View entering={FadeIn.duration(700)} exiting={FadeOut.duration(600)} style={[StyleSheet.absoluteFill, styles.intro]} pointerEvents="none">
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
            <Words text={opts.title} style={styles.introTitle} delay={250} stagger={90} maxWidth={width - 48} />
            <Text style={styles.introSub}>{dateSpan(list)}</Text>
          </Animated.View>
        )}

        {caption && (
          <Animated.View key={titleKey} entering={FadeIn.duration(500).delay(250)} exiting={FadeOut.duration(250)} style={[styles.caption, { bottom: insets.bottom + 110 }]} pointerEvents="none">
            {newDay ? (
              <>
                <Text style={styles.captionDate}>{new Date(item.createdAt).toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}</Text>
                <Words text={new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} style={styles.dayTitle} delay={250} stagger={70} />
                {opts.titles && <Text style={styles.captionSmall}>{friendlyName(item)}</Text>}
              </>
            ) : (
              <>
                <Text style={styles.captionDate}>
                  {new Date(item.createdAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}
                </Text>
                <Words text={friendlyName(item)} style={styles.captionTitle} delay={300} stagger={60} />
              </>
            )}
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
                {opts.speed !== 1 ? `  ·  ${speedLabel(opts.speed)}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={styles.round} onPress={() => onSet({ sound: !opts.sound })} accessibilityLabel={opts.sound ? 'Mute the videos' : 'Video sound on'}>
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
            {music && (
              <View style={[styles.nowMusic, { top: insets.top + 72 }]} pointerEvents="none">
                <Icon name="audio" size={12} color="#fff" />
                <Text style={styles.nowMusicText} numberOfLines={1}>
                  {music.title}
                </Text>
              </View>
            )}
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
      </Animated.View>
    </GestureDetector>
  );
}

/** "14 October 2026", "3 – 9 October 2026", "October 2025 – March 2026". */
function dateSpan(list: VaultItem[]): string {
  if (!list.length) return '';
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of list) {
    lo = Math.min(lo, v.createdAt);
    hi = Math.max(hi, v.createdAt);
  }
  const a = new Date(lo);
  const b = new Date(hi);
  const full = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  if (a.toDateString() === b.toDateString()) return full(a);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()} – ${full(b)}`;
  const my = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return my(a) === my(b) ? my(a) : `${my(a)} – ${my(b)}`;
}

/**
 * Music under the show: the tracks of one Audio item, one after another and round again, fading
 * in at the start and out at the end; paused with the show.
 */
function useMusic(music: ShowMusic | null, paused: boolean) {
  const player = useVideoPlayer(null, (pl) => {
    pl.loop = false;
    pl.volume = 0;
  });
  const track = useRef(0);
  const fade = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  /** Whether the music really plays (it may fail to load): the videos are turned down only then. */
  const [on, setOn] = useState(false);
  const ramp = useCallback(
    (to: number, ms: number, then?: () => void) => {
      if (fade.current) clearInterval(fade.current);
      const from = player.volume;
      const started = Date.now();
      fade.current = setInterval(() => {
        const f = Math.min(1, (Date.now() - started) / ms);
        try {
          player.volume = from + (to - from) * f;
        } catch {
          // the player is gone with the show
        }
        if (f >= 1) {
          if (fade.current) clearInterval(fade.current);
          fade.current = null;
          then?.();
        }
      }, 50);
    },
    [player]
  );
  useEffect(() => {
    if (!music) return;
    let gone = false;
    track.current = 0;
    const load = (i: number, first: boolean) =>
      player
        .replaceAsync(music.trackUris[i])
        .then(() => {
          if (gone) return;
          setOn(true);
          if (!pausedRef.current) player.play();
          if (first) ramp(1, 1500);
        })
        .catch((e) => {
          console.log(`[SLIDESHOW] music did not load: ${String(e)}`);
          if (!gone) setOn(false);
        });
    void load(0, true);
    const sub = player.addListener('playToEnd', () => {
      track.current = (track.current + 1) % music.trackUris.length;
      void load(track.current, false);
    });
    return () => {
      gone = true;
      sub.remove();
      if (fade.current) clearInterval(fade.current);
      try {
        player.pause();
      } catch {
        // already released
      }
    };
  }, [music?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!music || !on) return;
    if (paused) player.pause();
    else player.play();
  }, [paused, on]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    playing: !!music && on,
    fadeOut: (then: () => void) => {
      if (!music || !on) return then();
      ramp(0, 1200, () => {
        player.pause();
        then();
      });
    },
  };
}

/* ------------------------------------------------------------------- end */

function EndCard({ list, title, stoppedAfter, onReplay, onSetup, onClose }: { list: VaultItem[]; title: string; stoppedAfter: number; onReplay: () => void; onSetup: () => void; onClose: () => void }) {
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
        <Text style={styles.setupKicker}>{stoppedAfter ? `STOPPED AFTER ${stoppedAfter} MINUTES` : title ? title.toUpperCase() : 'THAT WAS THE SLIDESHOW'}</Text>
        <Words text={stoppedAfter ? 'Sleep well.' : `${total} ${total === 1 ? 'video' : 'videos'}, start to finish`} style={styles.setupTitle} />
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
  titleInput: { color: '#fff', fontSize: 17, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '900', letterSpacing: 1, marginTop: 14, textTransform: 'uppercase' },
  hint: { color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: '#000' },
  trans: { width: 70, height: 66, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  toggleOn: { backgroundColor: '#fff' },
  toggleText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  musicRow: { gap: 10, paddingRight: 20 },
  music: { width: 86, gap: 6, padding: 4, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  musicOn: { borderColor: '#fff' },
  musicArt: { width: 74, height: 74, borderRadius: 10 },
  musicNone: { backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  musicTitle: { color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 15 },
  playBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14 },
  playBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 16, alignSelf: 'stretch' },
  playText: { color: '#000', fontSize: 18, fontWeight: '900' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  roundBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topShade: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 3 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3 },
  bars: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 3, zIndex: 4 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: '#fff' },
  intro: { zIndex: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  introTitle: { color: '#fff', fontSize: 44, fontWeight: '900', letterSpacing: -1.4, lineHeight: 48, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 16 },
  introSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase', textAlign: 'center' },
  caption: { position: 'absolute', left: 20, right: 20, zIndex: 4, gap: 4 },
  captionDate: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  captionTitle: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -0.8, lineHeight: 34, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 12 },
  captionSmall: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '700', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  dayTitle: { color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: -1.2, lineHeight: 44, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 14 },
  ctlTop: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 },
  ctlBottom: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 34, zIndex: 5 },
  count: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  nowMusic: { position: 'absolute', alignSelf: 'center', maxWidth: '70%', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, zIndex: 5 },
  nowMusicText: { color: '#fff', fontSize: 12, fontWeight: '700', flexShrink: 1 },
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
