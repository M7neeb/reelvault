/**
 * Pure vault rules. No runtime imports (types only), so the browser preview,
 * the native layer and the tests can all use the same code.
 */

import type {
  LayoutStyle,
  SmartRule,
  ThemeMode,
  ThumbInfo,
  ThumbSize,
  UiStatus,
  VaultSort,
  ViewOptions,
} from './types';

/* ------------------------------------------------------------ smart filters */

type RuleTarget = { filename: string; rating: number; tagNames: string[]; status: UiStatus | null };

/** True when the video meets every condition the rule sets. An empty rule matches all. */
export function matchesRule(item: RuleTarget, rule: SmartRule): boolean {
  const text = rule.text?.trim().toLowerCase();
  if (text && !item.filename.toLowerCase().includes(text)) return false;
  if (rule.minRating && item.rating < rule.minRating) return false;
  if (rule.tags?.length && !rule.tags.every((t) => item.tagNames.includes(t))) return false;
  if (rule.status && item.status !== rule.status) return false;
  if (rule.untagged && item.tagNames.length > 0) return false;
  return true;
}

const STATUS_WORDS: Record<UiStatus, string> = {
  plantowatch: 'to watch',
  watching: 'watching',
  completed: 'watched',
  hold: 'on hold',
  dropped: 'dropped',
};

/** `rated 8+ · #travel · watched` - the line under a smart filter's name. */
export function describeRule(rule: SmartRule): string {
  const parts: string[] = [];
  if (rule.minRating) parts.push(`rated ${rule.minRating}+`);
  for (const t of rule.tags ?? []) parts.push(`#${t}`);
  if (rule.untagged) parts.push('no keywords');
  if (rule.status) parts.push(STATUS_WORDS[rule.status]);
  if (rule.text?.trim()) parts.push(`"${rule.text.trim()}"`);
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
  if (typeof r.text === 'string' && r.text.trim()) rule.text = r.text;
  if (typeof r.minRating === 'number' && r.minRating >= 1 && r.minRating <= 10) {
    rule.minRating = Math.round(r.minRating);
  }
  if (Array.isArray(r.tags)) {
    const tags = r.tags.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (tags.length) rule.tags = tags;
  }
  if (typeof r.status === 'string' && r.status in STATUS_WORDS) rule.status = r.status as UiStatus;
  if (r.untagged === true) rule.untagged = true;
  return rule;
}

/* ------------------------------------------------------------- view options */

const SORT_KEYS: VaultSort[] = ['recent', 'oldest', 'rating', 'name', 'size', 'duration'];
const LAYOUT_KEYS: LayoutStyle[] = ['grid', 'natural', 'waterfall', 'mosaic'];
const SIZE_KEYS: ThumbSize[] = ['small', 'medium', 'large', 'xlarge', 'fit'];
const INFO_KEYS: ThumbInfo[] = [
  'duration',
  'size',
  'date',
  'dimensions',
  'format',
  'filename',
  'keywords',
  'none',
];
const THEME_KEYS: ThemeMode[] = ['system', 'light', 'dark'];

/** The thumbnail sizes the first version saved as a column count. */
const LEGACY_COLUMNS: Record<number, ThumbSize> = { 3: 'large', 4: 'medium', 5: 'small' };

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Saved view options, with anything missing or invalid replaced by the default.
 * Also reads the older format (`columns`, `showDuration`), so nobody loses
 * their settings after an update.
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
  const legacyInfo = r.showDuration === false ? 'none' : undefined;

  return {
    layout: oneOf(r.layout, LAYOUT_KEYS, defaults.layout),
    size: oneOf(r.size, SIZE_KEYS, legacySize ?? defaults.size),
    sort: oneOf(r.sort, SORT_KEYS, defaults.sort),
    info: oneOf(r.info, INFO_KEYS, legacyInfo ?? defaults.info),
    showRating: bool(r.showRating, defaults.showRating),
    showKeywords: bool(r.showKeywords, defaults.showKeywords),
    theme: oneOf(r.theme, THEME_KEYS, defaults.theme),
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
export function purgeCutoff(now: number): number {
  return now - RECENTLY_DELETED_DAYS * DAY;
}

/** Whole days left before a deleted video is removed. Never below 0. */
export function daysLeft(deletedAt: number, now: number): number {
  const left = deletedAt + RECENTLY_DELETED_DAYS * DAY - now;
  return Math.max(0, Math.ceil(left / DAY));
}

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
