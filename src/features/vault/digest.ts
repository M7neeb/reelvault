/**
 * One notification a day (native half): while it is on, the episode and On
 * this day schedulers hand their notes here instead of scheduling them, and
 * this file schedules one note per day at the chosen hour.
 */

import * as Notifications from 'expo-notifications';

import { parseDigest, planDigest, type DigestPart, type DigestSettings } from './digestPlan';
import { getSetting, setSetting } from './library';

const KEY = 'digest';
const TAG = 'reelvault-digest';
type Source = 'episodes' | 'memories';
const partKey = (s: Source) => `digest.part.${s}`;

export const digestSettings = async (): Promise<DigestSettings> => parseDigest(await getSetting(KEY).catch(() => null));
export const digestOn = async (): Promise<boolean> => (await digestSettings()).on;

// The schedulers that feed the digest re-run when it is switched on or off.
const listeners = new Set<() => Promise<unknown>>();
export function onDigestChange(run: () => Promise<unknown>): () => void {
  listeners.add(run);
  return () => listeners.delete(run);
}

/** False when iOS notifications are refused for ReelVault. */
export async function setDigest(next: DigestSettings): Promise<boolean> {
  if (next.on) {
    const current = await Notifications.getPermissionsAsync();
    const ok = current.granted || (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } })).granted;
    if (!ok) return false;
  }
  await setSetting(KEY, JSON.stringify(next));
  for (const run of listeners) await run().catch((e) => console.log(`[DIGEST] ${String(e)}`));
  await rebuildDigest();
  return true;
}

/** A scheduler's notes for the coming days, while the digest is on. */
export async function digestPart(source: Source, parts: DigestPart[]): Promise<void> {
  await setSetting(partKey(source), JSON.stringify(parts));
  await rebuildDigest();
}

async function readPart(source: Source): Promise<DigestPart[]> {
  try {
    const list = JSON.parse((await getSetting(partKey(source))) ?? '[]');
    return Array.isArray(list) ? list.filter((p) => p && Number.isFinite(p.at) && typeof p.title === 'string' && typeof p.body === 'string') : [];
  } catch {
    return [];
  }
}

export async function rebuildDigest(): Promise<number> {
  const pending = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of pending) if (n.content.data?.tag === TAG) await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined);
  const s = await digestSettings();
  if (!s.on) return 0;
  const plan = planDigest([...(await readPart('episodes')), ...(await readPart('memories'))], s.hour, Date.now());
  for (const [i, n] of plan.entries()) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${TAG}-${i}`,
      content: { title: n.title, body: n.body, data: { tag: TAG } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.at) },
    }).catch((e) => console.log(`[DIGEST] could not schedule: ${String(e)}`));
  }
  console.log(`[DIGEST] ${plan.length} daily notes scheduled`);
  return plan.length;
}
