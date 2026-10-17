/** An SF Symbol by role (see icons.ts). The browser preview uses Icon.web.tsx instead. */

import { SymbolView, type SymbolWeight } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { ICONS, type IconName } from './icons';

export default function Icon({
  name,
  size = 20,
  color,
  weight = 'semibold',
}: {
  name: IconName;
  size?: number;
  color: ColorValue;
  weight?: SymbolWeight;
}) {
  return (
    <SymbolView
      name={ICONS[name].sf}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
    />
  );
}
