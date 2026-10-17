/**
 * Small pieces shared by the Overview screen and a title's page: covers,
 * the Watch / Overview switch, status colours. Presentational only.
 */

import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { hueFor } from '@/features/simkl/ui/Poster';

import type { OvEntry, OvStatus, OvVideo } from '../overview';
import Fade from './Fade';
import { tick } from './haptics';
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

/** Watch ⟷ Overview, at the top of the Videos tab in both modes. */
export function ModeSwitch({ mode, onChange }: { mode: 'watch' | 'overview'; onChange: (m: 'watch' | 'overview') => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <View style={styles.mode} accessibilityRole="tablist">
      {(
        [
          ['watch', 'Watch', 'play'],
          ['overview', 'Overview', 'star'],
        ] as const
      ).map(([key, label, icon]) => {
        const on = mode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.modeItem, on && styles.modeOn]}
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
    modeOn: { backgroundColor: p.accent },
    modeText: { color: p.textSecondary, fontSize: 14, fontWeight: '700' },
    modeTextOn: { color: '#fff' },
  });
