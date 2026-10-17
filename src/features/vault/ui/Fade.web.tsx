/** Browser preview version of Fade: the same gradient as CSS. */

import { View, type StyleProp, type ViewStyle } from 'react-native';

export default function Fade({
  color,
  from = 0,
  to = 1,
  reverse,
  style,
}: {
  color: string;
  from?: number;
  to?: number;
  reverse?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const dir = reverse ? 'to top' : 'to bottom';
  const image = `linear-gradient(${dir}, rgba(${color},${from}) 0%, rgba(${color},${(from + to) / 2.6}) 45%, rgba(${color},${to}) 100%)`;
  return <View pointerEvents="none" style={[{ backgroundImage: image } as unknown as ViewStyle, style]} />;
}
