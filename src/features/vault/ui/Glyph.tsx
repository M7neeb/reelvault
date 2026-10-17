/** An SF Symbol in the theme's icon colour, for round buttons that style their own circle. */

import Icon from './Icon';
import type { IconName } from './icons';
import { usePalette } from './theme';

export default function Glyph({ name, size = 15, color }: { name: IconName; size?: number; color?: string }) {
  const p = usePalette();
  return <Icon name={name} size={size} color={color ?? p.icon} weight="bold" />;
}
