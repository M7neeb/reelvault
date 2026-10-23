/**
 * "New chapters" notifications, shown on the phone itself (no server):
 * after the app checks your sources and finds chapters you don't have.
 */

import * as Notifications from 'expo-notifications';

import { getSetting, setSetting } from '../library';

const LAST_CHECK = 'manga.lastCheck';
const SIX_HOURS = 6 * 3_600_000;

/** Whether it is time for the next check when the app opens. */
export async function dueForCheck(now: number): Promise<boolean> {
  const last = Number(await getSetting(LAST_CHECK).catch(() => null)) || 0;
  return now - last >= SIX_HOURS;
}

export async function markChecked(now: number): Promise<void> {
  await setSetting(LAST_CHECK, String(now)).catch(() => undefined);
}

/** One notification for everything that came in: "3 new chapters: Title, Title". */
export async function notifyNewChapters(found: { title: string; count: number }[]): Promise<void> {
  const total = found.reduce((a, f) => a + f.count, 0);
  if (!total) return;
  try {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })).granted;
    if (!granted) return;
    const names = found.sort((a, b) => b.count - a.count).map((f) => (f.count > 1 ? `${f.title} (${f.count})` : f.title));
    await Notifications.scheduleNotificationAsync({
      content: {
        title: total === 1 ? 'A new chapter' : `${total} new chapters`,
        body: names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : ''),
        data: { kind: 'manga-new' },
      },
      trigger: null,
    });
  } catch (e) {
    console.log(`[MANGA] notification: ${String(e)}`);
  }
}
