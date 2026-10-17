/**
 * "Your weekly Wrapped is ready": a local notification every Monday at 10:00
 * (no server needed). Tapping it opens last week's Wrapped.
 */

import * as Notifications from 'expo-notifications';

import { getSetting, setSetting } from './library';

const KEY = 'vault.wrappedReminder';
const ID = 'reelvault-wrapped';

export async function wrappedReminderOn(): Promise<boolean> {
  return (await getSetting(KEY)) === '1';
}

/** False when iOS notifications are refused for ReelVault. */
export async function setWrappedReminder(on: boolean): Promise<boolean> {
  await Notifications.cancelScheduledNotificationAsync(ID).catch(() => undefined);
  if (on) {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } })).granted;
    if (!granted) {
      await setSetting(KEY, '0');
      return false;
    }
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: { title: 'Your weekly Wrapped is ready', body: 'See what you watched last week.', data: { tag: ID } },
      // weekday: 1 = Sunday, 2 = Monday.
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 2, hour: 10, minute: 0 },
    });
  }
  await setSetting(KEY, on ? '1' : '0');
  return true;
}

export function onWrappedTap(open: () => void): () => void {
  const handle = (r: Notifications.NotificationResponse | null) => {
    if (r?.notification.request.content.data?.tag === ID) open();
  };
  Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
