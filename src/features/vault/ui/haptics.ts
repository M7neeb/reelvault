/**
 * Small taps you feel on the iPhone: a light one for buttons, a tick for
 * pickers, a success buzz when something is saved. No-ops where there is no
 * Taptic Engine (the browser preview).
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const on = Platform.OS === 'ios';

export function tap(): void {
  if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function tick(): void {
  if (on) Haptics.selectionAsync().catch(() => undefined);
}

export function success(): void {
  if (on) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function warn(): void {
  if (on) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
