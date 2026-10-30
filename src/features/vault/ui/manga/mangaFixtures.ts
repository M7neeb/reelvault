/**
 * Made-up series for the browser preview (`/preview?view=manga`,
 * `manga-detail`, `manga-reader`, `manga-strip`, `manga-deleted`). Covers and
 * pages are drawn as small SVG pictures, so no files are needed.
 */

import type { MangaChapter, MangaKind, MangaSeries, MangaStatus } from '../../manga/mangaLogic';
import { sortChapters } from '../../manga/mangaLogic';
import type { BrowsePrefs } from '../../manga/sources/prefs';
import type { MangaSource, SourceChapter, SourceDetails, SourceSeries } from '../../manga/sources/types';
import { infoOf } from '../../manga/sources/types';
import type { BrowseActions, MangaActions, MangaData, MangaUiSeries } from './mangaTypes';

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
    loadPages: async (_s, c) => Array.from({ length: c.pageCount || 18 }, (_, i) => ({ uri: page(i + 1, c.seriesId === 'tower') })),
    refresh: async () => 0,
    refreshAll: async () => ({ added: 0, failed: [] }),
    setCoverFromPhoto: none,
    setCoverFromPage: none,
    storageBytes: async () => 1_900_000_000,
    download: async () => 3,
    downloadLibrary: async () => 40,
    removeDownloads: none,
    cancelDownloads: none,
    retryDownloads: none,
    orderDownloads: none,
    pauseDownloads: () => undefined,
    exportCbz: async () => 'Saved 12 .cbz files to Files › On My iPhone › ReelVault › Exports › Lighthouse Keeper.',
    shareCbz: none,
    importBackup: none,
    linkSeries: async () => ({ matched: 20, added: 4 }),
    autoLink: async () => 0,
    loadReads: async () => fixtureReads(items),
  };
  const reading = items[0];
  const downloads = {
    queue: [
      ...reading.chapters.slice(12, 16).map((c) => ({ chapterId: c.id, seriesId: reading.id, state: 'queued' as const, error: null })),
      ...items.slice(1, 4).flatMap((s, i) => s.chapters.slice(0, [30, 1, 6][i]).map((c) => ({ chapterId: c.id, seriesId: s.id, state: 'queued' as const, error: null }))),
      { chapterId: items[2].chapters[30].id, seriesId: items[2].id, state: 'failed' as const, error: 'Could not reach api.mangadex.org. Check the address and that it is on.' },
    ],
    current: { chapterId: reading.chapters[12].id, seriesId: reading.id, done: 7, total: 18 },
    paused: false,
  };
  // Some chapters online (not downloaded), to show both.
  for (const s of items) for (const c of s.chapters.slice(Math.ceil(s.chapters.length * 0.6))) Object.assign(c, { folder: null, pages: [], sourceKey: `k-${c.id}`, downloaded: false });
  for (const s of items.slice(0, 3)) Object.assign(s, { sourceId: 'mangadex', sourceKey: `md-${s.id}` });
  const media = (id: number, title: string, chapters: number | null) => ({ id, title, altTitles: [], cover: null, chapters, volumes: null, year: 2021, format: 'MANGA', status: 'RELEASING', averageScore: 81, country: 'JP', url: `https://anilist.co/manga/${id}` });
  const anilist = {
    state: { configured: false, user: null, links: { lighthouse: 1001 } as Record<string, number>, syncing: false, error: null },
    actions: {
      search: async (q: string) => [media(1001, q, 120), media(1002, `${q}: Side Stories`, 12)],
      get: async (id: number) => media(id, 'Lighthouse Keeper', 120),
      link: async () => 0,
      unlink: none,
      fill: none,
      signIn: none,
      signOut: none,
      syncNow: none,
    },
  };
  return { items, deleted, busy: false, status: '', actions, browse: fixtureBrowse(), downloads, anilist };
}

/* ------------------------------------------------------------- Browse */

const NAMES = ['Starfall Academy', 'The Quiet Blacksmith', 'Neon Ronin', 'Moss and Iron', 'Paper Lanterns', 'Second Sun', 'Glass Garden', 'Wolf Harbor', 'Night Bakery', 'Comet Club', 'River Witch', 'Last Train Home'];
const HUES: [string, string][] = [['#ff512f', '#3b0a12'], ['#36d1dc', '#0b2a4a'], ['#a18cd1', '#2a1350'], ['#43e97b', '#0b3d2a'], ['#f7971e', '#4a2600'], ['#fc466b', '#2c0b3d']];

function fakeSource(id: string, name: string, kind: MangaSource['kind'], hint: string, extra: Partial<MangaSource> = {}): MangaSource {
  const list = (offset: number): SourceSeries[] =>
    NAMES.map((_, i) => {
      const n = (i + offset) % NAMES.length;
      return { key: `${id}-${n}`, title: NAMES[n], cover: { uri: cover(NAMES[n], ...HUES[n % HUES.length]) }, author: 'Rin Takahashi' };
    });
  const chapters = (key: string): SourceChapter[] =>
    Array.from({ length: 14 }, (_, i) => ({
      key: `${key}-c${i + 1}`,
      number: i + 1,
      volume: null,
      title: i === 0 ? 'A new term' : null,
      scanlator: kind === 'builtin' ? 'Moonlight Scans' : null,
      uploadedAt: NOW - (14 - i) * 3 * DAY,
      pageCount: 18,
      externalUrl: i === 13 && kind === 'builtin' ? 'https://example.org/official' : null,
      lang: 'en',
    }));
  return {
    id,
    name,
    lang: 'en',
    kind,
    nsfw: false,
    hint,
    canLatest: kind !== 'server',
    search: async (q) => ({ items: list(0).filter((x) => x.title.toLowerCase().includes(q.toLowerCase())), hasMore: false }),
    popular: async (n) => ({ items: n === 1 ? list(0) : [], hasMore: false }),
    latest: async () => ({ items: list(5), hasMore: false }),
    details: async (key): Promise<SourceDetails> => {
      const it = list(0).find((x) => x.key === key) ?? list(0)[0];
      return {
        ...it,
        altTitles: [],
        artist: null,
        description: 'A small-town student finds a map of a city that only exists at night, and a club that has been waiting for her.',
        genres: ['Fantasy', 'School', 'Mystery'],
        pubStatus: 'ongoing',
        kind: 'manga',
        webUrl: 'https://example.org',
      };
    },
    chapters: async (key) => chapters(key),
    pages: async () => Array.from({ length: 18 }, (_, i) => ({ uri: page(i + 1) })),
    ...extra,
  };
}

export function fixtureBrowse(): { prefs: BrowsePrefs; actions: BrowseActions } {
  const md = fakeSource('mangadex', 'MangaDex', 'builtin', 'Fan translations, credited to their groups');
  const komga = fakeSource('server:home', 'Komga on My PC', 'server', 'Your server (OPDS)', {
    folder: async () => ({ items: NAMES.slice(4, 10).map((t, i) => ({ key: `home-f${i}`, title: t, cover: { uri: cover(t, ...HUES[i % HUES.length]) } })), hasMore: false }),
    popular: async () => ({
      items: [
        { key: 'feed:1', title: 'Libraries', cover: null, folder: true },
        { key: 'feed:2', title: 'Collections', cover: null, folder: true },
        ...NAMES.slice(0, 4).map((t, i) => ({ key: `home-${i}`, title: t, cover: { uri: cover(t, ...HUES[i]) } })),
      ],
      hasMore: false,
    }),
  });
  const ext = fakeSource('ext:example', 'Public Domain Comics', 'extension', 'Golden-age comics that are free to share');
  const all = [md, komga, ext];
  const repoUrl = 'https://example.org/reelvault/index.json';
  const prefs: BrowsePrefs = {
    languages: ['en', 'de'],
    adult: false,
    servers: [{ id: 'home', kind: 'opds', name: 'My PC', url: 'http://192.168.1.20:25600/opds/v1.2/catalog', user: 'muneeb' }],
    repos: [
      {
        url: repoUrl,
        name: 'Example repo',
        addedAt: NOW - 3 * DAY,
        checkedAt: NOW,
        extensions: [
          { id: 'example', name: 'Public Domain Comics', version: 2, lang: 'en', nsfw: false, url: 'https://example.org/reelvault/example.js', domains: ['example.org'], description: 'Golden-age comics that are free to share' },
          { id: 'webcomics', name: 'Creator Webcomics', version: 1, lang: 'en', nsfw: false, url: 'https://example.org/reelvault/webcomics.js', domains: ['example.org'], description: 'Comics their creators publish for free' },
        ],
      },
    ],
    installed: [{ id: 'example', name: 'Public Domain Comics', version: 1, lang: 'en', nsfw: false, url: 'https://example.org/reelvault/example.js', domains: ['example.org'], description: null, repoUrl, installedAt: NOW }],

    smallerPages: true,
    checkOnOpen: true,
    autoDownload: false,
    removeAfterRead: false,
    syncProgress: true,
    wifiOnly: false,
    patient: false,
    parallel: 3,
    autoUpdateExt: true,
    reader: { tapZones: true, tapInvert: false, page: 'black', spreads: true, fit: 'screen', filter: 'none', autoSpeed: 3, longStrip: false, crop: false, autoBg: false, volumeKeys: true, volumeInvert: false, holdSpeed: 5 },
  };
  const none = async () => undefined;
  return {
    prefs,
    actions: {
      groups: async () => [
        { title: 'Built in', items: [infoOf(md)] },
        { title: 'My PC', serverId: 'home', items: [infoOf(komga)] },
        { title: 'Extensions', items: [infoOf(ext)] },
      ],
      source: (id) => all.find((x) => x.id === id) ?? null,
      setLanguages: none,
      setAdult: none,
      setOption: none,
      setReader: none,
      addServer: none,
      removeServer: none,
      addRepo: none,
      refreshRepos: async () => [],
      removeRepo: none,
      install: none,
      uninstall: none,
      addToLibrary: async () => 'lighthouse',
      openUrl: () => undefined,
    },
  };
}


/** A few months of reading, for the dashboard preview. */
export function fixtureReads(items: MangaUiSeries[]): import('../../manga/mangaLogic').MangaRead[] {
  const out: import('../../manga/mangaLogic').MangaRead[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let d = 200; d >= 0; d--) {
    if (rnd() < 0.35) continue;
    const s = items[Math.floor(rnd() * Math.min(5, items.length))];
    const sessions = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < sessions; k++) out.push({ seriesId: s.id, chapterId: s.chapters[0]?.id ?? null, startedAt: NOW - d * DAY - k * 3_600_000 - 20 * 3_600_000 * rnd(), readMs: (6 + rnd() * 25) * 60_000, pages: 15 + Math.floor(rnd() * 40) });
  }
  return out;
}
