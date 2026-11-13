/**
 * "Export all data": everything ReelVault knows about you, as tables. One
 * CSV per table plus the same tables in one JSON file, zipped together by
 * dataExport.ts. Made for your own number crunching (a spreadsheet, Python,
 * a home-made Wrapped), so every table keeps ids to join on and plain
 * numbers rather than "1h 20m". Pure (tested).
 */

import { csvCell } from './sheetExport.ts';

export type Cell = string | number | null;
export type Table = { file: string; about: string; columns: string[]; rows: Cell[][] };

export type ExportVideo = {
  id: string;
  title: string | null;
  filename: string;
  size: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  rating: number;
  flag: number;
  status: string | null;
  notes: string | null;
  createdAt: number | null;
  importedAt: number | null;
  keywords: string[];
  albums: string[];
  series: string | null;
};

export type ExportKeptVideo = {
  id: string;
  title: string | null;
  filename: string;
  durationMs: number | null;
  rating: number;
  status: string | null;
  keywords: string[];
  createdAt: number | null;
  importedAt: number | null;
  removedAt: number;
};

export type ExportTitle = {
  simklId: number;
  type: string;
  title: string;
  year: number | null;
  slug: string | null;
  runtime: number | null;
  status: string;
  rating: number | null;
  ratedAt: string | null;
  addedAt: string | null;
  lastWatchedAt: string | null;
  watchedEpisodes: number;
  totalEpisodes: number;
  animeType: string | null;
  memo: string | null;
  simklRating: number | null;
  imdbRating: number | null;
  malRating: number | null;
  genres: string[];
  network: string | null;
  country: string | null;
  language: string | null;
};

export type ExportAudio = {
  id: string;
  kind: string;
  title: string | null;
  filename: string;
  author: string | null;
  narrator: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  durationMs: number | null;
  rating: number;
  status: string | null;
  keywords: string[];
  createdAt: number | null;
  lastPlayedAt: number | null;
  finishedAt: number | null;
};

export type ExportManga = {
  id: string;
  title: string;
  altTitle: string | null;
  author: string | null;
  artist: string | null;
  kind: string | null;
  pubStatus: string | null;
  status: string | null;
  rating: number;
  keywords: string[];
  source: string | null;
  createdAt: number | null;
  lastReadAt: number | null;
  finishedAt: number | null;
};

export type ExportChapter = {
  id: string;
  seriesId: string;
  number: number | null;
  volume: number | null;
  title: string | null;
  pageCount: number;
  readAt: number | null;
  lastPage: number;
  uploadedAt: number | null;
  scanlator: string | null;
};

export type ExportBook = {
  id: string;
  title: string | null;
  filename: string;
  author: string | null;
  language: string | null;
  chapters: number;
  /** 0..1 */
  progress: number;
  addedAt: number;
  lastReadAt: number | null;
  finishedAt: number | null;
  rating?: number;
  status?: string | null;
  keywords?: string[];
};

const BOOK_STATUS: Record<string, string> = { want: 'Want to read', reading: 'Reading', finished: 'Finished', dropped: 'Dropped' };

export type ExportInput = {
  exportedAt: number;
  videos: ExportVideo[];
  keptVideos: ExportKeptVideo[];
  videoPlays: { videoId: string; startedAt: number; watchedMs: number }[];
  videoSeries: { name: string; description: string | null; rating: number; status: string | null; episodes: number }[];
  titles: ExportTitle[];
  episodes: { simklId: number; season: number; episode: number; watchedAt: string | null }[];
  /** Watches logged again in ReelVault. Movies use season 0, episode 0. */
  rewatches: { simklId: number; season: number; episode: number; watchedAt: string }[];
  lists: { list: string; simklId: number; type: string; title: string; year: number | null; addedAt: string | null }[];
  audio: ExportAudio[];
  audioPlays: { itemId: string; startedAt: number; listenedMs: number }[];
  manga: ExportManga[];
  chapters: ExportChapter[];
  mangaReads: { seriesId: string; chapterId: string | null; startedAt: number; readMs: number; pages: number }[];
  /** Books (EPUB) and their reading sittings. */
  books?: ExportBook[];
  bookReads?: { bookId: string; startedAt: number; readMs: number; progressFrom: number; progressTo: number }[];
  highlights?: { bookId: string; chapter: number; text: string; note: string | null; createdAt: number }[];
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Milliseconds or an ISO string -> ms, or null when there is no usable date. */
export function toMs(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** 2026-10-23 19:05:42 in the phone's time zone: spreadsheets read it as a date and time. */
export function stamp(v: number | string | null | undefined): string | null {
  const ms = toMs(v);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 2026-10-23T19:05:42+02:00: the moment with its time zone, so it lines up with other apps' exports. */
export function isoLocal(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${stamp(ms)!.replace(' ', 'T')}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Minutes with one decimal, null for nothing. */
export function minutes(ms: number | null | undefined): number | null {
  if (!ms || ms < 0) return null;
  return Math.round(ms / 6000) / 10;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const STATUS_NAMES: Record<string, string> = {
  plantowatch: 'Plan to watch',
  watching: 'Watching',
  completed: 'Completed',
  hold: 'On hold',
  onHold: 'On hold',
  dropped: 'Dropped',
  planned: 'Planned',
  listening: 'Listening',
  finished: 'Finished',
  reading: 'Reading',
  ongoing: 'Ongoing',
  hiatus: 'Hiatus',
  cancelled: 'Cancelled',
};

export function statusName(s: string | null | undefined): string | null {
  if (!s) return null;
  return STATUS_NAMES[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Your rating of a Simkl title: the exact one kept in ReelVault (9.7) while it
 * still rounds to what Simkl has; if it was changed on Simkl since, Simkl's.
 */
export function myRating(simkl: number | null, exact: number | null): number | null {
  if (simkl === null) return null;
  if (exact !== null && Math.min(10, Math.max(1, Math.round(exact))) === simkl) return exact;
  return simkl;
}

const rating = (r: number | null | undefined) => (r ? r : null);
const list = (xs: string[]) => (xs.length ? xs.join('; ') : null);
const mb = (bytes: number | null) => (bytes ? Math.round((bytes / 1_048_576) * 10) / 10 : null);
const typeName = (t: string) => (t === 'movie' ? 'Movie' : t === 'anime' ? 'Anime' : 'Show');
const episodeLabel = (season: number, episode: number) => `S${pad(season)}E${pad(episode)}`;

function simklLink(t: { type: string; simklId: number; slug: string | null }): string {
  const section = t.type === 'movie' ? 'movies' : t.type === 'anime' ? 'anime' : 'tv';
  return `https://simkl.com/${section}/${t.simklId}/${t.slug ?? ''}`;
}

/** Number of a chapter as it is printed: 12, 12.5. */
const chapterNo = (n: number | null) => (n === null || n < 0 ? null : n);

export type ActivityRow = {
  at: number;
  section: 'Video' | 'Movie' | 'Show' | 'Anime' | 'Audio' | 'Manga' | 'Book';
  itemId: string;
  title: string;
  detail: string | null;
  ms: number | null;
  pages: number | null;
};

/**
 * Every time you watched, listened or read something, oldest first. Movie
 * and episode lengths come from the title's runtime on Simkl (Simkl does
 * not record how long you actually watched).
 */
export function activity(input: ExportInput): ActivityRow[] {
  const out: ActivityRow[] = [];
  const videoTitle = new Map<string, string>();
  for (const v of input.videos) videoTitle.set(v.id, v.title || v.filename);
  for (const v of input.keptVideos) if (!videoTitle.has(v.id)) videoTitle.set(v.id, v.title || v.filename);
  for (const p of input.videoPlays) {
    const title = videoTitle.get(p.videoId);
    // Plays of private videos stay out, like the videos themselves.
    if (title === undefined) continue;
    out.push({ at: p.startedAt, section: 'Video', itemId: p.videoId, title, detail: null, ms: p.watchedMs || null, pages: null });
  }

  const titles = new Map(input.titles.map((t) => [t.simklId, t]));
  const watchMs = (t: ExportTitle) => (t.runtime ? t.runtime * 60_000 : null);
  for (const e of input.episodes) {
    const t = titles.get(e.simklId);
    const at = toMs(e.watchedAt);
    if (!t || at === null) continue;
    out.push({ at, section: typeName(t.type), itemId: String(t.simklId), title: t.title, detail: episodeLabel(e.season, e.episode), ms: watchMs(t), pages: null });
  }
  for (const t of input.titles) {
    const at = toMs(t.lastWatchedAt);
    if (t.type !== 'movie' || t.status !== 'completed' || at === null) continue;
    out.push({ at, section: 'Movie', itemId: String(t.simklId), title: t.title, detail: null, ms: watchMs(t), pages: null });
  }
  for (const r of input.rewatches) {
    const t = titles.get(r.simklId);
    const at = toMs(r.watchedAt);
    if (!t || at === null) continue;
    const detail = t.type === 'movie' ? 'Rewatch' : `${episodeLabel(r.season, r.episode)} rewatch`;
    out.push({ at, section: typeName(t.type), itemId: String(t.simklId), title: t.title, detail, ms: watchMs(t), pages: null });
  }

  const audioTitle = new Map(input.audio.map((a) => [a.id, a.title || a.filename]));
  for (const p of input.audioPlays) {
    const title = audioTitle.get(p.itemId);
    if (title === undefined) continue;
    out.push({ at: p.startedAt, section: 'Audio', itemId: p.itemId, title, detail: null, ms: p.listenedMs || null, pages: null });
  }

  const mangaTitle = new Map(input.manga.map((m) => [m.id, m.title]));
  const chapters = new Map(input.chapters.map((c) => [c.id, c]));
  for (const r of input.mangaReads) {
    const title = mangaTitle.get(r.seriesId);
    if (title === undefined) continue;
    const c = r.chapterId ? chapters.get(r.chapterId) : undefined;
    const no = c ? chapterNo(c.number) : null;
    const detail = c ? (no !== null ? `Chapter ${no}` : c.title) : null;
    out.push({ at: r.startedAt, section: 'Manga', itemId: r.seriesId, title, detail, ms: r.readMs || null, pages: r.pages || null });
  }

  const bookTitle = new Map((input.books ?? []).map((b) => [b.id, b.title || b.filename]));
  for (const r of input.bookReads ?? []) {
    const title = bookTitle.get(r.bookId);
    if (title === undefined) continue;
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    out.push({ at: r.startedAt, section: 'Book', itemId: r.bookId, title, detail: `${pct(r.progressFrom)} to ${pct(r.progressTo)}`, ms: r.readMs || null, pages: null });
  }
  return out.sort((a, b) => a.at - b.at);
}

function activityTable(rows: ActivityRow[]): Table {
  return {
    file: 'activity.csv',
    about: 'Every watch, listen and reading session across the app, oldest first. The main file for a Wrapped.',
    columns: ['Source', 'Timestamp', 'Unix ms', 'When', 'Date', 'Year', 'Month', 'Weekday', 'Hour', 'Section', 'Item id', 'Title', 'Detail', 'Minutes', 'Pages'],
    rows: rows.map((r) => {
      const d = new Date(r.at);
      return ['ReelVault', isoLocal(r.at), r.at, stamp(r.at), stamp(r.at)!.slice(0, 10), d.getFullYear(), d.getMonth() + 1, WEEKDAYS[d.getDay()], d.getHours(), r.section, r.itemId, r.title, r.detail, minutes(r.ms), r.pages];
    }),
  };
}

/** Sessions, minutes and pages per month and section. */
export function byMonth(rows: ActivityRow[]): Table {
  const sums = new Map<string, { month: string; section: string; n: number; ms: number; pages: number }>();
  for (const r of rows) {
    const d = new Date(r.at);
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const key = `${month}|${r.section}`;
    const s = sums.get(key) ?? { month, section: r.section, n: 0, ms: 0, pages: 0 };
    s.n++;
    s.ms += r.ms ?? 0;
    s.pages += r.pages ?? 0;
    sums.set(key, s);
  }
  const sorted = [...sums.values()].sort((a, b) => a.month.localeCompare(b.month) || a.section.localeCompare(b.section));
  return {
    file: 'by_month.csv',
    about: 'Activity added up per month and section.',
    columns: ['Month', 'Section', 'Sessions', 'Minutes', 'Hours', 'Pages'],
    rows: sorted.map((s) => [s.month, s.section, s.n, minutes(s.ms) ?? 0, Math.round(s.ms / 360_000) / 10, s.pages || null]),
  };
}

type SectionStats = { section: string; items: number; ratings: number[]; done: number };

/** One line per section: how much there is, how it is rated, how much time went into it. */
export function summary(input: ExportInput, rows: ActivityRow[]): Table {
  const sections: SectionStats[] = [
    { section: 'Video', items: input.videos.length, ratings: input.videos.map((v) => v.rating), done: input.videos.filter((v) => v.status === 'completed').length },
    ...(['movie', 'show', 'anime'] as const).map((type) => {
      const ts = input.titles.filter((t) => t.type === type);
      return { section: typeName(type), items: ts.length, ratings: ts.map((t) => t.rating ?? 0), done: ts.filter((t) => t.status === 'completed').length };
    }),
    { section: 'Audio', items: input.audio.length, ratings: input.audio.map((a) => a.rating), done: input.audio.filter((a) => a.status === 'finished' || a.finishedAt).length },
    { section: 'Manga', items: input.manga.length, ratings: input.manga.map((m) => m.rating), done: input.manga.filter((m) => m.status === 'completed').length },
    { section: 'Book', items: (input.books ?? []).length, ratings: (input.books ?? []).map((b) => b.rating ?? 0), done: (input.books ?? []).filter((b) => b.finishedAt).length },
  ];
  const line = (s: SectionStats, acts: ActivityRow[]): Cell[] => {
    const rated = s.ratings.filter((r) => r > 0);
    const ms = acts.reduce((a, r) => a + (r.ms ?? 0), 0);
    const pages = acts.reduce((a, r) => a + (r.pages ?? 0), 0);
    return [
      s.section,
      s.items,
      rated.length,
      rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 100) / 100 : null,
      s.done,
      acts.length,
      Math.round(ms / 360_000) / 10,
      pages || null,
      acts.length ? stamp(acts[0].at) : null,
      acts.length ? stamp(acts[acts.length - 1].at) : null,
    ];
  };
  const all: SectionStats = {
    section: 'Everything',
    items: sections.reduce((a, s) => a + s.items, 0),
    ratings: sections.flatMap((s) => s.ratings),
    done: sections.reduce((a, s) => a + s.done, 0),
  };
  return {
    file: 'summary.csv',
    about: 'Totals per section: items, ratings, finished, sessions, hours, first and last activity.',
    columns: ['Section', 'Items', 'Rated', 'Average rating', 'Finished', 'Sessions', 'Hours', 'Pages', 'First activity', 'Last activity'],
    rows: [...sections.map((s) => line(s, rows.filter((r) => r.section === s.section))), line(all, rows)],
  };
}

/** All the tables, in the order the README lists them. */
export function exportTables(input: ExportInput): Table[] {
  const acts = activity(input);
  const playsBy = new Map<string, { n: number; ms: number; last: number }>();
  const tally = (id: string, ms: number | null, at: number) => {
    const s = playsBy.get(id) ?? { n: 0, ms: 0, last: 0 };
    s.n++;
    s.ms += ms ?? 0;
    s.last = Math.max(s.last, at);
    playsBy.set(id, s);
  };
  for (const r of acts) tally(`${r.section}:${r.itemId}`, r.ms, r.at);
  const plays = (section: string, id: string | number) => playsBy.get(`${section}:${id}`);
  const pagesBy = new Map<string, number>();
  for (const r of input.mangaReads) pagesBy.set(r.seriesId, (pagesBy.get(r.seriesId) ?? 0) + (r.pages || 0));

  const videos: Table = {
    file: 'videos.csv',
    about: 'Your own videos (not private ones, not Recently Deleted).',
    columns: ['Id', 'Title', 'File', 'Filmed', 'Added', 'Minutes long', 'Size (MB)', 'Width', 'Height', 'Rating', 'Flag', 'Status', 'Keywords', 'Albums', 'Series', 'Caption', 'Times watched', 'Minutes watched', 'Last watched'],
    rows: input.videos.map((v) => {
      const p = plays('Video', v.id);
      return [
        v.id, v.title, v.filename, stamp(v.createdAt), stamp(v.importedAt), minutes(v.durationMs), mb(v.size), v.width || null, v.height || null,
        rating(v.rating), v.flag === 1 ? 'Pick' : v.flag === -1 ? 'Reject' : null, statusName(v.status), list(v.keywords), list(v.albums), v.series, v.notes,
        p?.n ?? 0, minutes(p?.ms) ?? 0, stamp(p?.last),
      ];
    }),
  };

  const removed: Table = {
    file: 'removed_videos.csv',
    about: 'Videos you removed for good: their info is kept, the files are gone.',
    columns: ['Id', 'Title', 'File', 'Filmed', 'Added', 'Removed', 'Minutes long', 'Rating', 'Status', 'Keywords', 'Times watched', 'Minutes watched'],
    rows: input.keptVideos.map((v) => {
      const p = plays('Video', v.id);
      return [v.id, v.title, v.filename, stamp(v.createdAt), stamp(v.importedAt), stamp(v.removedAt), minutes(v.durationMs), rating(v.rating), statusName(v.status), list(v.keywords), p?.n ?? 0, minutes(p?.ms) ?? 0];
    }),
  };

  const series: Table = {
    file: 'video_series.csv',
    about: 'Your video series and how you rated them.',
    columns: ['Series', 'Episodes', 'Rating', 'Status', 'Description'],
    rows: input.videoSeries.map((s) => [s.name, s.episodes, rating(s.rating), statusName(s.status), s.description]),
  };

  const titles: Table = {
    file: 'movies_shows_anime.csv',
    about: 'Your Simkl library: movies, shows and anime, with your rating and the community ratings.',
    columns: [
      'Simkl id', 'Type', 'Title', 'Year', 'Status', 'My rating', 'Rated on', 'Added on', 'Last watched', 'Episodes watched', 'Episodes total',
      'Minutes per episode', 'Times watched', 'Minutes watched', 'Genres', 'Network', 'Country', 'Language', 'Anime type', 'Simkl rating', 'IMDb rating', 'MAL rating', 'Memo', 'Link',
    ],
    rows: input.titles.map((t) => {
      const p = plays(typeName(t.type), t.simklId);
      return [
        t.simklId, typeName(t.type), t.title, t.year, statusName(t.status), t.rating, stamp(t.ratedAt), stamp(t.addedAt), stamp(t.lastWatchedAt),
        t.type === 'movie' ? null : t.watchedEpisodes, t.type === 'movie' ? null : t.totalEpisodes || null, t.runtime, p?.n ?? 0, minutes(p?.ms) ?? 0,
        list(t.genres), t.network, t.country, t.language, t.animeType, t.simklRating, t.imdbRating, t.malRating, t.memo, simklLink(t),
      ];
    }),
  };

  const titleOf = new Map(input.titles.map((t) => [t.simklId, t]));
  const episodes: Table = {
    file: 'episodes_watched.csv',
    about: 'Every episode marked watched, plus rewatches logged in ReelVault.',
    columns: ['Simkl id', 'Type', 'Title', 'Season', 'Episode', 'Watched on', 'Rewatch'],
    rows: [
      ...input.episodes.map((e) => ({ ...e, rewatch: false })),
      ...input.rewatches.filter((r) => titleOf.get(r.simklId)?.type !== 'movie').map((r) => ({ ...r, rewatch: true })),
    ]
      .filter((e) => titleOf.has(e.simklId))
      .sort((a, b) => (toMs(a.watchedAt) ?? 0) - (toMs(b.watchedAt) ?? 0))
      .map((e) => {
        const t = titleOf.get(e.simklId)!;
        return [t.simklId, typeName(t.type), t.title, e.season, e.episode, stamp(e.watchedAt), e.rewatch ? 'Yes' : null];
      }),
  };

  const lists: Table = {
    file: 'lists.csv',
    about: 'Your own lists of movies, shows and anime.',
    columns: ['List', 'Simkl id', 'Type', 'Title', 'Year', 'Added on'],
    rows: input.lists.map((l) => [l.list, l.simklId, typeName(l.type), l.title, l.year, stamp(l.addedAt)]),
  };

  const audio: Table = {
    file: 'audio.csv',
    about: 'Audiobooks, EPUB read-alongs and other audio.',
    columns: ['Id', 'Kind', 'Title', 'Author', 'Narrator', 'Album', 'Genre', 'Year', 'Minutes long', 'Rating', 'Status', 'Keywords', 'Added', 'Last played', 'Finished', 'Listens', 'Minutes listened'],
    rows: input.audio.map((a) => {
      const p = plays('Audio', a.id);
      return [
        a.id, a.kind === 'book' ? 'EPUB' : 'Audio', a.title || a.filename, a.author, a.narrator, a.album, a.genre, a.year, minutes(a.durationMs), rating(a.rating),
        statusName(a.status), list(a.keywords), stamp(a.createdAt), stamp(a.lastPlayedAt), stamp(a.finishedAt), p?.n ?? 0, minutes(p?.ms) ?? 0,
      ];
    }),
  };

  const chaptersBy = new Map<string, ExportChapter[]>();
  for (const c of input.chapters) {
    const l = chaptersBy.get(c.seriesId);
    if (l) l.push(c);
    else chaptersBy.set(c.seriesId, [c]);
  }
  const manga: Table = {
    file: 'manga.csv',
    about: 'Manga, manhwa and comics.',
    columns: ['Id', 'Title', 'Other title', 'Author', 'Artist', 'Kind', 'Publication', 'Status', 'Rating', 'Keywords', 'Chapters', 'Chapters read', 'Added', 'Last read', 'Finished', 'Sessions', 'Minutes read', 'Pages read', 'Source'],
    rows: input.manga.map((m) => {
      const cs = chaptersBy.get(m.id) ?? [];
      const p = plays('Manga', m.id);
      return [
        m.id, m.title, m.altTitle, m.author, m.artist, statusName(m.kind), statusName(m.pubStatus), statusName(m.status), rating(m.rating), list(m.keywords),
        cs.length, cs.filter((c) => c.readAt).length, stamp(m.createdAt), stamp(m.lastReadAt), stamp(m.finishedAt), p?.n ?? 0, minutes(p?.ms) ?? 0, pagesBy.get(m.id) || null, m.source,
      ];
    }),
  };

  const mangaTitle = new Map(input.manga.map((m) => [m.id, m.title]));
  const chapters: Table = {
    file: 'manga_chapters.csv',
    about: 'Every chapter of every manga, read or not.',
    columns: ['Series id', 'Series', 'Chapter id', 'Number', 'Volume', 'Title', 'Pages', 'Read on', 'Last page seen', 'Released', 'Scanlator'],
    rows: input.chapters
      .filter((c) => mangaTitle.has(c.seriesId))
      .map((c) => [c.seriesId, mangaTitle.get(c.seriesId)!, c.id, chapterNo(c.number), c.volume, c.title, c.pageCount || null, stamp(c.readAt), c.lastPage || null, stamp(c.uploadedAt), c.scanlator]),
  };

  const books: Table = {
    file: 'books.csv',
    about: 'Books (EPUB) to read, with how far you are.',
    columns: ['Id', 'Title', 'Author', 'Language', 'Chapters', 'Percent read', 'Rating', 'Status', 'Keywords', 'Added', 'Last read', 'Finished', 'Sessions', 'Minutes read', 'Highlights'],
    rows: (input.books ?? []).map((b) => {
      const p = plays('Book', b.id);
      return [
        b.id, b.title || b.filename, b.author, b.language, b.chapters, b.finishedAt ? 100 : Math.round(b.progress * 1000) / 10, rating(b.rating ?? 0), BOOK_STATUS[b.status ?? ''] ?? null,
        list(b.keywords ?? []), stamp(b.addedAt), stamp(b.lastReadAt), stamp(b.finishedAt), p?.n ?? 0, minutes(p?.ms) ?? 0, (input.highlights ?? []).filter((h) => h.bookId === b.id).length,
      ];
    }),
  };

  const bookTitle = new Map((input.books ?? []).map((b) => [b.id, b.title || b.filename]));
  const highlights: Table = {
    file: 'book_highlights.csv',
    about: 'What you highlighted in your books, with your notes.',
    columns: ['Book id', 'Book', 'Chapter', 'Highlight', 'Note', 'Made on'],
    rows: (input.highlights ?? []).filter((h) => bookTitle.has(h.bookId)).map((h) => [h.bookId, bookTitle.get(h.bookId)!, h.chapter + 1, h.text, h.note, stamp(h.createdAt)]),
  };

  return [summary(input, acts), activityTable(acts), byMonth(acts), videos, removed, series, titles, episodes, lists, audio, manga, chapters, books, highlights];
}

/** A table as CSV: a byte-order mark so Excel reads accents and emoji, Windows line ends. */
export function tableCsv(t: Table): string {
  const lines = [t.columns.map(csvCell).join(',')];
  for (const r of t.rows) lines.push(r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** The same tables as one JSON file: each table a list of objects keyed by column name. */
export function tablesJson(tables: Table[], exportedAt: number): string {
  const out: Record<string, unknown> = { app: 'ReelVault', exportedAt: new Date(exportedAt).toISOString() };
  const data: Record<string, Record<string, Cell>[]> = {};
  for (const t of tables) {
    data[t.file.replace(/\.csv$/, '')] = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? null])));
  }
  out.tables = data;
  return JSON.stringify(out, null, 1);
}

export function readme(tables: Table[], exportedAt: number): string {
  const width = Math.max(...tables.map((t) => t.file.length));
  return [
    'ReelVault data',
    `Exported ${stamp(exportedAt)} (times are in the phone's time zone).`,
    '',
    ...tables.map((t) => `${t.file.padEnd(width)}  ${t.rows.length} ${t.rows.length === 1 ? 'row' : 'rows'}. ${t.about}`),
    `${'everything.json'.padEnd(width)}  All of the tables above in one file.`,
    '',
    'Notes',
    '- Private items and anything in Recently Deleted are left out.',
    '- Minutes for movies and episodes are the runtime Simkl lists, not timed by the app.',
    '- Ratings are 1 to 10; an empty cell means not rated.',
    '- To mix with other exports, use activity.csv: "Timestamp" is ISO 8601 with the time zone, "Unix ms" is the same moment as a number, "Source" is always ReelVault.',
    '- Join tables on the id columns: activity "Item id" matches the Id of videos, audio, manga and books, and the Simkl id of movies, shows and anime.',
    '',
  ].join('\r\n');
}
