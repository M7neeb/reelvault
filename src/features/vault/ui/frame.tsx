/**
 * Showing a video (or its cover) inside a card of a different shape without
 * cropping it to pieces: the whole picture sits in the middle, and the space
 * around it is filled by a soft, blurred, darkened copy of the same picture
 * (like iOS does for a portrait video on a wide screen). When the shapes are
 * close enough the picture simply fills the card.
 * Presentational only.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import type { ThumbSource } from './types';

/** How much of the picture filling the card would cut off (0 = nothing). */
export function cropShare(videoAspect: number | null | undefined, boxAspect: number): number {
  if (!videoAspect || !boxAspect || !isFinite(videoAspect)) return 0;
  return 1 - Math.min(videoAspect / boxAspect, boxAspect / videoAspect);
}

/** Fill the card when little would be cut off, otherwise show the whole picture. */
export function fitFor(videoAspect: number | null | undefined, boxAspect: number): 'cover' | 'contain' {
  return cropShare(videoAspect, boxAspect) > 0.18 ? 'contain' : 'cover';
}

export const aspectOf = (v: { width?: number | null; height?: number | null } | undefined | null): number | null =>
  v?.width && v?.height ? v.width / v.height : null;

/** The blurred copy that fills the space around a picture that doesn't fill the card. */
export function Backdrop({ source, dim = 0.3, blur = 36, style }: { source: ThumbSource | undefined; dim?: number; blur?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: '#000' }, style]} pointerEvents="none">
      {source ? <Image source={source} style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.25 }] }]} contentFit="cover" blurRadius={blur} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${dim})` }]} />
    </View>
  );
}

/** A still picture shown whole over its own blurred copy. */
export function FramedImage({ source, aspect, boxAspect, style, transition = 150 }: { source: ThumbSource | undefined; aspect?: number | null; boxAspect?: number; style?: StyleProp<ViewStyle>; transition?: number }) {
  const fit = boxAspect ? fitFor(aspect, boxAspect) : 'contain';
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {fit === 'contain' && <Backdrop source={source} />}
      {source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit={fit} transition={transition} /> : null}
    </View>
  );
}
