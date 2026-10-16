import { Alert, Platform } from 'react-native';

/**
 * A yes/no question before anything that changes or removes videos.
 * Alert.alert does not exist on web, so the browser preview uses window.confirm.
 */
export function confirmAction(
  title: string,
  message: string | undefined,
  onConfirm: () => void,
  { label = 'Delete', destructive = true }: { label?: string; destructive?: boolean } = {}
): void {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // eslint-disable-next-line no-alert
    if (typeof window === 'undefined' || window.confirm(text)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: label, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

/** A message with only an OK button. */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined') window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
