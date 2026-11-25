/**
 * One notification a day: new episodes and On this day for each day, put
 * together in one note at the time you choose. Pure; digest.ts schedules it.
 */

export type DigestPart = { at: number; title: string; body: string; kind: 'episode' | 'memory' };
export type DigestSettings = { on: boolean; hour: number };
export type DigestNote = { at: number; title: string; body: string };

export const DIGEST_HOURS = [8, 12, 18, 21];
const DAYS_AHEAD = 14;
const MAX_BODY = 240;

export function parseDigest(json: string | null): DigestSettings {
  try {
    const r = json ? JSON.parse(json) : {};
    return { on: r?.on === true, hour: Number.isInteger(r?.hour) && r.hour >= 0 && r.hour <= 23 ? r.hour : 9 };
  } catch {
    return { on: false, hour: 9 };
  }
}

const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function titleFor(episodes: number, memories: number): string {
  const bits: string[] = [];
  if (episodes) bits.push(episodes === 1 ? '1 new episode' : `${episodes} new episodes`);
  if (memories) bits.push(memories === 1 ? 'a memory' : `${memories} memories`);
  return `Today: ${bits.join(' and ')}`;
}

export function planDigest(parts: DigestPart[], hour: number, now: number): DigestNote[] {
  const byDay = new Map<number, DigestPart[]>();
  for (const p of parts) {
    const day = dayStart(p.at);
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  const out: DigestNote[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const when = new Date(day);
    when.setHours(hour, 0, 0, 0);
    if (when.getTime() <= now) continue;
    if (out.length >= DAYS_AHEAD) break;
    const list = byDay.get(day)!.sort((a, b) => (a.kind === b.kind ? a.at - b.at : a.kind === 'episode' ? -1 : 1));
    const episodes = list.filter((p) => p.kind === 'episode').length;
    const memories = list.length - episodes;
    let body = '';
    let used = 0;
    for (const p of list) {
      const line = p.kind === 'episode' ? `${p.title} ${p.body}` : p.body;
      const next = body ? `${body} · ${line}` : line;
      if (next.length > MAX_BODY - 12) break;
      body = next;
      used++;
    }
    if (used < list.length) body += ` · ${list.length - used} more`;
    out.push({ at: when.getTime(), title: titleFor(episodes, memories), body });
  }
  return out;
}
