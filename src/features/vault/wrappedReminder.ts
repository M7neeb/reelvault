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

/* ------------------------------------------- on this day and the yearly Wrapped */

const OTD_KEY = 'vault.onThisDayReminder';
const OTD_TAG = 'reelvault-otd';
const YEAR_KEY = 'vault.yearWrappedReminder';
const YEAR_TAG = 'reelvault-year';

export type OpenRequest = 'yearWrapped' | 'monthWrapped' | 'onThisDay';

const MONTH_KEY = 'vault.monthWrappedReminder';
const MONTH_TAG = 'reelvault-month';

async function allowed(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  return current.granted || (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } })).granted;
}

async function cancelTagged(tag: string): Promise<void> {
  const pending = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of pending) if (n.content.data?.tag === tag) await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined);
}

export async function onThisDayReminderOn(): Promise<boolean> {
  return (await getSetting(OTD_KEY)) === '1';
}

export async function yearWrappedReminderOn(): Promise<boolean> {
  return (await getSetting(YEAR_KEY)) !== '0';
}

/**
 * Plans the next two weeks of "On this day" notifications (9:00, only on days
 * with videos from earlier years). Run again on every app start, so new
 * imports are counted. False when notifications are refused.
 */
export async function scheduleOnThisDay(plan: { at: number; title: string; body: string }[]): Promise<void> {
  await cancelTagged(OTD_TAG);
  if (!(await onThisDayReminderOn())) return;
  for (const [i, n] of plan.entries()) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${OTD_TAG}-${i}`,
      content: { title: n.title, body: n.body, data: { tag: OTD_TAG } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.at) },
    }).catch((e) => console.log(`[OTD] could not schedule: ${String(e)}`));
  }
}

export async function setOnThisDayReminder(on: boolean, plan: { at: number; title: string; body: string }[]): Promise<boolean> {
  if (on && !(await allowed())) {
    await setSetting(OTD_KEY, '0');
    return false;
  }
  await setSetting(OTD_KEY, on ? '1' : '0');
  await scheduleOnThisDay(on ? plan : []);
  return true;
}

/** 1 December, 10:00: "Your <year> Wrapped is ready". On unless turned off (it only asks for permission when turned on by hand). */
export async function scheduleYearWrapped(): Promise<void> {
  await cancelTagged(YEAR_TAG);
  if (!(await yearWrappedReminderOn())) return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  const now = new Date();
  let at = new Date(now.getFullYear(), 11, 1, 10, 0);
  if (at.getTime() <= now.getTime()) at = new Date(now.getFullYear() + 1, 11, 1, 10, 0);
  await Notifications.scheduleNotificationAsync({
    identifier: YEAR_TAG,
    content: { title: `Your ${at.getFullYear()} Wrapped is ready`, body: 'Your year in videos: your #1, your streaks, your month-by-month.', data: { tag: YEAR_TAG } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  }).catch((e) => console.log(`[YEAR] could not schedule: ${String(e)}`));
}

export async function setYearWrappedReminder(on: boolean): Promise<boolean> {
  if (on && !(await allowed())) {
    await setSetting(YEAR_KEY, '0');
    return false;
  }
  await setSetting(YEAR_KEY, on ? '1' : '0');
  await scheduleYearWrapped();
  return true;
}

export async function monthWrappedReminderOn(): Promise<boolean> {
  return (await getSetting(MONTH_KEY)) !== '0';
}

/** The 1st of next month, 10:00: "Your <month> Wrapped is ready". Planned again on every app start. */
export async function scheduleMonthWrapped(): Promise<void> {
  await cancelTagged(MONTH_TAG);
  if (!(await monthWrappedReminderOn())) return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth() + 1, 1, 10, 0);
  // December's 1st already has the yearly one; the month's goes out a day later then.
  if (at.getMonth() === 11) at.setDate(2);
  const month = new Date(at.getFullYear(), at.getMonth() - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
  await Notifications.scheduleNotificationAsync({
    identifier: MONTH_TAG,
    content: { title: `Your ${month} Wrapped is ready`, body: 'Your month in videos: what you watched most, your biggest day and more.', data: { tag: MONTH_TAG } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  }).catch((e) => console.log(`[MONTH] could not schedule: ${String(e)}`));
}

export async function setMonthWrappedReminder(on: boolean): Promise<boolean> {
  if (on && !(await allowed())) {
    await setSetting(MONTH_KEY, '0');
    return false;
  }
  await setSetting(MONTH_KEY, on ? '1' : '0');
  await scheduleMonthWrapped();
  return true;
}

/** Tapping an On this day or yearly Wrapped notification. */
export function onOpenRequestTap(open: (r: OpenRequest) => void): () => void {
  const handle = (r: Notifications.NotificationResponse | null) => {
    const tag = r?.notification.request.content.data?.tag;
    if (tag === OTD_TAG) open('onThisDay');
    else if (tag === YEAR_TAG) open('yearWrapped');
    else if (tag === MONTH_TAG) open('monthWrapped');
  };
  Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
