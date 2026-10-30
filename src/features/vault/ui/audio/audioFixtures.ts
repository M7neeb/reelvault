/**
 * Made-up audio items and a small read-along book for the browser preview
 * (`/preview?view=audio`, `audio-player`, `audio-read`, `audio-info`,
 * `audio-stats`, `audio-deleted`). No files, no native modules.
 */

import { DEFAULT_AUDIO_PREFS, type AudioItem, type AudioPlay } from '../../audio/audioLogic';
import type { BookJson } from '../../audio/epub';
import type { AudioActions, AudioData, AudioUiItem } from './audioTypes';

const DAY = 86_400_000;
const NOW = Date.now();

const base = (id: string, extra: Partial<AudioItem>): AudioItem => ({
  id,
  kind: 'audio',
  folder: `audio/${id}`,
  filename: `${id}.mp3`,
  size: 48_000_000,
  durationMs: null,
  title: null,
  author: null,
  album: null,
  narrator: null,
  year: null,
  genre: null,
  description: null,
  notes: null,
  rating: 0,
  status: null,
  cover: null,
  tracks: [{ file: `${id}.mp3`, title: id, durationMs: 1_800_000 }],
  chapters: [],
  contentKey: null,
  isPrivate: false,
  positionTrack: 0,
  positionMs: 0,
  speed: null,
  lastPlayedAt: null,
  finishedAt: null,
  createdAt: NOW - 30 * DAY,
  importedAt: NOW - 30 * DAY,
  deletedAt: null,
  tags: [],
  ...extra,
});

const ITEMS: AudioItem[] = [
  base('book-1', {
    kind: 'book',
    filename: 'The Night Garden.epub',
    title: 'The Night Garden',
    author: 'Muneeb',
    narrator: 'Muneeb',
    size: 212_000_000,
    rating: 9.4,
    status: 'listening',
    tracks: [
      { file: 'OEBPS/audio/ch1.mp3', title: 'One: The Gate', durationMs: 1_260_000 },
      { file: 'OEBPS/audio/ch2.mp3', title: 'Two: Lanterns', durationMs: 1_540_000 },
      { file: 'OEBPS/audio/ch3.mp3', title: 'Three: Morning', durationMs: 980_000 },
    ],
    chapters: [
      { title: 'One: The Gate', track: 0, startMs: 0 },
      { title: 'Two: Lanterns', track: 1, startMs: 0 },
      { title: 'Three: Morning', track: 2, startMs: 0 },
    ],
    positionTrack: 0,
    positionMs: 9_000,
    lastPlayedAt: NOW - 3_600_000,
    tags: ['own', 'stories'],
  }),
  base('aud-2', {
    filename: 'Morning Walk Thoughts.m4b',
    title: 'Morning Walk Thoughts',
    author: 'Muneeb',
    rating: 8.2,
    status: 'listening',
    tracks: [{ file: 'walk.m4b', title: 'walk', durationMs: 5_400_000 }],
    chapters: [
      { title: 'Leaving the house', track: 0, startMs: 0 },
      { title: 'The park', track: 0, startMs: 1_500_000 },
      { title: 'Coffee', track: 0, startMs: 3_300_000 },
    ],
    positionMs: 2_100_000,
    lastPlayedAt: NOW - DAY,
    tags: ['walks'],
  }),
  base('aud-3', {
    filename: 'Study Notes - History.mp3',
    title: 'Study Notes: History',
    author: 'Muneeb',
    status: 'finished',
    finishedAt: NOW - 5 * DAY,
    rating: 7,
    tracks: [{ file: 'history.mp3', title: 'history', durationMs: 2_700_000 }],
    lastPlayedAt: NOW - 5 * DAY,
    tags: ['study'],
  }),
  base('aud-4', {
    filename: 'Sleep Story 3.mp3',
    title: 'Sleep Story 3',
    author: 'Muneeb',
    genre: 'Sleep',
    tracks: [{ file: 'sleep3.mp3', title: 'sleep3', durationMs: 1_200_000 }],
    tags: ['sleep'],
    importedAt: NOW - 2 * DAY,
  }),
  base('aud-5', {
    filename: 'Podcast Draft (12 files)',
    title: 'Podcast Draft',
    author: 'Muneeb and friends',
    tracks: Array.from({ length: 12 }, (_, n) => ({ file: `${String(n + 1).padStart(3, '0')} part.mp3`, title: `Episode ${n + 1}`, durationMs: 900_000 + n * 60_000 })),
    status: 'planned',
    importedAt: NOW - 7 * DAY,
  }),
  base('aud-6', { filename: 'voice memo 2026-10-01.m4a', title: 'Voice memo, 1 October', tracks: [{ file: 'memo.m4a', title: 'memo', durationMs: 184_000 }], importedAt: NOW - 18 * DAY }),
];

const DELETED: AudioItem[] = [base('aud-del', { filename: 'old take.wav', title: 'Old take', deletedAt: NOW - 3 * DAY })];

const asUi = (i: AudioItem): AudioUiItem => ({ ...i, coverSource: null, trackUris: i.tracks.map(() => '') });

export const FIXTURE_AUDIO: AudioUiItem[] = ITEMS.map(asUi);

const BOOK: BookJson = {
  v: 1,
  title: 'The Night Garden',
  authors: ['Muneeb'],
  narrators: ['Muneeb'],
  language: 'en',
  description: null,
  publisher: null,
  date: '2026',
  cover: null,
  chapters: [
    { href: 'OEBPS/ch1.xhtml', title: 'One: The Gate', overlay: true },
    { href: 'OEBPS/ch2.xhtml', title: 'Two: Lanterns', overlay: true },
    { href: 'OEBPS/ch3.xhtml', title: 'Three: Morning', overlay: true },
  ],
  tracks: [
    { file: 'OEBPS/audio/ch1.mp3', durationMs: 1_260_000 },
    { file: 'OEBPS/audio/ch2.mp3', durationMs: 1_540_000 },
    { file: 'OEBPS/audio/ch3.mp3', durationMs: 980_000 },
  ],
  clips: [
    { c: 0, id: 'h1', t: 0, b: 0, e: 3000 },
    { c: 0, id: 's1', t: 0, b: 3000, e: 8000 },
    { c: 0, id: 's2', t: 0, b: 8000, e: 14000 },
    { c: 0, id: 's3', t: 0, b: 14000, e: 21000 },
    { c: 0, id: 's4', t: 0, b: 21000, e: 30000 },
    { c: 0, id: 's5', t: 0, b: 30000, e: 38000 },
    { c: 1, id: 'h2', t: 1, b: 0, e: 3000 },
    { c: 2, id: 'h3', t: 2, b: 0, e: 3000 },
  ],
  toc: [
    { title: 'One: The Gate', chapter: 0, id: null, depth: 0 },
    { title: 'Two: Lanterns', chapter: 1, id: null, depth: 0 },
    { title: 'Three: Morning', chapter: 2, id: null, depth: 0 },
  ],
  durationMs: 3_780_000,
  activeClass: null,
};

const CHAPTER_1 = `<html><body>
<h1 id="h1">One: The Gate</h1>
<p><span id="s1">The garden only opened after dark, when the last bus had gone.</span> <span id="s2">Nobody remembered who had built the gate, or why its hinges never rusted.</span></p>
<p><span id="s3">That night the lanterns were already lit, a long line of them, swaying like they were breathing.</span> <span id="s4">I stepped through, and the city behind me went quiet, the way a room goes quiet when someone important walks in.</span></p>
<p><span id="s5">Somewhere ahead, water was running over stones.</span> I followed the sound.</p>
<hr/>
<p>The path was narrow at first, then wide enough for two. Moss covered the stones, soft under my shoes.</p>
</body></html>`;

export function fixtureAudioData(): AudioData {
  const noop = async () => undefined;
  const actions: AudioActions = {
    importFiles: noop,
    importFolder: noop,
    update: noop,
    addTag: noop,
    removeTag: noop,
    trash: noop,
    restore: noop,
    purge: noop,
    savePosition: noop,
    markFinished: noop,
    reset: noop,
    addPlay: noop,
    loadPlays: async (): Promise<AudioPlay[]> => {
      const out: AudioPlay[] = [];
      for (let d = 0; d < 120; d++) {
        if (d % 3 === 1 || d % 7 === 5) continue;
        const ids = ['book-1', 'aud-2', 'aud-3', 'aud-4'];
        out.push({ itemId: ids[d % ids.length], startedAt: NOW - d * DAY - ((d * 37) % 12) * 3_600_000, listenedMs: 600_000 + ((d * 7919) % 2_400_000) });
      }
      return out;
    },
    listBookmarks: async (id) => (id === 'aud-2' ? [{ id: 1, itemId: id, track: 0, atMs: 1_620_000, label: 'The bit about the ducks', createdAt: NOW - DAY }] : []),
    addBookmark: noop,
    removeBookmark: noop,
    loadBook: async (id) => (id === 'book-1' ? { book: BOOK, chapterText: async (n) => (n === 0 ? CHAPTER_1 : `<html><body><h1 id="h${n + 1}">${BOOK.chapters[n].title}</h1><p>More of the story.</p></body></html>`), uriOf: () => '' } : null),
    share: noop,
    setCoverFromPhoto: noop,
    listPhotos: async () => [
      'https://picsum.photos/id/1015/1200/800',
      'https://picsum.photos/id/1025/800/1200',
      'https://picsum.photos/id/1043/1200/900',
    ],
    addPhotos: async () => 0,
    removePhoto: noop,
    storageBytes: async () => 412_000_000,
    setPrefs: async () => undefined,
    canBoost: () => true,
    setVoiceBoost: async (_id, _on, onProgress) => onProgress(1),
  };
  const prefs = { ...DEFAULT_AUDIO_PREFS, upNext: FIXTURE_AUDIO.slice(1, 3).map((i) => i.id) };
  return { items: FIXTURE_AUDIO, deleted: DELETED.map(asUi), busy: false, status: '', duplicateAsk: null, actions, prefs };
}
