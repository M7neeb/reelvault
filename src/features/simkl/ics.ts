/**
 * Upcoming episodes and releases as a calendar file (.ics). Opening it on the
 * iPhone offers "Add All" to the Calendar app, so no calendar permission is
 * needed. Pure, so it is tested in Node.
 */

import type { CatalogTitle, SimklItem } from './logic';

export type CalendarEntry = {
  uid: string;
  title: string;
  /** ISO time it airs or releases. */
  start: string;
  minutes: number;
  description?: string;
  url?: string;
  /** Releases (movies) are all-day events. */
  allDay?: boolean;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Text values escape backslash, semicolon, comma and newlines (RFC 5545 §3.3.11). */
export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets are folded onto continuation lines starting with a space. */
export function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(' ' + line.slice(i, i + 74));
  return parts.join('\r\n');
}

export function buildIcs(entries: CalendarEntry[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ReelVault//Simkl calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:ReelVault'];
  for (const e of entries) {
    const start = new Date(e.start);
    if (Number.isNaN(start.getTime())) continue;
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@reelvault`, `DTSTAMP:${stamp(now)}`);
    if (e.allDay) {
      const next = new Date(start.getTime() + 86400000);
      lines.push(`DTSTART;VALUE=DATE:${day(start)}`, `DTEND;VALUE=DATE:${day(next)}`);
    } else {
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + Math.max(5, e.minutes) * 60000))}`);
    }
    lines.push(`SUMMARY:${icsText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}


/**
 * What goes in the file: the next two months of episodes for what you watch,
 * have on hold or plan to watch, and releases from your Plan to Watch movies.
 */
export function calendarEntries(rows: CatalogTitle[], items: SimklItem[], now: number, days = 60): CalendarEntry[] {
  const byId = new Map(items.map((i) => [i.simklId, i]));
  const seen = new Set<string>();
  const out: CalendarEntry[] = [];
  for (const r of rows) {
    const item = byId.get(r.simklId);
    if (!item || !r.date) continue;
    const follows = item.type === 'movie' ? item.status === 'plantowatch' : ['watching', 'hold', 'plantowatch'].includes(item.status);
    const at = Date.parse(r.date);
    if (!follows || !Number.isFinite(at) || at < now - 6 * 3600_000 || at > now + days * 86400_000) continue;
    const uid = `${r.simklId}-${(r.episodeLabel ?? 'release').replace(/\W/g, '')}`;
    if (seen.has(uid)) continue;
    seen.add(uid);
    out.push({
      uid,
      title: item.type === 'movie' ? `${item.title} (release)` : `${item.title} ${r.episodeLabel ?? ''}`.trim(),
      start: new Date(at).toISOString(),
      minutes: item.runtime ?? (item.type === 'anime' ? 24 : 45),
      allDay: item.type === 'movie',
      url: `https://simkl.com/${item.type === 'movie' ? 'movies' : item.type === 'anime' ? 'anime' : 'tv'}/${item.simklId}`,
    });
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
