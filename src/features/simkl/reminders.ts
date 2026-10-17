/**
 * Which local notifications to schedule (pure, tested in Node): new episodes
 * of shows and anime you follow, and release days of movies on your Plan to
 * Watch list, from Simkl's calendar files. iOS keeps at most 64 pending
 * notifications per app, so only the next ones are planned.
 */

import type { CatalogTitle, SimklItem, SimklType } from './logic';

export type ReminderSettings = {
  enabled: boolean;
  /** Minutes after the air time (0 = when it airs). */
  delayMinutes: number;
  types: Record<SimklType, boolean>;
};

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  delayMinutes: 0,
  types: { show: true, anime: true, movie: true },
};

export const DELAYS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'When it airs' },
  { minutes: 60, label: '1 hour later' },
  { minutes: 180, label: '3 hours later' },
  { minutes: 720, label: 'Next morning-ish (12 h)' },
];

export function parseReminderSettings(raw: string | null): ReminderSettings {
  if (!raw) return DEFAULT_REMINDERS;
  try {
    const v = JSON.parse(raw);
    return {
      enabled: v?.enabled === true,
      delayMinutes: DELAYS.some((d) => d.minutes === v?.delayMinutes) ? v.delayMinutes : 0,
      types: {
        show: v?.types?.show !== false,
        anime: v?.types?.anime !== false,
        movie: v?.types?.movie !== false,
      },
    };
  } catch {
    return DEFAULT_REMINDERS;
  }
}

export type PlannedReminder = { key: string; at: number; title: string; body: string; simklId: number; type: SimklType };

/** Keep well under iOS's 64. */
export const MAX_REMINDERS = 50;
const HORIZON_MS = 21 * 86_400_000;

/**
 * Episodes: only titles you are Watching, On Hold or Plan to Watch.
 * Movies: only Plan to Watch. Soonest first, within three weeks.
 */
export function planReminders(
  calendar: CatalogTitle[],
  items: SimklItem[],
  settings: ReminderSettings,
  now: number
): PlannedReminder[] {
  if (!settings.enabled) return [];
  const byId = new Map(items.map((i) => [i.simklId, i]));
  const out: PlannedReminder[] = [];
  const seen = new Set<string>();
  for (const row of calendar) {
    const item = byId.get(row.simklId);
    if (!item || !settings.types[item.type]) continue;
    const follows = item.type === 'movie' ? item.status === 'plantowatch' : item.status === 'watching' || item.status === 'hold' || item.status === 'plantowatch';
    if (!follows || !row.date) continue;
    const at = Date.parse(row.date) + settings.delayMinutes * 60_000;
    if (!Number.isFinite(at) || at <= now + 60_000 || at > now + HORIZON_MS) continue;
    const key = `${row.simklId}:${row.episodeLabel ?? 'release'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      at,
      simklId: item.simklId,
      type: item.type,
      title: item.title,
      body:
        item.type === 'movie'
          ? 'Out today - it is on your Plan to Watch list.'
          : `${row.episodeLabel ?? 'A new episode'} is out${settings.delayMinutes ? '' : ' now'}.`,
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_REMINDERS);
}
