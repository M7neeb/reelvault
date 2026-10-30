/**
 * Smarter search: plain words in the search box that mean filters.
 * "beach 2024 8+ long portrait #holiday unwatched" finds videos named or noted
 * "beach", filmed in 2024, rated 8 or more, over 5 minutes, upright, with the
 * keyword holiday, never watched. ">60fps" / "60fps+" / "<30fps" / "60fps"
 * filter by frame rate, "h264" / "hevc" by codec. What is left over is searched as text.
 * Pure (no native modules), so it is tested in Node.
 */

import type { SmartRule } from './types';

export type SearchChip = { key: string; label: string };

export type ParsedSearch = {
  /** Words that are not filters: searched in names, titles, notes and keywords. */
  text: string;
  rule: SmartRule;
  watch?: 'watched' | 'unwatched';
  /** What was understood, in order, for the chips under the box. */
  chips: SearchChip[];
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = 86_400_000;

const monthIndex = (w: string) => {
  const i = MONTHS.indexOf(w);
  return i >= 0 ? i : MONTH_SHORT.indexOf(w.slice(0, 3)) >= 0 && MONTHS[MONTH_SHORT.indexOf(w.slice(0, 3))].startsWith(w) ? MONTH_SHORT.indexOf(w.slice(0, 3)) : -1;
};
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "2m", "90s", "1h", "1.5m", "5min" → seconds, or null. */
function seconds(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(s|sec|secs|m|min|mins|h|hr|hrs)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2].startsWith('h') ? n * 3600 : m[2].startsWith('m') ? n * 60 : n);
}

/** "500mb", "1gb", "1.5gb" → MB, or null. */
function megabytes(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(mb|gb)$/.exec(s);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === 'gb' ? 1024 : 1));
}

const fmtSec = (s: number) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : s >= 60 ? `${+(s / 60).toFixed(1)} min` : `${s} s`);
const fmtMb = (mb: number) => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

/**
 * `tags` are the library's keyword names: a word that is a keyword counts as
 * one (so "beach" finds the keyword, not only file names) unless it is
 * written in quotes. `now` sets "today", "this week" and so on.
 */
export function parseSearch(query: string, tags: string[], now: number): ParsedSearch {
  const rule: SmartRule = {};
  const chips: SearchChip[] = [];
  const rest: string[] = [];
  let watch: ParsedSearch['watch'];
  const tagByLower = new Map(tags.map((t) => [t.toLowerCase(), t]));
  const addTag = (t: string) => {
    rule.tags = [...new Set([...(rule.tags ?? []), t])];
    chips.push({ key: `tag:${t}`, label: `#${t}` });
  };
  const setDates = (from: number, to: number, label: string) => {
    rule.dateFrom = from;
    rule.dateTo = to;
    chips.push({ key: 'date', label });
  };

  // Quoted phrases stay text, as they are.
  const tokens: { w: string; quoted: boolean }[] = [];
  for (const m of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    if (m[1] !== undefined) {
      if (m[1].trim()) tokens.push({ w: m[1].trim(), quoted: true });
    } else tokens.push({ w: m[2], quoted: false });
  }

  for (let i = 0; i < tokens.length; i++) {
    const { w: raw, quoted } = tokens[i];
    if (quoted) {
      rest.push(raw);
      continue;
    }
    const w = raw.toLowerCase();
    const next = tokens[i + 1]?.quoted ? '' : (tokens[i + 1]?.w.toLowerCase() ?? '');
    const two = `${w} ${next}`;

    // Keywords: #tag, or a word that is one of your keywords.
    if (w.startsWith('#') && w.length > 1) {
      addTag(tagByLower.get(w.slice(1)) ?? raw.slice(1));
      continue;
    }

    // Two-word keywords ("new york") before single words.
    if (tagByLower.has(two) && next) {
      addTag(tagByLower.get(two)!);
      i++;
      continue;
    }

    // Ratings: 8+, ★8, 8★, *8, rated 8, unrated.
    let m = /^(?:★|\*)(\d{1,2})\+?$/.exec(w) ?? /^(\d{1,2})(?:★|\*|\+)$/.exec(w);
    if (!m && w === 'rated' && /^\d{1,2}\+?$/.test(next)) {
      m = /^(\d{1,2})/.exec(next);
      i++;
    }
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10) {
      rule.minRating = Number(m[1]);
      chips.push({ key: 'rating', label: `★ ${m[1]}+` });
      continue;
    }
    if (w === 'unrated') {
      rule.maxRating = 0;
      chips.push({ key: 'rating', label: 'Not rated' });
      continue;
    }

    // Dates: 2024, 2022-2024, june 2024, today, yesterday, this/last week|month|year.
    m = /^((?:19|20)\d{2})(?:-((?:19|20)\d{2}))?$/.exec(w);
    if (m) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      setDates(new Date(Math.min(a, b), 0, 1).getTime(), new Date(Math.max(a, b) + 1, 0, 1).getTime() - 1, a === b ? String(a) : `${Math.min(a, b)}–${Math.max(a, b)}`);
      continue;
    }
    const mi = w.length >= 3 ? monthIndex(w) : -1;
    if (mi >= 0 && /^(19|20)\d{2}$/.test(next)) {
      const y = Number(next);
      setDates(new Date(y, mi, 1).getTime(), new Date(y, mi + 1, 1).getTime() - 1, `${MONTHS[mi][0].toUpperCase()}${MONTHS[mi].slice(1)} ${y}`);
      i++;
      continue;
    }
    if (w === 'today' || w === 'yesterday') {
      const start = sod(now) - (w === 'yesterday' ? DAY : 0);
      setDates(start, sod(start + DAY * 1.5) - 1, w === 'today' ? 'Today' : 'Yesterday');
      continue;
    }
    if ((w === 'this' || w === 'last') && ['week', 'month', 'year'].includes(next)) {
      const d = new Date(now);
      let from: number;
      let to: number;
      if (next === 'week') {
        const monday = sod(now) - ((d.getDay() + 6) % 7) * DAY;
        from = w === 'this' ? monday : sod(monday - 6.5 * DAY);
        to = w === 'this' ? now : monday - 1;
      } else if (next === 'month') {
        from = new Date(d.getFullYear(), d.getMonth() - (w === 'last' ? 1 : 0), 1).getTime();
        to = w === 'this' ? now : new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1;
      } else {
        from = new Date(d.getFullYear() - (w === 'last' ? 1 : 0), 0, 1).getTime();
        to = w === 'this' ? now : new Date(d.getFullYear(), 0, 1).getTime() - 1;
      }
      setDates(from, to, `${w === 'this' ? 'This' : 'Last'} ${next}`);
      i++;
      continue;
    }

    // Frame rate: >60fps, 60fps+, >=60fps, <30fps, 60fps, "60 fps", high fps (= 50 or more).
    m = /^(>=?|<=?)?(\d{1,3}(?:\.\d+)?)(fps|p)?(\+)?$/.exec(w);
    const fpsWord = m && (m[3] === 'fps' || (!m[3] && next === 'fps'));
    if (m && fpsWord && m[3] !== 'p') {
      const n = Number(m[2]);
      if (!m[3]) i++;
      if (m[1]?.startsWith('>') || m[4]) {
        rule.minFps = n;
        chips.push({ key: 'fps', label: `${n}+ fps` });
      } else if (m[1]?.startsWith('<')) {
        rule.maxFps = n;
        chips.push({ key: 'fps', label: `Up to ${n} fps` });
      } else {
        rule.minFps = n;
        rule.maxFps = n;
        chips.push({ key: 'fps', label: `${n} fps` });
      }
      continue;
    }
    if (w === 'high' && next === 'fps') {
      rule.minFps = 50;
      chips.push({ key: 'fps', label: '50+ fps' });
      i++;
      continue;
    }
    const codec = ({ h264: 'H.264', 'h.264': 'H.264', avc: 'H.264', x264: 'H.264', hevc: 'HEVC', h265: 'HEVC', 'h.265': 'HEVC', x265: 'HEVC', av1: 'AV1', vp9: 'VP9', prores: 'ProRes' } as Record<string, string>)[w];
    if (codec) {
      rule.codec = codec;
      chips.push({ key: 'codec', label: codec });
      continue;
    }

    // Length: >2m, <30s, 10m+, long, short.
    m = /^([<>])(.+)$/.exec(w) ?? /^(.+?)(\+)$/.exec(w);
    if (m) {
      const val = m[1] === '<' || m[1] === '>' ? m[2] : m[1];
      const more = m[1] === '>' || m[2] === '+';
      const sec = seconds(val);
      const mb = megabytes(val);
      if (sec !== null) {
        if (more) rule.minDurationSec = sec;
        else rule.maxDurationSec = sec;
        chips.push({ key: more ? 'minDur' : 'maxDur', label: `${more ? 'Over' : 'Under'} ${fmtSec(sec)}` });
        continue;
      }
      if (mb !== null) {
        if (more) rule.minSizeMb = mb;
        else rule.maxSizeMb = mb;
        chips.push({ key: more ? 'minSize' : 'maxSize', label: `${more ? 'Over' : 'Under'} ${fmtMb(mb)}` });
        continue;
      }
    }
    if (w === 'long' || w === 'short') {
      if (w === 'long') rule.minDurationSec = 300;
      else rule.maxDurationSec = 30;
      chips.push({ key: w === 'long' ? 'minDur' : 'maxDur', label: w === 'long' ? 'Over 5 min' : 'Under 30 s' });
      continue;
    }
    if (w === 'big' || w === 'large') {
      rule.minSizeMb = 500;
      chips.push({ key: 'minSize', label: 'Over 500 MB' });
      continue;
    }

    // Shape, file type, flags, places, keywords, watching.
    const shape = ({ portrait: 'portrait', vertical: 'portrait', upright: 'portrait', landscape: 'landscape', horizontal: 'landscape', wide: 'landscape', square: 'square' } as const)[w as 'portrait'];
    if (shape) {
      rule.orientation = shape;
      chips.push({ key: 'shape', label: shape === 'portrait' ? 'Upright' : shape === 'landscape' ? 'Wide' : 'Square' });
      continue;
    }
    if (['mov', 'mp4', 'm4v', 'mkv', 'avi', 'webm', '3gp'].includes(w.replace(/^\./, ''))) {
      rule.format = w.replace(/^\./, '').toUpperCase();
      chips.push({ key: 'format', label: rule.format });
      continue;
    }
    if (w === 'pick' || w === 'picks' || w === 'picked') {
      rule.flag = 'pick';
      chips.push({ key: 'flag', label: 'Picks' });
      continue;
    }
    if (w === 'reject' || w === 'rejects' || w === 'rejected') {
      rule.flag = 'reject';
      chips.push({ key: 'flag', label: 'Rejects' });
      continue;
    }
    if (w === 'untagged' || w === 'notags') {
      rule.untagged = true;
      chips.push({ key: 'untagged', label: 'No keywords' });
      continue;
    }
    if (w === 'located' || w === 'gps' || w === 'place') {
      rule.hasLocation = true;
      chips.push({ key: 'place', label: 'Has a place' });
      continue;
    }
    if (w === 'unwatched' || (w === 'never' && next === 'watched') || w === 'new') {
      watch = 'unwatched';
      chips.push({ key: 'watch', label: 'Never watched' });
      if (w === 'never') i++;
      continue;
    }
    if (w === 'watched') {
      watch = 'watched';
      chips.push({ key: 'watch', label: 'Watched' });
      continue;
    }
    if (tagByLower.has(w)) {
      addTag(tagByLower.get(w)!);
      continue;
    }
    rest.push(raw);
  }
  const text = rest.join(' ').trim();
  if (text) chips.unshift({ key: 'text', label: `“${text}”` });
  return { text, rule, watch, chips };
}

/** True when the query is more than plain text (so it filters, not only searches). */
export const isSmartSearch = (p: ParsedSearch) => p.chips.some((c) => c.key !== 'text');

/** Ideas shown under an empty search box. */
export const SEARCH_EXAMPLES = ['beach 2024', '8+ long', 'unwatched this year', 'portrait >1m', 'last month #family', 'big mov', '>60fps', 'h264 big'];
