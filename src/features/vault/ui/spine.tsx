/**
 * The box-set spine: a printed colour band down the leading edge of a box
 * (a series, a poster, a book), with a hairline where the board is cut.
 */

import { StyleSheet, View } from 'react-native';

import { spineColor } from '../spineColor';
import { usePalette } from './theme';

export function Spine({ name, color, width = 4 }: { /** Picks the colour when `color` is not given. */ name?: string; color?: string; width?: number }) {
  const p = usePalette();
  const c = color ?? (name ? spineColor(name, p.scheme) : null);
  if (!c) return null;
  return (
    <View pointerEvents="none" style={[styles.band, { width, backgroundColor: c }]}>
      <View style={styles.cut} />
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  cut: { position: 'absolute', right: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.45)' },
});
