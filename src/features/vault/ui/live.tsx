/**
 * Cards that play their video, with its sound, while they are on screen
 * (Dashboard, Memories, Wrapped and History). Only one plays at a time: the
 * card most in view. Scrolling hands over to the next one; a small speaker
 * button mutes them all (remembered). The cover shows until the video is ready,
 * so nothing flashes black. In the browser preview the covers stay still.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { tick } from './haptics';
import Icon from './Icon';
import type { ThumbSource } from './types';

type Entry = { ref: View; priority: number };

type Live = {
  active: string | null;
  sound: boolean;
  enableVideo: boolean;
  setSound: (on: boolean) => void;
  register: (id: string, ref: View, priority: number) => () => void;
};

const LiveContext = createContext<Live | null>(null);

/**
 * Wrap a scrolling screen. Pass `onScroll` / `scrollEventThrottle` from the
 * returned handlers to its ScrollView. `paused` stops every card (a player
 * is open on top, or the screen is hidden).
 */
export function useLiveScope({ enableVideo, sound, onSound, paused }: { enableVideo: boolean; sound: boolean; onSound: (on: boolean) => void; paused: boolean }) {
  const entries = useRef(new Map<string, Entry>());
  const [active, setActive] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(() => {
    const { height: h, width: W } = Dimensions.get('window');
    const list = [...entries.current.entries()];
    if (!list.length) return setActive(null);
    let left = list.length;
    const seen: { id: string; share: number; top: number; priority: number }[] = [];
    for (const [id, e] of list) {
      e.ref.measureInWindow((x, y, w, hh) => {
        if (hh > 0 && w > 0) {
          const vis = Math.max(0, Math.min(y + hh, h - 40) - Math.max(y, 90)) / hh;
          const across = Math.max(0, Math.min(x + w, W) - Math.max(x, 0)) / w;
          seen.push({ id, share: vis * across, top: y, priority: e.priority });
        }
        left -= 1;
        if (left === 0) {
          const best = seen.filter((s) => s.share >= 0.6).sort((a, b) => b.priority - a.priority || a.top - b.top)[0];
          setActive(best?.id ?? null);
        }
      });
    }
  }, []);

  const schedule = useCallback(
    (ms = 180) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(check, ms);
    },
    [check]
  );

  useEffect(() => {
    schedule(500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);

  const register = useCallback(
    (id: string, ref: View, priority: number) => {
      entries.current.set(id, { ref, priority });
      schedule(350);
      return () => {
        entries.current.delete(id);
        schedule(100);
      };
    },
    [schedule]
  );

  const value = useMemo<Live>(
    () => ({ active: paused ? null : active, sound, enableVideo, setSound: onSound, register }),
    [active, paused, sound, enableVideo, onSound, register]
  );

  return {
    /** Pass to <LiveProvider value={…}>. */
    value,
    scrollProps: {
      scrollEventThrottle: 64,
      onScroll: (_e: NativeSyntheticEvent<NativeScrollEvent>) => schedule(160),
      onMomentumScrollEnd: () => schedule(40),
    },
    /** Look again (a tab changed, content moved). */
    recheck: () => schedule(250),
  };
}

export function LiveProvider({ value, children }: { value: Live; children: ReactNode }) {
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** The video behind a live card: a short loop from `startMs`, sound as chosen, fading in once it plays. */
function LiveVideo({ uri, startMs, clipMs, sound, radius }: { uri: string; startMs: number; clipMs: number; sound: boolean; radius: number }) {
  const [ready, setReady] = useState(false);
  const player = useVideoPlayer(uri, (pl) => {
    pl.loop = true;
    pl.muted = !sound;
    pl.timeUpdateEventInterval = 0.5;
    pl.currentTime = startMs / 1000;
    pl.play();
  });
  useEffect(() => {
    player.muted = !sound;
  }, [sound, player]);
  useEffect(() => {
    const a = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') setReady(true);
    });
    const b = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime * 1000 > startMs + clipMs || currentTime * 1000 < startMs - 1000) player.currentTime = startMs / 1000;
    });
    return () => {
      a.remove();
      b.remove();
    };
  }, [player, startMs, clipMs]);
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden', opacity: ready ? 1 : 0 }]} pointerEvents="none">
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} />
    </View>
  );
}

/**
 * A card that plays `uri` while it is the one most in view. `children` sit on
 * top (titles, gradients). `priority` lets a hero card win over smaller ones.
 */
export function LiveCard({
  id,
  uri,
  cover,
  durationMs,
  startMs,
  clipMs = 12_000,
  radius = 20,
  priority = 0,
  style,
  children,
  under,
  showSound = true,
  soundStyle,
}: {
  id: string;
  uri: string | null | undefined;
  cover?: ThumbSource;
  durationMs?: number | null;
  /** Where the loop starts; the middle of the video when left out. */
  startMs?: number;
  clipMs?: number;
  radius?: number;
  priority?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Drawn under the video (e.g. a slowly moving cover), seen until it plays. */
  under?: ReactNode;
  showSound?: boolean;
  /** Where the speaker button sits (top right by default). */
  soundStyle?: StyleProp<ViewStyle>;
}) {
  const live = useContext(LiveContext);
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!live || !ref.current || !uri) return;
    return live.register(id, ref.current, priority);
  }, [live?.register, id, uri, priority]); // eslint-disable-line react-hooks/exhaustive-deps
  const playing = !!live && live.enableVideo && live.active === id && !!uri;
  const start = startMs ?? Math.max(0, ((durationMs ?? 0) - clipMs) / 2);
  return (
    <View ref={ref} collapsable={false} style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      {cover !== undefined && <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />}
      {under}
      {playing && <LiveVideo uri={uri!} startMs={start} clipMs={clipMs} sound={live!.sound} radius={radius} />}
      {children}
      {playing && showSound && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.sound, soundStyle]}>
          <TouchableOpacity
            style={styles.soundBtn}
            hitSlop={10}
            onPress={() => {
              tick();
              live!.setSound(!live!.sound);
            }}
            accessibilityLabel={live!.sound ? 'Mute' : 'Sound on'}>
            <Icon name={live!.sound ? 'sound' : 'muted'} size={14} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sound: { position: 'absolute', top: 10, right: 10 },
  soundBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
});
