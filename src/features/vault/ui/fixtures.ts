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

import type { ThumbSource, UiTag, VaultItem } from './types';

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
  'IMG_4471_market.mp4',
  'snaptik_7609629117616590111_v3 (1).mp4',
  'family_evening_oct.mp4',
  'Terra Formars (2016) S01E04.mp4',
  'screenrec_2026-10-11_notes.mp4',
  'IMG_4462_lake.mp4',
  'birthday_cut_v2.mp4',
  'Snaptik.app_7358080437329153323.mp4',
  'clip_2026-10-08_walk.mp4',
  'IMG_4448_sunset.mp4',
  'lecture_part3.mp4',
];

const SIZES = [45.2, 12.8, 8.5, 120.4, 7.6, 33.1, 19.7, 64.9, 1.2, 22.5, 14.3, 9.8];
const DURATIONS = [192, 41, 15, 615, 44, 128, 76, 271, 12, 98, 63, 205];
const RATINGS = [9, 0, 7, 10, 5, 0, 8, 6, 0, 4, 9, 0];

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

const NAMES = Array.from(
  new Set(TAG_SETS.flat())
).sort((a, b) => a.localeCompare(b));

export const FIXTURE_TAGS: UiTag[] = NAMES.map((name, i) => ({ id: i + 1, name }));

export const FIXTURE_ITEMS: VaultItem[] = SAMPLE_NAMES.map((filename, i) => ({
  id: `fixture-${i + 1}`,
  filename,
  uri: '',
  thumbSource: PLACEHOLDERS[i % PLACEHOLDERS.length],
  sizeBytes: Math.round(SIZES[i] * 1024 * 1024),
  durationMs: DURATIONS[i] * 1000,
  rating: RATINGS[i],
  width: 1920,
  height: 1080,
  // A few days apart, newest first, so date ordering is visible.
  importedAt: Date.UTC(2026, 9, 13, 18, 30) - i * 26 * 60 * 60 * 1000,
  tagCount: TAG_SETS[i].length,
  tagNames: TAG_SETS[i],
}));

/** name -> ids, the same shape the native layer hands over. */
export const FIXTURE_TAG_MAP: Record<string, string[]> = Object.fromEntries(
  FIXTURE_TAGS.map((t) => [
    t.name,
    FIXTURE_ITEMS.filter((v) => v.tagNames.includes(t.name)).map((v) => v.id),
  ]),
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
