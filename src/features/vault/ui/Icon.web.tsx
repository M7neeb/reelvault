/** Browser preview stand-in for the SF Symbols: the closest Ionicon. */

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';

import { ICONS, type IconName } from './icons';

export default function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: ColorValue; weight?: string }) {
  return <Ionicons name={ICONS[name].ion} size={size} color={color as string} />;
}
