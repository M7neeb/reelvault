/**
 * The video viewer, laid out to match HashPhotos.
 *
 * HashPhotos is NOT a draggable sheet. It is a FIXED stack:
 *
 *   header      (back · date+time · info · edit · more), "Add To" under it
 *   media, filling everything above the bottom stack
 *   player bar  (play · film-strip scrubber · sound · player menu)
 *   neighbours  (the videos around this one; tap to go there)
 *   toolbar     (pick · reject · stars · more · delete)
 *
 * Tapping the video hides all of it (the video alone) and brings it back.
 * Nothing sits over the picture upright: the bars are under it. Sideways or
 * full screen only a slim player bar and the back button come over the video,
 * and they hide again a few seconds after you stop touching them. The player's
 * own settings (speed, loop, bookmarks, fill, glow, PiP, lock, full screen,
 * cover) live in the player menu at the end of the bar. The metadata lives in
 * a SEPARATE panel opened by the info button.
 *
 * Gestures, like the iOS Photos app: swipe left or right for the next or
 * previous video, drag down to close (the library shows through as you pull),
 * double-tap the left or right half to jump 10 seconds, and drag the playback
 * bar to scrub. The back button does the same as dragging down.
 *
 * A video linked to a Simkl movie or episode scrobbles while it plays: Simkl
 * shows it as "watching now", and finishing it marks it watched there.
 *
 * The stage: the video sits in a soft glow of its own colours (Ambient), with
 * a frame preview over the bar while you scrub, pinch to fill the screen (and back), a lock that ignores
 * every touch until you unlock it, picture in picture, playback speed, loop,
 * and Up Next: when a video ends the next one in the list starts after a
 * short countdown. The sound keeps playing when you leave the app (setting).
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

// The one native view the viewer uses besides the player: Apple's AirPlay button (renders nothing where missing).
import { AirPlayButton, hasAirPlay } from '../../../../modules/reelvault-airplay';
// Turning sideways (does nothing in builds before 1.9.1 and the browser preview).
import { allowRotation, canRotate, lockSideways, lockUpright, restoreRotation } from '../rotate';
import { CoverPicker } from './coverPicker';
import { pauseLookingInside } from '../scenes';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { GatedModal as Modal } from './screen';
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
import { StatusBar } from 'expo-status-bar';
import { Backdrop } from './frame';

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
import { DARK, sheet, usePalette, useStyles, withAccent, type Palette } from './theme';
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
  PLAYER_SPEEDS,
  PLAYER_STARTS,
  type PlayerOptions,
  type VaultPrefs,
} from './types';
import Glyph from './Glyph';
import Fade from './Fade';
import { DUR, EASE_OUT, fadeIn, SPRING, useReducedMotion, zoomIn } from './motion';
import FilmScrubber from './FilmScrubber';

/** The neighbour strip: a thumbnail, the gap between them and the current (wider) one. */
const NB_W = 34;
const NB_GAP = 2;
const NB_ON = 50;
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
  initialCoverOpen = false,
  initialEditorTab,
  onSlideshow,
  onNearby,
  simkl,
  link = null,
  onLinkChanged,
  resumeAt = null,
  startAt = null,
  prefs = DEFAULT_VAULT_PREFS,
  onPrefs,
  onClose,
  strip = [],
  onPick,
}: ViewerProps & {
  stage: Stage;
  prev?: VaultItem;
  next?: VaultItem;
  /** The videos around this one, for the strip under the player bar. */
  strip?: VaultItem[];
  /** Go straight to another video from the strip. */
  onPick?: (item: VaultItem) => void;
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
  // Over the video the controls are always dark (white on a see-through black), whatever the theme.
  const darkP = useMemo(() => withAccent(DARK, p.accent), [p.accent]);
  const darkStyles = useMemo(() => makeStyles(darkP), [darkP]);
  /** Height of the controls at the bottom, so what sits over the video stays clear of them. */
  const [bottomH, setBottomH] = useState(0);

  // The player's own settings, kept for the next video and the next time.
  const [opts, setOpts] = useState<PlayerOptions>(prefs.player ?? DEFAULT_VAULT_PREFS.player);
  const setOpt = (patch: Partial<PlayerOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    onPrefs?.({ ...prefs, player: next });
  };

  const player = useVideoPlayer(enableVideo && item.uri ? item.uri : null, (pl) => {
    pl.loop = opts.endLoop;
    // AirPlay sends the video itself to the TV, not only the sound.
    pl.allowsExternalPlayback = true;
    pl.playbackRate = opts.speed;
    // Leave the app or lock the phone and the sound carries on, with controls on the lock screen.
    pl.staysActiveInBackground = opts.background;
    pl.showNowPlayingNotification = opts.background;
    if (enableVideo) pl.play();
    pl.timeUpdateEventInterval = 0.2;
  });
  useEffect(() => {
    player.loop = opts.endLoop;
    player.playbackRate = opts.speed;
    player.staysActiveInBackground = opts.background;
    player.showNowPlayingNotification = opts.background;
  }, [player, opts.endLoop, opts.speed, opts.background]);

  const videoRef = useRef<VideoView>(null);
  /** Pinch out to fill the screen (cropping the edges), pinch in to see it whole. */
  const [fillScreen, setFillScreen] = useState(opts.start === 'fill');
  const [locked, setLocked] = useState(false);
  const [lockHint, setLockHint] = useState(false);
  /** The video ended: the next one comes up after a countdown (or Replay when it is the last). */
  const [ended, setEnded] = useState(false);
  const [upNextLeft, setUpNextLeft] = useState<number | null>(null);
  /** While dragging the bar: where (0..1), for the frame preview. */
  const [scrubAt, setScrubAt] = useState<number | null>(null);
  const [toast, setToast] = useState('');

  const [rating, setRating] = useState(item.rating);
  const [flag, setFlag] = useState<UiFlag>(item.flag);
  const [watch, setWatch] = useState<UiStatus | null>(item.status);
  const [inTray, setInTray] = useState(item.inTray);
  const [albumIds, setAlbumIds] = useState<number[]>(item.albumIds);
  const albumIdsAtOpen = useRef(item.albumIds);
  const [skipMenu, setSkipMenu] = useState(false);
  const [title, setTitle] = useState(item.title ?? '');
  const [caption, setCaption] = useState(item.notes ?? '');
  const [videoTags, setVideoTags] = useState<UiTag[]>([]);
  const [draft, setDraft] = useState('');
  const [frames, setFrames] = useState<ThumbSource[]>([]);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(enableVideo);
  const [infoOpen, setInfoOpen] = useState(initialInfoOpen);
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);
  /** The controls. "Video Only" (the player setting) opens without them; a tap brings them back. */
  const [chrome, setChrome] = useState(opts.start !== 'video');
  /** Sideways: the phone was turned, or the full-screen button turned it. */
  const landscape = W > H;
  const wide = !!item.width && !!item.height && item.width > item.height;
  /** The full-screen button was pressed: the video alone (sideways when it is wide). */
  const [fullScreen, setFullScreen] = useState(false);
  // Turning sideways hides the controls (a tap brings them, over the video); upright brings them back.
  const lastTurn = useRef(landscape);
  useEffect(() => {
    if (lastTurn.current === landscape) return;
    lastTurn.current = landscape;
    setChrome(!landscape);
    if (!landscape) setFullScreen(false);
  }, [landscape]);
  function toggleFullScreen() {
    tick();
    if (landscape || fullScreen) {
      if (landscape) lockUpright();
      setFullScreen(false);
      setChrome(true);
    } else {
      if (wide && canRotate) lockSideways();
      setFullScreen(true);
      setChrome(false);
      // A tall video stays upright, so say how to get the controls back.
      if (!wide || !canRotate) setToast('Tap the video for the controls');
    }
  }
  /** Over the video (sideways or full screen), the controls hide again a few seconds after you stop touching them. */
  const overlay = landscape || fullScreen;
  const bs = overlay ? darkStyles : styles;
  const bp = overlay ? darkP : p;
  const [poked, setPoked] = useState(0);
  const poke = () => setPoked((n) => n + 1);
  const [playerMenu, setPlayerMenu] = useState(false);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const busy = menuOpen || infoOpen || playerMenu || albumsOpen || scrubAt !== null || ended || locked;
  // Over the video the controls hide again a few seconds after you stop touching them; upright they stay (they cover nothing).
  useEffect(() => {
    if (!chrome || !overlay || !playing || busy) return;
    const t = setTimeout(() => setChrome(false), 3500);
    return () => clearTimeout(t);
  }, [chrome, playing, busy, overlay, poked]);
  /** A tap on the video: the video alone, or everything back. */
  function tapVideo() {
    setChrome((c) => !c);
  }
  function toggleMute() {
    tick();
    const m = !muted;
    setMuted(m);
    player.muted = m;
  }
  const [dateOpen, setDateOpen] = useState(false);
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [smallerOpen, setSmallerOpen] = useState(initialSmallerOpen);
  const [coverOpen, setCoverOpen] = useState(initialCoverOpen);
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
  /** The file could not be opened (missing or unreadable): said plainly instead of a cover that never plays. */
  const [failed, setFailed] = useState(false);
  const resumeDone = useRef(false);
  /** While the bar is being dragged (and just after), player time updates are ignored. */
  const scrubbing = useRef(false);
  const holdUntil = useRef(0);
  const wasPlaying = useRef(false);
  const lastSeek = useRef(0);

  // The cover stays on top until the first frame is ready, so changing videos never flashes black.
  useEffect(() => {
    if (player.status === 'readyToPlay') setReady(true);
    setFailed(player.status === 'error');
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') setReady(true);
      setFailed(status === 'error');
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

  // Chapter markers stored in the file itself.
  const [chapters, setChapters] = useState<{ title: string; startMs: number }[]>([]);
  useEffect(() => {
    let live = true;
    setChapters([]);
    actions
      .loadChapters(item)
      .then((c) => live && setChapters(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Opened at a moment found by search: start right there (instead of where you stopped).
  useEffect(() => {
    if (!enableVideo || startAt === null) return;
    resumeDone.current = true;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      player.currentTime = Math.max(0, startAt / 1000 - 1);
    };
    if (player.status === 'readyToPlay') go();
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') go();
    });
    return () => sub.remove();
  }, [player, startAt, enableVideo]);

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

  // Skip intro: an album can skip the start of its videos (not when picking up where you stopped).
  const skipSec = Math.max(0, ...albumIdsAtOpen.current.map((id) => prefs.skipIntro?.[String(id)] ?? 0));
  useEffect(() => {
    if (!enableVideo || skipSec <= 0 || startAt !== null || (prefs.resumeEnabled && resumeAt !== null)) return;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      const d = player.duration || (item.durationMs ?? 0) / 1000;
      if (d && skipSec >= d - 1) return;
      if (player.currentTime < skipSec) {
        player.currentTime = skipSec;
        setToast(`Skipped the first ${fmtClock(skipSec * 1000)}`);
      }
    };
    if (player.status === 'readyToPlay') go();
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') go();
    });
    return () => sub.remove();
  }, [player, enableVideo, skipSec]); // eslint-disable-line react-hooks/exhaustive-deps

  // Played to the end: the saved point is no longer needed.
  useEffect(() => {
    if (resumeAt !== null && progress > 0.97) void actions.setResume(item.id, null);
  }, [progress > 0.97]); // eslint-disable-line react-hooks/exhaustive-deps

  function holdFast(on: boolean) {
    if (!enableVideo || !prefs.holdForSpeed) return;
    if (!on && player.playbackRate === opts.speed) return;
    player.playbackRate = on ? Math.max(2, opts.speed * 2) : opts.speed;
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

  const ambientSource = frames.length ? frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))] : item.thumbSource;
  const dt = fmtDateTime(item.createdAt);
  const imported = fmtDateTime(item.importedAt);
  const totalSec = player.duration || (item.durationMs ?? 0) / 1000;
  const elapsed = Math.round(progress * totalSec);
  const stripIndex = Math.max(0, strip.findIndex((v) => v.id === item.id));

  function togglePlay() {
    if (ended) return replay();
    if (!enableVideo) return;
    // Read it first: the player may already say the new state right after play() or pause().
    const was = player.playing;
    if (was) player.pause();
    else player.play();
    setPlaying(!was);
    poke();
  }

  const durationSec = () => player.duration || (item.durationMs ?? 0) / 1000;

  function seek(fraction: number) {
    setEnded(false);
    setUpNextLeft(null);
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
    setEnded(false);
    setUpNextLeft(null);
    scrubbing.current = true;
    wasPlaying.current = enableVideo ? player.playing : false;
    if (enableVideo && player.playing) player.pause();
  }
  function scrubMove(f: number) {
    setProgress(f);
    setScrubAt(f);
    const now = Date.now();
    if (!enableVideo || now - lastSeek.current < 70) return;
    lastSeek.current = now;
    const d = durationSec();
    if (d > 0) player.currentTime = d * f;
  }
  function scrubEnd(f: number) {
    setProgress(f);
    setScrubAt(null);
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
    setEnded(false);
    setUpNextLeft(null);
    poke();
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1400);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!lockHint) return;
    const t = setTimeout(() => setLockHint(false), 2200);
    return () => clearTimeout(t);
  }, [lockHint]);

  // The end: the next video comes up after 5 seconds, unless you cancel (or it loops).
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      if (player.loop) return;
      setEnded(true);
      setChrome(true);
      if (opts.autoplayNext && next) setUpNextLeft(5);
    });
    return () => sub.remove();
  }, [player, opts.autoplayNext, next]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (upNextLeft === null || menuOpen || infoOpen) return;
    if (upNextLeft <= 0) {
      setUpNextLeft(null);
      goNext();
      return;
    }
    const t = setTimeout(() => setUpNextLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [upNextLeft, menuOpen, infoOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Slide to the next / previous video, the same way a swipe does. */
  function goNext(dir: 1 | -1 = 1) {
    if ((dir === 1 && !next) || (dir === -1 && !prev)) return;
    tick();
    setUpNextLeft(null);
    tx.value = withTiming(-dir * (W + PAGE_GAP), { duration: DUR.base, easing: EASE_OUT }, (done) => {
      if (done) scheduleOnRN(onStep, dir);
    });
  }
  function replay() {
    tick();
    setEnded(false);
    setUpNextLeft(null);
    if (!enableVideo) return;
    player.currentTime = 0;
    player.play();
  }
  function cycleSpeed() {
    tick();
    const i = PLAYER_SPEEDS.indexOf(opts.speed as (typeof PLAYER_SPEEDS)[number]);
    const speed = PLAYER_SPEEDS[(i + 1) % PLAYER_SPEEDS.length];
    setOpt({ speed });
    setToast(`Speed ${speed}×`);
  }
  function toggleLoop() {
    tick();
    setOpt({ endLoop: !opts.endLoop });
    setToast(opts.endLoop ? 'Loop off' : 'Loops this video');
  }
  function startPip() {
    tick();
    videoRef.current?.startPictureInPicture().catch(() => setToast('Picture in picture is not available here'));
  }

  /* ---------------------------------------------------------- gestures */

  const hasPrev = !!prev;
  const hasNext = !!next;
  const axis = useSharedValue(0); // 0 = not decided, 1 = sideways (paging), 2 = down (closing)

  const pan = Gesture.Pan()
    .minDistance(12)
    .maxPointers(1)
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
      if (ok) tapVideo();
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
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onEnd((e) => {
      if (e.scale > 1.12 && !fillScreen) {
        tick();
        setFillScreen(true);
        setToast('Zoomed to fill');
      } else if (e.scale < 0.9 && fillScreen) {
        tick();
        setFillScreen(false);
        setToast('Whole video');
      }
    });
  // Locked: every touch only shows the unlock button.
  const lockedTap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((_e, ok) => {
      if (ok) setLockHint(true);
    });
  const gestures = locked ? lockedTap : Gesture.Race(pinch, pan, hold, Gesture.Exclusive(doubleTap, singleTap));

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
    const word = ratingLabel(next, prefs.ratingLabels);
    if (word) setToast(word);
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
        <StatusBar hidden={!chrome || landscape} animated />
        <Animated.View style={[fill, { backgroundColor: p.bg }, bgStyle]} pointerEvents="none">
          <Animated.View style={[fill, { backgroundColor: '#000' }, blackStyle]} />
        </Animated.View>

        {/* ── media: swipe for the next video, drag down to close, tap to hide everything else ── */}
        <Animated.View style={styles.stage} layout={reduce ? undefined : LinearTransition.duration(DUR.base).easing(EASE_OUT)}>
          <GestureDetector gesture={gestures}>
            <View style={styles.stageTouch} collapsable={false}>
              <Animated.View style={[fill, rowStyle]}>
                {prev && <Image source={prev.thumbSource} style={[styles.neighbour, { left: -(W + PAGE_GAP), width: W }]} contentFit="contain" />}
                {/* Ambient: a soft glow of the video's own colours around it (it follows the film strip). */}
                {opts.ambient && !fillScreen && <Backdrop source={ambientSource} dim={chrome ? 0.38 : 0.55} blur={70} style={{ backgroundColor: 'transparent' }} />}
                {enableVideo ? (
                  <VideoView
                    ref={videoRef}
                    player={player}
                    style={[styles.video, { backgroundColor: 'transparent' }]}
                    contentFit={fillScreen ? 'cover' : 'contain'}
                    nativeControls={false}
                    allowsPictureInPicture
                    startsPictureInPictureAutomatically={opts.background}
                  />
                ) : (
                  <View style={styles.video} />
                )}
                {!ready && (
                  <Animated.View style={fill} exiting={FadeOut.duration(DUR.fast)} pointerEvents="none">
                    <Image source={item.thumbSource} style={styles.video} contentFit="contain" />
                  </Animated.View>
                )}
                {failed && enableVideo && (
                  <View style={styles.failed} pointerEvents="none">
                    <Text style={styles.failedTitle}>This video won't open</Text>
                    <Text style={styles.failedText}>Its file couldn't be read. Close the app fully and open it again; if it still won't play, the file is missing.</Text>
                  </View>
                )}
                {next && <Image source={next.thumbSource} style={[styles.neighbour, { left: W + PAGE_GAP, width: W }]} contentFit="contain" />}
              </Animated.View>
            </View>
          </GestureDetector>
          {ended && !locked && (
            <Animated.View entering={FadeIn.duration(DUR.base)} exiting={FadeOut.duration(DUR.fast)} style={styles.endWrap} pointerEvents="box-none">
              {next && upNextLeft !== null ? (
                <View style={styles.upNext}>
                  <Text style={styles.upNextKicker}>UP NEXT IN {upNextLeft}</Text>
                  <View style={styles.upNextRow}>
                    <Image source={next.thumbSource} style={styles.upNextThumb} contentFit="cover" />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.upNextTitle} numberOfLines={2}>
                        {next.title || next.filename}
                      </Text>
                      <Text style={styles.upNextSub}>{fmtDuration(next.durationMs) ?? ''}</Text>
                    </View>
                  </View>
                  <View style={styles.upNextBar}>
                    <Animated.View key={upNextLeft} entering={FadeIn} style={[styles.upNextFill, { width: `${((5 - upNextLeft) / 5) * 100}%` }]} />
                  </View>
                  <View style={styles.upNextButtons}>
                    <TouchableOpacity style={styles.upNextGhost} onPress={() => setUpNextLeft(null)}>
                      <Text style={styles.upNextGhostText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.upNextPlay} onPress={() => goNext(1)}>
                      <Icon name="play" size={14} color="#000" />
                      <Text style={styles.upNextPlayText}>Play now</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.endButtons}>
                  <TouchableOpacity style={styles.endBtn} onPress={replay} accessibilityLabel="Replay">
                    <Icon name="rewatch" size={22} color="#fff" />
                    <Text style={styles.endBtnText}>Replay</Text>
                  </TouchableOpacity>
                  {next && (
                    <TouchableOpacity style={styles.endBtn} onPress={() => goNext(1)} accessibilityLabel="Next video">
                      <Icon name="nextVideo" size={22} color="#fff" />
                      <Text style={styles.endBtnText}>Next</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </Animated.View>
          )}
          {/* ── scrubbing: the frame under your finger ── */}
          {scrubAt !== null && frames.length > 0 && (
            <Animated.View entering={FadeIn.duration(DUR.fast)} exiting={FadeOut.duration(DUR.fast)} style={[styles.preview, overlay && { bottom: bottomH + 12 }]} pointerEvents="none">
              <Image source={frames[Math.min(frames.length - 1, Math.floor(scrubAt * frames.length))]} style={styles.previewImg} contentFit="cover" />
              <Text style={styles.previewTime}>
                {fmtClock(scrubAt * totalSec * 1000)} / {fmtClock(totalSec * 1000)}
              </Text>
            </Animated.View>
          )}
          {!!toast && (
            <Animated.View key={toast} entering={FadeIn.duration(DUR.fast)} exiting={FadeOut.duration(DUR.base)} style={[styles.fastPill, { top: insets.top + (fast ? 104 : 60) }]} pointerEvents="none">
              <Text style={styles.fastText}>{toast}</Text>
            </Animated.View>
          )}
          {locked && (lockHint || !chrome) && (
            <Animated.View entering={FadeIn.duration(DUR.fast)} exiting={FadeOut.duration(DUR.base)} style={[styles.lockWrap, { top: insets.top + 14 }]} pointerEvents="box-none">
              <TouchableOpacity
                style={[styles.lockBtn, !lockHint && { opacity: 0.35 }]}
                onPress={() => {
                  success();
                  setLocked(false);
                  setLockHint(false);
                  setChrome(true);
                }}
                accessibilityLabel="Unlock the screen">
                <Icon name="unlock" size={15} color="#fff" />
                <Text style={styles.lockText}>{lockHint ? 'Tap to unlock' : 'Locked'}</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
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

        {chrome && !locked && (
          <>
            {/* ── header (over the top edge, with a soft shade so the buttons always show) ── */}
            <Animated.View entering={fadeIn} exiting={FadeOut.duration(DUR.fast)} style={[styles.headerWrap, chromeFade]} pointerEvents="box-none" onTouchStart={poke}>
              <Fade color="0,0,0" from={0} to={0.55} reverse style={[fill, { bottom: -30 }]} />
              <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: insets.left + 8, paddingRight: insets.right + 8 }]} pointerEvents="box-none">
                <IconButton icon="back" label="Back" clear color="#fff" onPress={onDismiss} size={38} />

                <View style={styles.titleWrap} pointerEvents="none">
                  <Text style={styles.titleDate} numberOfLines={1}>
                    {item.title || dt.date}
                  </Text>
                  <Text style={styles.titleTime}>{item.title ? `${dt.date} ${dt.time}` : dt.time}</Text>
                </View>

                <View style={styles.headerRight}>
                  {hasAirPlay && (
                    <View style={styles.airplay} accessibilityLabel="AirPlay">
                      <AirPlayButton style={{ width: 24, height: 24 }} tint="#ffffff" activeTint={p.accent} />
                    </View>
                  )}
                  <IconButton icon="info" label="Info" clear color="#fff" size={38} tint={infoOpen ? p.accent : undefined} onPress={() => setInfoOpen((v) => !v)} />
                  {!overlay && (
                    <IconButton
                      icon="options"
                      label="Edit: trim, crop, resize"
                      clear
                      color="#fff"
                      size={38}
                      onPress={() => {
                        if (player.playing) player.pause();
                        setEditorTab('trim');
                      }}
                    />
                  )}
                </View>
              </View>
              {!overlay && (
                <View style={styles.pillRow} pointerEvents="box-none">
                  <TouchableOpacity style={styles.addToPill} onPress={() => setAlbumsOpen(true)} accessibilityLabel="Add to an album">
                    <Text style={styles.addToText} numberOfLines={1}>
                      {albumIds.length === 0
                        ? 'Add To'
                        : albumIds.length === 1
                          ? (albums.find((a) => a.id === albumIds[0])?.name ?? '1 album')
                          : `In ${albumIds.length} albums`}
                    </Text>
                    <Icon name="down" size={11} color="#fff" />
                  </TouchableOpacity>
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
                </View>
              )}
            </Animated.View>

            {/* ── bottom: under the video upright; sideways or full screen only the player bar, over it ── */}
            <Animated.View
              entering={reduce ? fadeIn : SlideInDown.duration(DUR.base).easing(EASE_OUT)}
              exiting={reduce ? FadeOut.duration(DUR.fast) : SlideOutDown.duration(DUR.fast)}
              onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}
              onTouchStart={poke}
              style={[
                bs.bottom,
                chromeFade,
                overlay && [bs.bottomOver, { paddingLeft: insets.left + 10, paddingRight: insets.right + 10, paddingBottom: Math.max(10, insets.bottom) }],
              ]}>
              {!!note && (
                <TouchableOpacity onPress={() => setNote('')}>
                  <Text style={bs.note}>{note}</Text>
                </TouchableOpacity>
              )}
              {resumedFrom !== null && (
                <View style={bs.resumeRow}>
                  <Icon name="later" size={13} color={bp.accent} />
                  <Text style={bs.resumeText}>Continuing from {fmtClock(resumedFrom)}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      player.currentTime = 0;
                      setProgress(0);
                      holdUntil.current = Date.now() + 500;
                      setResumedFrom(null);
                      void actions.setResume(item.id, null);
                    }}>
                    <Text style={bs.resumeLink}>Start over</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* time, small, over the bar (tap: time left or the length) */}
              {!overlay && (
              <TouchableOpacity style={bs.timeRow} onPress={() => setOpt({ remaining: !opts.remaining })} hitSlop={6} accessibilityLabel="Show the time left or the length">
                <Text style={bs.timeText}>
                  {fmtDuration(elapsed * 1000) ?? '0:00'}
                  {'  /  '}
                  {opts.remaining ? `−${fmtDuration(Math.max(0, totalSec - elapsed) * 1000) ?? '0:00'}` : (fmtDuration(totalSec * 1000) ?? '--:--')}
                  {opts.speed !== 1 ? `   ${opts.speed}×` : ''}
                  {opts.endLoop ? '   ↻' : ''}
                </Text>
              </TouchableOpacity>
              )}

              {/* the player bar: play · film strip · sound · player menu */}
              <View style={[bs.capsule, overlay && bs.capsuleOver]}>
                <TouchableOpacity style={bs.capBtn} onPress={togglePlay} hitSlop={6} accessibilityLabel={ended ? 'Replay' : playing ? 'Pause' : 'Play'}>
                  <Icon name={ended ? 'rewatch' : playing ? 'pause' : 'play'} size={20} color={bp.text} />
                </TouchableOpacity>
                <FilmScrubber
                  fraction={progress}
                  durationSec={totalSec}
                  frames={frames}
                  cover={item.thumbSource}
                  marks={marks.map((m) => m.atMs)}
                  markColor={bp.rating}
                  height={overlay ? 30 : 38}
                  onStart={scrubStart}
                  onMove={scrubMove}
                  onEnd={scrubEnd}
                />
                {overlay && (
                  <TouchableOpacity onPress={() => setOpt({ remaining: !opts.remaining })} hitSlop={6} accessibilityLabel="Show the time left or the length">
                    <Text style={bs.capTime}>
                      {fmtDuration(elapsed * 1000) ?? '0:00'} / {opts.remaining ? `−${fmtDuration(Math.max(0, totalSec - elapsed) * 1000) ?? '0:00'}` : (fmtDuration(totalSec * 1000) ?? '--:--')}
                    </Text>
                  </TouchableOpacity>
                )}
                {enableVideo && (
                  <TouchableOpacity style={bs.capBtn} onPress={toggleMute} hitSlop={6} accessibilityLabel={muted ? 'Sound on' : 'Mute'}>
                    <Icon name={muted ? 'muted' : 'sound'} size={18} color={muted ? bp.accent : bp.text} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={bs.capBtn} onPress={() => setPlayerMenu(true)} hitSlop={6} accessibilityLabel="Player: speed, loop, bookmarks and more">
                  <Icon name="more" size={18} color={bp.text} />
                </TouchableOpacity>
              </View>

              {/* the videos around this one (HashPhotos' strip): tap to go there */}
              {!overlay && strip.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={bs.neighbours}
                  contentOffset={{ x: Math.max(0, stripIndex * (NB_W + NB_GAP) - (W - NB_ON) / 2), y: 0 }}>
                  {strip.map((v) => {
                    const on = v.id === item.id;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        disabled={on || !onPick}
                        onPress={() => onPick?.(v)}
                        accessibilityLabel={on ? 'This video' : `Open ${v.title || v.filename}`}>
                        <Image source={v.thumbSource} style={[bs.nb, on && bs.nbOn]} contentFit="cover" transition={0} recyclingKey={String(v.id)} />
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {/* the rating bar: pick · reject · stars · more · delete */}
              {!overlay && (
                <View style={[bs.toolbar, { marginBottom: insets.bottom + 8 }]}>
                  <TouchableOpacity style={bs.tool} onPress={() => void onFlag(1)} accessibilityLabel="Pick">
                    <Icon name="flag" size={18} color={flag === 1 ? '#30d158' : bp.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={bs.tool} onPress={() => void onFlag(-1)} accessibilityLabel="Reject">
                    <Icon name="close" size={18} color={flag === -1 ? '#ff453a' : bp.textSecondary} weight="bold" />
                  </TouchableOpacity>
                  <View style={bs.stars}>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <TouchableOpacity key={n} onPress={() => onRate(n)} onLongPress={() => setPickerOpen(true)} hitSlop={4} accessibilityLabel={`Rate ${n}`}>
                        <Text style={[bs.star, n <= rating && bs.starOn]}>{n <= rating ? '★' : '☆'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={bs.tool} onPress={() => setMenuOpen(true)} accessibilityLabel="More">
                    <Icon name="more" size={18} color={bp.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={bs.tool} onPress={confirmDelete} accessibilityLabel="Delete">
                    <Icon name="trash" size={18} color={bp.dangerText} />
                  </TouchableOpacity>
                </View>
              )}
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
                {!item.isPrivate && (
                  <MenuRow
                    label={(prefs.pinned ?? []).includes(item.id) ? 'Unpin from the Top' : 'Pin to the Top'}
                    hint={(prefs.pinned ?? []).includes(item.id) ? 'Pinned' : 'Library shelf'}
                    onPress={() => {
                      setMenuOpen(false);
                      const on = (prefs.pinned ?? []).includes(item.id);
                      success();
                      onPrefs?.({ ...prefs, player: opts, pinned: on ? prefs.pinned.filter((x) => x !== item.id) : [item.id, ...(prefs.pinned ?? [])].slice(0, 60) });
                      setToast(on ? 'Unpinned' : 'Pinned to the top of the library');
                    }}
                  />
                )}
                <MenuRow
                  label="Player…"
                  hint="Speed, loop, bookmarks, full screen"
                  onPress={() => {
                    setMenuOpen(false);
                    setPlayerMenu(true);
                  }}
                />
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
                {actions.canSaveSound() && (
                  <MenuRow
                    label="Save Sound to Audio"
                    hint="Listen without the picture"
                    onPress={() => {
                      setMenuOpen(false);
                      setNote('Saving the sound…');
                      actions
                        .onSaveSound(item)
                        .then((added) => setNote(added ? 'Sound saved: find it in Audio' : 'That sound is already in Audio'))
                        .catch((e) => setNote(`That did not work: ${String(e?.message ?? e)}`));
                    }}
                  />
                )}
                <MenuRow
                  label="Use This Frame as Cover"
                  hint={fmtDuration(elapsed * 1000) ?? '0:00'}
                  onPress={() => {
                    setMenuOpen(false);
                    run('Cover changed', actions.onSetCoverFrame(item, progress * totalSec * 1000));
                  }}
                />
                <MenuRow
                  label="Choose Cover Frame…"
                  hint="Scrub to the exact frame"
                  onPress={() => {
                    setMenuOpen(false);
                    if (player.playing) player.pause();
                    setCoverOpen(true);
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

        {/* ── player menu: everything about playing, toggles stay open so you see them change ── */}
        {playerMenu && (
          <Animated.View style={styles.infoRoot} exiting={FadeOut.duration(DUR.fast)}>
            <Animated.View entering={fadeIn} exiting={FadeOut.duration(DUR.fast)} style={styles.infoBackdrop}>
              <TouchableOpacity style={fill} activeOpacity={1} onPress={() => setPlayerMenu(false)} accessibilityLabel="Close the player menu" />
            </Animated.View>
            <Animated.View
              entering={reduce ? fadeIn : SlideInDown.duration(DUR.base).easing(EASE_OUT)}
              exiting={reduce ? FadeOut.duration(DUR.fast) : SlideOutDown.duration(DUR.fast)}
              style={[styles.menuSheet, { paddingBottom: insets.bottom + 12, paddingLeft: insets.left + 8, paddingRight: insets.right + 8 }]}>
              <View style={styles.grabber} />
              <Text style={styles.menuTitle}>Player</Text>
              <ScrollView style={styles.menuScroll}>
                <MenuRow label="Speed" hint={`${opts.speed}×`} onPress={cycleSpeed} />
                <MenuRow
                  label="When It Ends"
                  hint={opts.endLoop ? 'Loop' : opts.autoplayNext ? 'Play the next one' : 'Stop'}
                  onPress={() => {
                    tick();
                    // Loop → Play the next one → Stop → Loop
                    if (opts.endLoop) setOpt({ endLoop: false, autoplayNext: true });
                    else if (opts.autoplayNext) setOpt({ endLoop: false, autoplayNext: false });
                    else setOpt({ endLoop: true, autoplayNext: false });
                  }}
                />
                <MenuRow
                  label="Bookmark This Moment"
                  hint={fmtDuration(elapsed * 1000) ?? '0:00'}
                  onPress={() => {
                    setPlayerMenu(false);
                    addMark();
                  }}
                />
                {marks.map((m) => (
                  <MenuRow
                    key={m.id}
                    label={`   ${fmtClock(m.atMs)}${m.label ? `  ${m.label}` : ''}`}
                    hint="Hold for more"
                    onPress={() => {
                      setPlayerMenu(false);
                      seek(Math.min(1, m.atMs / 1000 / Math.max(1, totalSec)));
                    }}
                    onLongPress={() => {
                      setPlayerMenu(false);
                      setMarkMenu(m);
                    }}
                  />
                ))}
                {chapters.length > 0 && <Text style={styles.menuTitle}>Chapters</Text>}
                {chapters.map((c, i) => (
                  <MenuRow
                    key={`ch${i}`}
                    label={`   ${c.title}`}
                    hint={fmtClock(c.startMs)}
                    onPress={() => {
                      setPlayerMenu(false);
                      seek(Math.min(1, c.startMs / 1000 / Math.max(1, totalSec)));
                    }}
                  />
                ))}
                {prefs.resumeEnabled && canResume(item.durationMs) && (
                  <MenuRow
                    label="Continue Another Time"
                    hint={`From ${fmtClock(Math.max(0, elapsed * 1000 - 150_000))}`}
                    onPress={() => {
                      setPlayerMenu(false);
                      continueLater();
                    }}
                  />
                )}
                <MenuRow
                  label="Skip the Start…"
                  hint={skipSec > 0 ? `First ${fmtClock(skipSec * 1000)}` : 'For an album'}
                  onPress={() => {
                    setPlayerMenu(false);
                    setSkipMenu(true);
                  }}
                />
                <MenuRow
                  label="Fill the Screen"
                  hint={fillScreen ? 'On' : 'Off (pinch works too)'}
                  onPress={() => {
                    tick();
                    setFillScreen(!fillScreen);
                  }}
                />
                <MenuRow
                  label="Ambient Glow"
                  hint={opts.ambient ? 'On' : 'Off'}
                  onPress={() => {
                    tick();
                    setOpt({ ambient: !opts.ambient });
                  }}
                />
                <MenuRow
                  label={overlay ? 'Exit Full Screen' : 'Full Screen'}
                  hint={wide && canRotate && !overlay ? 'Turns sideways' : ''}
                  onPress={() => {
                    setPlayerMenu(false);
                    toggleFullScreen();
                  }}
                />
                {enableVideo && (
                  <MenuRow
                    label="Picture in Picture"
                    hint=""
                    onPress={() => {
                      setPlayerMenu(false);
                      startPip();
                    }}
                  />
                )}
                <MenuRow
                  label="Lock the Screen"
                  hint="Ignores touches"
                  onPress={() => {
                    setPlayerMenu(false);
                    success();
                    setLocked(true);
                    setChrome(false);
                    setLockHint(true);
                  }}
                />
                <MenuRow
                  label="Choose Cover Frame…"
                  hint="Scrub to the exact frame"
                  onPress={() => {
                    setPlayerMenu(false);
                    if (player.playing) player.pause();
                    setCoverOpen(true);
                  }}
                />
                <MenuRow
                  label="Keep Playing in the Background"
                  hint={opts.background ? 'On' : 'Off'}
                  onPress={() => {
                    tick();
                    setOpt({ background: !opts.background });
                  }}
                />
                <MenuRow
                  label="Open Videos"
                  hint={PLAYER_STARTS.find((x) => x.key === opts.start)?.label ?? ''}
                  onPress={() => {
                    const i = PLAYER_STARTS.findIndex((x) => x.key === opts.start);
                    setOpt({ start: PLAYER_STARTS[(i + 1) % PLAYER_STARTS.length].key });
                  }}
                />
                {overlay && (
                  <MenuRow
                    label="More…"
                    hint="Rate, share, albums"
                    onPress={() => {
                      setPlayerMenu(false);
                      setMenuOpen(true);
                    }}
                  />
                )}
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}

        {/* ── Add To: tick albums on and off, the sheet stays open ── */}
        {albumsOpen && (
          <Animated.View style={styles.infoRoot} exiting={FadeOut.duration(DUR.fast)}>
            <Animated.View entering={fadeIn} exiting={FadeOut.duration(DUR.fast)} style={styles.infoBackdrop}>
              <TouchableOpacity style={fill} activeOpacity={1} onPress={() => setAlbumsOpen(false)} accessibilityLabel="Close albums" />
            </Animated.View>
            <Animated.View
              entering={reduce ? fadeIn : SlideInDown.duration(DUR.base).easing(EASE_OUT)}
              exiting={reduce ? FadeOut.duration(DUR.fast) : SlideOutDown.duration(DUR.fast)}
              style={[styles.menuSheet, { paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.grabber} />
              <View style={styles.albumHead}>
                <Text style={styles.albumHeadTitle}>Add To</Text>
                <TouchableOpacity onPress={() => setAlbumsOpen(false)} hitSlop={10}>
                  <Text style={styles.albumDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.menuScroll}>
                <MenuRow
                  label="New Album…"
                  hint=""
                  onPress={() => {
                    setAlbumsOpen(false);
                    setNewAlbumOpen(true);
                  }}
                />
                {barAlbums.map((a) => {
                  const on = albumIds.includes(a.id);
                  return (
                    <TouchableOpacity key={a.id} style={styles.menuRow} onPress={() => void toggleAlbum(a).catch(() => undefined)} accessibilityState={{ checked: on }}>
                      <Text style={[styles.menuLabel, { flex: 1 }]} numberOfLines={1}>
                        {a.name}
                      </Text>
                      <Icon name={on ? 'checkCircle' : 'circle'} size={20} color={on ? p.accent : p.textMuted} />
                    </TouchableOpacity>
                  );
                })}
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

        {skipMenu && (
          <OptionsSheet
            title={albumIds.length ? 'Skip the start of every video in…' : 'Put this video in an album first, then every video in it can skip its start.'}
            options={albums
              .filter((a) => albumIds.includes(a.id))
              .slice(0, 6)
              .flatMap((a) => {
                const cur = prefs.skipIntro?.[String(a.id)] ?? 0;
                const here = Math.round(progress * totalSec);
                const save = (sec: number) => {
                  const next = { ...(prefs.skipIntro ?? {}) };
                  if (sec > 0) next[String(a.id)] = sec;
                  else delete next[String(a.id)];
                  onPrefs?.({ ...prefs, player: opts, skipIntro: next });
                  success();
                  setToast(sec > 0 ? `${a.name}: skips the first ${fmtClock(sec * 1000)}` : `${a.name}: plays from the start`);
                };
                return [
                  ...(here > 0 ? [{ label: `${a.name}: up to here (${fmtClock(here * 1000)})`, onPress: () => save(here) }] : []),
                  ...(cur > 0 ? [{ label: `${a.name}: stop skipping (now ${fmtClock(cur * 1000)})`, onPress: () => save(0) }] : []),
                ];
              })}
            onClose={() => setSkipMenu(false)}
          />
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

        {coverOpen && (
          <CoverPicker
            item={item}
            frames={frames}
            enableVideo={enableVideo}
            startMs={progress * totalSec * 1000}
            onUse={async (ms) => {
              await actions.onSetCoverFrame(item, ms);
              setNote('Cover changed');
            }}
            onClose={() => setCoverOpen(false)}
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
  initialCoverOpen?: boolean;
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
  /** Start at this moment (ms), e.g. one found by search inside videos. */
  startAt?: number | null;
  prefs?: VaultPrefs;
  /** Save changed settings (the player's speed, loop, Up Next…). */
  onPrefs?: (p: VaultPrefs) => void;
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

  // The strip under the player bar: up to 40 videos either side of this one.
  const strip = useMemo(() => (index < 0 ? [] : items.slice(Math.max(0, index - 40), index + 41)), [items, index]);
  const pick = useCallback(
    (v: VaultItem) => {
      tick();
      onChangeItem?.(v);
    },
    [onChangeItem]
  );

  // The background look-inside scan waits while you watch.
  useEffect(() => pauseLookingInside(), []);

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

  // The viewer turns with the phone; closing it goes back to how the rest of the app turns.
  useEffect(() => {
    allowRotation();
    return restoreRotation;
  }, []);

  const dismiss = useCallback(() => {
    out.value = withTiming(1, { duration: reduce ? DUR.fast : DUR.base, easing: EASE_OUT }, (done) => {
      if (done) scheduleOnRN(onClose);
    });
  }, [onClose, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const shell = useAnimatedStyle(() => ({ opacity: 1 - out.value, transform: [{ scale: 1 - out.value * 0.06 }] }));

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View entering={reduce ? fadeIn : zoomIn} style={[StyleSheet.absoluteFill, shell]}>
          <ViewerPage key={item.id} {...props} stage={{ tx, ty, dx }} prev={prev} next={next} strip={strip} onPick={pick} onStep={step} onDismiss={dismiss} />
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
  onLongPress,
}: {
  label: string;
  hint: string;
  danger?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} onLongPress={onLongPress}>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      {!!hint && <Text style={styles.menuHint}>{hint}</Text>}
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    failed: { position: 'absolute', left: 24, right: 24, top: '42%', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 16, padding: 16, gap: 6, alignItems: 'center' },
    failedTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    failedText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, textAlign: 'center' },
    viewer: { flex: 1 },
    stage: { flex: 1, overflow: 'visible' },
    stageTouch: { flex: 1 },
    video: { width: '100%', height: '100%' },
    neighbour: { position: 'absolute', top: 0, bottom: 0 },
    centre: { position: 'absolute', left: 0, right: 0, top: '50%', marginTop: -36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 34 },
    centreBig: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
    centreSmall: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' },
    endWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
    endButtons: { flexDirection: 'row', gap: 28 },
    endBtn: { alignItems: 'center', gap: 6, width: 86, paddingVertical: 14, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)' },
    endBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    upNext: { width: '100%', maxWidth: 380, gap: 10, padding: 14, borderRadius: 22, backgroundColor: 'rgba(18,18,22,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    upNextKicker: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    upNextRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    upNextThumb: { width: 112, height: 64, borderRadius: 10, backgroundColor: '#222' },
    upNextTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
    upNextSub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
    upNextBar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
    upNextFill: { height: 3, backgroundColor: '#fff' },
    upNextButtons: { flexDirection: 'row', gap: 10 },
    upNextGhost: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
    upNextGhostText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    upNextPlay: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 999, backgroundColor: '#fff' },
    upNextPlayText: { color: '#000', fontSize: 14, fontWeight: '900' },
    preview: { position: 'absolute', alignSelf: 'center', bottom: 24, alignItems: 'center', gap: 6 },
    previewImg: { width: 176, height: 100, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: '#111' },
    previewTime: { color: '#fff', fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'], backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
    lockWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    lockBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
    lockText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    speedPill: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: p.border },
    speedPillOn: { backgroundColor: p.accent, borderColor: p.accent },
    speedText: { color: p.textSecondary, fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
    speedTextOn: { color: '#fff' },
    quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 6 },
    quick: { height: 30, minWidth: 38, paddingHorizontal: 10, borderRadius: 999, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 },
    quickOn: { backgroundColor: `${p.accent}2E` },
    quickText: { color: p.text, fontSize: 12, fontWeight: '800' },
    quickTextOn: { color: p.accent },
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
    headerRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    airplay: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    pillRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
    addToPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      maxWidth: 200,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    addToText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    albumHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
    albumHeadTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    albumDone: { color: p.link, fontSize: 16, fontWeight: '700' },
    linkPill: {
      alignSelf: 'center',
      maxWidth: '60%',
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
    bottomOver: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
    capsuleOver: { backgroundColor: 'rgba(22,22,26,0.78)', marginHorizontal: 0 },
    note: { color: p.link, fontSize: 12, textAlign: 'center', paddingTop: 8 },
    timeRow: { alignSelf: 'center', paddingTop: 6, paddingBottom: 4 },
    timeText: { color: p.textSecondary, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
    capsule: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginHorizontal: 10,
      paddingHorizontal: 6,
      borderRadius: 14,
      backgroundColor: p.card,
    },
    capTime: { color: p.text, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], paddingLeft: 4 },
    capBtn: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
    neighbours: { gap: NB_GAP, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, alignItems: 'center' },
    nb: { width: NB_W, height: NB_W, borderRadius: 3, backgroundColor: p.tile, opacity: 0.75 },
    nbOn: { width: NB_ON, height: NB_W + 6, borderRadius: 4, opacity: 1, borderWidth: 2, borderColor: p.text },

    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 8,
      borderRadius: 14,
      backgroundColor: p.card,
    },
    tool: { paddingVertical: 4, paddingHorizontal: 2 },
    toolIcon: { color: p.textSoft, fontSize: 17, fontWeight: '600' },
    toolPick: { color: '#34c759' },
    toolReject: { color: '#ff453a' },
    toolDanger: { color: p.dangerText, fontSize: 17, fontWeight: '700' },
    stars: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
    starsOver: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', gap: 7 },
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
