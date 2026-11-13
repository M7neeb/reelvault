// Run with `npm test`. Export all data: the tables, the activity log, totals and the files.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activity, byMonth, exportTables, isoLocal, minutes, myRating, readme, stamp, statusName, tableCsv, tablesJson } from '../src/features/vault/dataExportFormat.ts';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();

const empty = () => ({
  exportedAt: at(2026, 11, 9),
  videos: [],
  keptVideos: [],
  videoPlays: [],
  videoSeries: [],
  titles: [],
  episodes: [],
  rewatches: [],
  lists: [],
  audio: [],
  audioPlays: [],
  manga: [],
  chapters: [],
  mangaReads: [],
});

const video = (id, extra = {}) => ({
  id, title: `Clip ${id}`, filename: `${id}.mp4`, size: 10_485_760, durationMs: 90_000, width: 1920, height: 1080, rating: 8, flag: 0,
  status: 'completed', notes: null, createdAt: at(2026, 1, 2), importedAt: at(2026, 1, 3), keywords: ['beach'], albums: [], series: null, ...extra,
});

const title = (simklId, type, extra = {}) => ({
  simklId, type, title: `${type} ${simklId}`, year: 2020, slug: 'x', runtime: 24, status: 'completed', rating: 9, ratedAt: null, addedAt: null,
  lastWatchedAt: null, watchedEpisodes: 2, totalEpisodes: 12, animeType: null, memo: null, simklRating: 8.1, imdbRating: null, malRating: null,
  genres: ['Action', 'Drama'], network: null, country: 'jp', language: null, ...extra,
});

function sample() {
  const input = empty();
  input.videos = [video('v1'), video('v2', { rating: 0, title: null })];
  input.videoPlays = [
    { videoId: 'v1', startedAt: at(2026, 3, 1), watchedMs: 60_000 },
    { videoId: 'v1', startedAt: at(2026, 4, 1), watchedMs: 30_000 },
    { videoId: 'private', startedAt: at(2026, 4, 2), watchedMs: 30_000 },
  ];
  input.titles = [title(1, 'anime'), title(2, 'movie', { runtime: 120, lastWatchedAt: iso(2026, 2, 14, 21) })];
  input.episodes = [
    { simklId: 1, season: 1, episode: 1, watchedAt: iso(2026, 3, 5) },
    { simklId: 1, season: 1, episode: 2, watchedAt: null },
    { simklId: 99, season: 1, episode: 1, watchedAt: iso(2026, 3, 5) },
  ];
  input.rewatches = [{ simklId: 2, season: 0, episode: 0, watchedAt: iso(2026, 5, 1) }];
  input.audio = [{ id: 'a1', kind: 'audio', title: 'Book', filename: 'b.m4b', author: 'A', narrator: null, album: null, genre: null, year: null, durationMs: 3_600_000, rating: 7, status: 'finished', keywords: [], createdAt: at(2026, 1, 1), lastPlayedAt: null, finishedAt: at(2026, 6, 1) }];
  input.audioPlays = [{ itemId: 'a1', startedAt: at(2026, 3, 10), listenedMs: 1_800_000 }];
  input.manga = [{ id: 'm1', title: 'Tower', altTitle: null, author: null, artist: null, kind: 'manhwa', pubStatus: 'ongoing', status: 'reading', rating: 9.5, keywords: ['fantasy'], source: null, createdAt: at(2026, 1, 1), lastReadAt: null, finishedAt: null }];
  input.chapters = [
    { id: 'c1', seriesId: 'm1', number: 1, volume: null, title: 'Start', pageCount: 40, readAt: at(2026, 3, 20), lastPage: 40, uploadedAt: null, scanlator: null },
    { id: 'c2', seriesId: 'm1', number: 2, volume: null, title: null, pageCount: 38, readAt: null, lastPage: 3, uploadedAt: null, scanlator: null },
    { id: 'c9', seriesId: 'gone', number: 1, volume: null, title: null, pageCount: 1, readAt: null, lastPage: 0, uploadedAt: null, scanlator: null },
  ];
  input.mangaReads = [
    { seriesId: 'm1', chapterId: 'c1', startedAt: at(2026, 3, 20), readMs: 600_000, pages: 40 },
    { seriesId: 'gone', chapterId: null, startedAt: at(2026, 3, 21), readMs: 1000, pages: 1 },
  ];
  return input;
}

test('dates are local "YYYY-MM-DD HH:MM:SS"; Simkl ISO strings are read too; nothing for missing dates', () => {
  assert.equal(stamp(new Date(2026, 0, 2, 3, 4, 5).getTime()), '2026-01-02 03:04:05');
  assert.equal(stamp(new Date(2026, 0, 2, 3, 4, 5).toISOString()), '2026-01-02 03:04:05');
  assert.equal(stamp(null), null);
  assert.equal(stamp(''), null);
  assert.equal(stamp('not a date'), null);
  assert.equal(minutes(90_000), 1.5);
  const ms = new Date(2026, 0, 2, 3, 4, 5).getTime();
  assert.equal(Date.parse(isoLocal(ms)), ms);
  assert.match(isoLocal(ms), /^2026-01-02T03:04:05[+-]\d\d:\d\d$/);
  assert.equal(minutes(0), null);
});

test('status names are readable, unknown ones are capitalised', () => {
  assert.equal(statusName('plantowatch'), 'Plan to watch');
  assert.equal(statusName('onHold'), 'On hold');
  assert.equal(statusName('manhwa'), 'Manhwa');
  assert.equal(statusName(null), null);
});

test('my Simkl rating: the exact one while it still rounds to Simkl, else Simkl', () => {
  assert.equal(myRating(10, 9.7), 9.7);
  assert.equal(myRating(8, 9.7), 8);
  assert.equal(myRating(null, 9.7), null);
  assert.equal(myRating(7, null), 7);
});

test('activity: every section, oldest first, private and unknown items left out', () => {
  const acts = activity(sample());
  assert.deepEqual(
    acts.map((a) => [a.section, a.title, a.detail]),
    [
      ['Movie', 'movie 2', null],
      ['Video', 'Clip v1', null],
      ['Anime', 'anime 1', 'S01E01'],
      ['Audio', 'Book', null],
      ['Manga', 'Tower', 'Chapter 1'],
      ['Video', 'Clip v1', null],
      ['Movie', 'movie 2', 'Rewatch'],
    ]
  );
  // Episode and movie minutes come from the runtime.
  assert.equal(acts.find((a) => a.section === 'Anime').ms, 24 * 60_000);
  assert.equal(acts.find((a) => a.section === 'Manga').pages, 40);
});

test('by month adds up sessions, minutes and pages per section', () => {
  const t = byMonth(activity(sample()));
  const march = t.rows.filter((r) => r[0] === '2026-03');
  assert.deepEqual(march.map((r) => [r[1], r[2], r[3]]), [['Anime', 1, 24], ['Audio', 1, 30], ['Manga', 1, 10], ['Video', 1, 1]]);
});

test('tables: per-item totals, summary line per section and an Everything line', () => {
  const tables = exportTables(sample());
  const get = (f) => tables.find((t) => t.file === f);
  const col = (t, name) => t.columns.indexOf(name);

  const videos = get('videos.csv');
  const v1 = videos.rows[0];
  assert.equal(v1[col(videos, 'Times watched')], 2);
  assert.equal(v1[col(videos, 'Minutes watched')], 1.5);
  assert.equal(v1[col(videos, 'Size (MB)')], 10);
  assert.equal(videos.rows[1][col(videos, 'Rating')], null);

  const titles = get('movies_shows_anime.csv');
  const movie = titles.rows.find((r) => r[1] === 'Movie');
  assert.equal(movie[col(titles, 'Times watched')], 2);
  assert.equal(movie[col(titles, 'Episodes watched')], null);
  assert.equal(movie[col(titles, 'Genres')], 'Action; Drama');
  assert.equal(movie[col(titles, 'Link')], 'https://simkl.com/movies/2/x');

  const manga = get('manga.csv');
  assert.equal(manga.rows[0][col(manga, 'Chapters')], 2);
  assert.equal(manga.rows[0][col(manga, 'Chapters read')], 1);
  assert.equal(manga.rows[0][col(manga, 'Pages read')], 40);
  assert.equal(get('manga_chapters.csv').rows.length, 2);

  // Episodes: the one with a date, the undated one; the unknown title is left out. Movie rewatches are not episodes.
  assert.equal(get('episodes_watched.csv').rows.length, 2);

  const summary = get('summary.csv');
  const line = (s) => summary.rows.find((r) => r[0] === s);
  assert.equal(line('Video')[col(summary, 'Items')], 2);
  assert.equal(line('Video')[col(summary, 'Rated')], 1);
  assert.equal(line('Movie')[col(summary, 'Sessions')], 2);
  assert.equal(line('Movie')[col(summary, 'Hours')], 4);
  assert.equal(line('Show')[col(summary, 'Items')], 0);
  assert.equal(line('Everything')[col(summary, 'Items')], 6);
  assert.equal(line('Everything')[col(summary, 'Sessions')], 7);
});

test('an empty library still gives every file with headers', () => {
  const tables = exportTables(empty());
  assert.equal(tables.length, 14);
  for (const t of tables) assert.ok(tableCsv(t).startsWith('﻿' + t.columns[0]));
  assert.match(readme(tables, empty().exportedAt), /activity\.csv\s+0 rows\./);
});

test('CSV and JSON carry the same rows; text that looks like a formula is made safe', () => {
  const input = sample();
  input.videos[0].title = '=HYPERLINK("x")';
  const tables = exportTables(input);
  const videos = tables.find((t) => t.file === 'videos.csv');
  const csv = tableCsv(videos);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.equal(csv.trim().split('\r\n').length, 1 + videos.rows.length);
  const json = JSON.parse(tablesJson(tables, input.exportedAt));
  assert.equal(json.tables.videos[0].Title, '=HYPERLINK("x")');
  assert.equal(json.tables.activity.length, 7);
  assert.equal(json.tables.activity[0].Source, 'ReelVault');
  assert.equal(Date.parse(json.tables.activity[0].Timestamp), json.tables.activity[0]['Unix ms']);
  assert.equal(json.tables.summary.at(-1).Section, 'Everything');
});

test('books and their sittings go into the export', () => {
  const input = {
    ...empty(),
    books: [{ id: 'cp', title: 'Crime and Punishment', filename: 'cp.epub', author: 'Fyodor Dostoevsky', language: 'en', chapters: 53, progress: 0.1234, addedAt: 1_000, lastReadAt: 9_000, finishedAt: null }],
    bookReads: [
      { bookId: 'cp', startedAt: 5_000, readMs: 30 * 60_000, progressFrom: 0, progressTo: 0.06 },
      { bookId: 'gone', startedAt: 6_000, readMs: 60_000, progressFrom: 0, progressTo: 0.1 },
    ],
  };
  const tables = exportTables(input);
  const acts = tables.find((t) => t.file === 'activity.csv').rows;
  assert.equal(acts.length, 1);
  assert.equal(acts[0][9], 'Book');
  assert.equal(acts[0][12], '0% to 6%');
  const books = tables.find((t) => t.file === 'books.csv').rows;
  assert.deepEqual([books[0][1], books[0][5], books[0][12], books[0][13]], ['Crime and Punishment', 12.3, 1, 30]);
  const sum = tables.find((t) => t.file === 'summary.csv').rows.find((r) => r[0] === 'Book');
  assert.equal(sum[1], 1);
});
