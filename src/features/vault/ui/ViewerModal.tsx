/**
 * The video viewer, laid out to match HashPhotos.
 *
 * HashPhotos is NOT a draggable sheet. It is a FIXED stack:
 *
 *   header (back · date+time · info · actions)
 *   media, filling everything above the bottom stack
 *   scrubber bar   (play/pause · track · time · more)
 *   filmstrip      (tap a frame to seek)
 *   album bar      (tap an album to put the video in it)
 *   toolbar        (pick flag · reject flag · stars · more · delete)
 *
 * Tapping the video hides all of it (full screen) and brings it back. The
 * metadata lives in a SEPARATE panel opened by the info button.
 *
 * Gestures, like the iOS Photos app: swipe left or right for the next or
 * previous video, drag down to close (the library shows through as you pull),
 * double-tap the left or right half to jump 10 seconds, and drag the playback
 * bar to scrub. The back button does the same as dragging down.
 *
 * A video linked to a Simkl movie or episode scrobbles while it plays: Simkl
 * shows it as "watching now", and finishing it marks it watched there.
 *
 * Also: hold the left or right edge for 2× speed, bookmarks (ticks on the
 * scrubber, chips to jump), "Continue another time" on long videos (it picks
 * up 2.5 min before where you stopped), and every play is recorded for the
 * dashboard and Wrapped.
 *
 * Like the rest of `ui/`, this imports no native module except expo-video, which
 * has a real web implementation. `enableVideo=false` (the browser preview) skips
 * mounting the player and shows a placeholder stage instead.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { episodeCode } from '@/features/simkl/logic';
import type { SimklBridge, VideoLink } from '@/features/simkl/ui/types';

import { canResume, fmtClock, ratingLabel, resumeFrom } from '../stats';
import type { Bookmark } from '../watching';
import { confirmAction } from './confirm';
import { OptionsSheet } from './prompts';
import { success, tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import LinkSheet from './LinkSheet';
import DateSheet from './DateSheet';
import { fmtBitrate, fmtDateTime, fmtDuration, fmtFormat, fmtSize } from './format';
import { fmtLocation, RECENTLY_DELETED_DAYS } from './logic';
import { PromptSheet } from './prompts';
import { SmallerSheet } from './smaller';
import RatingPicker from './RatingPicker';
import EditorModal from './EditorModal';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import {
  STATUSES,
  statusLabel,
  type ThumbSource,
  type UiAlbum,
  type UiFlag,
  type UiStatus,
  type UiTag,
  type VaultItem,
  type VaultScreenProps,
  DEFAULT_VAULT_PREFS,
  type VaultPrefs,
} from './types';
import Glyph from './Glyph';
import Fade from './Fade';
import { DUR, EASE_OUT, fadeIn, SPRING, useReducedMotion, zoomIn } from './motion';
import Scrubber from './Scrubber';

const FRAME_W = 52;
const FRAME_H = 36;
const FRAME_GAP = 3;
/** Space between videos while you swipe from one to the next. */
const PAGE_GAP = 24;
const fill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

type Stage = { tx: SharedValue<number>; ty: SharedValue<number>; dx: SharedValue<number> };

/** The vault's own definition of a favourite (see the sidebar). */
const FAVOURITE_RATING = 8;

function ViewerPage({
  stage,
  prev,
  next,
  onStep,
  onDismiss,
  item,
  actions,
  albums,
  enableVideo,
  initialInfoOpen = false,
  initialMenuOpen = false,
  initialSmallerOpen = false,
  initialEditorTab,
  onSlideshow,
  onNearby,
  simkl,
  link = null,
  onLinkChanged,
  resumeAt = null,
  prefs = DEFAULT_VAULT_PREFS,
  onClose,
}: ViewerProps & {
  stage: Stage;
  prev?: VaultItem;
  next?: VaultItem;
  /** Move to the next (1) or previous (-1) video. */
  onStep: (dir: 1 | -1) => void;
  /** Close with the animation (the back button). */
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const { tx, ty, dx } = stage;

  const player = useVideoPlayer(enableVideo && item.uri ? item.uri : null, (pl) => {
    pl.loop = false;
    if (enableVideo) pl.play();
    pl.timeUpdateEventInterval = 0.2;
  });

  const [rating, setRating] = useState(item.rating);
  const [flag, setFlag] = useState<UiFlag>(item.flag);
  const [watch, setWatch] = useState<UiStatus | null>(item.status);
  const [inTray, setInTray] = useState(item.inTray);
  const [albumIds, setAlbumIds] = useState<number[]>(item.albumIds);
  const [title, setTitle] = useState(item.title ?? '');
  const [caption, setCaption] = useState(item.notes ?? '');
  const [videoTags, setVideoTags] = useState<UiTag[]>([]);
  const [draft, setDraft] = useState('');
  const [frames, setFrames] = useState<ThumbSource[]>([]);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(enableVideo);
  const [infoOpen, setInfoOpen] = useState(initialInfoOpen);
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);
  const [chrome, setChrome] = useState(true);
  const [dateOpen, setDateOpen] = useState(false);
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [smallerOpen, setSmallerOpen] = useState(initialSmallerOpen);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<'trim' | 'crop' | 'size' | null>(initialEditorTab ?? null);
  const [note, setNote] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [fast, setFast] = useState(false);
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [markMenu, setMarkMenu] = useState<Bookmark | null>(null);
  const [renaming, setRenaming] = useState<Bookmark | null>(null);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [skip, setSkip] = useState<{ dir: -1 | 1; n: number } | null>(null);
  const resumeDone = useRef(false);
  /** While the bar is being dragged (and just after), player time updates are ignored. */
  const scrubbing = useRef(false);
  const holdUntil = useRef(0);
  const wasPlaying = useRef(false);
  const lastSeek = useRef(0);

  // The cover stays on top until the first frame is ready, so changing videos never flashes black.
  useEffect(() => {
    if (player.status === 'readyToPlay') setReady(true);
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') setReady(true);
    });
    const play = player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying));
    return () => {
      sub.remove();
      play.remove();
    };
  }, [player]);

  const loadMarks = () => {
    actions
      .loadBookmarks(item.id)
      .then(setMarks)
      .catch(() => undefined);
  };
  useEffect(loadMarks, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Record how much of the video was watched (content time; seeks are not counted).
  const watched = useRef({ ms: 0, last: -1, openedAt: Date.now() });
  useEffect(() => {
    const w = watched.current;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (w.last >= 0 && player.playing) {
        const delta = currentTime - w.last;
        if (delta > 0 && delta < 1.5) w.ms += delta * 1000;
      }
      w.last = currentTime;
    });
    return () => {
      sub.remove();
      void actions.recordPlay(item.id, w.openedAt, w.ms).catch(() => undefined);
    };
  }, [player, item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick a saved video up again, 2.5 minutes before where you stopped.
  useEffect(() => {
    if (!enableVideo || !prefs.resumeEnabled || resumeAt === null || resumeDone.current) return;
    const go = () => {
      if (resumeDone.current) return;
      resumeDone.current = true;
      const from = resumeFrom(resumeAt, item.durationMs ?? (player.duration ? player.duration * 1000 : null));
      player.currentTime = from / 1000;
      setResumedFrom(from);
    };
    if (player.status === 'readyToPlay') go();
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') go();
    });
    return () => sub.remove();
  }, [player, resumeAt, enableVideo, prefs.resumeEnabled, item.durationMs]);

  // Played to the end: the saved point is no longer needed.
  useEffect(() => {
    if (resumeAt !== null && progress > 0.97) void actions.setResume(item.id, null);
  }, [progress > 0.97]); // eslint-disable-line react-hooks/exhaustive-deps

  function holdFast(on: boolean) {
    if (!enableVideo || !prefs.holdForSpeed) return;
    if (!on && player.playbackRate === 1) return;
    player.playbackRate = on ? 2 : 1;
    if (on && !player.playing) {
      player.play();
      setPlaying(true);
    }
    if (on) tick();
    setFast(on);
  }

  function addMark() {
    const at = Math.round(progress * totalSec * 1000);
    success();
    actions
      .addBookmark(item.id, at, null)
      .then(() => {
        setNote(`Bookmarked ${fmtClock(at)} - hold it to name it`);
        loadMarks();
      })
      .catch((e) => setNote(`Not saved: ${String(e)}`));
  }

  function continueLater() {
    const at = Math.round(progress * totalSec * 1000);
    if (player.playing) player.pause();
    actions
      .setResume(item.id, at)
      .then(() => {
        success();
        onClose();
      })
      .catch((e) => setNote(`Not saved: ${String(e)}`));
  }

  const framesRef = useRef<ThumbSource[]>([]);
  framesRef.current = frames;
  const lastIdx = useRef(-1);
  const stripRef = useRef<ScrollView>(null);

  useEffect(() => {
    actions
      .loadTags(item.id)
      .then(setVideoTags)
      .catch((e) => console.log(`[TAG] load failed: ${String(e)}`));
  }, [item.id, actions]);

  useEffect(() => {
    actions
      .loadFrames(item)
      .then(setFrames)
      .catch((e) => console.log(`[FILM] failed: ${String(e)}`));
  }, [item, actions]);

  // Playhead + auto-scroll the strip.
  useEffect(() => {
    const sub = player.addListener('timeUpdate', (payload) => {
      if (scrubbing.current || Date.now() < holdUntil.current) return;
      const total = player.duration || (item.durationMs ?? 0) / 1000;
      if (!total) return;
      const fraction = Math.min(1, Math.max(0, payload.currentTime / total));
      setProgress(fraction);
      const count = framesRef.current.length;
      if (count) {
        const idx = Math.min(count - 1, Math.floor(fraction * count));
        if (idx !== lastIdx.current) {
          lastIdx.current = idx;
          stripRef.current?.scrollTo({ x: Math.max(0, idx * (FRAME_W + FRAME_GAP) - 60), animated: true });
        }
      }
    });
    return () => sub.remove();
  }, [player, item.durationMs]);

  // Scrobble a linked video: start / pause as it plays, stop (= watched at 80 %+) at 90 % or on close.
  const scrob = useRef({ started: false, done: false, progress: 0 });
  useEffect(() => {
    if (!simkl?.connected || !link || !enableVideo) return;
    const target = { simklId: link.simklId, type: link.type, season: link.season, episode: link.episode };
    const state = { started: false, done: false, progress: 0 };
    scrob.current = state;
    const send = (action: 'start' | 'pause' | 'stop') =>
      simkl.scrobble(item.id, target, action, state.progress * 100).catch((e) => console.log(`[SCROBBLE] ${action} failed: ${String(e)}`));
    const playing = player.addListener('playingChange', ({ isPlaying }) => {
      if (state.done) return;
      if (isPlaying) {
        state.started = true;
        void send('start');
      } else if (state.started) void send('pause');
    });
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      const total = player.duration || (item.durationMs ?? 0) / 1000;
      if (!total) return;
      state.progress = Math.min(1, currentTime / total);
      if (!state.done && state.started && state.progress >= 0.9) {
        state.done = true;
        void send('stop').then((r) => {
          if (r === 'watched' || r === 'already') {
            success();
            setNote(`Marked ${link.type === 'movie' ? link.title : episodeCode(link.type, link.season ?? 1, link.episode ?? 1)} watched on Simkl`);
            onLinkChanged?.();
          }
        });
      }
    });
    return () => {
      playing.remove();
      time.remove();
      if (state.started && !state.done) void send('stop');
    };
  }, [simkl, link, player, item.id, item.durationMs, enableVideo]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Recently used albums first, then pinned, then the rest - HashPhotos' album bar. */
  const barAlbums = useMemo(
    () =>
      [...albums].sort(
        (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)
      ),
    [albums]
  );

  const dt = fmtDateTime(item.createdAt);
  const imported = fmtDateTime(item.importedAt);
  const totalSec = player.duration || (item.durationMs ?? 0) / 1000;
  const elapsed = Math.round(progress * totalSec);

  function togglePlay() {
    if (!enableVideo) return;
    if (player.playing) player.pause();
    else player.play();
    setPlaying(!player.playing);
  }

  const durationSec = () => player.duration || (item.durationMs ?? 0) / 1000;

  function seek(fraction: number) {
    setProgress(fraction);
    holdUntil.current = Date.now() + 500;
    if (!enableVideo) return;
    const d = durationSec();
    if (d > 0) {
      player.currentTime = d * fraction;
      player.play();
      setPlaying(true);
      console.log(`[SEEK] ${(fraction * 100).toFixed(0)}%`);
    }
  }

  /* Scrubbing: pause under the finger, show the frame as it moves, carry on after. */
  function scrubStart() {
    scrubbing.current = true;
    wasPlaying.current = enableVideo ? player.playing : false;
    if (enableVideo && player.playing) player.pause();
  }
  function scrubMove(f: number) {
    setProgress(f);
    const now = Date.now();
    if (!enableVideo || now - lastSeek.current < 70) return;
    lastSeek.current = now;
    const d = durationSec();
    if (d > 0) player.currentTime = d * f;
  }
  function scrubEnd(f: number) {
    setProgress(f);
    holdUntil.current = Date.now() + 500;
    scrubbing.current = false;
    if (!enableVideo) return;
    const d = durationSec();
    if (d > 0) player.currentTime = d * f;
    if (wasPlaying.current) player.play();
  }

  /** Double-tap a side: 10 seconds back or forward. */
  function jump(dir: -1 | 1) {
    tick();
    setSkip((s) => ({ dir, n: s && s.dir === dir ? s.n + 10 : 10 }));
    const d = durationSec();
    if (enableVideo && d > 0) {
      const t = Math.min(d, Math.max(0, player.currentTime + dir * 10));
      player.currentTime = t;
      setProgress(t / d);
      holdUntil.current = Date.now() + 400;
    }
  }
  useEffect(() => {
    if (!skip) return;
    const t = setTimeout(() => setSkip(null), 700);
    return () => clearTimeout(t);
  }, [skip]);

  /* ---------------------------------------------------------- gestures */

  const hasPrev = !!prev;
  const hasNext = !!next;
  const axis = useSharedValue(0); // 0 = not decided, 1 = sideways (paging), 2 = down (closing)

  const pan = Gesture.Pan()
    .minDistance(12)
    .onStart(() => {
      'worklet';
      axis.value = 0;
    })
    .onUpdate((e) => {
      'worklet';
      if (axis.value === 0) axis.value = Math.abs(e.translationX) > Math.abs(e.translationY) ? 1 : e.translationY > 0 ? 2 : 0;
      if (axis.value === 1) {
        const x = e.translationX;
        // Past the first or last video it only gives a little, like a rubber band.
        tx.value = (x > 0 && !hasPrev) || (x < 0 && !hasNext) ? x * 0.22 : x;
      } else if (axis.value === 2) {
        ty.value = Math.max(0, e.translationY);
        dx.value = e.translationX * 0.7;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (axis.value === 1) {
        const dir = (e.translationX < -W * 0.22 || e.velocityX < -650) && hasNext ? 1 : (e.translationX > W * 0.22 || e.velocityX > 650) && hasPrev ? -1 : 0;
        if (dir !== 0) {
          tx.value = withTiming(-dir * (W + PAGE_GAP), { duration: DUR.base, easing: EASE_OUT }, (done) => {
            if (done) scheduleOnRN(onStep, dir as 1 | -1);
          });
        } else tx.value = withSpring(0, SPRING);
      } else if (axis.value === 2) {
        if (e.translationY > 110 || e.velocityY > 900) {
          ty.value = withTiming(H, { duration: DUR.base, easing: EASE_OUT }, (done) => {
            if (done) scheduleOnRN(onClose);
          });
        } else {
          ty.value = withSpring(0, SPRING);
          dx.value = withSpring(0, SPRING);
        }
      }
    });

  const singleTap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(260)
    .onEnd((_e, ok) => {
      if (ok) setChrome((c) => !c);
    });
  const doubleTap = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .maxDelay(240)
    .onEnd((e, ok) => {
      if (ok) jump(e.x < W / 2 ? -1 : 1);
    });
  const hold = Gesture.LongPress()
    .runOnJS(true)
    .minDuration(280)
    .onStart((e) => {
      if (e.x < W * 0.28 || e.x > W * 0.72) holdFast(true);
    })
    .onFinalize(() => holdFast(false));
  const gestures = Gesture.Race(pan, hold, Gesture.Exclusive(doubleTap, singleTap));

  const rowStyle = useAnimatedStyle(() => {
    const pull = Math.min(1, ty.value / Math.max(1, H));
    return { transform: [{ translateX: tx.value + dx.value }, { translateY: ty.value }, { scale: 1 - pull * 0.35 }] };
  });
  const chromeFade = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, ty.value / 90) - Math.min(0.6, Math.abs(tx.value) / Math.max(1, W)) }));
  const dark = useSharedValue(0);
  useEffect(() => {
    dark.value = withTiming(chrome ? 0 : 1, { duration: DUR.base, easing: EASE_OUT });
  }, [chrome]); // eslint-disable-line react-hooks/exhaustive-deps
  const bgStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, ty.value / (H * 0.55)) }));
  const blackStyle = useAnimatedStyle(() => ({ opacity: dark.value }));

  async function onRate(n: number) {
    const next = n === rating ? 0 : n;
    setRating(next);
    await actions.onRate(item.id, next);
    console.log(`[RATE] ${item.filename} → ${next}`);
  }

  async function onFlag(next: UiFlag) {
    const value = next === flag ? 0 : next;
    setFlag(value);
    await actions.onSetFlag([item.id], value);
  }

  async function onStatus(next: UiStatus) {
    const value = next === watch ? null : next;
    setWatch(value);
    await actions.onSetStatus([item.id], value);
    console.log(`[STATUS] ${item.filename} → ${value ?? 'none'}`);
  }

  async function toggleAlbum(album: UiAlbum) {
    if (albumIds.includes(album.id)) {
      setAlbumIds((ids) => ids.filter((x) => x !== album.id));
      await actions.onRemoveFromAlbum([item.id], album.id);
    } else {
      setAlbumIds((ids) => [...ids, album.id]);
      await actions.onAddToAlbums([item.id], [album.id]);
    }
  }

  async function onAddTag() {
    const name = draft.trim();
    if (!name) return;
    await actions.onAddTag(item.id, name);
    setDraft('');
    setVideoTags(await actions.loadTags(item.id));
    console.log(`[TAG] +${name} @ ${item.filename}`);
  }

  async function onRemoveTag(tag: UiTag) {
    await actions.onRemoveTag(item.id, tag.id);
    setVideoTags(await actions.loadTags(item.id));
  }

  function confirmDelete() {
    confirmAction('Delete video?', `It moves to Recently Deleted for ${RECENTLY_DELETED_DAYS} days.`, () => {
      actions
        .onDeleteOne(item)
        .then(onClose)
        .catch((e) => console.log(`[DELETE] failed: ${String(e)}`));
    });
  }

  /** Moving a video in or out of Private takes it out of the current view, so close. */
  function togglePrivate() {
    actions
      .onSetPrivate([item.id], !item.isPrivate)
      .then(onClose)
      .catch((e) => console.log(`[PRIVATE] failed: ${String(e)}`));
  }

  function run(label: string, job: Promise<void>) {
    job.then(() => setNote(label)).catch((e) => setNote(`That did not work: ${String(e)}`));
  }

  const isFavourite = rating >= FAVOURITE_RATING;
  const format = fmtFormat(item.filename);
  const bitrate = fmtBitrate(item.sizeBytes, item.durationMs);
  const loc = item.meta?.location;
  const camera = [item.meta?.make, item.meta?.model].filter(Boolean).join(' ');

  return (
    <View style={styles.viewer}>
        <Animated.View style={[fill, { backgroundColor: p.bg }, bgStyle]} pointerEvents="none">
          <Animated.View style={[fill, { backgroundColor: '#000' }, blackStyle]} />
        </Animated.View>

        {/* ── media: swipe for the next video, drag down to close, tap to hide everything else ── */}
        <Animated.View style={styles.stage} layout={reduce ? undefined : LinearTransition.duration(DUR.base).easing(EASE_OUT)}>
          <GestureDetector gesture={gestures}>
            <View style={styles.stageTouch} collapsable={false}>
              <Animated.View style={[fill, rowStyle]}>
                {prev && <Image source={prev.thumbSource} style={[styles.neighbour, { left: -(W + PAGE_GAP), width: W }]} contentFit="contain" />}
                {enableVideo ? (
                  <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />
                ) : (
                  <View style={styles.video} />
                )}
                {!ready && (
                  <Animated.View style={fill} exiting={FadeOut.duration(DUR.fast)} pointerEvents="none">
                    <Image source={item.thumbSource} style={styles.video} contentFit="contain" />
                  </Animated.View>
                )}
                {next && <Image source={next.thumbSource} style={[styles.neighbour, { left: W + PAGE_GAP, width: W }]} contentFit="contain" />}
              </Animated.View>
            </View>
          </GestureDetector>
          {fast && (
            <Animated.View entering={fadeIn} exiting={FadeOut.duration(DUR.fast)} style={[styles.fastPill, { top: insets.top + 60 }]} pointerEvents="none">
              <Icon name="fast" size={13} color="#fff" />
              <Text style={styles.fastText}>2×</Text>
            </Animated.View>
          )}
          {skip && (
            <Animated.View
              key={`${skip.dir}${skip.n}`}
              entering={FadeIn.duration(120)}
              exiting={FadeOut.duration(DUR.base)}
              pointerEvents="none"
              style={[styles.skipPill, skip.dir < 0 ? { left: 24 } : { right: 24 }]}>
              <Icon name={skip.dir < 0 ? 'rewatch' : 'fast'} size={14} color="#fff" />
              <Text style={styles.fastText}>
                {skip.dir < 0 ? '−' : '+'}
                {skip.n}s
              </Text>
            </Animated.View>
          )}
        </Animated.View>

        {chrome && (
          <>
            {/* ── header (over the video, with a soft shade so the buttons always show) ── */}
            <Animated.View entering={fadeIn} exiting={FadeOut.duration(DUR.fast)} style={[styles.headerWrap, chromeFade]} pointerEvents="box-none">
              <Fade color="0,0,0" from={0} to={0.55} reverse style={[fill, { bottom: -30 }]} />
              <View style={[styles.header, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
                <IconButton icon="back" label="Back" clear color="#fff" onPress={onDismiss} size={38} />

                <View style={styles.titleWrap} pointerEvents="none">
                  <Text style={styles.titleDate} numberOfLines={1}>
                    {item.title || dt.date}
                  </Text>
                  <Text style={styles.titleTime}>{item.title ? `${dt.date} ${dt.time}` : dt.time}</Text>
                </View>

                <View style={styles.headerRight}>
                  <IconButton icon="info" label="Info" clear color="#fff" size={38} tint={infoOpen ? p.accent : undefined} onPress={() => setInfoOpen((v) => !v)} />
                  <IconButton icon="more" label="More" clear color="#fff" size={38} onPress={() => setMenuOpen(true)} />
                </View>
              </View>
              {link && (
                <TouchableOpacity style={styles.linkPill} onPress={() => setLinkOpen(true)} accessibilityLabel="Linked to Simkl">
                  <Icon name="tv" size={12} color="#fff" />
                  <Text style={styles.linkPillText} numberOfLines={1}>
                    {link.title}
                    {link.type !== 'movie' ? ` · ${episodeCode(link.type, link.season ?? 1, link.episode ?? 1)}` : ''}
                    {link.loggedAt ? '  ✓' : ''}
                  </Text>
                </TouchableOpacity>
              )}
            </Animated.View>

            {/* ── bottom stack ────────────────────────────────────────── */}
            <Animated.View
              entering={reduce ? fadeIn : SlideInDown.duration(DUR.base).easing(EASE_OUT)}
              exiting={reduce ? FadeOut.duration(DUR.fast) : SlideOutDown.duration(DUR.fast)}
              style={[styles.bottom, chromeFade]}>
              {!!note && (
                <TouchableOpacity onPress={() => setNote('')}>
                  <Text style={styles.note}>{note}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.scrub}>
                <TouchableOpacity onPress={togglePlay} hitSlop={10} accessibilityLabel="Play or pause">
                  <Icon name={playing ? 'pause' : 'play'} size={18} color={p.text} />
                </TouchableOpacity>
                <Scrubber
                  fraction={progress}
                  durationSec={totalSec}
                  marks={marks.map((m) => m.atMs)}
                  color={p.text}
                  trackColor={p.border}
                  markColor={p.rating}
                  onStart={scrubStart}
                  onMove={scrubMove}
                  onEnd={scrubEnd}
                />
                <Text style={styles.scrubTime}>
                  {fmtDuration(elapsed * 1000) ?? '0:00'} / {fmtDuration(totalSec * 1000) ?? '--:--'}
                </Text>
                <TouchableOpacity onPress={addMark} hitSlop={8} accessibilityLabel="Bookmark this moment">
                  <Icon name="bookmarkAdd" size={17} color={p.text} />
                </TouchableOpacity>
                {prefs.resumeEnabled && canResume(item.durationMs) && (
                  <TouchableOpacity onPress={continueLater} hitSlop={8} accessibilityLabel="Continue another time">
                    <Icon name="later" size={17} color={p.text} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityLabel="More">
                  <Icon name="more" size={18} color={p.text} />
                </TouchableOpacity>
              </View>

              {resumedFrom !== null && (
                <View style={styles.resumeRow}>
                  <Icon name="later" size={13} color={p.accent} />
                  <Text style={styles.resumeText}>Continuing from {fmtClock(resumedFrom)}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      player.currentTime = 0;
                      setResumedFrom(null);
                      void actions.setResume(item.id, null);
                    }}>
                    <Text style={styles.resumeLink}>Start over</Text>
                  </TouchableOpacity>
                </View>
              )}

              {marks.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.markRow}>
                  {marks.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={styles.markChip}
                      onPress={() => seek(Math.min(1, m.atMs / 1000 / Math.max(1, totalSec)))}
                      onLongPress={() => setMarkMenu(m)}>
                      <Icon name="bookmark" size={11} color={p.accent} />
                      <Text style={styles.markText} numberOfLines={1}>
                        {fmtClock(m.atMs)}
                        {m.label ? `  ${m.label}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {frames.map((src, i) => (
                  <TouchableOpacity key={i} onPress={() => seek((i + 0.5) / frames.length)}>
                    <Image source={src} style={styles.stripFrame} contentFit="cover" />
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* album bar */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albumBar}>
                {barAlbums.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.albumChip, albumIds.includes(a.id) && styles.albumChipOn]}
                    onPress={() => void toggleAlbum(a)}>
                    <Text style={[styles.albumChipText, albumIds.includes(a.id) && styles.albumChipTextOn]} numberOfLines={1}>
                      {albumIds.includes(a.id) ? '✓ ' : ''}
                      {a.name}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.albumChip} onPress={() => setNewAlbumOpen(true)}>
                  <Text style={styles.albumChipText}>+ Album</Text>
                </TouchableOpacity>
              </ScrollView>

              <View style={[styles.toolbar, { paddingBottom: insets.bottom + 10 }]}>
                <TouchableOpacity style={styles.tool} onPress={() => void onFlag(1)} accessibilityLabel="Pick">
                  <Icon name="flag" size={18} color={flag === 1 ? '#30d158' : p.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.tool} onPress={() => void onFlag(-1)} accessibilityLabel="Reject">
                  <Icon name="close" size={18} color={flag === -1 ? '#ff453a' : p.textSecondary} weight="bold" />
                </TouchableOpacity>
                <View style={styles.stars}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <TouchableOpacity key={n} onPress={() => onRate(n)} onLongPress={() => setPickerOpen(true)} hitSlop={4}>
                      <Text style={[styles.star, n <= rating && styles.starOn]}>{n <= rating ? '★' : '☆'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {!!ratingLabel(rating, prefs.ratingLabels) && (
                  <Text style={styles.rateWord} numberOfLines={1}>
                    {ratingLabel(rating, prefs.ratingLabels)}
                  </Text>
                )}
                <TouchableOpacity style={styles.tool} onPress={() => setMenuOpen(true)} accessibilityLabel="More">
                  <Icon name="more" size={18} color={p.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.tool} onPress={confirmDelete} accessibilityLabel="Delete">
                  <Icon name="trash" size={18} color={p.dangerText} />
                </TouchableOpacity>
              </View>
            </Animated.View>
          </>
        )}

        {/* ── info panel ────────────────────────────────────────────────── */}
        {infoOpen && (
          <Animated.View style={styles.infoRoot} exiting={FadeOut.duration(DUR.fast)}>
            <Animated.View entering={fadeIn} exiting={FadeOut.duration(DUR.fast)} style={styles.infoBackdrop}>
              <TouchableOpacity style={fill} activeOpacity={1} onPress={() => setInfoOpen(false)} accessibilityLabel="Close info" />
            </Animated.View>
            <Animated.View
              entering={reduce ? fadeIn : SlideInDown.duration(DUR.base).easing(EASE_OUT)}
              exiting={reduce ? FadeOut.duration(DUR.fast) : SlideOutDown.duration(DUR.fast)}
              style={[styles.infoSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.infoHeader}>
                <TouchableOpacity style={styles.circle} onPress={() => setInfoOpen(false)}>
                  <Glyph name="close" />
                </TouchableOpacity>
                <Text style={styles.infoTitle}>Info</Text>
                <View style={styles.circleGhost} />
              </View>

              <ScrollView contentContainerStyle={styles.infoBody} keyboardShouldPersistTaps="handled">
                <View style={styles.thumbWrap}>
                  <Image source={item.thumbSource} style={styles.thumbPreview} contentFit="cover" />
                </View>

                {/* the blue filename bar */}
                <View style={styles.fileBar}>
                  <Text style={styles.fileBarIcon}>▶</Text>
                  <Text style={styles.fileBarText} numberOfLines={1}>
                    {item.filename}
                  </Text>
                </View>

                <TextInput
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  onEndEditing={() => void actions.onSetText([item.id], 'title', title)}
                  placeholder="Tap here to add title"
                  placeholderTextColor={p.link}
                  keyboardAppearance={p.scheme}
                  returnKeyType="done"
                />
                <TextInput
                  style={styles.captionInput}
                  value={caption}
                  onChangeText={setCaption}
                  onEndEditing={() => void actions.onSetText([item.id], 'notes', caption)}
                  placeholder="No Caption"
                  placeholderTextColor={p.textSecondary}
                  keyboardAppearance={p.scheme}
                  multiline
                />

                <TouchableOpacity style={styles.infoRow} onPress={() => setDateOpen(true)}>
                  <Text style={styles.infoValue}>
                    {dt.date} at {dt.time}
                  </Text>
                  <Text style={styles.linkSmall}>Adjust</Text>
                </TouchableOpacity>

                <View style={styles.chipRow}>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>
                      {item.width && item.height ? `${item.width} x ${item.height}` : 'Unknown size'}
                    </Text>
                  </View>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{fmtSize(item.sizeBytes)}</Text>
                  </View>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{item.durationMs ? fmtDuration(item.durationMs) : '--:--'}</Text>
                  </View>
                  {format && (
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>{format}</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.section}>Details</Text>
                <Detail label="Camera" value={camera || 'No camera information'} />
                <Detail label="Software" value={item.meta?.software} />
                <Detail label="Codec" value={item.meta?.codec} />
                <Detail label="Frame rate" value={item.meta?.fps ? `${item.meta.fps} fps` : undefined} />
                <Detail label="Bitrate" value={bitrate ?? undefined} />
                <Detail
                  label="Made smaller"
                  value={item.originalSizeBytes ? `from ${fmtSize(item.originalSizeBytes)}` : undefined}
                />
                <Detail label="Imported" value={`${imported.date} at ${imported.time}`} />

                <Text style={styles.section}>Location</Text>
                {loc ? (
                  <>
                    <Text style={styles.infoValue}>{fmtLocation(loc)}</Text>
                    <View style={styles.linkRow}>
                      <TouchableOpacity onPress={() => actions.onOpenMap(loc.lat, loc.lon, item.title || item.filename)}>
                        <Text style={styles.linkSmall}>Open in Maps</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          onNearby(item);
                          onClose();
                        }}>
                        <Text style={styles.linkSmall}>Videos nearby</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <Text style={styles.infoMuted}>No Location Data</Text>
                )}

                <Text style={styles.section}>Status</Text>
                <View style={styles.pills}>
                  {STATUSES.map((s) => (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.statusChip, watch === s.key && styles.statusChipOn]}
                      onPress={() => void onStatus(s.key)}>
                      <Text style={[styles.statusChipText, watch === s.key && styles.statusChipTextOn]}>{s.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {albumIds.length > 0 && (
                  <>
                    <Text style={styles.section}>Albums</Text>
                    <Text style={styles.infoValue}>
                      {albums
                        .filter((a) => albumIds.includes(a.id))
                        .map((a) => a.name)
                        .join(', ')}
                    </Text>
                  </>
                )}

                <Text style={styles.section}>Keywords</Text>
                <View style={styles.pills}>
                  {videoTags.length === 0 && <Text style={styles.infoMuted}>No keywords yet.</Text>}
                  {videoTags.map((t) => (
                    <TouchableOpacity key={t.id} style={styles.pill} onPress={() => onRemoveTag(t)}>
                      <Text style={styles.pillText}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder="add a keyword…"
                    placeholderTextColor={p.textMuted}
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={onAddTag}
                    autoCapitalize="none"
                    returnKeyType="done"
                    keyboardAppearance={p.scheme}
                  />
                  <TouchableOpacity style={styles.addBtn} onPress={onAddTag}>
                    <Text style={styles.addBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}

        {/* ── actions sheet ─────────────────────────────────────────────── */}
        {menuOpen && (
          <Animated.View style={styles.infoRoot} exiting={FadeOut.duration(DUR.fast)}>
            <Animated.View entering={fadeIn} exiting={FadeOut.duration(DUR.fast)} style={styles.infoBackdrop}>
              <TouchableOpacity style={fill} activeOpacity={1} onPress={() => setMenuOpen(false)} accessibilityLabel="Close menu" />
            </Animated.View>
            <Animated.View
              entering={reduce ? fadeIn : SlideInDown.duration(DUR.base).easing(EASE_OUT)}
              exiting={reduce ? FadeOut.duration(DUR.fast) : SlideOutDown.duration(DUR.fast)}
              style={[styles.menuSheet, { paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.grabber} />
              <Text style={styles.menuTitle} numberOfLines={1}>
                {item.filename}
              </Text>
              <ScrollView style={styles.menuScroll}>
                <MenuRow
                  label="Favourite"
                  hint={isFavourite ? 'On' : 'Off'}
                  onPress={() => {
                    setMenuOpen(false);
                    void onRate(isFavourite ? 0 : FAVOURITE_RATING);
                  }}
                />
                <MenuRow
                  label="Rate with Decimals…"
                  hint={rating > 0 ? `${Number.isInteger(rating) ? rating : rating.toFixed(1)}/10` : 'e.g. 9.7'}
                  onPress={() => {
                    setMenuOpen(false);
                    setPickerOpen(true);
                  }}
                />
                <MenuRow
                  label="Status"
                  hint={statusLabel(watch)}
                  onPress={() => {
                    setMenuOpen(false);
                    setInfoOpen(true);
                  }}
                />
                <MenuRow
                  label="Keyword, title, caption"
                  hint={`${videoTags.length}`}
                  onPress={() => {
                    setMenuOpen(false);
                    setInfoOpen(true);
                  }}
                />
                <MenuRow
                  label="Bookmark This Moment"
                  hint={fmtDuration(elapsed * 1000) ?? '0:00'}
                  onPress={() => {
                    setMenuOpen(false);
                    addMark();
                  }}
                />
                {prefs.resumeEnabled && canResume(item.durationMs) && (
                  <MenuRow
                    label="Continue Another Time"
                    hint={`From ${fmtClock(Math.max(0, elapsed * 1000 - 150_000))}`}
                    onPress={() => {
                      setMenuOpen(false);
                      continueLater();
                    }}
                  />
                )}
                {simkl && (
                  <MenuRow
                    label={link ? 'Simkl Link…' : 'Link to Simkl…'}
                    hint={
                      link
                        ? link.type === 'movie'
                          ? link.title
                          : `${link.title} ${episodeCode(link.type, link.season ?? 1, link.episode ?? 1)}`
                        : 'Logs it when you finish'
                    }
                    onPress={() => {
                      setMenuOpen(false);
                      setLinkOpen(true);
                    }}
                  />
                )}
                <MenuRow
                  label={inTray ? 'Remove from Tray' : 'Add to Tray'}
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    setInTray(!inTray);
                    run(inTray ? 'Removed from the Tray' : 'Added to the Tray', actions.onSetTray([item.id], !inTray));
                  }}
                />
                <MenuRow
                  label="Adjust Date & Time"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    setDateOpen(true);
                  }}
                />
                <MenuRow
                  label="Share / Save to Files"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    void actions.onShare(item);
                  }}
                />
                <MenuRow
                  label="Save to Photos"
                  hint="Copy"
                  onPress={() => {
                    setMenuOpen(false);
                    run('Saved to Photos', actions.onSaveToPhotos([item]));
                  }}
                />
                <MenuRow
                  label="Save This Frame as Image"
                  hint={fmtDuration(elapsed * 1000) ?? '0:00'}
                  onPress={() => {
                    setMenuOpen(false);
                    void actions.onExtractFrame(item, progress * totalSec * 1000);
                  }}
                />
                <MenuRow
                  label="Use This Frame as Cover"
                  hint={fmtDuration(elapsed * 1000) ?? '0:00'}
                  onPress={() => {
                    setMenuOpen(false);
                    run('Cover changed', actions.onSetCoverFrame(item, progress * totalSec * 1000));
                  }}
                />
                <MenuRow
                  label="Choose Cover Photo…"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    actions
                      .onPickCover(item)
                      .then((picked) => picked && setNote('Cover changed'))
                      .catch((e) => setNote(`That did not work: ${String(e)}`));
                  }}
                />
                {item.customCover && (
                  <MenuRow
                    label="Reset Cover"
                    hint="First frame"
                    onPress={() => {
                      setMenuOpen(false);
                      run('Cover reset', actions.onResetCover(item));
                    }}
                  />
                )}
                <MenuRow
                  label="Trim, Crop & Resize…"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    if (player.playing) player.pause();
                    setEditorTab('trim');
                  }}
                />
                <MenuRow
                  label="Make Smaller…"
                  hint={fmtSize(item.sizeBytes)}
                  onPress={() => {
                    setMenuOpen(false);
                    if (player.playing) player.pause();
                    setSmallerOpen(true);
                  }}
                />
                <MenuRow
                  label="Slideshow from Here"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    onSlideshow(item);
                  }}
                />
                <MenuRow
                  label="Duplicate"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    run('Duplicated - the copy is in the library', actions.onDuplicate(item));
                  }}
                />
                <MenuRow
                  label={item.isPrivate ? 'Remove from Private' : 'Move to Private'}
                  hint={item.isPrivate ? '' : 'Locked'}
                  onPress={() => {
                    setMenuOpen(false);
                    togglePrivate();
                  }}
                />
                <MenuRow
                  label="Delete"
                  danger
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    confirmDelete();
                  }}
                />
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}

        {dateOpen && (
          <DateSheet
            count={1}
            initial={item.createdAt}
            onApply={(change) => actions.onAdjustDates([item.id], change)}
            onClose={() => setDateOpen(false)}
          />
        )}

        {editorTab && (
          <EditorModal
            item={item}
            actions={actions}
            enableVideo={enableVideo}
            initialTab={editorTab}
            onDone={(message) => {
              setEditorTab(null);
              setNote(message);
            }}
            onClose={() => setEditorTab(null)}
          />
        )}

        {linkOpen && simkl && (
          <LinkSheet item={item} bridge={simkl} link={link} onChanged={() => onLinkChanged?.()} onClose={() => setLinkOpen(false)} />
        )}

        {markMenu && (
          <OptionsSheet
            title={`Bookmark ${fmtClock(markMenu.atMs)}`}
            options={[
              { label: 'Jump here', onPress: () => seek(Math.min(1, markMenu.atMs / 1000 / Math.max(1, totalSec))) },
              { label: markMenu.label ? 'Rename' : 'Name it', onPress: () => setRenaming(markMenu) },
              {
                label: 'Delete',
                danger: true,
                onPress: () => void actions.deleteBookmark(markMenu.id).then(loadMarks),
              },
            ]}
            onClose={() => setMarkMenu(null)}
          />
        )}
        {renaming && (
          <PromptSheet
            title="Name this moment"
            initial={renaming.label ?? ''}
            placeholder="The best part"
            onSubmit={(name) => void actions.renameBookmark(renaming.id, name).then(loadMarks)}
            onClose={() => setRenaming(null)}
          />
        )}

        {pickerOpen && (
          <RatingPicker
            title="Rate this video"
            value={rating > 0 ? rating : null}
            note={(n) => ratingLabel(n, prefs.ratingLabels) ?? 'Tip: hold the stars to open this.'}
            onPick={(n) => {
              const next = n ?? 0;
              setRating(next);
              void actions.onRate(item.id, next);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}

        {smallerOpen && (
          <SmallerSheet
            items={[item]}
            available={actions.canMakeSmaller()}
            onMakeSmaller={actions.onMakeSmaller}
            onCancel={actions.onCancelMakeSmaller}
            onClose={() => setSmallerOpen(false)}
          />
        )}

        {newAlbumOpen && (
          <PromptSheet
            title="New Album"
            message={item.isPrivate ? 'A private album, only shown when Private is unlocked.' : undefined}
            placeholder="Album name"
            confirmLabel="Create"
            onSubmit={(name) => {
              actions
                .onCreateAlbum(name, { isPrivate: item.isPrivate })
                .then((id) => actions.onAddToAlbums([item.id], [id]).then(() => setAlbumIds((ids) => [...ids, id])))
                .catch((e) => console.log(`[ALBUM] create failed: ${String(e)}`));
            }}
            onClose={() => setNewAlbumOpen(false)}
          />
        )}
    </View>
  );
}


type ViewerProps = {
  item: VaultItem;
  actions: VaultScreenProps['actions'];
  /** Albums this video can go into (private ones only for private videos). */
  albums: UiAlbum[];
  enableVideo: boolean;
  /** Preview-only: open a panel on first render so it can be screenshotted. */
  initialInfoOpen?: boolean;
  initialMenuOpen?: boolean;
  initialSmallerOpen?: boolean;
  /** Preview only: open the editor on this tab. */
  initialEditorTab?: 'trim' | 'crop' | 'size';
  /** Play the current list as a slideshow, starting here. */
  onSlideshow: (item: VaultItem) => void;
  /** Show the videos filmed near this one. */
  onNearby: (item: VaultItem) => void;
  /** Simkl, for linking this video to a movie or episode and scrobbling it. */
  simkl?: SimklBridge;
  link?: VideoLink | null;
  onLinkChanged?: () => void;
  /** A saved "continue another time" point (ms), if there is one. */
  resumeAt?: number | null;
  prefs?: VaultPrefs;
  onClose: () => void;
};

/**
 * The viewer: stays open while you swipe between videos (each one gets a fresh
 * page, so ratings, tags and the player belong to that video), and opens and
 * closes with a short zoom.
 */
export default function ViewerModal({
  items = [],
  onChangeItem,
  ...props
}: ViewerProps & {
  /** The list you opened it from, for swiping to the previous / next video. */
  items?: VaultItem[];
  onChangeItem?: (item: VaultItem) => void;
}) {
  const { item, onClose } = props;
  const reduce = useReducedMotion();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const dx = useSharedValue(0);
  const out = useSharedValue(0);

  const index = items.findIndex((v) => v.id === item.id);
  const prev = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : undefined;

  // The new page starts centred; the swipe that brought it here is over.
  useLayoutEffect(() => {
    tx.value = 0;
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = useCallback(
    (dir: 1 | -1) => {
      const target = dir === 1 ? next : prev;
      if (target && onChangeItem) {
        tick();
        onChangeItem(target);
      } else tx.value = withSpring(0, SPRING);
    },
    [next, prev, onChangeItem] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dismiss = useCallback(() => {
    out.value = withTiming(1, { duration: reduce ? DUR.fast : DUR.base, easing: EASE_OUT }, (done) => {
      if (done) scheduleOnRN(onClose);
    });
  }, [onClose, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const shell = useAnimatedStyle(() => ({ opacity: 1 - out.value, transform: [{ scale: 1 - out.value * 0.06 }] }));

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View entering={reduce ? fadeIn : zoomIn} style={[StyleSheet.absoluteFill, shell]}>
          <ViewerPage key={item.id} {...props} stage={{ tx, ty, dx }} prev={prev} next={next} onStep={step} onDismiss={dismiss} />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  const styles = useStyles(makeStyles);
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function MenuRow({
  label,
  hint,
  danger,
  onPress,
}: {
  label: string;
  hint: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress}>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      {!!hint && <Text style={styles.menuHint}>{hint}</Text>}
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    viewer: { flex: 1 },
    stage: { flex: 1, overflow: 'visible' },
    stageTouch: { flex: 1 },
    video: { width: '100%', height: '100%' },
    neighbour: { position: 'absolute', top: 0, bottom: 0 },
    headerWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 6 },
    skipPill: {
      position: 'absolute',
      top: '45%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    videoPlaceholderText: { color: p.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 1 },

    header: {
      paddingBottom: 8,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    titleWrap: { alignItems: 'center', flex: 1, paddingHorizontal: 8 },
    titleDate: { color: '#fff', fontSize: 17, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 6 },
    titleTime: { color: 'rgba(255,255,255,0.75)', fontSize: 13, textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 6 },
    headerRight: { flexDirection: 'row', gap: 8 },
    linkPill: {
      alignSelf: 'center',
      maxWidth: '80%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    linkPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    fastPill: {
      position: 'absolute',
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    fastText: { color: '#fff', fontSize: 14, fontWeight: '900' },
    scrubMark: { position: 'absolute', top: -3, width: 3, height: 9, borderRadius: 1.5, backgroundColor: p.rating },
    resumeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 6 },
    resumeText: { color: p.textSoft, fontSize: 12, fontWeight: '600', flex: 1 },
    resumeLink: { color: p.link, fontSize: 12, fontWeight: '700' },
    markRow: { gap: 6, paddingHorizontal: 14, paddingBottom: 8 },
    markChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 200 },
    markText: { color: p.textSoft, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
    rateWord: { color: p.rating, fontSize: 11, fontWeight: '700', maxWidth: 70 },
    circle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.circle,
    },
    circleGhost: { width: 34, height: 34 },
    circleOn: { backgroundColor: p.accent },
    circleIcon: { color: p.icon, fontSize: 15, fontWeight: '700' },
    circleIconOn: { color: '#fff' },

    bottom: { backgroundColor: p.viewerBar },
    note: { color: p.link, fontSize: 12, textAlign: 'center', paddingTop: 8 },
    scrub: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    scrubIcon: { color: p.text, fontSize: 13, fontWeight: '700' },
    scrubTrack: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      backgroundColor: p.border,
      justifyContent: 'center',
    },
    scrubFill: { height: 3, borderRadius: 2, backgroundColor: p.text },
    scrubThumb: { position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: p.text },
    scrubTime: { color: p.textSecondary, fontSize: 11, fontVariant: ['tabular-nums'] },

    strip: { gap: FRAME_GAP, paddingHorizontal: 14, paddingBottom: 8, alignItems: 'center' },
    stripFrame: { width: FRAME_W, height: FRAME_H, backgroundColor: p.tile },

    albumBar: { gap: 6, paddingHorizontal: 14, paddingBottom: 8 },
    albumChip: {
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.card,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 5,
      maxWidth: 160,
    },
    albumChipOn: { backgroundColor: p.accent, borderColor: p.accent },
    albumChipText: { color: p.textSoft, fontSize: 12, fontWeight: '600' },
    albumChipTextOn: { color: '#fff' },

    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingTop: 10,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: p.separator,
    },
    tool: { paddingVertical: 4, paddingHorizontal: 2 },
    toolIcon: { color: p.textSoft, fontSize: 17, fontWeight: '600' },
    toolPick: { color: '#34c759' },
    toolReject: { color: '#ff453a' },
    toolDanger: { color: p.dangerText, fontSize: 17, fontWeight: '700' },
    stars: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
    star: { color: p.starOff, fontSize: 14 },
    starOn: { color: p.rating },

    infoRoot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    infoBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.backdrop },
    infoSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '88%',
      backgroundColor: p.panel,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
    },
    infoHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 8,
    },
    infoTitle: { color: p.text, fontSize: 17, fontWeight: '700' },
    infoBody: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
    thumbWrap: { alignItems: 'center' },
    thumbPreview: { width: 120, height: 120, backgroundColor: p.tile },
    fileBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: p.accent,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    fileBarIcon: { color: '#fff', fontSize: 11 },
    fileBarText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
    titleInput: { color: p.text, fontSize: 15, fontWeight: '600', paddingVertical: 4 },
    captionInput: { color: p.textSoft, fontSize: 13, paddingVertical: 4, minHeight: 22 },
    infoMuted: { color: p.textSecondary, fontSize: 13 },
    infoValue: { color: p.textSoft, fontSize: 13, flexShrink: 1 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    linkSmall: { color: p.link, fontSize: 13, fontWeight: '600' },
    linkRow: { flexDirection: 'row', gap: 18 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { backgroundColor: p.card, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
    chipText: { color: p.textSoft, fontSize: 12 },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingTop: 4 },
    detail: { flexDirection: 'row', gap: 10 },
    detailLabel: { width: 82, color: p.textSecondary, fontSize: 13 },
    detailValue: { flex: 1, color: p.textSoft, fontSize: 13 },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: { backgroundColor: p.keyword, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
    pillText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    statusChip: {
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.card,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
    },
    statusChipOn: { backgroundColor: p.accent, borderColor: p.accent },
    statusChipText: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
    statusChipTextOn: { color: '#fff' },
    addRow: { flexDirection: 'row', gap: 8 },
    input: {
      flex: 1,
      backgroundColor: p.card,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: p.text,
    },
    addBtn: { backgroundColor: p.accent, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 10 },
    addBtnText: { color: '#fff', fontWeight: '700' },

    menuSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '80%',
      backgroundColor: p.panel,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingTop: 10,
      paddingHorizontal: 8,
    },
    menuScroll: { flexGrow: 0 },
    grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: p.grabber },
    menuTitle: { color: p.textSecondary, fontSize: 12, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderRadius: 10,
    },
    menuLabel: { color: p.textSoft, fontSize: 16 },
    menuLabelDanger: { color: p.dangerText },
    menuHint: { color: p.textSecondary, fontSize: 14 },
  });
