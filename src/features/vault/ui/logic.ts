/**
 * Pure vault rules. No runtime imports (types only), so the browser preview,
 * the native layer and the tests can all use the same code.
 */

import type {
  GroupBy,
  DateGroup,
  LayoutStyle,
  Orientation,
  SmartRule,
  ThemeMode,
  ThumbInfo,
  ThumbSize,
  UiFlag,
  UiMeta,
  UiStatus,
  VaultSort,
  ViewOptions,
} from './types';

/** Adds to a list in a map in place (copying the list each time gets slow with thousands of items). */
function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

const MB = 1024 * 1024;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ------------------------------------------------------------ smart filters */

type RuleTarget = {
  id?: string;
  importedAt?: number;
  filename: string;
  rating: number;
  tagNames: string[];
  status: UiStatus | null;
  title?: string | null;
  notes?: string | null;
  flag?: UiFlag;
  createdAt?: number;
  durationMs?: number | null;
  sizeBytes?: number;
  width?: number | null;
  height?: number | null;
  albumIds?: number[];
  meta?: UiMeta | null;
  inTray?: boolean;
};

export function orientationOf(width: number | null | undefined, height: number | null | undefined): Orientation | null {
  if (!width || !height) return null;
  const r = width / height;
  if (r > 1.05) return 'landscape';
  if (r < 0.95) return 'portrait';
  return 'square';
}

export function formatOf(filename: string): string | null {
  const i = filename.lastIndexOf('.');
  return i > 0 && i < filename.length - 1 ? filename.slice(i + 1).toUpperCase() : null;
}

/** A regular expression from user text, or null when it doesn't compile. */
function safeRegex(text: string): RegExp | null {
  try {
    return new RegExp(text, 'i');
  } catch {
    return null;
  }
}

const outside = (value: number | undefined, min?: number, max?: number) =>
  value === undefined ? min !== undefined || max !== undefined : (min !== undefined && value < min) || (max !== undefined && value > max);

/** True when the video meets every condition the rule sets. An empty rule matches all. */
/** How often and when each video was last played, for the watch rules of smart filters. */
export type WatchInfo = Map<string, { plays: number; lastAt: number }>;
let WATCH: WatchInfo = new Map();
/** The screen keeps this up to date as plays load, so every smart filter count can use it. */
export function setWatchInfo(info: WatchInfo): void {
  WATCH = info;
}
export function watchInfoOf(plays: { videoId: string; startedAt: number }[]): WatchInfo {
  const m: WatchInfo = new Map();
  for (const x of plays) {
    const cur = m.get(x.videoId);
    m.set(x.videoId, { plays: (cur?.plays ?? 0) + 1, lastAt: Math.max(cur?.lastAt ?? 0, x.startedAt) });
  }
  return m;
}

const DAY_MS = 86_400_000;

export function matchesRule(item: RuleTarget, rule: SmartRule, watch: WatchInfo = WATCH, now: number = Date.now()): boolean {
  if (rule.anyTags?.length && !rule.anyTags.some((t) => item.tagNames.includes(t))) return false;
  if (rule.watched || rule.minPlays || rule.notWatchedDays || rule.watchedWithinDays) {
    const w = item.id ? watch.get(item.id) : undefined;
    const plays = w?.plays ?? 0;
    if (rule.watched === 'never' && plays > 0) return false;
    if (rule.watched === 'watched' && plays === 0) return false;
    if (rule.minPlays && plays < rule.minPlays) return false;
    if (rule.notWatchedDays && w && w.lastAt > now - rule.notWatchedDays * DAY_MS) return false;
    if (rule.watchedWithinDays && (!w || w.lastAt < now - rule.watchedWithinDays * DAY_MS)) return false;
  }
  if (rule.addedWithinDays && (item.importedAt ?? 0) < now - rule.addedWithinDays * DAY_MS) return false;
  if (rule.filmedWithinDays && (item.createdAt ?? 0) < now - rule.filmedWithinDays * DAY_MS) return false;
  const text = rule.text?.trim();
  if (text) {
    const haystack = [item.filename, item.title ?? '', item.notes ?? ''];
    if (rule.regex) {
      const re = safeRegex(text);
      if (!re || !haystack.some((h) => re.test(h))) return false;
    } else {
      const needle = text.toLowerCase();
      if (!haystack.some((h) => h.toLowerCase().includes(needle))) return false;
    }
  }
  if (rule.minRating && item.rating < rule.minRating) return false;
  if (rule.maxRating !== undefined && item.rating > rule.maxRating) return false;
  if (rule.tags?.length && !rule.tags.every((t) => item.tagNames.includes(t))) return false;
  if (rule.status && item.status !== rule.status) return false;
  if (rule.untagged && item.tagNames.length > 0) return false;
  if (rule.flag) {
    const want = rule.flag === 'pick' ? 1 : rule.flag === 'reject' ? -1 : 0;
    if ((item.flag ?? 0) !== want) return false;
  }
  if (rule.dateFrom !== undefined || rule.dateTo !== undefined) {
    if (outside(item.createdAt, rule.dateFrom, rule.dateTo)) return false;
  }
  if (rule.minDurationSec !== undefined || rule.maxDurationSec !== undefined) {
    const sec = item.durationMs ? item.durationMs / 1000 : undefined;
    if (outside(sec, rule.minDurationSec, rule.maxDurationSec)) return false;
  }
  if (rule.minSizeMb !== undefined || rule.maxSizeMb !== undefined) {
    const mb = item.sizeBytes !== undefined ? item.sizeBytes / MB : undefined;
    if (outside(mb, rule.minSizeMb, rule.maxSizeMb)) return false;
  }
  if (rule.minFps !== undefined || rule.maxFps !== undefined) {
    // Cameras write 59.94 or 29.97 for "60" and "30": half a frame either way still counts.
    const fps = item.meta?.fps;
    if (!fps) return false;
    if (rule.minFps !== undefined && fps < rule.minFps - 0.5) return false;
    if (rule.maxFps !== undefined && fps > rule.maxFps + 0.5) return false;
  }
  if (rule.codec && (item.meta?.codec ?? '').toUpperCase() !== rule.codec.toUpperCase()) return false;
  if (rule.orientation && orientationOf(item.width, item.height) !== rule.orientation) return false;
  if (rule.format && formatOf(item.filename) !== rule.format.toUpperCase()) return false;
  if ((rule.minKeywords !== undefined || rule.maxKeywords !== undefined) && outside(item.tagNames.length, rule.minKeywords, rule.maxKeywords)) {
    return false;
  }
  if (rule.minAlbums !== undefined || rule.maxAlbums !== undefined) {
    if (outside(item.albumIds?.length ?? 0, rule.minAlbums, rule.maxAlbums)) return false;
  }
  if (rule.hasLocation !== undefined && !!item.meta?.location !== rule.hasLocation) return false;
  if (rule.inTray && !item.inTray) return false;
  return true;
}

const STATUS_WORDS: Record<UiStatus, string> = {
  plantowatch: 'to watch',
  watching: 'watching',
  completed: 'watched',
  hold: 'on hold',
  dropped: 'dropped',
};

const shortDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
};

const range = (min: number | undefined, max: number | undefined, unit: string) =>
  min !== undefined && max !== undefined
    ? `${min}–${max} ${unit}`
    : min !== undefined
      ? `${min}+ ${unit}`
      : `up to ${max} ${unit}`;

/** `rated 8+ · #travel · watched` - the line under a smart filter's name. */
export function describeRule(rule: SmartRule): string {
  const parts: string[] = [];
  if (rule.minRating && rule.maxRating !== undefined) parts.push(`rated ${rule.minRating}–${rule.maxRating}`);
  else if (rule.minRating) parts.push(`rated ${rule.minRating}+`);
  else if (rule.maxRating !== undefined) parts.push(`rated ${rule.maxRating} or less`);
  if (rule.flag) parts.push(rule.flag === 'pick' ? 'picks' : rule.flag === 'reject' ? 'rejects' : 'no flag');
  for (const t of rule.tags ?? []) parts.push(`#${t}`);
  if (rule.untagged) parts.push('no keywords');
  if (rule.status) parts.push(STATUS_WORDS[rule.status]);
  if (rule.dateFrom !== undefined && rule.dateTo !== undefined) parts.push(`${shortDate(rule.dateFrom)} – ${shortDate(rule.dateTo)}`);
  else if (rule.dateFrom !== undefined) parts.push(`since ${shortDate(rule.dateFrom)}`);
  else if (rule.dateTo !== undefined) parts.push(`until ${shortDate(rule.dateTo)}`);
  if (rule.minDurationSec !== undefined || rule.maxDurationSec !== undefined) parts.push(range(rule.minDurationSec, rule.maxDurationSec, 's'));
  if (rule.minSizeMb !== undefined || rule.maxSizeMb !== undefined) parts.push(range(rule.minSizeMb, rule.maxSizeMb, 'MB'));
  if (rule.minFps !== undefined || rule.maxFps !== undefined) parts.push(range(rule.minFps, rule.maxFps, 'fps'));
  if (rule.codec) parts.push(rule.codec);
  if (rule.orientation) parts.push(rule.orientation);
  if (rule.format) parts.push(rule.format.toUpperCase());
  if (rule.minKeywords !== undefined || rule.maxKeywords !== undefined) parts.push(range(rule.minKeywords, rule.maxKeywords, 'keywords'));
  if (rule.minAlbums !== undefined || rule.maxAlbums !== undefined) parts.push(range(rule.minAlbums, rule.maxAlbums, 'albums'));
  if (rule.hasLocation !== undefined) parts.push(rule.hasLocation ? 'with location' : 'no location');
  if (rule.inTray) parts.push('in tray');
  if (rule.anyTags?.length) parts.push(rule.anyTags.map((t) => `#${t}`).join(' or '));
  if (rule.watched) parts.push(rule.watched === 'never' ? 'never watched' : 'watched');
  if (rule.minPlays) parts.push(`played ${rule.minPlays}+ times`);
  if (rule.notWatchedDays) parts.push(`not watched in ${rule.notWatchedDays} days`);
  if (rule.watchedWithinDays) parts.push(`watched in the last ${rule.watchedWithinDays} days`);
  if (rule.addedWithinDays) parts.push(`added in the last ${rule.addedWithinDays} days`);
  if (rule.filmedWithinDays) parts.push(`filmed in the last ${rule.filmedWithinDays} days`);
  if (rule.text?.trim()) parts.push(rule.regex ? `/${rule.text.trim()}/` : `"${rule.text.trim()}"`);
  return parts.length ? parts.join(' · ') : 'everything';
}

/** A rule read back from the database. Anything unexpected is dropped, never fatal. */
export function parseRule(json: string): SmartRule {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const rule: SmartRule = {};
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

  if (typeof r.text === 'string' && r.text.trim()) rule.text = r.text;
  if (r.regex === true) rule.regex = true;
  const minRating = num(r.minRating, 1, 10);
  if (minRating !== undefined) rule.minRating = Math.round(minRating);
  const maxRating = num(r.maxRating, 0, 10);
  if (maxRating !== undefined) rule.maxRating = Math.round(maxRating);
  if (Array.isArray(r.tags)) {
    const tags = r.tags.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (tags.length) rule.tags = tags;
  }
  if (typeof r.status === 'string' && r.status in STATUS_WORDS) rule.status = r.status as UiStatus;
  if (r.untagged === true) rule.untagged = true;
  if (r.flag === 'pick' || r.flag === 'reject' || r.flag === 'none') rule.flag = r.flag;
  for (const key of ['dateFrom', 'dateTo'] as const) {
    const v = num(r[key], 0, 8.64e15);
    if (v !== undefined) rule[key] = v;
  }
  for (const key of ['minDurationSec', 'maxDurationSec', 'minSizeMb', 'maxSizeMb'] as const) {
    const v = num(r[key], 0, 1e9);
    if (v !== undefined) rule[key] = v;
  }
  for (const key of ['minFps', 'maxFps'] as const) {
    const v = num(r[key], 0, 10_000);
    if (v !== undefined) rule[key] = v;
  }
  if (typeof r.codec === 'string' && /^[a-z0-9. -]{1,16}$/i.test(r.codec)) rule.codec = r.codec;
  for (const key of ['minKeywords', 'maxKeywords', 'minAlbums', 'maxAlbums'] as const) {
    const v = num(r[key], 0, 1e6);
    if (v !== undefined) rule[key] = Math.round(v);
  }
  if (r.orientation === 'landscape' || r.orientation === 'portrait' || r.orientation === 'square') {
    rule.orientation = r.orientation;
  }
  if (typeof r.format === 'string' && /^[a-z0-9]{1,8}$/i.test(r.format)) rule.format = r.format.toUpperCase();
  if (typeof r.hasLocation === 'boolean') rule.hasLocation = r.hasLocation;
  if (r.inTray === true) rule.inTray = true;
  if (Array.isArray(r.anyTags)) {
    const tags = r.anyTags.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (tags.length) rule.anyTags = tags;
  }
  if (r.watched === 'never' || r.watched === 'watched') rule.watched = r.watched;
  for (const key of ['minPlays', 'notWatchedDays', 'watchedWithinDays', 'addedWithinDays', 'filmedWithinDays'] as const) {
    const v = num(r[key], 1, 100_000);
    if (v !== undefined) rule[key] = Math.round(v);
  }
  return rule;
}

/** True when the rule sets anything at all. */
export const ruleIsEmpty = (rule: SmartRule): boolean => describeRule(rule) === 'everything';

/* ------------------------------------------------------------- view options */

const SORT_KEYS: VaultSort[] = ['recent', 'oldest', 'rating', 'name', 'size', 'duration', 'mostWatched', 'leastWatched', 'lastWatched'];
const LAYOUT_KEYS: LayoutStyle[] = ['grid', 'natural', 'waterfall', 'mosaic'];
const SIZE_KEYS: ThumbSize[] = ['small', 'medium', 'large', 'xlarge', 'fit'];
const INFO_KEYS: ThumbInfo[] = [
  'duration',
  'size',
  'date',
  'time',
  'dimensions',
  'format',
  'filename',
  'keywords',
  'albums',
  'device',
];
const GROUP_KEYS: GroupBy[] = ['none', 'day', 'week', 'month', 'year', 'rating', 'keyword', 'series', 'length'];
const THEME_KEYS: ThemeMode[] = ['system', 'light', 'dark'];

/** The thumbnail sizes the first version saved as a column count. */
const LEGACY_COLUMNS: Record<number, ThumbSize> = { 3: 'large', 4: 'medium', 5: 'small' };

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Saved view options, with anything missing or invalid replaced by the default.
 * Also reads older formats (`columns`, `showDuration`, a single `info`), so
 * nobody loses their settings after an update.
 */
export function parseViewOptions(json: string | null, defaults: ViewOptions): ViewOptions {
  if (!json) return defaults;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return defaults;
  }
  if (!raw || typeof raw !== 'object') return defaults;
  const r = raw as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

  const legacySize = typeof r.columns === 'number' ? LEGACY_COLUMNS[r.columns] : undefined;

  let infos: ThumbInfo[];
  if (Array.isArray(r.infos)) {
    infos = INFO_KEYS.filter((k) => (r.infos as unknown[]).includes(k));
  } else if (typeof r.info === 'string') {
    infos = r.info === 'none' ? [] : INFO_KEYS.includes(r.info as ThumbInfo) ? [r.info as ThumbInfo] : defaults.infos;
  } else if (r.showDuration === false) {
    infos = [];
  } else {
    infos = defaults.infos;
  }

  return {
    layout: oneOf(r.layout, LAYOUT_KEYS, defaults.layout),
    look: oneOf(r.look, ['standard', 'simple', 'detailed', 'compact', 'desktop'] as const, defaults.look),
    accent: typeof r.accent === 'string' && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : defaults.accent,
    size: oneOf(r.size, SIZE_KEYS, legacySize ?? defaults.size),
    sort: oneOf(r.sort, SORT_KEYS, defaults.sort),
    groupBy: oneOf(r.groupBy, GROUP_KEYS, defaults.groupBy),
    infos,
    showRating: bool(r.showRating, defaults.showRating),
    showKeywords: bool(r.showKeywords, defaults.showKeywords),
    theme: oneOf(r.theme, THEME_KEYS, defaults.theme),
    colors: oneOf(r.colors, ['standard', 'midnight', 'graphite', 'forest', 'rose', 'ember', 'video'] as const, defaults.colors),
    videoColor: typeof r.videoColor === 'string' && /^#[0-9a-f]{6}$/i.test(r.videoColor) ? r.videoColor : defaults.videoColor,
    videoColorFrom: typeof r.videoColorFrom === 'string' ? r.videoColorFrom : defaults.videoColorFrom,
    font: oneOf(r.font, ['system', 'avenir', 'futura', 'georgia', 'menlo'] as const, defaults.font),
    glass: oneOf(r.glass, ['regular', 'clear', 'solid'] as const, defaults.glass),
    corners: oneOf(r.corners, ['standard', 'round', 'square'] as const, defaults.corners),
    outlined: bool(r.outlined, defaults.outlined),
    rotate: bool(r.rotate, defaults.rotate),
  };
}

/**
 * Which colour set to use. "System" follows the phone; when the phone does not
 * say (web, older devices) the app keeps its original dark look.
 */
export function resolveScheme(mode: ThemeMode, system: string | null | undefined): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'light' ? 'light' : 'dark';
}

/* ---------------------------------------------------------- recently deleted */

const DAY = 24 * 60 * 60 * 1000;

/** How long a deleted video waits in Recently Deleted before it is removed for good. */
export const RECENTLY_DELETED_DAYS = 30;

/** Anything deleted before this moment is due to be removed for good. */
export function purgeCutoff(now: number, days = RECENTLY_DELETED_DAYS): number {
  return now - days * DAY;
}

/** Whole days left before a deleted video is removed. Never below 0. */
export function daysLeft(deletedAt: number, now: number, days = RECENTLY_DELETED_DAYS): number {
  const left = deletedAt + days * DAY - now;
  return Math.max(0, Math.ceil(left / DAY));
}

/* ------------------------------------------------------ duplicates & similar */

/**
 * Groups of ids that share a content key (two or more per group), oldest import
 * first inside each group so the original is listed before its copies. Groups
 * keep the order in which their first member appears in `items`.
 */
export function groupDuplicates<
  T extends { id: string; contentKey: string | null; importedAt: number },
>(items: T[]): string[][] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    if (!item.contentKey) continue;
    const list = byKey.get(item.contentKey);
    if (list) list.push(item);
    else byKey.set(item.contentKey, [item]);
  }
  const groups: string[][] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    groups.push([...list].sort((a, b) => a.importedAt - b.importedAt).map((i) => i.id));
  }
  return groups;
}

/** Ids of every copy except the oldest in each group - what "keep originals" removes. */
export function extraCopies(groups: string[][]): string[] {
  return groups.flatMap((g) => g.slice(1));
}

type SimilarTarget = {
  id: string;
  contentKey: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  importedAt: number;
  /** When filmed: two files filmed in the same second are the same moment. */
  createdAt?: number;
};

/**
 * HashPhotos' "Find Similar": videos that are probably the same clip in a
 * different file - re-saved, re-encoded or trimmed by a frame or two. Same
 * shape (or rotated), length within 1.5 s, and NOT byte-identical (those are
 * in Duplicates). Oldest import first in each group.
 */
export function groupSimilar<T extends SimilarTarget>(items: T[]): string[][] {
  const candidates = items
    .filter((v) => v.durationMs && v.width && v.height)
    .sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0));
  const seen = new Set<string>();
  const groups: string[][] = [];
  const sameShape = (a: T, b: T) => {
    const ra = (a.width ?? 1) / (a.height ?? 1);
    const rb = (b.width ?? 1) / (b.height ?? 1);
    return Math.abs(ra - rb) < 0.03 || Math.abs(ra - 1 / rb) < 0.03;
  };
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (seen.has(a.id)) continue;
    const group = [a];
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if ((b.durationMs ?? 0) - (a.durationMs ?? 0) > 1500) break;
      if (seen.has(b.id) || !sameShape(a, b)) continue;
      if (a.contentKey && a.contentKey === b.contentKey) continue;
      group.push(b);
    }
    if (group.length > 1) {
      for (const g of group) seen.add(g.id);
      groups.push(group.sort((x, y) => x.importedAt - y.importedAt).map((g) => g.id));
    }
  }
  // Also: filmed in the same second (a trimmed or shrunk copy keeps the filming date), any length.
  const byMoment = new Map<number, T[]>();
  for (const v of items) {
    // Skip videos whose date is only the import time (no filming date in the file).
    if (seen.has(v.id) || !v.createdAt || v.createdAt <= 0 || Math.abs(v.createdAt - v.importedAt) < 60_000) continue;
    const k = Math.round(v.createdAt / 1000);
    pushTo(byMoment, k, v);
  }
  for (const list of byMoment.values()) {
    const distinct = list.filter((v, i) => !v.contentKey || list.findIndex((x) => x.contentKey === v.contentKey) === i);
    if (distinct.length < 2) continue;
    for (const g of distinct) seen.add(g.id);
    groups.push(distinct.sort((x, y) => x.importedAt - y.importedAt).map((g) => g.id));
  }
  return groups;
}

/* ------------------------------------------------------------------- places */

/** Distance between two GPS points, in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** HashPhotos' "Shows Photos Nearby": other videos filmed within `km` of this one, closest first. */
export function nearby<T extends { id: string; meta: UiMeta | null }>(items: T[], target: T, km = 1): T[] {
  const here = target.meta?.location;
  if (!here) return [];
  return items
    .filter((v) => v.id !== target.id && v.meta?.location)
    .map((v) => ({ v, d: distanceKm(here, v.meta!.location!) }))
    .filter((x) => x.d <= km)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.v);
}

/** `52.5200° N, 13.4050° E` */
export function fmtLocation(loc: { lat: number; lon: number }): string {
  const lat = `${Math.abs(loc.lat).toFixed(4)}° ${loc.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(loc.lon).toFixed(4)}° ${loc.lon >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

/* -------------------------------------------------------- dates & grouping */

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10-13` in local time. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `2026-10` */
export const monthKey = (ms: number): string => dayKey(ms).slice(0, 7);

export function periodKey(ms: number, by: DateGroup): string {
  if (by === 'week') {
    const d = new Date(ms);
    return `w${dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime())}`;
  }
  const day = dayKey(ms);
  return by === 'day' ? day : by === 'month' ? day.slice(0, 7) : day.slice(0, 4);
}

/** `Mon, 13 Oct 2026` / `Week of 12 Oct 2026` / `October 2026` / `2026` */
export function periodTitle(key: string, by: DateGroup): string {
  const week = key.startsWith('w');
  const [y, m, d] = (week ? key.slice(1) : key).split('-').map(Number);
  if (by === 'year') return String(y);
  if (by === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (week) return `Week of ${d} ${MONTHS_SHORT[m - 1]} ${y}`;
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

const LENGTHS: { key: string; title: string; max: number }[] = [
  { key: 'l1', title: 'Under a minute', max: 60_000 },
  { key: 'l2', title: '1 to 5 minutes', max: 5 * 60_000 },
  { key: 'l3', title: '5 to 20 minutes', max: 20 * 60_000 },
  { key: 'l4', title: '20 minutes or longer', max: Infinity },
];

type GroupTarget = { id?: string; createdAt: number; rating?: number; tagNames?: string[]; durationMs?: number | null };

/** Which section a video falls into for the groupings that are not by date. */
function otherKey(item: GroupTarget, by: 'rating' | 'keyword' | 'series' | 'length', seriesOf?: Map<string, string>): { key: string; title: string; order: number } {
  if (by === 'rating') {
    const r = Math.round(item.rating ?? 0);
    return r > 0 ? { key: `r${r}`, title: `★ ${r}`, order: 10 - r } : { key: 'r0', title: 'Not rated', order: 99 };
  }
  if (by === 'keyword') {
    const first = [...(item.tagNames ?? [])].sort((a, b) => a.localeCompare(b))[0];
    return first ? { key: `k${first}`, title: `#${first}`, order: 0 } : { key: 'k', title: 'No keyword', order: 1 };
  }
  if (by === 'series') {
    const name = item.id ? seriesOf?.get(item.id) : undefined;
    return name ? { key: `s${name}`, title: name, order: 0 } : { key: 's', title: 'Not in a series', order: 1 };
  }
  if (!item.durationMs) return { key: 'l0', title: 'Length unknown', order: 9 };
  const i = LENGTHS.findIndex((l) => (item.durationMs as number) < l.max);
  return { key: LENGTHS[i].key, title: LENGTHS[i].title, order: i };
}

export type Section<T> = { key: string; title: string; items: T[] };

/**
 * HashPhotos' Grouping: the items cut into periods by filming date, in the
 * order the periods first appear (so the current sort decides the order).
 * With 'none' there is one untitled section.
 */
export function groupItems<T extends GroupTarget>(items: T[], by: GroupBy, seriesOf?: Map<string, string>): Section<T>[] {
  if (by === 'none') return items.length ? [{ key: 'all', title: '', items }] : [];
  if (by === 'rating' || by === 'keyword' || by === 'series' || by === 'length') {
    const index = new Map<string, Section<T> & { order: number }>();
    for (const item of items) {
      const k = otherKey(item, by, seriesOf);
      let s = index.get(k.key);
      if (!s) {
        s = { key: k.key, title: k.title, items: [], order: k.order };
        index.set(k.key, s);
      }
      s.items.push(item);
    }
    // Rating and length in their own order; keywords and series biggest first, the leftovers last.
    return [...index.values()]
      .sort((a, b) => a.order - b.order || (by === 'keyword' || by === 'series' ? b.items.length - a.items.length || a.title.localeCompare(b.title) : 0))
      .map(({ order: _o, ...s }) => s);
  }
  const sections: Section<T>[] = [];
  const index = new Map<string, Section<T>>();
  for (const item of items) {
    const key = periodKey(item.createdAt, by);
    let s = index.get(key);
    if (!s) {
      s = { key, title: periodTitle(key, by), items: [] };
      index.set(key, s);
      sections.push(s);
    }
    s.items.push(item);
  }
  return sections;
}

/** Video count per day (`dayKey`), for the calendar. */
export function countByDay<T extends { createdAt: number }>(items: T[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of items) {
    const k = dayKey(v.createdAt);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** The weeks of a month for a calendar grid: 6 rows x 7 days (Monday first), null = outside the month. */
export function monthGrid(year: number, month0: number): (number | null)[][] {
  const first = new Date(year, month0, 1);
  const daysIn = new Date(year, month0 + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const monthName = (month0: number): string => MONTHS[month0];

/* ---------------------------------------------------------- library overview */

type OverviewTarget = {
  sizeBytes: number;
  originalSizeBytes?: number | null;
  durationMs: number | null;
  rating: number;
  tagNames: string[];
  filename: string;
  width: number | null;
  height: number | null;
  createdAt: number;
  flag?: UiFlag;
  albumIds?: number[];
  meta?: UiMeta | null;
};

export type Overview = {
  count: number;
  totalBytes: number;
  /** Space freed by Make Smaller, and how many videos it shrank. */
  savedBytes: number;
  madeSmaller: number;
  totalMs: number;
  rated: number;
  averageRating: number | null;
  withKeywords: number;
  inAlbums: number;
  picks: number;
  rejects: number;
  withLocation: number;
  byFormat: { label: string; count: number }[];
  byOrientation: { label: string; count: number }[];
  byYear: { label: string; count: number }[];
  byDevice: { label: string; count: number }[];
};

function tally(values: string[]): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** HashPhotos' "Library Overview": the numbers behind the library. */
export function libraryOverview<T extends OverviewTarget>(items: T[]): Overview {
  const rated = items.filter((v) => v.rating > 0);
  return {
    count: items.length,
    totalBytes: items.reduce((s, v) => s + v.sizeBytes, 0),
    savedBytes: items.reduce((s, v) => s + (v.originalSizeBytes ? Math.max(0, v.originalSizeBytes - v.sizeBytes) : 0), 0),
    madeSmaller: items.filter((v) => v.originalSizeBytes).length,
    totalMs: items.reduce((s, v) => s + (v.durationMs ?? 0), 0),
    rated: rated.length,
    averageRating: rated.length ? Math.round((rated.reduce((s, v) => s + v.rating, 0) / rated.length) * 10) / 10 : null,
    withKeywords: items.filter((v) => v.tagNames.length > 0).length,
    inAlbums: items.filter((v) => (v.albumIds?.length ?? 0) > 0).length,
    picks: items.filter((v) => v.flag === 1).length,
    rejects: items.filter((v) => v.flag === -1).length,
    withLocation: items.filter((v) => v.meta?.location).length,
    byFormat: tally(items.map((v) => formatOf(v.filename) ?? 'Unknown')),
    byOrientation: tally(items.map((v) => orientationOf(v.width, v.height) ?? 'unknown')),
    byYear: tally(items.map((v) => String(new Date(v.createdAt).getFullYear()))).sort((a, b) => b.label.localeCompare(a.label)),
    byDevice: tally(items.map((v) => v.meta?.model ?? v.meta?.make ?? 'Unknown')),
  };
}

/* ------------------------------------------------------------------ imports */

/**
 * Space that must stay free after an import, in GB. iOS gets unstable when a
 * phone is completely full.
 */
export const FREE_SPACE_RESERVE_GB = 0.5;

/**
 * The largest batch (GB) that is safe to pick right now.
 *
 * While a batch moves in, each video briefly exists twice: once in Files (exported
 * from HashPhotos) and once as the picker's temporary copy, which ReelVault then
 * moves (not copies) into its own storage. So the batch can use half of the space
 * above the reserve.
 */
export function safeBatchGb(freeGb: number): number {
  return Math.max(0, Math.floor(((freeGb - FREE_SPACE_RESERVE_GB) / 2) * 10) / 10);
}

/* ---------------------------------------------------------------------- map */

export type MapRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/** A map region that shows every point with a little margin (a city-sized view for one point). */
export function regionFor(points: { lat: number; lon: number }[]): MapRegion | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.min(170, Math.max(0.05, (maxLat - minLat) * 1.4)),
    longitudeDelta: Math.min(350, Math.max(0.05, (maxLon - minLon) * 1.4)),
  };
}

/* ------------------------------------------------------- the copy to keep */

type KeeperTarget = { id: string; width: number | null; height: number | null; rating: number; importedAt: number; durationMs: number | null; tagNames: string[] };

/**
 * Which video of a duplicate or look-alike group to keep: the sharpest
 * (most pixels), then the longest, the best rated, the most watched, the one
 * with the most keywords, the oldest import. Returns its id.
 */
export function pickKeeper<T extends KeeperTarget>(group: T[], plays: Map<string, number> = new Map()): string | null {
  if (!group.length) return null;
  const px = (v: T) => (v.width ?? 0) * (v.height ?? 0);
  return [...group].sort(
    (a, b) =>
      px(b) - px(a) ||
      (b.durationMs ?? 0) - (a.durationMs ?? 0) ||
      b.rating - a.rating ||
      (plays.get(b.id) ?? 0) - (plays.get(a.id) ?? 0) ||
      b.tagNames.length - a.tagNames.length ||
      a.importedAt - b.importedAt
  )[0].id;
}
