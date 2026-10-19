/**
 * Small pieces shared by the Overview screen and a title's page: covers,
 * the Watch / Overview switch, status colours. Presentational only.
 */

import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { hueFor } from '@/features/simkl/ui/Poster';

import type { OvEntry, OvStatus, OvVideo } from '../overview';
import Fade from './Fade';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { tick } from './haptics';
import { SPRING } from './motion';
import Icon from './Icon';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

export const fmtStars = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function statusColor(p: Palette, s: OvStatus): string {
  switch (s) {
    case 'watching':
      return p.link;
    case 'completed':
      return p.success;
    case 'hold':
      return p.rating;
    case 'dropped':
      return p.danger;
    default:
      return p.textSecondary;
  }
}

/** A library item as the Overview sees it. */
export function toOvVideo(v: VaultItem): OvVideo {
  return {
    id: v.id,
    title: v.title,
    filename: v.filename,
    durationMs: v.durationMs,
    sizeBytes: v.sizeBytes,
    rating: v.rating,
    status: v.status,
    notes: v.notes,
    tagNames: v.tagNames,
    thumb: v.thumbSource || null,
    createdAt: v.createdAt,
    importedAt: v.importedAt,
    where: v.deletedAt ? 'trash' : 'library',
    removedAt: null,
    isPrivate: v.isPrivate,
  };
}

/** Watch ⟷ Overview, at the top of the Videos tab in both modes. The pill slides across. */
export type VideosMode = 'watch' | 'overview' | 'audio';

/** Watch · Overview · Audio: the three ways of the Videos tab. */
export function ModeSwitch({ mode, onChange }: { mode: VideosMode; onChange: (m: VideosMode) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [sizes, setSizes] = useState<{ x: number; w: number }[]>([]);
  const index = mode === 'watch' ? 0 : mode === 'overview' ? 1 : 2;
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  useEffect(() => {
    const s = sizes[index];
    if (!s) return;
    // The other side starts where the pill was, so switching slides it across.
    const other = mode === 'watch' ? sizes[1] : sizes[0];
    if (other && w.value === 0) {
      x.value = other.x;
      w.value = other.w;
    }
    x.value = withSpring(s.x, SPRING);
    w.value = withSpring(s.w, SPRING);
  }, [index, sizes]); // eslint-disable-line react-hooks/exhaustive-deps
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: w.value }));
  const items = [
    ['watch', 'Watch', 'play'],
    ['overview', 'Overview', 'star'],
    ['audio', 'Audio', 'headphones'],
  ] as const;
  return (
    <View style={styles.mode} accessibilityRole="tablist">
      <Animated.View pointerEvents="none" style={[styles.modePill, pill]} />
      {items.map(([key, label, icon], i) => {
        const on = mode === key;
        return (
          <TouchableOpacity
            key={key}
            style={styles.modeItem}
            onLayout={(e) => {
              const { x: lx, width } = e.nativeEvent.layout;
              setSizes((old) => {
                const next = [...old];
                next[i] = { x: lx, w: width };
                return next;
              });
            }}
            onPress={() => {
              if (on) return;
              tick();
              onChange(key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}>
            <Icon name={icon} size={12} color={on ? '#fff' : p.textSecondary} />
            <Text style={[styles.modeText, on && styles.modeTextOn]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** A cover picture, or a coloured stand-in with the name on it. */
export function Cover({
  source,
  title,
  width,
  height,
  radius = 10,
  hideTitle,
  children,
}: {
  source: OvEntry['cover'];
  title: string;
  width: number | `${number}%`;
  height: number;
  radius?: number;
  hideTitle?: boolean;
  children?: React.ReactNode;
}) {
  const box = { width, height, borderRadius: radius, overflow: 'hidden' as const };
  if (!source) {
    return (
      <View style={[box, { backgroundColor: `hsl(${hueFor(title)}, 46%, 36%)` }]}>
        <Fade color="0,0,0" from={0} to={0.6} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
        {!hideTitle && (
          <Text numberOfLines={3} style={{ position: 'absolute', left: 8, right: 8, bottom: 9, color: '#fff', fontSize: 13, fontWeight: '800' }}>
            {title}
          </Text>
        )}
        {children}
      </View>
    );
  }
  return (
    <View style={[box, { backgroundColor: '#1c1c1e' }]}>
      <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} />
      {children}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    mode: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: p.elevated, borderRadius: 999, padding: 3 },
    modeItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
    modePill: { position: 'absolute', top: 3, bottom: 3, left: 0, borderRadius: 999, backgroundColor: p.accent },
    modeText: { color: p.textSecondary, fontSize: 14, fontWeight: '700' },
    modeTextOn: { color: '#fff' },
  });
