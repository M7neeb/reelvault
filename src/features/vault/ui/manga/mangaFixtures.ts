/**
 * Made-up series for the browser preview (`/preview?view=manga`,
 * `manga-detail`, `manga-reader`, `manga-strip`, `manga-deleted`). Covers and
 * pages are drawn as small SVG pictures, so no files are needed.
 */

import type { MangaChapter, MangaKind, MangaSeries, MangaStatus } from '../../manga/mangaLogic';
import { sortChapters } from '../../manga/mangaLogic';
import type { MangaActions, MangaData, MangaUiSeries } from './mangaTypes';

const DAY = 86_400_000;
const NOW = Date.now();

const svg = (body: string, w: number, h: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`)}`;

function cover(title: string, a: string, b: string): string {
  return svg(
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
     <rect width="200" height="300" fill="url(#g)"/>
     <circle cx="150" cy="80" r="70" fill="#fff" opacity="0.12"/>
     <path d="M0 230 L70 170 L120 210 L200 140 L200 300 L0 300Z" fill="#000" opacity="0.25"/>
     <text x="14" y="262" font-family="Helvetica, Arial" font-size="22" font-weight="900" fill="#fff">${title.slice(0, 16)}</text>`,
    200,
    300
  );
}

/** A comic-like page: panels and a page number. */
function page(n: number, tall = false): string {
  const h = tall ? 1600 : 1100;
  const panels = tall
    ? `<rect x="40" y="40" width="720" height="460" rx="8" fill="#e8e3d8" stroke="#111" stroke-width="6"/>
       <rect x="40" y="540" width="720" height="560" rx="8" fill="#ddd6c6" stroke="#111" stroke-width="6"/>
       <rect x="40" y="1140" width="720" height="420" rx="8" fill="#efe9dd" stroke="#111" stroke-width="6"/>`
    : `<rect x="40" y="40" width="720" height="380" rx="8" fill="#e8e3d8" stroke="#111" stroke-width="6"/>
       <rect x="40" y="450" width="340" height="300" rx="8" fill="#ddd6c6" stroke="#111" stroke-width="6"/>
       <rect x="420" y="450" width="340" height="300" rx="8" fill="#efe9dd" stroke="#111" stroke-width="6"/>
       <rect x="40" y="780" width="720" height="280" rx="8" fill="#e5dfd2" stroke="#111" stroke-width="6"/>`;
  return svg(
    `<rect width="800" height="${h}" fill="#fbfaf7"/>${panels}
     <ellipse cx="240" cy="200" rx="120" ry="60" fill="#fff" stroke="#111" stroke-width="5"/>
     <text x="400" y="${tall ? 330 : 290}" text-anchor="middle" font-family="Helvetica, Arial" font-size="140" font-weight="900" fill="#111" opacity="0.18">${n}</text>`,
    800,
    h
  );
}

const ch = (seriesId: string, n: number, extra: Partial<MangaChapter> = {}): MangaChapter => ({
  id: `${seriesId}-c${n}`,
  seriesId,
  folder: `manga/${seriesId}/c${n}`,
  number: n,
  volume: null,
  title: null,
  filename: `Chapter ${n}.cbz`,
  pages: Array.from({ length: 18 }, (_, i) => `${String(i + 1).padStart(4, '0')}.jpg`),
  pageCount: 18,
  size: 6_400_000,
  contentKey: null,
  sourceKey: null,
  sourceUrl: null,
  scanlator: null,
  uploadedAt: null,
  addedAt: NOW - (40 - n) * DAY,
  readAt: null,
  lastPage: 0,
  downloaded: true,
  position: n,
  ...extra,
});

function series(id: string, title: string, colours: [string, string], o: Partial<MangaSeries> & { count: number; read?: number; at?: number; kind?: MangaKind | null; status?: MangaStatus | null }): MangaUiSeries {
  const read = o.read ?? 0;
  const chapters = Array.from({ length: o.count }, (_, i) =>
    ch(id, i + 1, {
      readAt: i < read ? NOW - (read - i) * DAY : null,
      lastPage: o.at !== undefined && i === read ? o.at : 0,
      title: i === 0 ? 'The beginning' : null,
    })
  );
  const s: MangaSeries = {
    id,
    folder: `manga/${id}`,
    title,
    altTitle: null,
    author: o.author ?? null,
    artist: null,
    description: o.description ?? null,
    kind: o.kind ?? null,
    pubStatus: null,
    status: o.status ?? null,
    rating: o.rating ?? 0,
    notes: null,
    cover: 'cover.jpg',
    isPrivate: false,
    readingMode: null,
    sourceId: null,
    sourceKey: null,
    sourceUrl: null,
    createdAt: NOW - 60 * DAY,
    importedAt: o.importedAt ?? NOW - 30 * DAY,
    lastReadAt: o.lastReadAt ?? null,
    finishedAt: null,
    deletedAt: o.deletedAt ?? null,
    tags: o.tags ?? [],
    chapters: sortChapters(chapters),
  };
  return { ...s, coverSource: cover(title, colours[0], colours[1]) };
}

export function fixtureMangaData(): MangaData {
  const items: MangaUiSeries[] = [
    series('lighthouse', 'Lighthouse Keeper', ['#3a6df0', '#1a1446'], {
      count: 24,
      read: 11,
      at: 7,
      rating: 9.2,
      status: 'reading',
      author: 'Aoi Morikawa',
      kind: 'manga',
      lastReadAt: NOW - 3_600_000,
      tags: ['seinen', 'mystery'],
      description: 'A quiet girl takes over a lighthouse on an island where the tide keeps bringing back things that were lost.',
    }),
    series('ember', 'Ember Road', ['#ff7a18', '#5e1a00'], { count: 40, read: 32, rating: 8.5, status: 'reading', kind: 'manga', lastReadAt: NOW - 2 * DAY, tags: ['action'] }),
    series('tower', 'Tower of Days', ['#22c1c3', '#0b3550'], { count: 86, read: 20, status: 'reading', kind: 'manhwa', lastReadAt: NOW - 5 * DAY, tags: ['fantasy'] }),
    series('night', 'Night Courier', ['#8e2de2', '#20063b'], { count: 12, read: 12, rating: 7.8, status: 'completed', kind: 'comic' }),
    series('garden', 'Paper Garden', ['#56ab2f', '#183d0c'], { count: 8, status: 'planned', tags: ['slice of life'] }),
    series('harbor', 'Harbor Lights', ['#e96443', '#3b1020'], { count: 30, read: 4, rating: 6.5, status: 'onHold', lastReadAt: NOW - 40 * DAY }),
    series('static', 'Static Summer', ['#4facfe', '#003a66'], { count: 5, importedAt: NOW - DAY }),
    series('crows', 'Seven Crows', ['#434343', '#000000'], { count: 15, read: 2, status: 'dropped', rating: 4 }),
    series('moon', 'Moonwell', ['#f7971e', '#6b3a00'], { count: 52, read: 0, rating: 0, importedAt: NOW - 2 * DAY }),
  ];
  const deleted = [series('old', 'Old Volume', ['#777', '#222'], { count: 3, deletedAt: NOW - 3 * DAY })];
  const none = async () => undefined;
  const actions: MangaActions = {
    importFiles: none,
    importFolder: none,
    update: none,
    addTag: none,
    removeTag: none,
    trash: none,
    restore: none,
    purge: none,
    deleteChapters: none,
    setRead: none,
    markPreviousRead: none,
    saveProgress: none,
    addRead: none,
    pageUris: (c) => c.pages.map((_, i) => page(i + 1, c.seriesId === 'tower')),
    setCoverFromPhoto: none,
    setCoverFromPage: none,
    storageBytes: async () => 1_900_000_000,
  };
  return { items, deleted, busy: false, status: '', actions };
}
