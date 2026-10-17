/** A round glass button with one SF Symbol: the header controls on every screen. */

import { TouchableOpacity, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import Glass from './Glass';
import { tap } from './haptics';
import Icon from './Icon';
import type { IconName } from './icons';
import { usePalette } from './theme';

export default function IconButton({
  icon,
  onPress,
  onLongPress,
  label,
  size = 40,
  tint,
  color,
  clear,
  style,
}: {
  icon: IconName;
  onPress: () => void;
  onLongPress?: () => void;
  /** Read out by VoiceOver. */
  label: string;
  size?: number;
  tint?: string;
  color?: ColorValue;
  /** See-through glass, for buttons over a picture. */
  clear?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <TouchableOpacity
      onPress={() => {
        tap();
        onPress();
      }}
      onLongPress={onLongPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      style={style}>
      <Glass
        interactive
        clear={clear}
        tint={tint}
        fallback={clear ? 'rgba(0,0,0,0.38)' : undefined}
        style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={Math.round(size * 0.44)} color={color ?? (tint || clear ? '#fff' : p.icon)} />
      </Glass>
    </TouchableOpacity>
  );
}
