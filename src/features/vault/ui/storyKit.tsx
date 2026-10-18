/**
 * The moving pieces behind Wrapped, Memories and the dashboard's big cards:
 * an aurora of drifting colour, words that rise in one after another, numbers
 * that count up, text and covers that scroll past like a poster, confetti,
 * slowly turning rays, cards that drop in at a tilt, bars that grow, and
 * cinema bars. With Reduce Motion on, everything simply appears and stays
 * still. Presentational only.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { gradient } from './insightParts';
import { EASE_IN_OUT, EASE_OUT, useReducedMotion } from './motion';
import type { ThumbSource } from './types';

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A value that swings 0 → 1 → 0 forever (still at 0.5 with Reduce Motion). */
function useSwing(ms: number, delay = 0): SharedValue<number> {
  const reduce = useReducedMotion();
  const v = useSharedValue(reduce ? 0.5 : 0);
  useEffect(() => {
    if (reduce) return;
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: ms, easing: EASE_IN_OUT }), -1, true));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

function Blob({ color, size, x, y, dx, dy, ms, delay }: { color: string; size: number; x: number; y: number; dx: number; dy: number; ms: number; delay: number }) {
  const s = useSwing(ms, delay);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x + dx * (s.value - 0.5) }, { translateY: y + dy * (s.value - 0.5) }, { scale: 0.9 + s.value * 0.25 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: size / 2 },
        gradient(`radial-gradient(circle at center, ${hexA(color, 0.85)} 0%, ${hexA(color, 0.35)} 40%, ${hexA(color, 0)} 70%)`, 'transparent'),
        style,
      ]}
    />
  );
}

/**
 * A slow aurora: the card's two colours as a gradient, with three soft blobs
 * of colour drifting over it.
 */
export function Aurora({ colors, accent, width, height, style }: { colors: [string, string]; accent?: string; width: number; height: number; style?: StyleProp<ViewStyle> }) {
  const big = Math.max(width, height) * 0.95;
  const third = accent ?? colors[0];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, gradient(`linear-gradient(160deg, ${colors[0]} 0%, ${colors[1]} 100%)`), style]}>
      <Blob color={colors[0]} size={big} x={-big * 0.35} y={-big * 0.3} dx={width * 0.5} dy={height * 0.2} ms={9000} delay={0} />
      <Blob color={third} size={big * 0.8} x={width - big * 0.45} y={height * 0.35} dx={-width * 0.45} dy={height * 0.25} ms={11000} delay={600} />
      <Blob color={colors[1] === '#000000' ? colors[0] : '#ffffff'} size={big * 0.55} x={width * 0.1} y={height * 0.7} dx={width * 0.4} dy={-height * 0.2} ms={13000} delay={1200} />
    </View>
  );
}

/** A word rising in with a slight turn, like it was dropped onto the card. */
const rise = (delay: number) =>
  new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 26 }, { rotate: '5deg' }, { scale: 0.92 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }, { rotate: '0deg' }, { scale: 1 }], easing: EASE_OUT },
  })
    .duration(520)
    .delay(delay);

/** Text that appears word by word. */
export function Words({ text, style, delay = 0, stagger = 70 }: { text: string; style: StyleProp<TextStyle>; delay?: number; stagger?: number }) {
  const reduce = useReducedMotion();
  const flat = StyleSheet.flatten(style) ?? {};
  const words = text.split(/\s+/).filter(Boolean);
  if (reduce) return <Text style={style}>{text}</Text>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: (flat.fontSize ?? 20) * 0.26, justifyContent: flat.textAlign === 'center' ? 'center' : 'flex-start' }} accessible accessibilityLabel={text}>
      {words.map((w, i) => (
        <Animated.Text key={`${i}${w}`} entering={rise(delay + i * stagger)} style={style}>
          {w}
        </Animated.Text>
      ))}
    </View>
  );
}

/** A number that counts up when it appears. */
export function CountUp({ to, format, style, ms = 1100, delay = 0 }: { to: number; format: (n: number) => string; style: StyleProp<TextStyle>; ms?: number; delay?: number }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) return setN(to);
    let id: ReturnType<typeof setInterval> | undefined;
    const wait = setTimeout(() => {
      const start = Date.now();
      id = setInterval(() => {
        const t = Math.min(1, (Date.now() - start) / ms);
        setN(to * (1 - Math.pow(1 - t, 3)));
        if (t >= 1 && id) clearInterval(id);
      }, 30);
    }, delay);
    return () => {
      clearTimeout(wait);
      if (id) clearInterval(id);
    };
  }, [to, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Text style={style}>{format(n)}</Text>;
}

/** Content that scrolls sideways forever, like a ticker on a poster. */
export function Marquee({ children, ms = 14000, reverse = false, style }: { children: ReactNode; ms?: number; reverse?: boolean; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (!w || reduce) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false);
  }, [w, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: reverse ? -w + x.value * w : -x.value * w }] }));
  return (
    <View style={[{ overflow: 'hidden' }, style]} pointerEvents="none">
      <Animated.View style={[{ flexDirection: 'row', alignSelf: 'flex-start' }, anim]}>
        <View style={{ flexDirection: 'row' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {children}
        </View>
        <View style={{ flexDirection: 'row' }}>{children}</View>
        <View style={{ flexDirection: 'row' }}>{children}</View>
      </Animated.View>
    </View>
  );
}

/** A tilted wall of covers, each row drifting the other way. */
export function CoverWall({ sources, rows = 4, tile = 108, tilt = -14, opacity = 1 }: { sources: (ThumbSource | undefined)[]; rows?: number; tile?: number; tilt?: number; opacity?: number }) {
  const list = sources.filter(Boolean) as ThumbSource[];
  if (!list.length) return null;
  const rowList = (r: number) => {
    const out: ThumbSource[] = [];
    for (let i = 0; i < Math.max(6, list.length); i++) out.push(list[(i * (r + 2) + r) % list.length]);
    return out;
  };
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', opacity }]}>
      <View style={{ position: 'absolute', left: '-40%', right: '-40%', top: '-12%', bottom: '-12%', justifyContent: 'center', gap: 12, transform: [{ rotate: `${tilt}deg` }] }}>
        {Array.from({ length: rows }, (_, r) => (
          <Marquee key={r} ms={26000 + r * 5000} reverse={r % 2 === 1}>
            {rowList(r).map((src, i) => (
              <Image key={i} source={src} style={{ width: tile, height: tile * 1.3, borderRadius: 14, marginRight: 12, backgroundColor: 'rgba(255,255,255,0.08)' }} contentFit="cover" />
            ))}
          </Marquee>
        ))}
      </View>
    </View>
  );
}

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function Bit({ i, t, colors }: { i: number; t: SharedValue<number>; colors: string[] }) {
  const a = rand(i) * Math.PI * 2;
  const speed = 160 + rand(i + 7) * 260;
  const spin = (rand(i + 3) - 0.5) * 900;
  const w = 6 + rand(i + 11) * 6;
  const style = useAnimatedStyle(() => {
    const k = t.value;
    return {
      opacity: k < 0.75 ? 1 : (1 - k) / 0.25,
      transform: [{ translateX: Math.cos(a) * speed * k }, { translateY: Math.sin(a) * speed * k - 120 * k + 520 * k * k }, { rotate: `${spin * k}deg` }],
    };
  });
  return <Animated.View style={[{ position: 'absolute', width: w, height: w * 1.6, borderRadius: 2, backgroundColor: colors[i % colors.length] }, style]} />;
}

/** A burst of confetti from the middle of its box. */
export function Confetti({ count = 40, colors = ['#FFD60A', '#FF375F', '#30D158', '#0A84FF', '#BF5AF2', '#ffffff'], delay = 250 }: { count?: number; colors?: string[]; delay?: number }) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!reduce) t.value = withDelay(delay, withTiming(1, { duration: 1700, easing: Easing.out(Easing.quad) }));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  if (reduce) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      {Array.from({ length: count }, (_, i) => (
        <Bit key={i} i={i} t={t} colors={colors} />
      ))}
    </View>
  );
}

/** Rays turning slowly behind something important. */
export function Rays({ color = '#ffffff', size, count = 14, opacity = 0.16 }: { color?: string; size: number; count?: number; opacity?: number }) {
  const reduce = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => {
    if (!reduce) r.value = withRepeat(withTiming(1, { duration: 40000, easing: Easing.linear }), -1, false);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  const half = size / 2;
  const base = (Math.PI * size) / count / 2.2;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, opacity }, spin]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ position: 'absolute', width: size, height: size, alignItems: 'center', transform: [{ rotate: `${(360 / count) * i}deg` }] }}>
          <View style={{ width: 0, height: 0, borderLeftWidth: base / 2, borderRightWidth: base / 2, borderTopWidth: half, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
        </View>
      ))}
    </Animated.View>
  );
}

/** Drops in with a spring and settles at a slight angle, like a photo put on a table. */
export function Tilt({ children, rotate = -4, delay = 0, style }: { children: ReactNode; rotate?: number; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const k = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) k.value = withDelay(delay, withSpring(1, { damping: 13, stiffness: 140, mass: 0.9 }));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({
    opacity: Math.min(1, k.value * 2),
    transform: [{ translateY: (1 - k.value) * 60 }, { scale: 0.7 + 0.3 * k.value }, { rotate: `${rotate * k.value + (1 - k.value) * rotate * -3}deg` }],
  }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** A slow, gentle bob for something floating. */
export function Float({ children, amount = 6, ms = 2600, style }: { children: ReactNode; amount?: number; ms?: number; style?: StyleProp<ViewStyle> }) {
  const s = useSwing(ms);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: (s.value - 0.5) * amount * 2 }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** A soft pulse (scale), e.g. on a play button that wants a tap. */
export function Pulse({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (!reduce) s.value = withRepeat(withSequence(withTiming(1.08, { duration: 700, easing: EASE_IN_OUT }), withTiming(1, { duration: 700, easing: EASE_IN_OUT })), -1, false);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** A horizontal bar that grows to its share. */
export function GrowBar({ share, delay = 0, color = '#fff', track = 'rgba(255,255,255,0.2)', height = 10 }: { share: number; delay?: number; color?: string; track?: string; height?: number }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(reduce ? share : 0);
  useEffect(() => {
    v.value = reduce ? share : withDelay(delay, withTiming(share, { duration: 900, easing: EASE_OUT }));
  }, [share, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ width: `${Math.max(2, v.value * 100)}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color }, anim]} />
    </View>
  );
}

/** A column that grows up from the baseline. */
export function GrowColumn({ ratio, delay = 0, color = '#fff', height, width, radius = 5 }: { ratio: number; delay?: number; color?: string; height: number; width: number | `${number}%`; radius?: number }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(reduce ? ratio : 0);
  useEffect(() => {
    v.value = reduce ? ratio : withDelay(delay, withSpring(ratio, { damping: 16, stiffness: 120 }));
  }, [ratio, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ height: Math.max(4, v.value * height) }));
  return <Animated.View style={[{ width, borderRadius: radius, backgroundColor: color }, anim]} />;
}

/** Black cinema bars sliding in from the top and bottom. */
export function Letterbox({ on, size = 64 }: { on: boolean; size?: number }) {
  const h = useSharedValue(0);
  useEffect(() => {
    h.value = withTiming(on ? size : 0, { duration: 700, easing: EASE_OUT });
  }, [on, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const bar = useAnimatedStyle(() => ({ height: h.value }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: '#000' }, bar]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, bar]} />
    </>
  );
}

/** A slow Ken Burns move over a still: zoom in or out, drifting a little. */
export function KenBurns({ source, ms, seed = 0, style }: { source: ThumbSource | undefined; ms: number; seed?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const k = useSharedValue(0);
  const dir = useMemo(() => ({ zoomIn: rand(seed) > 0.4, dx: (rand(seed + 1) - 0.5) * 40, dy: (rand(seed + 2) - 0.5) * 30 }), [seed]);
  useEffect(() => {
    k.value = 0;
    if (!reduce) k.value = withTiming(1, { duration: ms, easing: Easing.linear });
  }, [source, ms, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => {
    const s = dir.zoomIn ? 1.04 + k.value * 0.14 : 1.18 - k.value * 0.14;
    return { transform: [{ scale: s }, { translateX: dir.dx * k.value }, { translateY: dir.dy * k.value }] };
  });
  if (!source) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, anim, style]}>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" />
    </Animated.View>
  );
}
