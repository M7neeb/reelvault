/**
 * Fixture data for the browser preview.
 *
 * This exists so the real UI components can be rendered and screenshotted at
 * phone dimensions without a device, a database, or any native module. It is
 * how the design gets checked and iterated - the previous approach was editing
 * styles blind and waiting for someone to look at a phone.
 *
 * These are deliberately NOT real videos: neutral placeholders only, so a
 * screenshot of the app never contains anything personal.
 */

import { groupDuplicates } from './logic';
import type {
  SmartFilter,
  ThumbSource,
  UiAlbum,
  UiFlag,
  UiFolder,
  UiMeta,
  UiStatus,
  UiTag,
  VaultItem,
} from './types';

// Reuse the template's bundled images as stand-in thumbnails. Real pixels, so
// the grid can be judged honestly - tile size, gaps, badge legibility.
const PLACEHOLDERS = [
  require('@/assets/images/tutorial-web.png'),
  require('@/assets/images/react-logo.png'),
  require('@/assets/images/logo-glow.png'),
  require('@/assets/images/splash-icon.png'),
  require('@/assets/images/expo-logo.png'),
  require('@/assets/images/icon.png'),
];

const SAMPLE_NAMES = [
  'clip_2026-10-12_downtown.mp4',
  'IMG_4471_market.MOV',
  'snaptik_7609629117616590111_v3 (1).mp4',
  'family_evening_oct.mp4',
  'Terra Formars (2016) S01E04.mp4',
  'screenrec_2026-10-11_notes.mp4',
  'IMG_4462_lake.MOV',
  'birthday_cut_v2.mp4',
  'Snaptik.app_7358080437329153323.mp4',
  'clip_2026-10-08_walk.mp4',
  'IMG_4448_sunset.MOV',
  'lecture_part3.mp4',
];

const SIZES = [45.2, 12.8, 8.5, 120.4, 7.6, 33.1, 19.7, 64.9, 1.2, 22.5, 14.3, 9.8];
// screenrec (128 s) and lecture_part3 (129 s) are both 1920x1080: a "similar" pair.
const DURATIONS = [192, 41, 15, 615, 44, 128, 76, 271, 12, 98, 63, 129];
const RATINGS = [9, 0, 7, 10, 5, 0, 8, 6, 0, 4, 9, 0];
const FLAGS: UiFlag[] = [1, 0, 0, 1, 0, -1, 0, 0, -1, 0, 1, 0];
const IN_TRAY = [false, true, false, false, false, false, true, false, false, false, false, false];
/** Filming dates: a few days apart, several per day, across two months. */
const FILMED_DAYS_AGO = [3, 3, 4, 6, 6, 6, 10, 14, 21, 25, 33, 40];

const TAG_SETS: string[][] = [
  ['holiday'],
  [],
  ['funny', 'send'],
  ['family'],
  [],
  ['uni'],
  ['holiday', 'nature'],
  [],
  ['funny'],
  ['nature'],
  ['holiday'],
  [],
];

const STATUS_SET: (UiStatus | null)[] = [
  'completed',
  'plantowatch',
  null,
  'completed',
  'watching',
  null,
  'plantowatch',
  null,
  null,
  'hold',
  'completed',
  'plantowatch',
];

/** A mix of landscape, portrait (phone) and square videos, so every layout style can be judged. */
const DIMENSIONS: [number, number][] = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1920],
  [1920, 1080],
  [1080, 1080],
  [1920, 1080],
  [1080, 1920],
  [1920, 1080],
  [720, 1280],
  [1920, 1080],
  [1080, 1350],
  [1920, 1080],
];

/** Albums: Holiday 2026 (pinned) and Family in the folder "Personal", plus one private album. */
export const FIXTURE_FOLDERS: UiFolder[] = [{ id: 1, name: 'Personal' }];

export const FIXTURE_ALBUMS: UiAlbum[] = [
  { id: 1, name: 'Holiday 2026', folderId: null, isPrivate: false, pinned: true, excludeUncategorized: false, lastUsedAt: 5 },
  { id: 2, name: 'Family', folderId: 1, isPrivate: false, pinned: false, excludeUncategorized: false, lastUsedAt: 9 },
  { id: 3, name: 'Clips to send', folderId: null, isPrivate: false, pinned: false, excludeUncategorized: false, lastUsedAt: 2 },
  { id: 4, name: 'Diary', folderId: null, isPrivate: true, pinned: false, excludeUncategorized: false, lastUsedAt: 1 },
];

const ALBUM_SETS: number[][] = [[1], [], [3], [2], [], [], [1], [2], [3], [], [1], []];

/** A phone-style file record for some videos: device, codec, GPS. */
const META: (UiMeta | null)[] = [
  { codec: 'HEVC', fps: 30, make: 'Apple', model: 'iPhone 15', location: { lat: 51.6611, lon: 7.3489 } },
  { codec: 'HEVC', fps: 60, make: 'Apple', model: 'iPhone 15', location: { lat: 51.6618, lon: 7.3502 } },
  { codec: 'H.264', fps: 30 },
  { codec: 'HEVC', fps: 30, make: 'Apple', model: 'iPhone 12' },
  { codec: 'H.264', fps: 23.98 },
  { codec: 'H.264', fps: 60 },
  { codec: 'HEVC', fps: 30, make: 'Apple', model: 'iPhone 15', location: { lat: 51.66, lon: 7.35 } },
  null,
  { codec: 'H.264', fps: 30 },
  { codec: 'HEVC', fps: 30, make: 'Apple', model: 'iPhone 12', location: { lat: 52.52, lon: 13.405 } },
  { codec: 'HEVC', fps: 30, make: 'Apple', model: 'iPhone 15' },
  null,
];

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 9, 16, 17, 30);

const PUBLIC_ITEMS: VaultItem[] = SAMPLE_NAMES.map((filename, i) => ({
  id: `fixture-${i + 1}`,
  filename,
  uri: '',
  thumbSource: PLACEHOLDERS[i % PLACEHOLDERS.length],
  sizeBytes: Math.round(SIZES[i] * 1024 * 1024),
  durationMs: DURATIONS[i] * 1000,
  rating: RATINGS[i],
  width: DIMENSIONS[i][0],
  height: DIMENSIONS[i][1],
  createdAt: BASE - FILMED_DAYS_AGO[i] * DAY - i * 37 * 60 * 1000,
  // Imported a few days apart, newest first, so date ordering is visible.
  importedAt: Date.UTC(2026, 9, 13, 18, 30) - i * 26 * 60 * 60 * 1000,
  tagCount: TAG_SETS[i].length,
  tagNames: TAG_SETS[i],
  deletedAt: null,
  status: STATUS_SET[i],
  isPrivate: false,
  flag: FLAGS[i],
  inTray: IN_TRAY[i],
  albumIds: ALBUM_SETS[i],
  title: i === 0 ? 'Downtown at dusk' : null,
  notes: i === 0 ? 'First warm evening of October.' : null,
  meta: META[i],
  contentKey: null,
  customCover: false,
  originalSizeBytes: null,
}));

const PRIVATE_NAMES = ['private_note_01.mp4', 'private_note_02.mp4', 'private_note_03.mp4'];

/** Three videos in the Private album: invisible everywhere until it is unlocked. */
const PRIVATE_ITEMS: VaultItem[] = PRIVATE_NAMES.map((filename, i) => ({
  id: `fixture-private-${i + 1}`,
  filename,
  uri: '',
  thumbSource: PLACEHOLDERS[(i + 4) % PLACEHOLDERS.length],
  sizeBytes: Math.round([28.1, 4.4, 61.9][i] * 1024 * 1024),
  durationMs: [88, 21, 302][i] * 1000,
  rating: [7, 0, 9][i],
  width: 1080,
  height: 1920,
  createdAt: Date.UTC(2026, 9, 2, 10, 0) - i * DAY,
  importedAt: Date.UTC(2026, 9, 2, 10, 0) - i * 26 * 60 * 60 * 1000,
  tagCount: 0,
  tagNames: [],
  deletedAt: null,
  status: null,
  isPrivate: true,
  flag: 0,
  inTray: false,
  albumIds: i === 0 ? [4] : [],
  title: null,
  notes: null,
  meta: null,
  contentKey: null,
  customCover: false,
  originalSizeBytes: null,
}));

export const FIXTURE_ITEMS: VaultItem[] = [...PUBLIC_ITEMS, ...PRIVATE_ITEMS];

/** A couple of saved searches for the sidebar (one inside the "Personal" folder). */
export const FIXTURE_SMART_FILTERS: SmartFilter[] = [
  { id: 1, name: 'Best of holiday', rule: { minRating: 8, tags: ['holiday'] }, folderId: null },
  { id: 2, name: 'Still to watch', rule: { status: 'plantowatch' }, folderId: null },
  { id: 3, name: 'Long portrait clips', rule: { orientation: 'portrait', minDurationSec: 30 }, folderId: 1 },
];

/**
 * Pretend content keys: two pairs of the fixture videos are "the same video",
 * so the Duplicates view has something to show. Run through the real grouping.
 */
const FIXTURE_KEYS: Record<string, string> = {
  'fixture-3': 'same-a',
  'fixture-9': 'same-a',
  'fixture-7': 'same-b',
  'fixture-11': 'same-b',
};
export const FIXTURE_DUPLICATE_GROUPS: string[][] = groupDuplicates(
  FIXTURE_ITEMS.map((v) => ({ ...v, contentKey: FIXTURE_KEYS[v.id] ?? null }))
);

const DELETED_NAMES = ['old_screenrec_2026-09-20.mp4', 'IMG_4301_blurry.mp4', 'clip_2026-09-02_test.mp4'];
const DELETED_DAYS_AGO = [2, 11, 27];

/** Recently Deleted, newest deletion first - 28, 19 and 3 days left. */
export const FIXTURE_DELETED: VaultItem[] = DELETED_NAMES.map((filename, i) => ({
  id: `fixture-deleted-${i + 1}`,
  filename,
  uri: '',
  thumbSource: PLACEHOLDERS[(i + 2) % PLACEHOLDERS.length],
  sizeBytes: Math.round([18.4, 6.1, 52.7][i] * 1024 * 1024),
  durationMs: [33, 9, 140][i] * 1000,
  rating: 0,
  width: 1920,
  height: 1080,
  createdAt: Date.UTC(2026, 8, 1, 12, 0),
  importedAt: Date.UTC(2026, 8, 1, 12, 0),
  tagCount: 0,
  tagNames: [],
  deletedAt: Date.now() - DELETED_DAYS_AGO[i] * DAY - 60 * 60 * 1000,
  status: null,
  isPrivate: false,
  flag: 0,
  inTray: false,
  albumIds: [],
  title: null,
  notes: null,
  meta: null,
  contentKey: null,
  customCover: false,
  originalSizeBytes: null,
}));

const NAMES = Array.from(new Set(TAG_SETS.flat())).sort((a, b) => a.localeCompare(b));

/** "holiday" is pinned, so it is listed first. */
export const FIXTURE_TAGS: UiTag[] = [
  ...NAMES.filter((n) => n === 'holiday'),
  ...NAMES.filter((n) => n !== 'holiday'),
].map((name, i) => ({ id: i + 1, name, pinned: name === 'holiday' }));

/** name -> ids, the same shape the native layer hands over. */
export const FIXTURE_TAG_MAP: Record<string, string[]> = Object.fromEntries(
  FIXTURE_TAGS.map((t) => [t.name, FIXTURE_ITEMS.filter((v) => v.tagNames.includes(t.name)).map((v) => v.id)])
);

/** Mirrors the native FTS search closely enough to judge the search UI. */
export function fixtureSearch(query: string): VaultItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return FIXTURE_ITEMS.filter(
    (v) => v.filename.toLowerCase().includes(q) || v.tagNames.some((t) => t.toLowerCase().includes(q))
  );
}

/** Placeholder filmstrip: deterministic grey frames, no native calls. */
export function fixtureFrames(item: VaultItem, count = 8): ThumbSource[] {
  void item;
  const swatch = require('@/assets/images/logo-glow.png');
  return Array.from({ length: count }, () => swatch);
}

/** Preview: a believable few weeks of watching the fixture videos. */
export function fixturePlays(): { videoId: string; startedAt: number; watchedMs: number }[] {
  const out: { videoId: string; startedAt: number; watchedMs: number }[] = [];
  let seed = 11;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const ids = FIXTURE_ITEMS.map((v) => v.id);
  for (let i = 0; i < 70; i++) {
    const id = ids[Math.floor(Math.pow(rand(), 1.8) * ids.length)];
    const item = FIXTURE_ITEMS.find((v) => v.id === id)!;
    const d = new Date(Date.now() - Math.floor(rand() * 40) * 86_400_000);
    d.setHours(17 + Math.floor(rand() * 6), Math.floor(rand() * 60));
    out.push({ videoId: id, startedAt: d.getTime(), watchedMs: Math.round((item.durationMs ?? 60000) * (0.4 + rand() * 0.6)) });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export const FIXTURE_BOOKMARKS = [
  { id: 1, videoId: FIXTURE_ITEMS[0].id, atMs: 42_000, label: 'The view from the top', createdAt: Date.now() },
  { id: 2, videoId: FIXTURE_ITEMS[0].id, atMs: 131_000, label: null, createdAt: Date.now() },
];
