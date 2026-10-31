/**
 * Living backgrounds for every Wrapped, made of what the story is about
 * instead of plain colour:
 * - ImageRiver: tilted columns of pictures (manga pages, posters, covers,
 *   video frames) flowing up and down at different speeds;
 * - FilmStrips: strips of film with sprocket holes rolling across the card;
 * - Vinyl: a record with your cover as its label, spinning, and an equaliser
 *   bouncing under it;
 * - Screentone: the dot shading of a printed manga page;
 * - Sfx: big Japanese sound effects (ゴゴゴ, ドン!) floating and shaking;
 * - Panel: a comic panel that drops in at an angle.
 * `Tint` washes any of them with the card's two colours so each card keeps its
 * own look. With Reduce Motion on, everything stands still. Presentational
 * only.
 */

import { useEffect, useMemo, useState } from 'react';
import { Image as RNImage, StyleSheet, Text, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import { Image, type ImageProps } from 'expo-image';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';

import { gradient } from './insightParts';
import { useReducedMotion } from './motion';
import { hexA } from './storyKit';

/** Anything a picture can show: an address, a cover, or a page decoded once and shared. */
export type PicSource = NonNullable<ImageProps['source']>;

const TONE: ImageSourcePropType = require('@/assets/images/screentone.png');
const SPROCKET: ImageSourcePropType = require('@/assets/images/sprocket.png');
const SCANLINES: ImageSourcePropType = require('@/assets/images/scanlines.png');

/** The card's colours over a scene: strong enough to read the words, light enough to see what moves. */
export function Tint({ colors, strength = 0.78 }: { colors: [string, string]; strength?: number }) {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        gradient(
          `linear-gradient(165deg, ${hexA(colors[0], strength - 0.12)} 0%, ${hexA(colors[0], strength)} 35%, ${hexA(colors[1], Math.min(0.97, strength + 0.12))} 100%)`,
          hexA(colors[1], strength)
        ),
      ]}
    />
  );
}

/** One column of pictures scrolling without end. */
function Column({ sources, width, aspect, ms, reverse, gap }: { sources: PicSource[]; width: number; aspect: number; ms: number; reverse: boolean; gap: number }) {
  const reduce = useReducedMotion();
  const h = width * aspect + gap;
  const set = sources.length * h;
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce || !set) return;
    y.value = 0;
    y.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false);
  }, [set, ms, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: reverse ? -set + y.value * set : -y.value * set }] }));
  return (
    <Animated.View style={[{ width, gap }, anim]}>
      {[...sources, ...sources].map((src, i) => (
        <Image key={i} source={src} style={{ width, height: width * aspect, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)' }} contentFit="cover" contentPosition="top" transition={0} recyclingKey={`${i}`} />
      ))}
    </Animated.View>
  );
}

/** Tilted columns of pictures flowing up and down, like a wall of manga pages or posters. */
export function ImageRiver({ sources, columns = 3, aspect = 1.45, tilt = -9, speed = 1, opacity = 1 }: { sources: PicSource[]; columns?: number; aspect?: number; tilt?: number; speed?: number; opacity?: number }) {
  const { width, height } = useWindowDimensions();
  const gap = 10;
  const colW = (width * 1.35 - gap * (columns - 1)) / columns;
  // The pictures it started with stay (pages arriving later go to the next card, so nothing jumps).
  const [first, setFirst] = useState(sources);
  useEffect(() => {
    if (!first.length && sources.length) setFirst(sources);
  }, [sources, first.length]);
  const cols = useMemo(() => {
    const list = first.filter(Boolean);
    if (!list.length) return [];
    // Enough pictures in a column to more than cover the (tilted) screen, so the loop never shows a gap.
    const per = Math.min(10, Math.max(4, Math.ceil((height * 1.5) / (colW * aspect + gap))));
    return Array.from({ length: columns }, (_, c) => {
      const out: PicSource[] = [];
      for (let i = 0; i < per; i++) out.push(list[(i * columns + c * 3 + c) % list.length]);
      return out;
    });
  }, [first, columns, height, colW, aspect]);
  if (!cols.length) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <View style={{ position: 'absolute', left: '-18%', top: '-30%', opacity, flexDirection: 'row', gap, transform: [{ rotate: `${tilt}deg` }] }}>
        {cols.map((c, i) => (
          <Column key={i} sources={c} width={colW} aspect={aspect} gap={gap} ms={((30000 + i * 7000) / speed) * (c.length / 6)} reverse={i % 2 === 1} />
        ))}
      </View>
    </View>
  );
}

/** One strip of film rolling sideways, frames with sprocket holes above and below. */
function Strip({ sources, top, rotate, ms, reverse, frame }: { sources: PicSource[]; top: `${number}%`; rotate: number; ms: number; reverse: boolean; frame: number }) {
  const reduce = useReducedMotion();
  const w = frame * 1.5 + 8;
  const set = sources.length * w;
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduce || !set) return;
    x.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false);
  }, [set, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: reverse ? -set + x.value * set : -x.value * set }] }));
  // The holes are one repeating picture, not hundreds of little boxes.
  const holes = <RNImage source={SPROCKET} resizeMode="repeat" style={{ width: set * 2 + 8, height: 6, marginHorizontal: 4 }} />;
  return (
    <View style={{ position: 'absolute', left: '-20%', right: '-20%', top, transform: [{ rotate: `${rotate}deg` }] }}>
      <Animated.View style={[{ backgroundColor: '#0b0b0b', paddingVertical: 6, gap: 6, alignSelf: 'flex-start' }, anim]}>
        {holes}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
          {[...sources, ...sources].map((src, i) => (
            <Image key={i} source={src} style={{ width: frame * 1.5, height: frame, borderRadius: 3, backgroundColor: '#222' }} contentFit="cover" transition={0} />
          ))}
        </View>
        {holes}
      </Animated.View>
    </View>
  );
}

/** Two or three strips of film rolling across the card in opposite directions. */
export function FilmStrips({ sources, frame = 92, count = 3 }: { sources: PicSource[]; frame?: number; count?: 2 | 3 }) {
  const { width } = useWindowDimensions();
  const list = sources.filter(Boolean);
  if (!list.length) return null;
  // Enough frames to fill more than the (tilted, wider) strip even with one or two pictures, so it never runs out.
  const n = Math.min(14, Math.max(Math.ceil((width * 1.5) / (frame * 1.5 + 8)) + 1, Math.min(10, list.length)));
  const pick = (k: number) => Array.from({ length: n }, (_, i) => list[(i * 3 + k) % list.length]);
  const rows: { top: `${number}%`; rotate: number }[] = count === 3 ? [{ top: '6%', rotate: -8 }, { top: '42%', rotate: 5 }, { top: '76%', rotate: -6 }] : [{ top: '12%', rotate: -7 }, { top: '70%', rotate: 6 }];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {rows.map((r, i) => (
        <Strip key={i} sources={pick(i)} top={r.top} rotate={r.rotate} ms={34000 + i * 6000} reverse={i % 2 === 1} frame={frame} />
      ))}
    </View>
  );
}

/** A record spinning, your cover as its label, half off the edge, and an equaliser bouncing below. */
export function Vinyl({ cover, accent = '#FF375F', label }: { cover: PicSource | undefined; accent?: string; /** Shown on the label when there is no cover (a title's first letter). */ label?: string }) {
  const { width } = useWindowDimensions();
  const reduce = useReducedMotion();
  const size = width * 1.15;
  const r = useSharedValue(0);
  useEffect(() => {
    if (!reduce) r.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1, false);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, right: -size * 0.45, top: '6%', backgroundColor: '#0c0c0c', alignItems: 'center', justifyContent: 'center' }, spin]}>
        {[0.94, 0.84, 0.74, 0.64, 0.54].map((k) => (
          <View key={k} style={{ position: 'absolute', width: size * k, height: size * k, borderRadius: (size * k) / 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }} />
        ))}
        <View style={{ width: size * 0.36, height: size * 0.36, borderRadius: size * 0.18, overflow: 'hidden', backgroundColor: accent }}>
          {cover ? (
            <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : label ? (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#fff', fontSize: size * 0.14, fontWeight: '900' }}>{label}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#111' }} />
        <View style={{ position: 'absolute', top: size * 0.08, width: size * 0.2, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', transform: [{ rotate: '-30deg' }] }} />
      </Animated.View>
      <Equalizer color={accent} />
    </View>
  );
}

function Bar({ i, color }: { i: number; color: string }) {
  const reduce = useReducedMotion();
  const h = useSharedValue(0.3);
  useEffect(() => {
    if (reduce) return;
    const up = 0.35 + ((i * 37) % 60) / 100;
    h.value = withDelay((i * 90) % 600, withRepeat(withSequence(withTiming(up, { duration: 300 + ((i * 53) % 250) }), withTiming(0.15 + ((i * 17) % 20) / 100, { duration: 280 + ((i * 29) % 240) })), -1, true));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stretched, not resized: no layout work on every frame.
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleY: h.value }] }));
  return <Animated.View style={[{ flex: 1, height: '100%', borderRadius: 4, backgroundColor: color, opacity: 0.55, transformOrigin: 'bottom' }, anim]} />;
}

/** Bars bouncing to music along the bottom of the card. */
export function Equalizer({ color = '#fff', bars = 18 }: { color?: string; bars?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '22%', flexDirection: 'row', alignItems: 'flex-end', gap: 5, paddingHorizontal: 8 }}>
      {Array.from({ length: bars }, (_, i) => (
        <Bar key={i} i={i} color={color} />
      ))}
    </View>
  );
}

/** The dot shading of a printed manga page, over everything. */
export function Screentone({ opacity = 0.1 }: { opacity?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <RNImage source={TONE} resizeMode="repeat" style={{ width: '100%', height: '100%', opacity }} />
    </View>
  );
}

/** A big manga sound effect, floating and shaking a little (ゴゴゴ, ドン!). */
export function Sfx({ text, x, y, size = 64, rotate = -12, color = '#fff', delay = 300, shake = true }: { text: string; x: `${number}%`; y: `${number}%`; size?: number; rotate?: number; color?: string; delay?: number; shake?: boolean }) {
  const reduce = useReducedMotion();
  const k = useSharedValue(0);
  useEffect(() => {
    if (reduce || !shake) return;
    k.value = withDelay(delay + 300, withRepeat(withSequence(withTiming(1, { duration: 90 }), withTiming(-1, { duration: 90 }), withTiming(0, { duration: 90 }), withTiming(0, { duration: 900 })), -1, false));
  }, [reduce, shake]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotate + k.value * 3}deg` }, { translateX: k.value * 2 }] }));
  return (
    <Animated.View entering={reduce ? undefined : ZoomIn.delay(delay).springify().damping(9)} style={{ position: 'absolute', left: x, top: y, width: size * text.length * 1.1 + 20 }} pointerEvents="none">
      <Animated.View style={anim}>
        <Text numberOfLines={1} style={{ fontSize: size, fontWeight: '900', color, letterSpacing: -2, textShadowColor: '#000', textShadowRadius: 0.5, textShadowOffset: { width: 3, height: 3 } }}>{text}</Text>
      </Animated.View>
    </Animated.View>
  );
}

/** Sets of sound effects for a moment: menace (ゴゴゴ), impact (ドン!), heart (ドキドキ), sparkle (キラキラ), rush (ダダダ). */
export function SfxSet({ kind, color = '#fff' }: { kind: 'menace' | 'impact' | 'heart' | 'sparkle' | 'rush' | 'question'; color?: string }) {
  switch (kind) {
    case 'menace':
      return (
        <>
          <Sfx text="ゴ" x="4%" y="10%" size={70} rotate={-14} color={color} delay={250} />
          <Sfx text="ゴ" x="22%" y="5%" size={58} rotate={-8} color={color} delay={380} />
          <Sfx text="ゴ" x="74%" y="70%" size={66} rotate={12} color={color} delay={500} />
          <Sfx text="ゴ" x="84%" y="80%" size={52} rotate={16} color={color} delay={620} />
        </>
      );
    case 'impact':
      return <Sfx text="ドン!" x="56%" y="8%" size={78} rotate={10} color={color} delay={350} />;
    case 'heart':
      return (
        <>
          <Sfx text="ドキ" x="62%" y="8%" size={56} rotate={12} color={color} delay={300} />
          <Sfx text="ドキ" x="70%" y="17%" size={44} rotate={-6} color={color} delay={480} />
        </>
      );
    case 'sparkle':
      return (
        <>
          <Sfx text="キラ" x="66%" y="9%" size={50} rotate={14} color={color} delay={300} shake={false} />
          <Sfx text="★" x="8%" y="14%" size={40} rotate={0} color={color} delay={450} shake={false} />
          <Sfx text="✦" x="80%" y="74%" size={36} rotate={0} color={color} delay={600} shake={false} />
        </>
      );
    case 'rush':
      return (
        <>
          <Sfx text="ダ" x="6%" y="8%" size={62} rotate={-16} color={color} delay={250} />
          <Sfx text="ダ" x="24%" y="12%" size={62} rotate={-10} color={color} delay={340} />
          <Sfx text="ダ" x="42%" y="7%" size={62} rotate={-4} color={color} delay={430} />
        </>
      );
    case 'question':
      return <Sfx text="?!" x="72%" y="7%" size={84} rotate={12} color={color} delay={300} />;
  }
}

/** A comic panel with a picture, dropping in at an angle (thick black border, white gutter). */
export function Panel({ source, width, rotate = -5, x, y, delay = 200 }: { source: PicSource | undefined; width: number; rotate?: number; x: `${number}%`; y: `${number}%`; delay?: number }) {
  const reduce = useReducedMotion();
  const k = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) k.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 110 }));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ opacity: Math.min(1, k.value * 1.6), transform: [{ translateY: (1 - k.value) * -80 }, { rotate: `${rotate * k.value + (1 - k.value) * rotate * 3}deg` }, { scale: 0.8 + 0.2 * k.value }] }));
  if (!source) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y, padding: 6, backgroundColor: '#fff', borderRadius: 3, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 10 } }, anim]}>
      <View style={{ borderWidth: 3, borderColor: '#000' }}>
        <Image source={source} style={{ width, height: width * 1.3 }} contentFit="cover" transition={0} />
      </View>
    </Animated.View>
  );
}

/** Picks a scene by number, so neighbouring cards never look the same. */
export function useVariant(i: number, n: number): number {
  const [v] = useState(() => i % n);
  return v;
}

/** The scan lines of an old television, over everything (the Simkl Wrapped's season cards). */
export function Scanlines({ opacity = 0.35 }: { opacity?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <RNImage source={SCANLINES} resizeMode="repeat" style={{ width: '100%', height: '100%', opacity }} />
    </View>
  );
}
