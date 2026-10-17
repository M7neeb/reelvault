/**
 * Local notifications (native half): new episodes and movie releases from
 * Simkl's calendar files, scheduled on the phone. No push server and no push
 * entitlement (a free Apple ID cannot sign one): iOS shows them by itself.
 * Rescheduled after every sync and whenever the settings change.
 */

import * as Notifications from 'expo-notifications';

import { getSetting, setSetting } from '@/features/vault/library';

import { loadCalendar } from './actions';
import type { SimklType } from './logic';
import { parseReminderSettings, planReminders, type ReminderSettings } from './reminders';
import { listSimklItems } from './repo';

const SETTINGS_KEY = 'simkl.reminders';
const TAG = 'reelvault-simkl';

// Show the banner even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function reminderSettings(): Promise<ReminderSettings> {
  return parseReminderSettings(await getSetting(SETTINGS_KEY));
}

/** Saves the settings; turning them on asks iOS for permission first. False = permission refused. */
export async function saveReminderSettings(next: ReminderSettings): Promise<boolean> {
  if (next.enabled) {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } })).granted;
    if (!granted) {
      await setSetting(SETTINGS_KEY, JSON.stringify({ ...next, enabled: false }));
      await rescheduleReminders();
      return false;
    }
  }
  await setSetting(SETTINGS_KEY, JSON.stringify(next));
  await rescheduleReminders();
  return true;
}

/** Cancels ReelVault's pending reminders and schedules the next ones. Returns how many. */
export async function rescheduleReminders(): Promise<number> {
  const settings = await reminderSettings();
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of pending) {
    if (n.content.data?.tag === TAG) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
  if (!settings.enabled) return 0;

  const items = await listSimklItems();
  const types = (['show', 'anime', 'movie'] as SimklType[]).filter((t) => settings.types[t] && items.some((i) => i.type === t));
  const calendar = [];
  for (const t of types) {
    try {
      calendar.push(...(await loadCalendar(t)));
    } catch (e) {
      console.log(`[NOTIFY] calendar ${t} failed: ${String(e)}`);
    }
  }
  const plan = planReminders(calendar, items, settings, Date.now());
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      content: { title: r.title, body: r.body, data: { tag: TAG, simklId: r.simklId, type: r.type } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.at) },
    });
  }
  console.log(`[NOTIFY] ${plan.length} reminders scheduled`);
  return plan.length;
}

/** Tapping a reminder opens that title. */
export function onReminderTap(open: (t: { simklId: number; type: SimklType }) => void): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data;
    if (data?.tag === TAG && typeof data.simklId === 'number' && typeof data.type === 'string') {
      open({ simklId: data.simklId, type: data.type as SimklType });
    }
  };
  Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
