/**
 * A poster with a designed stand-in: titles Simkl has no picture for get a
 * colour of their own (picked from the title, so it never changes) with the
 * name written on it, instead of a grey "no picture" card.
 */

import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import Fade from '@/features/vault/ui/Fade';

import { posterUrl } from '../logic';

const HUES = [212, 262, 330, 8, 28, 160, 190, 286];

/** The stand-in colour for a title (also behind cards that have no picture). */
export function hueFor(title: string): number {
  // FNV-1a: similar titles still land on different colours.
  let h = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) h = Math.imul(h ^ title.charCodeAt(i), 16777619);
  return HUES[((h >>> 0) >>> 5) % HUES.length];
}

export default function Poster({
  path,
  title,
  width,
  height,
  radius = 8,
  size = '_c',
  style,
  hideTitle,
  children,
}: {
  path: string | null;
  title: string;
  width: number;
  height: number;
  radius?: number;
  size?: '_ca' | '_m' | '_c' | '_cm' | '_w';
  style?: StyleProp<ViewStyle>;
  /** Stand-in without the name on it (posters stacked behind another). */
  hideTitle?: boolean;
  /** Badges and progress bars drawn on top. */
  children?: React.ReactNode;
}) {
  const box = {
    width,
    height,
    borderRadius: radius,
    overflow: 'hidden' as const,
  };
  if (!path) {
    const hue = hueFor(title);
    const fs = Math.max(10, Math.min(18, Math.round(width / 6.2)));
    return (
      <View style={[box, { backgroundColor: `hsl(${hue}, 46%, 36%)` }, style]}>
        <Fade color="0,0,0" from={0} to={0.62} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.18)',
          }}
        />
        {!hideTitle && (
          <Text
            numberOfLines={4}
            style={{
              position: 'absolute',
              left: 8,
              right: 8,
              bottom: 10,
              color: '#fff',
              fontSize: fs,
              lineHeight: Math.round(fs * 1.15),
              fontWeight: '800',
              letterSpacing: -0.2,
            }}>
            {title}
          </Text>
        )}
        {children}
      </View>
    );
  }
  return (
    <View style={[box, { backgroundColor: '#1c1c1e' }, style]}>
      <Image source={{ uri: posterUrl(path, size) }} style={{ width, height }} contentFit="cover" transition={150} recyclingKey={path} />
      {children}
    </View>
  );
}
