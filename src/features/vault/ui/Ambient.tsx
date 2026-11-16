/**
 * The colour of a page taken from its picture: the cover or poster, blurred
 * far past recognition, washed with the background so text stays readable,
 * and fading into the plain background at the bottom. Sits behind content,
 * never over it. Off in Settings → Personalise → Artwork, and without a picture.
 */

import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import Fade from './Fade';
import { rgbOf, usePalette } from './theme';
import type { ThumbSource } from './types';

export default function Ambient({
  uri,
  height,
  style,
}: {
  /** A file or web address, or an image source as the audio covers carry. */
  uri: ThumbSource | null | undefined;
  /** Only the top of the page; the rest stays plain. */
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  if (!p.art || !uri) return null;
  const source = typeof uri === 'string' ? { uri } : uri;
  const bg = rgbOf(p.bg);
  const dark = p.scheme === 'dark';
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, height !== undefined && { bottom: undefined, height }, styles.clip, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {/* Larger than the box: a blur fades out at the picture's edges. */}
      <Image source={source} style={styles.picture} contentFit="cover" blurRadius={dark ? 70 : 90} transition={250} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${bg},${dark ? 0.5 : 0.62})` }]} />
      <Fade color={bg} from={0} to={1} style={styles.fade} />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  picture: { position: 'absolute', top: '-15%', left: '-15%', width: '130%', height: '130%' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
});
