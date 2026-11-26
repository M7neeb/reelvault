/** The app's switch: the theme's colours and a light tick when it flips, everywhere. */

import { Switch, type SwitchProps } from 'react-native';

import { tick } from './haptics';
import { usePalette } from './theme';

export default function Toggle({ onValueChange, ...props }: SwitchProps) {
  const p = usePalette();
  return (
    <Switch
      trackColor={{ false: p.switchOff, true: p.accent }}
      thumbColor="#fff"
      {...props}
      onValueChange={(v) => {
        tick();
        onValueChange?.(v);
      }}
    />
  );
}
