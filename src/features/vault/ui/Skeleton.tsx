/**
 * Loading shapes: grey outlines of what is on its way (rows, a dashboard, a
 * page of text), gently breathing, instead of a lone spinner. With Reduce
 * Motion on they stay still.
 */

import { createContext, useContext, useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from './motion';
import { raised, sheet, usePalette, useStyles, type Palette } from './theme';

function useBreath() {
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduce) o.value = withRepeat(withTiming(0.5, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduce, o]);
  return useAnimatedStyle(() => ({ opacity: o.value }));
}

/** One grey shape. `color` overrides the theme (readers on paper). */
export function Bone({ w, h, r = 6, color, style }: { w: DimensionValue; h: number; r?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: color ?? (p.scheme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.09)') }, style]} />;
}

// A shape inside another shape breathes with it, not on top of it.
const Inside = createContext(false);

function Breathing({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const inside = useContext(Inside);
  const breath = useBreath();
  if (inside) return <View style={style}>{children}</View>;
  return (
    <Animated.View style={[style, breath]} accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
      <Inside.Provider value>{children}</Inside.Provider>
    </Animated.View>
  );
}

const WIDTHS = ['72%', '58%', '80%', '64%', '50%', '76%'] as const;

/** A list loading: rows with a picture (square or poster) and two lines, in a card. */
export function SkeletonRows({ count = 6, art = 'square', card = true, style }: { count?: number; art?: 'none' | 'square' | 'poster'; card?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <Breathing style={[card && styles.card, card && { backgroundColor: raised(p) }, style]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, card && i > 0 && styles.line]}>
          {art !== 'none' && <Bone w={art === 'poster' ? 40 : 44} h={art === 'poster' ? 60 : 44} r={8} />}
          <View style={styles.lines}>
            <Bone w={WIDTHS[i % WIDTHS.length]} h={13} />
            <Bone w={WIDTHS[(i + 3) % WIDTHS.length]} h={10} style={{ opacity: 0.7 }} />
          </View>
        </View>
      ))}
    </Breathing>
  );
}

/** A grid of posters loading. */
export function SkeletonGrid({ count = 6, columns = 3, gap = 12, width }: { count?: number; columns?: number; gap?: number; width: number }) {
  const w = (width - gap * (columns - 1)) / columns;
  return (
    <Breathing style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: w, gap: 6 }}>
          <Bone w={w} h={Math.round(w * 1.5)} r={10} />
          <Bone w="80%" h={11} />
        </View>
      ))}
    </Breathing>
  );
}

/** A dashboard loading: three number tiles, a chart and a few rows. */
export function SkeletonDashboard({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <Breathing style={[styles.dash, style]}>
      <View style={styles.tiles}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.tile, { backgroundColor: raised(p) }]}>
            <Bone w="60%" h={22} />
            <Bone w="80%" h={10} />
          </View>
        ))}
      </View>
      <View style={[styles.chart, { backgroundColor: raised(p) }]}>
        <Bone w="40%" h={14} />
        <View style={styles.bars}>
          {[0.5, 0.8, 0.35, 0.9, 0.6, 0.75, 0.45].map((f, i) => (
            <Bone key={i} w={14} h={Math.round(110 * f)} r={4} />
          ))}
        </View>
      </View>
      <SkeletonRows count={3} art="none" />
    </Breathing>
  );
}

/** A page of text loading (a book, a summary). */
export function SkeletonText({ lines = 9, color, lineHeight = 26 }: { lines?: number; color?: string; lineHeight?: number }) {
  return (
    <Breathing style={{ gap: lineHeight - 12 }}>
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} w={i % 5 === 4 ? '55%' : i % 3 === 2 ? '92%' : '100%'} h={12} color={color} />
      ))}
    </Breathing>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    card: { borderRadius: 18, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    line: { borderTopWidth: 0.5, borderTopColor: p.separator },
    lines: { flex: 1, gap: 8 },
    dash: { gap: 14 },
    tiles: { flexDirection: 'row', gap: 10 },
    tile: { flex: 1, borderRadius: 16, padding: 14, gap: 10 },
    chart: { borderRadius: 18, padding: 16, gap: 16 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 110 },
  });
