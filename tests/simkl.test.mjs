// Run with `npm test`. Simkl parsing, sync planning, links and lists.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  backoffMs,
  followedIds,
  newThisWeek,
  weekAhead,
  groupBySeason,
  myCalendar,
  parseAllItems,
  parseCatalog,
  parseEpisodeCode,
  parseEpisodes,
  parseIds,
  planSync,
  posterUrl,
  shouldSync,
  simklUrl,
  sortItems,
  statsFor,
  statusesFor,
  upNext,
  countdown,
  episodesLeft,
  fmtVotes,
  libraryCsv,
  parseCommunityRatings,
  parseRelated,
  sortsFor,
  trailerUrl,
  watchHeatmap,
} from '../src/features/simkl/logic.ts';

const showEntry = (over = {}) => ({
  status: 'watching',
  user_rating: 8,
  last_watched_at: '2026-10-10T20:00:00Z',
  added_to_watchlist_at: '2026-01-01T00:00:00Z',
  watched_episodes_count: 16,
  total_episodes_count: 30,
  not_aired_episodes_count: 4,
  next_to_watch: 'S02E04',
  show: { title: 'The Boys', year: 2019, poster: '74/abc', runtime: 60, ids: { simkl: 967226, slug: 'the-boys' } },
  ...over,
});

test('all-items entries become local rows, with episodes when sent', () => {
  const { items, episodes } = parseAllItems({
    shows: [
      showEntry({
        seasons: [{ number: 1, episodes: [{ number: 1, watched_at: '2026-01-02T00:00:00Z' }, { number: 2 }] }],
      }),
    ],
    movies: [{ status: 'completed', user_rating: null, movie: { title: 'Dune', year: 2021, ids: { simkl: 1 } } }],
    anime: [{ status: 'notinteresting', show: { title: 'Old', ids: { simkl: 2 } } }],
  });
  assert.equal(items.length, 3);
  const boys = items.find((i) => i.simklId === 967226);
  assert.equal(boys.type, 'show');
  assert.equal(boys.rating, 8);
  assert.equal(boys.slug, 'the-boys');
  assert.deepEqual(episodes.get(967226).map((e) => [e.season, e.episode]), [[1, 1], [1, 2]]);
  assert.equal(items.find((i) => i.simklId === 2).status, 'dropped', 'old clients see notinteresting');
  assert.equal(items.find((i) => i.simklId === 1).rating, null);
  assert.equal(episodes.has(1), false, 'no seasons array = episodes unknown, not empty');
});

test('broken entries are skipped instead of crashing', () => {
  const { items } = parseAllItems({ shows: [{ status: 'watching' }, { status: 'weird', show: { ids: { simkl: 3 } } }, null] });
  assert.equal(items.length, 0);
  assert.deepEqual([...parseIds({ movies: [{ movie: { ids: { simkl: 5 } } }], shows: 'nope' })], [5]);
});

test('sync plan: full first, nothing when unchanged, delta with removals and ratings', () => {
  const a = { all: 'T1', tv_shows: { removed_from_list: 'R1', rated_at: 'X1' }, movies: {}, anime: {} };
  assert.deepEqual(planSync(null, a), { kind: 'full' });
  assert.deepEqual(planSync(a, { ...a }), { kind: 'nothing' });
  const b = { ...a, all: 'T2', tv_shows: { removed_from_list: 'R2', rated_at: 'X1' } };
  assert.deepEqual(planSync(a, b), { kind: 'delta', dateFrom: 'T1', removals: true, ratings: false });
  const c = { ...a, all: 'T3', movies: { rated_at: 'Y' } };
  assert.deepEqual(planSync(a, c), { kind: 'delta', dateFrom: 'T1', removals: false, ratings: true });
});

test('sync at most every 15 minutes unless pulled', () => {
  const now = 1_000_000_000;
  assert.equal(shouldSync(null, now, false), true);
  assert.equal(shouldSync(now - 5 * 60_000, now, false), false);
  assert.equal(shouldSync(now - 16 * 60_000, now, false), true);
  assert.equal(shouldSync(now - 60_000, now, true), true, 'pull-to-refresh');
  assert.equal(shouldSync(now - 2000, now, true), false, 'not twice in a row');
});

test('backoff doubles, caps at 60 s and honours Retry-After', () => {
  assert.equal(backoffMs(0, null), 1000);
  assert.equal(backoffMs(3, null), 8000);
  assert.equal(backoffMs(10, null), 60_000);
  assert.equal(backoffMs(0, '7'), 7000);
});

test('links and posters', () => {
  assert.equal(simklUrl('show', 967226, 'the-boys'), 'https://simkl.com/tv/967226/the-boys');
  assert.equal(simklUrl('movie', 53536, null), 'https://simkl.com/movies/53536/');
  assert.equal(simklUrl('anime', 38636, 'one-piece'), 'https://simkl.com/anime/38636/one-piece');
  assert.equal(posterUrl('74/abc'), 'https://wsrv.nl/?url=https://simkl.in/posters/74/abc_ca.webp&q=90');
  assert.match(posterUrl(null), /poster_no_pic/);
});

test('movies have only three statuses', () => {
  assert.deepEqual(statusesFor('movie'), ['plantowatch', 'completed', 'dropped']);
  assert.equal(statusesFor('anime').length, 5);
});

test('episode codes and lists', () => {
  assert.deepEqual(parseEpisodeCode('S02E04'), { season: 2, episode: 4 });
  assert.deepEqual(parseEpisodeCode('E12'), { season: 1, episode: 12 });
  assert.equal(parseEpisodeCode('soon'), null);
  const eps = parseEpisodes(
    [
      { season: 2, episode: 1, title: 'B', aired: true },
      { type: 'special', episode: 1, title: 'Sp' },
      { season: 1, episode: 2, aired: false },
      { season: 1, episode: 1 },
    ],
    'show'
  );
  assert.deepEqual(eps.map((e) => [e.season, e.episode]), [[1, 1], [1, 2], [2, 1], [0, 1]]);
  assert.deepEqual(groupBySeason(eps).map((g) => g.label), ['Season 1', 'Season 2', 'Specials']);
  const anime = parseEpisodes([{ episode: 1 }, { episode: 2 }], 'anime');
  assert.deepEqual(groupBySeason(anime).map((g) => g.label), ['Episodes']);
});

test('Up Next hides caught-up shows and movies', () => {
  const { items } = parseAllItems({
    shows: [
      showEntry(),
      showEntry({ next_to_watch: null, show: { title: 'Done', ids: { simkl: 9 } } }),
      showEntry({ status: 'hold', show: { title: 'Paused', ids: { simkl: 10 } } }),
    ],
  });
  assert.deepEqual(upNext(items).map((i) => i.title), ['The Boys']);
});

test('sorting and stats', () => {
  const { items } = parseAllItems({
    shows: [showEntry()],
    movies: [
      { status: 'completed', user_rating: 6, movie: { title: 'Arrival', year: 2016, runtime: 116, ids: { simkl: 1 } } },
      { status: 'plantowatch', movie: { title: 'Zodiac', year: 2007, runtime: 157, ids: { simkl: 2 } } },
    ],
  });
  assert.deepEqual(sortItems(items, 'title').map((i) => i.title), ['Arrival', 'The Boys', 'Zodiac']);
  assert.deepEqual(sortItems(items, 'mine').map((i) => i.title), ['The Boys', 'Arrival', 'Zodiac'], 'unrated last');
  const s = statsFor(items);
  assert.equal(s.total, 3);
  assert.equal(s.averageRating, 7);
  assert.equal(s.episodesWatched, 16);
  assert.equal(s.minutesWatched, 116 + 60 * 16, 'plan-to-watch movies do not count');
});

test('catalog rows and the personal calendar', () => {
  const rows = parseCatalog(
    [
      { title: 'The Boys', date: '2026-10-20T01:00:00Z', ids: { simkl_id: 967226, slug: 'the-boys' }, episode: { season: 5, episode: 2 } },
      { title: 'Other', date: '2026-10-19T01:00:00Z', ids: { simkl_id: 5 } },
      { title: 'Old', date: '2026-01-01T00:00:00Z', ids: { simkl_id: 967226 } },
      { title: 'no id' },
    ],
    'show'
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].episodeLabel, 'S05E02');
  const mine = myCalendar(rows, new Set([967226]), Date.parse('2026-10-17T00:00:00Z'));
  assert.deepEqual(mine.map((r) => r.title), ['The Boys']);
});

test('community ratings for the whole library', () => {
  const m = parseCommunityRatings([
    { id: 1, type: 'movie', rank: 120, simkl: { rating: 7.1, votes: 151 }, imdb: { rating: 6.6, votes: 15119 } },
    { id: 2, type: 'anime', simkl: { rating: 7 }, mal: { rating: 7.6, votes: 4132, rank: 1693 } },
    { type: 'tv' },
  ]);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get(1), { simklRating: 7.1, simklVotes: 151, imdbRating: 6.6, imdbVotes: 15119, malRating: null, rank: 120 });
  assert.equal(m.get(2).malRating, 7.6);
  assert.equal(m.get(2).imdbRating, null);
});

test('next episode info is kept from the sync', () => {
  const { items } = parseAllItems({
    shows: [showEntry({ next_to_watch_info: { title: 'Pilot two', season: 2, episode: 4, date: '2026-10-01T01:00:00Z' } })],
  });
  assert.equal(items[0].nextTitle, 'Pilot two');
  assert.equal(items[0].nextDate, '2026-10-01T01:00:00Z');
});

test('Simkl-style tabs: Aired puts something-to-watch first, rank and IMDb sort with gaps last', () => {
  assert.deepEqual(sortsFor('movie').map((s) => s.key).slice(0, 3), ['seen', 'added', 'year']);
  assert.equal(sortsFor('show')[0].key, 'aired');
  const { items } = parseAllItems({
    shows: [
      showEntry({ next_to_watch: null, show: { title: 'Done', ids: { simkl: 1 } } }),
      showEntry({ next_to_watch_info: { date: '2026-10-01T00:00:00Z' }, show: { title: 'Older', ids: { simkl: 2 } } }),
      showEntry({ next_to_watch_info: { date: '2026-10-15T00:00:00Z' }, show: { title: 'Newer', ids: { simkl: 3 } } }),
    ],
  });
  assert.deepEqual(sortItems(items, 'aired').map((i) => i.title), ['Newer', 'Older', 'Done']);
  const ranked = items.map((i, n) => ({ ...i, rank: n === 0 ? null : n * 10, imdbRating: n === 2 ? 9 : n === 1 ? 7 : null }));
  assert.deepEqual(sortItems(ranked, 'rank').map((i) => i.title), ['Older', 'Newer', 'Done']);
  assert.deepEqual(sortItems(ranked, 'imdb').map((i) => i.title), ['Newer', 'Older', 'Done']);
});

test('episodes left, votes and countdowns', () => {
  const { items } = parseAllItems({ shows: [showEntry()] });
  assert.equal(episodesLeft(items[0]), 30 - 4 - 16);
  assert.equal(fmtVotes(476419), '476K');
  assert.equal(fmtVotes(2287000), '2.3M');
  assert.equal(fmtVotes(57), '57');
  const now = Date.parse('2026-10-17T10:00:00Z');
  assert.equal(countdown('2026-10-17T10:35:00Z', now), 'in 35 min');
  assert.equal(countdown('2026-10-19T14:00:00Z', now), 'in 2 d 4 h');
  assert.equal(countdown('2026-10-16T10:00:00Z', now), 'aired');
  assert.equal(countdown(null, now), null);
});

test('trailers and related titles from a detail record', () => {
  assert.equal(trailerUrl([{ name: 'x' }, { youtube: 'KPLWWIOCOOQ' }]), 'https://www.youtube.com/watch?v=KPLWWIOCOOQ');
  assert.equal(trailerUrl(null), null);
  const rel = parseRelated([{ title: 'Breaking Bad', type: 'tv', ids: { simkl: 11121, slug: 'breaking-bad' } }, { title: 'x' }], 'show');
  assert.deepEqual(rel.map((r) => [r.simklId, r.type]), [[11121, 'show']]);
});

test('viewing heatmap and streaks', () => {
  const now = new Date(2026, 9, 17, 20).getTime(); // a Saturday
  const at = (d) => new Date(2026, 9, d, 21).toISOString();
  const h = watchHeatmap([at(17), at(16), at(16), at(15), at(10), null, 'nonsense'], now, 4);
  assert.equal(h.columns.length, 4);
  assert.ok(h.columns.every((c) => c.length === 7));
  assert.equal(h.current, 3, '15th, 16th and 17th');
  assert.equal(h.longest, 3);
  assert.equal(h.max, 2);
  const last = h.columns[3];
  assert.equal(last[6].future, true, 'Sunday has not happened yet');
});

test('CSV export escapes commas and quotes', () => {
  const { items } = parseAllItems({ movies: [{ status: 'completed', movie: { title: 'Hello, "World"', year: 2020, ids: { simkl: 7 } } }] });
  const csv = libraryCsv(items).split('\n');
  assert.equal(csv.length, 2);
  assert.ok(csv[1].startsWith('movie,"Hello, ""World""",2020,completed'));
});

test('home: the week ahead and what is new this week', () => {
  const now = new Date(2026, 9, 19, 12).getTime();
  const iso = (d, h = 20) => new Date(2026, 9, d, h).toISOString();
  const item = (id, over = {}) => ({ simklId: id, type: 'show', title: `T${id}`, year: null, poster: null, slug: null, runtime: null, status: 'watching', rating: null, ratedAt: null, addedAt: null, lastWatchedAt: null, watchedEpisodes: 0, totalEpisodes: 0, notAiredEpisodes: 0, nextToWatch: null, animeType: null, memo: null, nextTitle: null, nextDate: null, simklRating: null, simklVotes: null, imdbRating: null, imdbVotes: null, malRating: null, rank: null, ...over });
  const items = [
    item(1, { nextToWatch: 'S01E05', nextDate: iso(16) }),
    item(2, { status: 'completed' }),
    item(3, { nextToWatch: 'S02E01', nextDate: iso(1) }),
    item(4, { type: 'movie', status: 'plantowatch' }),
  ];
  const follow = followedIds(items);
  assert.deepEqual([...follow].sort(), [1, 3, 4]);
  const row = (id, d, label = null) => ({ simklId: id, type: 'show', title: `T${id}`, year: null, poster: null, slug: null, date: iso(d), episodeLabel: label });
  const rows = [row(1, 21, 'S01E07'), row(2, 21), row(3, 19, 'S02E02'), row(4, 18), row(3, 30)];
  const week = weekAhead(rows, follow, now);
  assert.equal(week.length, 7);
  assert.deepEqual(week[0].rows.map((r) => r.simklId), [3]);
  assert.deepEqual(week[2].rows.map((r) => r.simklId), [1]);
  // Followed only, and only the next seven days.
  assert.equal(week.flatMap((d) => d.rows).length, 2);
  const fresh = newThisWeek(items, rows, follow, now);
  // Show 1's unwatched episode from Friday, the movie released yesterday; show 3's episode is from weeks ago.
  assert.deepEqual(fresh.map((x) => [x.simklId, x.label]), [[4, null], [1, 'S01E05']]);
});
