/**
 * The frames the video Wrapped plays your videos in, so cards don't all look
 * the same. The video always plays (with sound), and shows whole unless it's
 * in the circle:
 *   full      the whole screen (the big moments: the opening, your #1)
 *   polaroid  a photo print on a wall of your other videos
 *   grid      the live tile in a wall of thumbnails
 *   tv        an old TV set, with scan lines
 *   filmstrip a frame of film, sprocket holes above and below
 *   orbit     a circle, your other videos circling round it
 *   split     the top of the card, a contact sheet underneath
 *   tilt      a card turned in 3D over your videos flowing by
 *   cinema    widescreen, your other videos rolling past in the black bars
 *   stack     the top photo of a pile
 * `lookFor` picks one per card, never the same twice in a row. Presentational
 * only.
 */

import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, ZoomIn } from 'react-native-reanimated';

import { Backdrop } from './frame';
import { useReducedMotion } from './motion';
import { FilmStrips, ImageRiver, Scanlines } from './scenes';
import { useWindowDimensions } from './screen';
import { CoverWall, Marquee } from './storyKit';
import type { ThumbSource } from './types';

import { type VideoLook } from '../videoLookOrder';

export { lookFor, VIDEO_LOOKS, type VideoLook } from '../videoLookOrder';

/** The biggest box of the video's shape that fits in maxW x maxH. */
function fit(aspect: number | null, maxW: number, maxH: number) {
  const a = aspect && aspect > 0 ? aspect : 16 / 9;
  let w = maxW;
  let h = w / a;
  if (h > maxH) {
    h = maxH;
    w = h * a;
  }
  return { w, h };
}

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Your other videos circling round the middle, the ring turning slowly. */
function Ring({ decor, radius, tile }: { decor: ThumbSource[]; radius: number; tile: number }) {
  const reduce = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => {
    if (!reduce) r.value = withRepeat(withTiming(1, { duration: 28000, easing: Easing.linear }), -1, false);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  const upright = useAnimatedStyle(() => ({ transform: [{ rotate: `${-r.value * 360}deg` }] }));
  const list = decor.slice(0, 8);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: radius * 2, height: radius * 2 }, ring]}>
      {list.map((src, k) => {
        const a = (k / list.length) * Math.PI * 2;
        return (
          <Animated.View key={k} style={[{ position: 'absolute', left: radius + Math.cos(a) * radius - tile / 2, top: radius + Math.sin(a) * radius - tile / 2 }, upright]}>
            <Image source={src} style={{ width: tile, height: tile, borderRadius: tile / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' }} contentFit="cover" transition={0} />
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

/**
 * The video (`children`, already filling its box) in the frame of `look`.
 * `decor` are thumbnails of your other videos, `cover` this video's own.
 */
export function LookFrame({ look, aspect, decor, cover, seed, children }: { look: Exclude<VideoLook, 'full'>; aspect: number | null; decor: ThumbSource[]; cover: ThumbSource | undefined; seed: number; children: ReactNode }) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const tiltV = useSharedValue(-20);
  useEffect(() => {
    if (look === 'tilt' && !reduce) tiltV.value = withRepeat(withTiming(-6, { duration: 5000, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [look, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const tiltStyle = useAnimatedStyle(() => ({ transform: [{ perspective: 1000 }, { rotateY: `${tiltV.value}deg` }, { rotateX: '6deg' }] }));
  const pop = reduce ? undefined : ZoomIn.springify().damping(14);
  const shadow = { shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 22, shadowOffset: { width: 0, height: 12 } };
  const box = (b: { w: number; h: number }, extra?: object) => <View style={[{ width: b.w, height: b.h, overflow: 'hidden', backgroundColor: '#000' }, extra]}>{children}</View>;
  const centre = [StyleSheet.absoluteFill, { alignItems: 'center' as const, justifyContent: 'center' as const }];
  const up = { marginBottom: H * 0.22 };

  switch (look) {
    case 'polaroid': {
      const b = fit(aspect, W * 0.76, H * 0.42);
      return (
        <View style={centre}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
            <CoverWall sources={decor} rows={5} tile={86} tilt={seed % 2 ? 10 : -10} opacity={0.5} />
          </View>
          <Animated.View entering={pop} style={[{ backgroundColor: '#fafafa', padding: 10, paddingBottom: 42, transform: [{ rotate: seed % 2 ? '3deg' : '-3deg' }] }, shadow, up]}>
            {box(b)}
          </Animated.View>
        </View>
      );
    }
    case 'grid': {
      const cols = 3;
      const tw = W / cols;
      const th = tw * 1.35;
      const rows = Math.ceil(H / th) + 1;
      const b = fit(aspect, W * 0.72, H * 0.42);
      return (
        <View style={centre}>
          <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#000' }]}>
            {Array.from({ length: cols * rows }, (_, k) => {
              const src = decor.length ? decor[(k * 5 + seed) % decor.length] : cover;
              return src ? <Image key={k} source={src} style={{ width: tw, height: th, opacity: 0.38, borderWidth: 1, borderColor: '#000' }} contentFit="cover" transition={0} /> : <View key={k} style={{ width: tw, height: th }} />;
            })}
          </View>
          <Animated.View entering={pop} style={[{ borderWidth: 3, borderColor: '#fff', borderRadius: 6 }, shadow, up]}>
            {box(b, { borderRadius: 3 })}
            <View style={styles.live}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>NOW PLAYING</Text>
            </View>
          </Animated.View>
        </View>
      );
    }
    case 'tv': {
      const b = fit(aspect, W * 0.74, H * 0.38);
      return (
        <View style={centre}>
          <Backdrop source={decor[seed % Math.max(1, decor.length)] ?? cover} dim={0.65} />
          <Animated.View entering={pop} style={[{ alignItems: 'center' }, up]}>
            {/* Antenna */}
            <View style={{ flexDirection: 'row', gap: 40, marginBottom: -4 }}>
              <View style={[styles.antenna, { transform: [{ rotate: '-28deg' }] }]} />
              <View style={[styles.antenna, { transform: [{ rotate: '28deg' }] }]} />
            </View>
            <View style={[styles.tv, shadow]}>
              <View style={{ borderRadius: 16, overflow: 'hidden' }}>
                {box(b)}
                <Scanlines opacity={0.28} />
              </View>
              <View style={styles.knobs}>
                <View style={styles.knob} />
                <View style={styles.knob} />
                <View style={styles.speaker} />
              </View>
            </View>
          </Animated.View>
        </View>
      );
    }
    case 'filmstrip': {
      const b = fit(aspect, W, H * 0.4);
      const holes = (
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6 }}>
          {Array.from({ length: 14 }, (_, k) => (
            <View key={k} style={styles.hole} />
          ))}
        </View>
      );
      return (
        <View style={centre}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 0.55 }]}>
            <FilmStrips sources={decor.length ? decor : cover ? [cover] : []} count={3} frame={80} />
          </View>
          <Animated.View entering={pop} style={[{ width: W, backgroundColor: '#0b0b0b', alignItems: 'center' }, shadow, up]}>
            {holes}
            {box(b)}
            {holes}
          </Animated.View>
        </View>
      );
    }
    case 'orbit': {
      const d = W * 0.66;
      return (
        <View style={centre}>
          <Backdrop source={cover} dim={0.55} />
          <View style={[{ alignItems: 'center', justifyContent: 'center' }, up]}>
            <Ring decor={decor} radius={W * 0.47} tile={W * 0.17} />
            <Animated.View entering={pop} style={[{ width: d, height: d, borderRadius: d / 2, overflow: 'hidden', borderWidth: 4, borderColor: '#fff' }, shadow]}>
              {children}
            </Animated.View>
          </View>
        </View>
      );
    }
    case 'split': {
      const b = fit(aspect, W, H * 0.52);
      const rowSrc = (r: number) => (decor.length ? decor.map((_, k) => decor[(k + r * 3) % decor.length]) : cover ? [cover] : []);
      return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          <View style={{ height: H * 0.52, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <Backdrop source={cover} dim={0.3} />
            {box(b)}
          </View>
          <View style={{ height: 3, backgroundColor: '#fff' }} />
          <View style={{ flex: 1, gap: 6, paddingTop: 6, opacity: 0.6 }}>
            {[0, 1, 2, 3].map((r) => (
              <Marquee key={r} ms={20000 + r * 4000} reverse={r % 2 === 1}>
                {rowSrc(r).map((src, k) => (
                  <Image key={k} source={src} style={{ width: 120, height: 72, borderRadius: 6, marginRight: 6 }} contentFit="cover" transition={0} />
                ))}
              </Marquee>
            ))}
          </View>
        </View>
      );
    }
    case 'tilt': {
      const b = fit(aspect, W * 0.8, H * 0.44);
      return (
        <View style={centre}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 0.6 }]}>
            <ImageRiver sources={decor.length ? decor : cover ? [cover] : []} columns={3} aspect={1.3} tilt={-8} speed={0.8} />
          </View>
          <Animated.View entering={pop} style={[{ borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' }, shadow, tiltStyle, up]}>
            {box(b)}
          </Animated.View>
        </View>
      );
    }
    case 'cinema': {
      const bar = H * 0.2;
      const b = fit(aspect, W, H - bar * 2);
      const strip = (r: number) => (
        <Marquee ms={24000} reverse={r % 2 === 1} style={{ opacity: 0.5 }}>
          {(decor.length ? decor : cover ? [cover] : []).map((src, k) => (
            <Image key={k} source={src} style={{ width: 96, height: bar * 0.6, borderRadius: 4, marginRight: 6 }} contentFit="cover" transition={0} />
          ))}
        </Marquee>
      );
      return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          <View style={{ height: bar, justifyContent: 'center' }}>{strip(0)}</View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{box(b)}</View>
          <View style={{ height: bar, justifyContent: 'center' }}>{strip(1)}</View>
        </View>
      );
    }
    case 'stack': {
      const b = fit(aspect, W * 0.72, H * 0.42);
      return (
        <View style={centre}>
          <Backdrop source={cover} dim={0.5} />
          <View style={[{ alignItems: 'center', justifyContent: 'center' }, up]}>
            {decor.slice(0, 3).map((src, k) => (
              <View key={k} style={[{ position: 'absolute', backgroundColor: '#fff', padding: 6, transform: [{ rotate: `${(rand(seed + k) - 0.5) * 30}deg` }, { translateX: (k - 1) * 24 }] }, shadow]}>
                <Image source={src} style={{ width: b.w, height: b.h }} contentFit="cover" transition={0} />
              </View>
            ))}
            <Animated.View entering={pop} style={[{ backgroundColor: '#fff', padding: 6, transform: [{ rotate: '2deg' }] }, shadow]}>
              {box(b)}
            </Animated.View>
          </View>
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  live: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF453A' },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  tv: { backgroundColor: '#2a2420', borderRadius: 30, padding: 16, paddingBottom: 12, borderWidth: 2, borderColor: '#4a3f36' },
  antenna: { width: 3, height: 70, backgroundColor: '#888', borderRadius: 2 },
  knobs: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, paddingHorizontal: 6 },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#8a7a6a', borderWidth: 2, borderColor: '#3a322c' },
  speaker: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#1a1612' },
  hole: { width: 12, height: 9, borderRadius: 2, backgroundColor: '#e8e8e8' },
});
