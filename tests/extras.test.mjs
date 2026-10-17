// Run with `npm test`. IMDb / Letterboxd import, the calendar file, Pick for me.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildIcs, fold, icsText } from '../src/features/simkl/ics.ts';
import {
  chunk,
  describeImport,
  detectSource,
  isoDay,
  parseCsv,
  planImport,
  readWriteResponse,
  starsToTen,
} from '../src/features/simkl/imports.ts';
import { candidates, pickOne, weightOf } from '../src/features/simkl/pick.ts';

test('parseCsv handles quotes, commas, newlines, CRLF and a BOM', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line\nbreak"\r\n\r\n1,,3');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'he said "hi"', 'line\nbreak'],
    ['1', '', '3'],
  ]);
});

test('detectSource tells the exports apart', () => {
  assert.equal(detectSource(['Const', 'Your Rating', 'Date Rated', 'Title', 'Title Type']), 'imdb-ratings');
  assert.equal(detectSource(['Position', 'Const', 'Created', 'Title', 'Title Type', 'Your Rating']), 'imdb-list');
  assert.equal(detectSource(['Date', 'Name', 'Year', 'Letterboxd URI']), 'letterboxd-watched');
  assert.equal(detectSource(['Date', 'Name', 'Year', 'Letterboxd URI'], 'watchlist.csv'), 'letterboxd-watchlist');
  assert.equal(detectSource(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating']), 'letterboxd-ratings');
  assert.equal(detectSource(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date']), 'letterboxd-diary');
  assert.equal(detectSource(['foo', 'bar']), null);
});

test('IMDb ratings: movies watched + rated, shows rated only, episodes skipped', () => {
  const csv = [
    'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year',
    'tt0133093,9,2024-03-09,The Matrix,The Matrix,https://x,Movie,8.7,136,1999',
    'tt0903747,10,2023-01-02,Breaking Bad,Breaking Bad,https://x,TV Series,9.5,49,2008',
    'tt0959621,8,2023-01-03,Pilot,Pilot,https://x,TV Episode,9.0,58,2008',
  ].join('\n');
  const p = planImport(csv);
  assert.equal(p.source, 'imdb-ratings');
  assert.deepEqual(p.history.movies, [{ title: 'The Matrix', year: 1999, ids: { imdb: 'tt0133093' }, watched_at: '2024-03-09T12:00:00.000Z' }]);
  assert.equal(p.history.shows.length, 0);
  assert.equal(p.ratings.movies[0].rating, 9);
  assert.equal(p.ratings.shows[0].ids.imdb, 'tt0903747');
  assert.equal(p.skipped, 1);
  assert.equal(p.total, 3);
});

test('IMDb watchlist goes to Plan to Watch', () => {
  const csv = 'Position,Const,Created,Modified,Description,Title,URL,Title Type,Year\n1,tt1375666,2024-01-01,,,"Inception",https://x,Movie,2010';
  const p = planImport(csv);
  assert.equal(p.source, 'imdb-list');
  assert.deepEqual(p.plan.movies, [{ title: 'Inception', year: 2010, ids: { imdb: 'tt1375666' }, to: 'plantowatch' }]);
});

test('Letterboxd diary: one history entry per film, latest rating wins, half stars to 1-10', () => {
  const csv = [
    'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
    '2024-01-01,Heat,1995,https://boxd.it/a,4,,,2023-12-31',
    '2024-05-01,Heat,1995,https://boxd.it/b,4.5,Yes,,2024-04-30',
    '2024-06-01,Up,2009,https://boxd.it/c,,,,2024-06-01',
  ].join('\n');
  const p = planImport(csv);
  assert.equal(p.source, 'letterboxd-diary');
  assert.equal(p.history.movies.length, 2);
  assert.equal(p.history.movies[0].watched_at, '2023-12-31T12:00:00.000Z');
  assert.deepEqual(p.ratings.movies, [{ title: 'Heat', year: 1995, rating: 9, rated_at: '2024-05-01T12:00:00.000Z' }]);
  assert.equal(starsToTen('0.5'), 1);
  assert.equal(starsToTen('5'), 10);
  assert.equal(starsToTen(''), undefined);
});

test('Letterboxd watchlist by file name; dates and responses', () => {
  const p = planImport('Date,Name,Year,Letterboxd URI\n2024-01-01,Up,2009,https://boxd.it/c', 'watchlist.csv');
  assert.equal(p.plan.movies.length, 1);
  assert.equal(p.history.movies.length, 0);
  assert.equal(isoDay('nope'), undefined);
  assert.deepEqual(
    readWriteResponse({ added: { movies: 2, shows: 1 }, not_found: { movies: [{ title: 'Zzz', year: 2001 }], shows: [{ ids: { imdb: 'tt1' } }] } }),
    { added: 3, notFound: ['Zzz (2001)', 'tt1'] }
  );
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(
    describeImport({ source: 'imdb-ratings', watched: 4, rated: 3, planned: 0, skipped: 1, notFound: ['x'] }),
    'Added 4 watched, 3 ratings · 1 not found, 1 skipped'
  );
});

test('calendar file: escaped, folded, all-day releases, timed episodes', () => {
  const ics = buildIcs(
    [
      { uid: '1:S01E02', title: 'Show; S01E02, "Pilot"', start: '2026-10-20T01:00:00Z', minutes: 45, description: 'a\nb' },
      { uid: '2:release', title: 'Movie', start: '2026-11-01T00:00:00Z', minutes: 0, allDay: true },
      { uid: 'bad', title: 'x', start: 'not a date', minutes: 1 },
    ],
    new Date('2026-10-17T00:00:00Z')
  );
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261020T010000Z\r\nDTEND:20261020T014500Z/);
  assert.match(ics, /SUMMARY:Show\\; S01E02\\, "Pilot"/);
  assert.match(ics, /DESCRIPTION:a\\nb/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.equal(icsText('a,b'), 'a\\,b');
  const long = fold('X'.repeat(160));
  assert.ok(long.split('\r\n').every((l) => l.length <= 75));
});

const item = (o) => ({
  simklId: 1, type: 'movie', title: 't', status: 'plantowatch', runtime: 100, imdbRating: 7, simklRating: null, nextToWatch: null, ...o,
});

test('Pick for me: filters by list, type, time and exclusions; favours better ratings', () => {
  const items = [
    item({ simklId: 1 }),
    item({ simklId: 2, runtime: 150 }),
    item({ simklId: 3, status: 'completed' }),
    item({ simklId: 4, type: 'show', status: 'watching', runtime: 45, nextToWatch: 'S01E02' }),
    item({ simklId: 5, type: 'show', status: 'watching', runtime: 45, nextToWatch: null }),
  ];
  assert.deepEqual(candidates(items, { type: 'movie', from: 'plan', maxMinutes: 120 }).map((i) => i.simklId), [1]);
  assert.deepEqual(candidates(items, { type: 'movie', from: 'plan', maxMinutes: null }).map((i) => i.simklId), [1, 2]);
  assert.deepEqual(candidates(items, { type: 'movie', from: 'plan', maxMinutes: null, exclude: new Set([1]) }).map((i) => i.simklId), [2]);
  assert.deepEqual(candidates(items, { type: 'show', from: 'watching', maxMinutes: 60 }).map((i) => i.simklId), [4]);
  assert.ok(weightOf(item({ imdbRating: 9 })) > weightOf(item({ imdbRating: 6 })));
  const a = item({ simklId: 10, imdbRating: 5 });
  const b = item({ simklId: 11, imdbRating: 9 });
  assert.equal(pickOne([a, b], () => 0).simklId, 10);
  assert.equal(pickOne([a, b], () => 0.99).simklId, 11);
  assert.equal(pickOne([]), null);
});

import { guessEpisode, guessQuery } from '../src/features/simkl/linking.ts';

test('linking guesses the title and episode from the file name', () => {
  assert.equal(guessQuery({ title: null, filename: 'Harbour.Lights.S02E04.1080p.WEB-DL.mp4' }), 'Harbour Lights');
  assert.equal(guessQuery({ title: null, filename: 'Low_Tide_2020_2160p.mkv' }), 'Low Tide 2020');
  assert.equal(guessQuery({ title: 'My clip', filename: 'IMG_0001.MOV' }), 'My clip');
  assert.deepEqual(guessEpisode({ title: null, filename: 'show.s1e12.mp4' }), { season: 1, episode: 12 });
  assert.equal(guessEpisode({ title: null, filename: 'movie.mp4' }), null);
});

import { franchiseQuery, hasOrdinals, parseFranchises, simklTypeOf, sortOrdinal } from '../src/features/simkl/franchise.ts';

const row = (series, sLabel, m, mLabel, imdb, date, ord) => ({
  series: { value: `http://www.wikidata.org/entity/${series}` },
  seriesLabel: { value: sLabel },
  m: { value: `http://www.wikidata.org/entity/${m}` },
  mLabel: { value: mLabel },
  imdb: { value: imdb },
  ...(date ? { date: { value: `${date}T00:00:00Z` } } : {}),
  ...(ord ? { ord: { value: ord } } : {}),
});

test('franchise: series folded, biggest first, release and series order', () => {
  const json = {
    results: {
      bindings: [
        row('Q1', 'Big Saga', 'Q10', 'Second', 'tt2', '2012-05-01', '2'),
        row('Q1', 'Big Saga', 'Q10', 'Second', 'tt2', '2012-04-25', '2'),
        row('Q1', 'Big Saga', 'Q11', 'First', 'tt1', '2008-05-02', '1'),
        row('Q1', 'Big Saga', 'Q12', 'Prequel', 'tt3', '2019-03-08', '0.5'),
        row('Q2', 'Small Pair', 'Q10', 'Second', 'tt2', '2012-04-25'),
        row('Q2', 'Small Pair', 'Q13', 'Other', 'tt4', null),
        row('Q3', 'Alone', 'Q10', 'Second', 'tt2', '2012-04-25'),
        row('Q1', 'Big Saga', 'Q14', 'Bad', 'nope', '2001-01-01'),
      ],
    },
  };
  const [big, small] = parseFranchises(json);
  assert.equal(big.name, 'Big Saga');
  assert.deepEqual(big.entries.map((e) => e.title), ['First', 'Second', 'Prequel']);
  assert.equal(big.entries[1].date, '2012-04-25');
  assert.deepEqual(sortOrdinal(big.entries).map((e) => e.title), ['Prequel', 'First', 'Second']);
  assert.ok(hasOrdinals(big));
  assert.equal(small.entries.at(-1).title, 'Other');
  assert.equal(parseFranchises(json).length, 2);
  assert.match(franchiseQuery('tt0848228'), /wdt:P345 "tt0848228"/);
  assert.throws(() => franchiseQuery('x" } DROP'));
  assert.equal(simklTypeOf('tv'), 'show');
  assert.equal(simklTypeOf('book'), null);
});
