/**
 * The audio player behind the Audio section: one player for the whole app,
 * so listening goes on while you browse, switch modes or lock the phone
 * (background playback and the lock-screen controls come from expo-video,
 * the player the app already uses). It moves from file to file in a book,
 * remembers where you are (every 10 seconds and on pause), rewinds a little
 * after a long pause, keeps your speed per item, has a sleep timer (minutes,
 * or the end of the chapter), and records how long you listened.
 * Presentational layer: data goes through `AudioActions` (see audioTypes.ts).
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';

import { chapterIndexAt, chaptersOf, isAtEnd, locate, overallMs, smartRewindMs, totalMs } from '../../audio/audioLogic';
import type { AudioActions, AudioUiItem } from './audioTypes';

export type Sleep = { endsAt: number | null; chapter: number | null } | null;

export type Playback = {
  item: AudioUiItem | null;
  track: number;
  /** ms into the current file. */
  position: number;
  /** ms from the start of the whole item. */
  overall: number;
  total: number;
  playing: boolean;
  rate: number;
  sleep: Sleep;
  error: string | null;
  open: (item: AudioUiItem, opts?: { track?: number; ms?: number; autoplay?: boolean }) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  seekOverall: (ms: number) => void;
  seekTrack: (track: number, ms: number) => void;
  skip: (deltaMs: number) => void;
  setRate: (rate: number) => void;
  /** Minutes, 'chapter' (stop at the end of this chapter), or null (off). */
  setSleep: (option: number | 'chapter' | null) => void;
  close: () => void;
};

const Ctx = createContext<Playback | null>(null);

/** The player, or null outside a provider (screens that may run without audio). */
export function useAudioPlaybackOptional(): Playback | null {
  return useContext(Ctx);
}

export function useAudioPlayback(): Playback {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAudioPlayback outside AudioPlaybackProvider');
  return v;
}

/** Saved this often while playing. */
const SAVE_EVERY = 10_000;

export function AudioPlaybackProvider({
  items,
  actions,
  enabled = true,
  rewind = 1,
  children,
}: {
  items: AudioUiItem[];
  actions: AudioActions;
  enabled?: boolean;
  /** Smart rewind: 0 = off, 0.5 = a little, 1 = normal, 2 = more. */
  rewind?: number;
  children: ReactNode;
}) {
  const rewindRef = useRef(rewind);
  rewindRef.current = rewind;
  const playerRef = useRef<VideoPlayer | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [track, setTrack] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [sleep, setSleepState] = useState<Sleep>(null);
  const [error, setError] = useState<string | null>(null);

  const item = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId]);
  // Live values for the player's events (they outlive renders).
  const live = useRef({ item: null as AudioUiItem | null, track: 0, position: 0, playing: false, rate: 1, sleep: null as Sleep });
  live.current = { item, track, position, playing, rate, sleep };
  const session = useRef<{ startedAt: number; listened: number; from: number; lastTime: number; lastSave: number; pendingSeek: number | null; autoplay: boolean; pausedAt: number | null }>({
    startedAt: 0,
    listened: 0,
    from: 0,
    lastTime: -1,
    lastSave: 0,
    pendingSeek: null,
    autoplay: false,
    pausedAt: null,
  });
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  /** Writes how long you listened since the last flush (only when it is worth keeping). */
  const flush = () => {
    const s = session.current;
    const it = live.current.item;
    if (it && s.listened >= 3000) {
      const to = overallMs(it, live.current.track, live.current.position);
      actionsRef.current.addPlay(it.id, s.startedAt, s.listened, s.from, to).catch(() => undefined);
    }
    s.listened = 0;
    s.startedAt = Date.now();
    s.from = it ? overallMs(it, live.current.track, live.current.position) : 0;
  };
  const save = () => {
    const it = live.current.item;
    if (!it) return;
    session.current.lastSave = Date.now();
    actionsRef.current.savePosition(it.id, live.current.track, live.current.position).catch(() => undefined);
  };

  const player = (): VideoPlayer | null => {
    if (!enabled) return null;
    if (!playerRef.current) {
      const p = createVideoPlayer(null);
      p.staysActiveInBackground = true;
      p.showNowPlayingNotification = true;
      p.audioMixingMode = 'doNotMix';
      p.preservesPitch = true;
      p.timeUpdateEventInterval = 0.5;
      playerRef.current = p;
    }
    return playerRef.current;
  };

  const load = (it: AudioUiItem, t: number, ms: number, autoplay: boolean) => {
    const uri = it.trackUris[t];
    setTrack(t);
    setPosition(ms);
    setError(null);
    live.current.track = t;
    live.current.position = ms;
    const p = player();
    if (!p || !uri) return;
    session.current.pendingSeek = ms;
    session.current.autoplay = autoplay;
    session.current.lastTime = -1;
    const chapters = chaptersOf(it);
    const ch = chapters[chapterIndexAt(chapters, overallMs(it, t, ms))];
    const title = it.title || it.filename;
    p.replaceAsync({
      uri,
      metadata: { title: ch && chapters.length > 1 ? ch.title : title, artist: ch && chapters.length > 1 ? title : (it.author ?? undefined), artwork: typeof it.coverSource === 'string' ? it.coverSource : undefined },
    }).catch((e) => setError(String(e)));
  };

  // The player's events.
  useEffect(() => {
    if (!enabled) return;
    const p = player();
    if (!p) return;
    const subs = [
      p.addListener('statusChange', ({ status, error: err }) => {
        if (status === 'readyToPlay') {
          const s = session.current;
          if (s.pendingSeek !== null) {
            p.currentTime = s.pendingSeek / 1000;
            s.pendingSeek = null;
          }
          p.playbackRate = live.current.rate;
          if (s.autoplay) {
            s.autoplay = false;
            p.play();
          }
        } else if (status === 'error') setError(err?.message ?? 'This file could not be played');
      }),
      p.addListener('playingChange', ({ isPlaying }) => {
        setPlaying(isPlaying);
        live.current.playing = isPlaying;
        if (isPlaying) {
          session.current.pausedAt = null;
          session.current.startedAt = Date.now();
          session.current.from = live.current.item ? overallMs(live.current.item, live.current.track, live.current.position) : 0;
        } else {
          session.current.pausedAt = Date.now();
          flush();
          save();
        }
      }),
      p.addListener('timeUpdate', ({ currentTime }) => {
        const ms = currentTime * 1000;
        const s = session.current;
        if (live.current.playing && s.lastTime >= 0) {
          const d = ms - s.lastTime;
          // Real listening only: seeks and jumps are not counted.
          if (d > 0 && d < 5000) s.listened += d / Math.max(0.5, live.current.rate);
        }
        s.lastTime = ms;
        setPosition(ms);
        live.current.position = ms;
        if (live.current.playing && Date.now() - s.lastSave > SAVE_EVERY) save();
        // The sleep timer.
        const sl = live.current.sleep;
        const it = live.current.item;
        if (sl && live.current.playing) {
          const now = Date.now();
          const chapterNow = it && sl.chapter !== null ? chapterIndexAt(chaptersOf(it), overallMs(it, live.current.track, ms)) : null;
          if ((sl.endsAt !== null && now >= sl.endsAt) || (sl.chapter !== null && chapterNow !== null && chapterNow !== sl.chapter)) {
            p.pause();
            setSleepState(null);
          }
        }
      }),
      p.addListener('playToEnd', () => {
        const it = live.current.item;
        if (!it) return;
        flush();
        if (live.current.track + 1 < it.trackUris.length) {
          load(it, live.current.track + 1, 0, true);
          return;
        }
        // The end of the item.
        actionsRef.current.markFinished(it.id).catch(() => undefined);
        actionsRef.current.savePosition(it.id, 0, 0).catch(() => undefined);
        setPlaying(false);
        setSleepState(null);
      }),
    ];
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'background') {
        flush();
        save();
      }
    });
    return () => {
      subs.forEach((s) => s.remove());
      app.remove();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Let go of the player when the screen goes away.
  useEffect(
    () => () => {
      flush();
      save();
      try {
        playerRef.current?.release();
      } catch {
        // already released
      }
      playerRef.current = null;
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const api: Playback = {
    item,
    track,
    position,
    overall: item ? overallMs(item, track, position) : 0,
    total: item ? totalMs(item) : 0,
    playing,
    rate,
    sleep,
    error,
    open: (it, opts = {}) => {
      if (live.current.item) {
        flush();
        save();
      }
      setItemId(it.id);
      live.current.item = it;
      const r = it.speed ?? live.current.rate ?? 1;
      setRateState(r);
      live.current.rate = r;
      let t = opts.track ?? it.positionTrack;
      let ms = opts.ms ?? it.positionMs;
      // Finished (or at the very end): start again from the beginning.
      if (opts.track === undefined && (it.status === 'finished' || isAtEnd(it, overallMs(it, t, ms)))) {
        t = 0;
        ms = 0;
      }
      // Coming back after a while: a few seconds back, to catch the thread again.
      if (opts.ms === undefined && it.lastPlayedAt) ms = Math.max(0, ms - smartRewindMs(Date.now() - it.lastPlayedAt, rewindRef.current));
      t = Math.min(Math.max(0, t), Math.max(0, it.trackUris.length - 1));
      load(it, t, ms, opts.autoplay ?? true);
    },
    toggle: () => {
      const p = player();
      if (!p) return setPlaying((x) => !x);
      if (live.current.playing) p.pause();
      else api.resume();
    },
    pause: () => player()?.pause(),
    resume: () => {
      const p = player();
      if (!p) return setPlaying(true);
      const pausedAt = session.current.pausedAt;
      if (pausedAt) {
        const back = smartRewindMs(Date.now() - pausedAt, rewindRef.current);
        if (back) p.currentTime = Math.max(0, p.currentTime - back / 1000);
      }
      p.play();
    },
    seekTrack: (t, ms) => {
      const it = live.current.item;
      if (!it) return;
      if (t !== live.current.track) {
        flush();
        load(it, t, ms, live.current.playing);
        return;
      }
      const p = player();
      session.current.lastTime = -1;
      if (p) p.currentTime = ms / 1000;
      setPosition(ms);
      live.current.position = ms;
    },
    seekOverall: (ms) => {
      const it = live.current.item;
      if (!it) return;
      const at = locate(it, ms);
      api.seekTrack(at.track, at.ms);
    },
    skip: (delta) => {
      const it = live.current.item;
      if (!it) return;
      api.seekOverall(Math.max(0, Math.min(totalMs(it), overallMs(it, live.current.track, live.current.position) + delta)));
    },
    setRate: (r) => {
      setRateState(r);
      live.current.rate = r;
      const p = player();
      if (p) p.playbackRate = r;
      const it = live.current.item;
      if (it) actionsRef.current.update([it.id], { speed: r }).catch(() => undefined);
    },
    setSleep: (option) => {
      const it = live.current.item;
      if (option === null || !it) return setSleepState(null);
      if (option === 'chapter') setSleepState({ endsAt: null, chapter: chapterIndexAt(chaptersOf(it), overallMs(it, live.current.track, live.current.position)) });
      else setSleepState({ endsAt: Date.now() + option * 60_000, chapter: null });
    },
    close: () => {
      flush();
      save();
      player()?.pause();
      setItemId(null);
      setPlaying(false);
      setSleepState(null);
    },
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
