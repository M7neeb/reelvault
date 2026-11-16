/**
 * "Time to read": a local notification on evenings the daily goal is not reached yet.
 * The next week is planned again whenever reading changes (see reminderTimes).
 */

import * as Notifications from 'expo-notifications';

const TAG = 'reelvault-readgoal';

/** False when iOS notifications are refused for ReelVault. */
export async function allowReadReminder(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  return current.granted || (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } })).granted;
}

export async function planReadReminders(times: number[], goalMin: number): Promise<void> {
  const pending = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of pending) if (n.content.data?.tag === TAG) await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined);
  if (!times.length) return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  for (const [i, at] of times.entries()) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${TAG}-${i}`,
      content: { title: 'Time to read', body: `${goalMin} minutes with a book and today's goal is done.`, data: { tag: TAG } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
    }).catch((e) => console.log(`[BOOKS] reminder not planned: ${String(e)}`));
  }
}
