import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewStyle } from 'react-native';

type Props = { style?: ViewStyle; tint?: string; activeTint?: string };

const available = requireOptionalNativeModule('ReelVaultAirPlay') != null;
const NativeButton: ComponentType<Props> | null = available ? requireNativeView<Props>('ReelVaultAirPlay') : null;

/** True in app builds that have the AirPlay button (1.9+). */
export const hasAirPlay = NativeButton != null;

/** Apple's AirPlay button; renders nothing where it isn't available (Expo Go, the web, older builds). */
export function AirPlayButton(props: Props) {
  return NativeButton ? <NativeButton {...props} /> : null;
}
