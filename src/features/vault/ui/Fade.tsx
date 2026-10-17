/**
 * A smooth vertical gradient (transparent → colour), for text over pictures.
 * Uses the native CSS-style gradient React Native draws; no banding.
 */

import { View, type StyleProp, type ViewStyle } from 'react-native';

export default function Fade({
  color,
  from = 0,
  to = 1,
  reverse,
  style,
}: {
  /** The solid end, as `r,g,b` (e.g. "0,0,0"). */
  color: string;
  from?: number;
  to?: number;
  /** Solid at the top instead of the bottom. */
  reverse?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const dir = reverse ? 'to top' : 'to bottom';
  const image = `linear-gradient(${dir}, rgba(${color},${from}) 0%, rgba(${color},${(from + to) / 2.6}) 45%, rgba(${color},${to}) 100%)`;
  return <View pointerEvents="none" style={[{ experimental_backgroundImage: image } as ViewStyle, style]} />;
}
