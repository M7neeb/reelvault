/**
 * Building blocks for the dashboard, Wrapped and badges: cards, stat tiles,
 * a change pill, bar charts that grow in (tap a bar to read it), share bars
 * and tier medallions. One look for every number in the app.
 * Presentational only.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import Icon from './Icon';
import { LiveCard } from './live';
import type { VaultItem } from './types';
import { ICONS, type IconName } from './icons';
import { DUR, EASE_OUT, enterUp, PressableScale, useReducedMotion } from './motion';
import { sheet, usePalette, useStyles, type Palette } from './theme';

/**
 * A CSS linear gradient as a style. The phone draws `experimental_backgroundImage`;
 * the browser preview reads `backgroundImage`; the solid colour shows if neither does.
 */
export function gradient(css: string, fallback?: string): ViewStyle {
  const solid = fallback ?? css.match(/#[0-9a-f]{6}|rgba?\([^)]*\)/i)?.[0];
  return { experimental_backgroundImage: css, backgroundImage: css, ...(solid ? { backgroundColor: solid } : {}) } as unknown as ViewStyle;
}

export const iconOr = (name: string, fallback: IconName = 'trophy'): IconName => (name in ICONS ? (name as IconName) : fallback);

/** A rounded card with an optional title and a short line under it. */
export function Card({
  title,
  sub,
  action,
  index = 0,
  style,
  children,
}: {
  title?: string;
  sub?: string;
  action?: { label: string; onPress: () => void };
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Animated.View entering={enterUp(index)} style={[styles.card, style]}>
      {(title || action) && (
        <View style={styles.cardHead}>
          <View style={{ flex: 1, gap: 2 }}>
            {!!title && <Text style={styles.cardTitle}>{title}</Text>}
            {!!sub && <Text style={styles.cardSub}>{sub}</Text>}
          </View>
          {action && (
            <TouchableOpacity onPress={action.onPress} hitSlop={8}>
              <Text style={styles.cardAction}>{action.label}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {children}
    </Animated.View>
  );
}

export function StatTile({ icon, value, label, tint, index = 0 }: { icon: IconName; value: string; label: string; tint?: string; index?: number }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <Animated.View entering={enterUp(index)} style={styles.tile}>
      <View style={[styles.tileIcon, { backgroundColor: `${tint ?? p.accent}26` }]}>
        <Icon name={icon} size={14} color={tint ?? p.accent} />
      </View>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Animated.View>
  );
}

/** "+35 %" in green, "−12 %" in grey: how a number moved against the time before. */
export function ChangePill({ text, up }: { text: string; up: boolean | null }) {
  const p = usePalette();
  const color = up === null ? p.textSecondary : up ? p.success : p.textSecondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: `${up ? p.success : p.textSecondary}22`, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
      {up !== null && <Icon name={up ? 'arrowUp' : 'arrowDown'} size={11} color={color} weight="bold" />}
      <Text style={{ color, fontSize: 12, fontWeight: '800' }}>{text}</Text>
    </View>
  );
}

function GrowBar({ ratio, color, height, delay }: { ratio: number; color: string; height: number; delay: number }) {
  const h = useSharedValue(0);
  useEffect(() => {
    h.value = withDelay(delay, withTiming(ratio, { duration: DUR.slow, easing: EASE_OUT }));
  }, [ratio]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ height: Math.max(ratio > 0 ? 3 : 0, h.value * height) }));
  return <Animated.View style={[{ width: '100%', borderRadius: 4, backgroundColor: color }, style]} />;
}

/**
 * Vertical bars. Tap one to see its value; labels are thinned out when there
 * are many bars, so they never overlap.
 */
export function Bars({
  data,
  height = 120,
  format,
  highlight,
  everyLabel,
}: {
  data: { label: string; value: number; current?: boolean; detail?: string }[];
  height?: number;
  format: (v: number) => string;
  /** Colour of the bars (the current one is full strength). */
  highlight?: string;
  /** Show every n-th label (worked out from the count when left out). */
  everyLabel?: number;
}) {
  const p = usePalette();
  const [picked, setPicked] = useState<number | null>(null);
  const [labelW, setLabelW] = useState(0);
  const max = Math.max(1, ...data.map((d) => d.value));
  const color = highlight ?? p.accent;
  const step = everyLabel ?? (data.length > 14 ? Math.ceil(data.length / 7) : 1);
  const sel = picked !== null ? data[picked] : null;
  const currentAt = data.findIndex((d) => d.current);
  // Every step-th label, plus the current one; a regular label too close to the current one is skipped.
  const showLabel = (i: number) =>
    i === currentAt || (i % step === 0 && (currentAt < 0 || step === 1 || Math.abs(i - currentAt) >= Math.ceil(step / 2)));
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: sel ? p.text : p.textSecondary, fontSize: 13, fontWeight: '700', minHeight: 18 }} numberOfLines={1}>
        {sel ? `${sel.detail ?? sel.label} · ${format(sel.value)}` : total > 0 ? 'Tap a bar to see it' : 'Nothing yet'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: data.length > 20 ? 2 : 4 }}>
        {data.map((d, i) => (
          <TouchableOpacity
            key={i}
            style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}
            onPress={() => setPicked(picked === i ? null : i)}
            accessibilityLabel={`${d.detail ?? d.label}: ${format(d.value)}`}>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, borderRadius: 4, backgroundColor: picked === i ? p.card : 'transparent' }} />
            <GrowBar ratio={d.value / max} color={d.current || picked === i ? color : `${color}99`} height={height} delay={Math.min(i, 30) * 12} />
          </TouchableOpacity>
        ))}
      </View>
      {/* Labels are placed under their bar but may be wider than it, so they never get cut off. */}
      <View style={{ height: 14 }} onLayout={(e) => setLabelW(e.nativeEvent.layout.width)}>
        {labelW > 0 &&
          data.map((d, i) =>
            showLabel(i) && d.label ? (
              <Text
                key={i}
                style={{
                  position: 'absolute',
                  width: 36,
                  left: ((i + 0.5) / data.length) * labelW - 18,
                  textAlign: 'center',
                  color: d.current ? p.text : p.textMuted,
                  fontSize: 10,
                  fontWeight: d.current ? '800' : '600',
                }}
                numberOfLines={1}>
                {d.label}
              </Text>
            ) : null
          )}
      </View>
    </View>
  );
}

/** A horizontal share bar (e.g. how much of your watching went to one video). */
export function ShareBar({ ratio, color, height = 6 }: { ratio: number; color?: string; height?: number }) {
  const p = usePalette();
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(Math.min(1, Math.max(0, ratio)), { duration: DUR.slow, easing: EASE_OUT });
  }, [ratio]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: p.card, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color ?? p.accent }, style]} />
    </View>
  );
}

/** Bronze to diamond: the colours of a badge, light to dark. */
export const TIER_COLORS: Record<number, [string, string]> = {
  1: ['#E8A66B', '#8A4B12'],
  2: ['#EEF1F5', '#7E8A9A'],
  3: ['#FFE08A', '#C27C0E'],
  4: ['#C9F4FF', '#3E8FB0'],
  5: ['#F0DBFF', '#7A4DFF'],
};

/** A round medal with the badge's icon; grey and unlit until it is earned. */
export function Medallion({ icon, tier, unlocked, size = 64, progress }: { icon: string; tier: number; unlocked: boolean; size?: number; progress?: number }) {
  const p = usePalette();
  const [light, dark] = TIER_COLORS[Math.min(5, Math.max(1, tier))];
  const ring = Math.max(3, Math.round(size / 16));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={[
          { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', borderWidth: ring },
          unlocked
            ? ({ ...gradient(`linear-gradient(145deg, ${light} 0%, ${dark} 55%, ${light} 100%)`), borderColor: `${light}AA`, shadowColor: dark, shadowOpacity: 0.45, shadowRadius: size / 6, shadowOffset: { width: 0, height: size / 16 } } as ViewStyle)
            : { backgroundColor: p.card, borderColor: p.border },
        ]}>
        {unlocked && (
          <>
            {/* the inner rim and a highlight, so it reads as metal */}
            <View pointerEvents="none" style={{ position: 'absolute', top: ring, left: ring, right: ring, bottom: ring, borderRadius: size, borderWidth: Math.max(1, ring / 2), borderColor: 'rgba(255,255,255,0.35)' }} />
            <View pointerEvents="none" style={[{ position: 'absolute', top: size * 0.08, left: size * 0.2, right: size * 0.2, height: size * 0.34, borderRadius: size }, gradient('linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 100%)', 'transparent')]} />
          </>
        )}
        <Icon name={iconOr(icon)} size={size * 0.42} color={unlocked ? '#fff' : p.textMuted} weight="bold" />
      </View>
      {!unlocked && progress !== undefined && progress > 0 && (
        <View style={{ position: 'absolute', bottom: -2, left: size * 0.16, right: size * 0.16, height: 5, borderRadius: 3, backgroundColor: p.bg, padding: 1 }}>
          <View style={{ height: 3, borderRadius: 2, width: `${Math.min(100, progress * 100)}%`, backgroundColor: p.accent }} />
        </View>
      )}
    </View>
  );
}

/** Fills from 0 to `to` when it appears (and eases to new values); straight there with Reduce Motion. */
function useFill(to: number, ms = 900): number {
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  const from = useRef(reduce ? to : 0);
  useEffect(() => {
    if (reduce) return setV(to);
    const start = Date.now();
    const a = from.current;
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / ms);
      const n = a + (to - a) * (1 - Math.pow(1 - t, 3));
      from.current = n;
      setV(n);
      if (t >= 1) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, [to, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/**
 * A progress ring drawn with plain views (two clipped half rings), so it needs
 * no extra native library. 0..1, and past 1 it shows a full ring.
 */
export function Ring({ size, stroke, progress, color, track, children }: { size: number; stroke: number; progress: number; color: string; track?: string; children?: ReactNode }) {
  const p = usePalette();
  const v = useFill(Math.max(0, Math.min(1, progress)));
  const half = size / 2;
  // A ring with only its top and right borders coloured is a half ring from -45° to 135°.
  const arc = (end: number) => ({
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: stroke,
    borderColor: 'transparent',
    borderTopColor: color,
    borderRightColor: color,
    transform: [{ rotate: `${end - 135}deg` }],
  });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: half, borderWidth: stroke, borderColor: track ?? p.card }} />
      {v > 0 && (
        <View style={{ position: 'absolute', left: half, top: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={[arc(Math.min(v, 0.5) * 360), { left: -half }]} />
        </View>
      )}
      {v > 0.5 && (
        <View style={{ position: 'absolute', left: 0, top: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={arc(v * 360)} />
        </View>
      )}
      {children}
    </View>
  );
}

/** A picture card: a video's frame with a shade, a big value and a line under it. */
export function PhotoCard({
  source,
  kicker,
  value,
  detail,
  icon,
  width,
  height = 150,
  onPress,
  video,
}: {
  /** Plays this video in the card while it is the one most in view. */
  video?: Pick<VaultItem, 'id' | 'uri' | 'durationMs' | 'width' | 'height'> | null;
  source: unknown;
  kicker: string;
  value: string;
  detail?: string;
  icon?: string;
  width: number | `${number}%`;
  height?: number;
  onPress?: () => void;
}) {
  const p = usePalette();
  const body = (
    <View style={{ width: '100%', height, borderRadius: 18, overflow: 'hidden', backgroundColor: p.tile, justifyContent: 'flex-end', padding: 12 }}>
      {video ? (
        <LiveCard
          id={`photo-${video.id}-${kicker}`}
          uri={video.uri}
          durationMs={video.durationMs}
          cover={source as VaultItem['thumbSource']}
          radius={0}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          video={video}
          soundStyle={{ top: 10, right: 10 }}
        />
      ) : source ? (
        <Image source={source as never} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} contentFit="cover" transition={150} />
      ) : null}
      <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, gradient('linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)', 'rgba(0,0,0,0.35)')]} />
      {icon && (
        <View style={{ position: 'absolute', top: 10, left: 10, width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={iconOr(icon)} size={14} color="#fff" />
        </View>
      )}
      <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 }} numberOfLines={1}>
        {kicker.toUpperCase()}
      </Text>
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {!!detail && (
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' }} numberOfLines={2}>
          {detail}
        </Text>
      )}
    </View>
  );
  return onPress ? (
    <PressableScale style={{ width }} onPress={onPress} accessibilityLabel={`${kicker}: ${value}`}>
      {body}
    </PressableScale>
  ) : (
    <View style={{ width }}>{body}</View>
  );
}

export function SectionTitle({ title, detail, index = 0, action }: { title: string; detail?: string; index?: number; action?: { label: string; onPress: () => void } }) {
  const styles = useStyles(makeStyles);
  return (
    <Animated.View entering={enterUp(index)} style={styles.sectionRow}>
      <Text style={styles.section}>{title}</Text>
      {!!detail && (
        <Text style={styles.sectionDetail} numberOfLines={1}>
          {detail}
        </Text>
      )}
      {action && (
        <TouchableOpacity onPress={action.onPress} hitSlop={8} style={{ marginLeft: 'auto' }}>
          <Text style={styles.sectionAction}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    card: { backgroundColor: p.elevated, borderRadius: 20, padding: 16, gap: 12 },
    cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    cardTitle: { color: p.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
    cardSub: { color: p.textSecondary, fontSize: 13 },
    cardAction: { color: p.link, fontSize: 14, fontWeight: '700' },
    tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: p.elevated, borderRadius: 18, padding: 14, gap: 4 },
    tileIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    tileValue: { color: p.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.4 },
    tileLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    sectionRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 },
    section: { color: p.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
    sectionDetail: { color: p.textSecondary, fontSize: 15, fontWeight: '600', flexShrink: 1 },
    sectionAction: { color: p.link, fontSize: 15, fontWeight: '700' },
  });
