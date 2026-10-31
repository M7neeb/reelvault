/**
 * Everything the reading Wrapped tells, for one range (a week, a month, a
 * year): the basics come from readingIn and wrappedMore (mangaInsights.ts);
 * this adds the story of each top title (when you met it, your binge day with
 * it, its share of your time), a calendar of every day, the year month by
 * month, your ratings, a hidden gem, the ones you dropped, the cliffhangers
 * still waiting, your first and last chapter, how your pages turn (right to
 * left, a long strip...), your speed, what the time and pages add up to, the
 * badges you earned and three quizzes. Pure (tested in
 * tests/manga-wrapped-story.test.mjs).
 */

import { modeOf, type MangaRead, type MangaSeries, type ReadingMode } from './mangaLogic.ts';
import { readingIn, wrappedMore, type ReadingRange, type WrappedMore } from './mangaInsights.ts';

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
/** A chapter finished counts as five minutes where there is no time (backups without time). */
const CHAPTER_MS = 5 * 60_000;

export type TitleStory = {
  id: string;
  ms: number;
  chapters: number;
  /** Its share of your reading in the range (time, else chapters). */
  share: number;
  sessions: number;
  /** The first and last time you read it in the range. */
  firstAt: number | null;
  lastAt: number | null;
  /** The day you read the most chapters of it. */
  binge: { day: number; chapters: number } | null;
  /** When you first ever read it (before the range too). */
  metAt: number | null;
};

export type Badge = { key: string; name: string; line: string; icon: 'moon' | 'sun' | 'fire' | 'trophy' | 'target' | 'sparkle' | 'star' | 'calendar' | 'fast' | 'heart' | 'book' | 'medal' };

export type Quiz = { key: string; question: string; options: string[]; answer: number };

export type WrappedStoryData = {
  y: ReadingRange;
  w: WrappedMore;
  /** Your top titles with their story (up to 5). */
  titles: TitleStory[];
  /** Every day of the range, oldest first, with how much you read (0 = nothing). */
  calendar: { day: number; v: number }[];
  /** Twelve months (a year only), time or chapters. */
  months: { ms: number; chapters: number }[];
  sessions: { count: number; averageMs: number };
  ratings: { histogram: number[]; average: number | null; rated: number; harshest: { id: string; rating: number } | null };
  gem: { id: string; rating: number; chapters: number } | null;
  dropped: string[];
  /** Titles you are reading with chapters still unread. */
  waiting: { chapters: number; titles: number; most: { id: string; unread: number } | null };
  firstChapter: { seriesId: string; chapterId: string; at: number } | null;
  lastChapter: { seriesId: string; chapterId: string; at: number } | null;
  /** How your pages turned, by chapters. */
  directions: { mode: ReadingMode; chapters: number; share: number }[];
  /** Seconds per page, from the reading done in ReelVault (null when too little). */
  secondsPerPage: number | null;
  /** What it adds up to. */
  adds: { movies: number; fullDays: number; stackCm: number; stripKm: number };
  /** The share of the days in the range you read on. */
  dayShare: number;
  weekendShare: number;
  badges: Badge[];
  quizzes: Quiz[];
};

export const MODE_LABEL: Record<ReadingMode, string> = { rtl: 'Right to left', ltr: 'Left to right', vertical: 'Page by page, down', webtoon: 'Long strip' };

/** `prevStart`: where the period before begins (see wrappedMore). */
export function wrappedStory(series: MangaSeries[], reads: MangaRead[], start: number, end: number, now: number, prevStart?: number): WrappedStoryData {
  const y = readingIn(series, reads, start, end);
  const w = wrappedMore(series, reads, start, end, prevStart);
  const live = series.filter((s) => !s.deletedAt);
  const byId = new Map(live.map((s) => [s.id, s]));
  const inside = (t: number | null | undefined) => typeof t === 'number' && t >= start && t < end;
  const rsAll = reads.filter((r) => inside(r.startedAt) && r.readMs > 0 && (byId.has(r.seriesId) || r.seriesId.startsWith('other:')));
  const rs = rsAll.filter((r) => byId.has(r.seriesId));

  // Chapters finished in the range, per title and per day.
  const done = live.flatMap((s) => s.chapters.filter((c) => inside(c.readAt)).map((c) => ({ s, c, at: c.readAt! })));
  done.sort((a, b) => a.at - b.at);

  // Lookups built once: reads by title, chapters finished in the range by title, first read ever.
  const readsBy = new Map<string, MangaRead[]>();
  for (const r of rs) readsBy.set(r.seriesId, [...(readsBy.get(r.seriesId) ?? []), r]);
  const doneBy = new Map<string, typeof done>();
  for (const d of done) doneBy.set(d.s.id, [...(doneBy.get(d.s.id) ?? []), d]);
  const firstBy = new Map<string, number>();
  for (const r of reads) if (r.readMs > 0) firstBy.set(r.seriesId, Math.min(firstBy.get(r.seriesId) ?? Infinity, r.startedAt));

  // The story of each top title. Time, or chapters as five minutes each where no time was kept.
  const weight = (ms: number, chapters: number) => Math.max(ms, chapters * CHAPTER_MS);
  const totalWeight = Math.max(y.ms, y.chapters * CHAPTER_MS) || 1;
  const titles: TitleStory[] = y.top
    .map((t) => {
      const s = byId.get(t.id);
      if (!s) return null;
      const mine = readsBy.get(t.id) ?? [];
      const chs = doneBy.get(t.id) ?? [];
      const times = [...mine.map((r) => r.startedAt), ...chs.map((d) => d.at)];
      const perDay = new Map<number, number>();
      for (const d of chs) perDay.set(sod(d.at), (perDay.get(sod(d.at)) ?? 0) + 1);
      const best = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
      const met = s.chapters.reduce((m, c) => (c.readAt && c.readAt < m ? c.readAt : m), firstBy.get(s.id) ?? Infinity);
      return {
        id: t.id,
        ms: t.ms,
        chapters: t.chapters,
        share: Math.min(1, weight(t.ms, t.chapters) / totalWeight),
        sessions: mine.length,
        firstAt: times.length ? Math.min(...times) : null,
        lastAt: times.length ? Math.max(...times) : null,
        binge: best && best[1] > 1 ? { day: best[0], chapters: best[1] } : null,
        metAt: Number.isFinite(met) ? met : null,
      };
    })
    .filter((x): x is TitleStory => !!x);

  // Every day of the range (up to a year), time plus chapters as time.
  const last = Math.min(end, now + 1);
  const dayVal = new Map<number, number>();
  for (const r of rsAll) dayVal.set(sod(r.startedAt), (dayVal.get(sod(r.startedAt)) ?? 0) + r.readMs);
  // A day with chapters but no time recorded (from a backup) still lights up.
  for (const d of done) if (!y.ms || !dayVal.has(sod(d.at))) dayVal.set(sod(d.at), (dayVal.get(sod(d.at)) ?? 0) + CHAPTER_MS);
  const calendar: { day: number; v: number }[] = [];
  for (let d = sod(start); d < last && calendar.length < 370; d = sod(d + DAY + 3_600_000 * 3)) calendar.push({ day: d, v: dayVal.get(d) ?? 0 });
  const daysInRange = Math.max(1, calendar.length);
  const readDays = calendar.filter((c) => c.v > 0).length;
  const weekendDays = calendar.filter((c) => c.v > 0 && [0, 6].includes(new Date(c.day).getDay())).length;

  const months = Array.from({ length: 12 }, () => ({ ms: 0, chapters: 0 }));
  for (const r of rsAll) months[new Date(r.startedAt).getMonth()].ms += r.readMs;
  for (const d of done) months[new Date(d.at).getMonth()].chapters++;

  const sessionsCount = rsAll.length;
  const sessions = { count: sessionsCount, averageMs: sessionsCount ? y.ms / sessionsCount : 0 };

  // Titles read in the range.
  const readIds = new Set([...done.map((d) => d.s.id), ...rs.map((r) => r.seriesId)]);
  const readList = live.filter((s) => readIds.has(s.id));
  const rated = readList.filter((s) => s.rating > 0);
  const histogram = Array.from({ length: 10 }, () => 0);
  for (const s of rated) histogram[Math.min(9, Math.max(0, Math.round(s.rating) - 1))]++;
  const average = rated.length ? Math.round((rated.reduce((a, s) => a + s.rating, 0) / rated.length) * 10) / 10 : null;
  const low = [...rated].sort((a, b) => a.rating - b.rating)[0];
  const ratings = { histogram, average, rated: rated.length, harshest: low && rated.length >= 3 && low.rating < (average ?? 0) ? { id: low.id, rating: low.rating } : null };

  const topIds = new Set(titles.map((t) => t.id));
  const chaptersOf = (id: string) => doneBy.get(id)?.length ?? 0;
  // A gem: rated highly after only a few chapters (1 to 10), not already in your top five.
  const gemPick = rated
    .filter((s) => s.rating >= 8 && !topIds.has(s.id) && chaptersOf(s.id) >= 1 && chaptersOf(s.id) <= 10)
    .sort((a, b) => b.rating - a.rating || chaptersOf(a.id) - chaptersOf(b.id))[0];
  const gem = gemPick ? { id: gemPick.id, rating: gemPick.rating, chapters: chaptersOf(gemPick.id) } : null;

  const dropped = readList.filter((s) => s.status === 'dropped').map((s) => s.id);

  const reading = readList.filter((s) => s.status === 'reading' || s.status === null);
  // Chapters waiting: unread ones after the furthest you read (not the ones before where you started).
  const unreadOf = (s: MangaSeries) => {
    const hi = s.chapters.reduce((m, c) => (c.readAt && c.number !== null && c.number > m ? c.number : m), -Infinity);
    const lastIdx = s.chapters.reduce((m, c, i) => (c.readAt ? i : m), -1);
    return s.chapters.filter((c, i) => !c.readAt && (c.number !== null && Number.isFinite(hi) ? c.number > hi : i > lastIdx)).length;
  };
  const waitingList = reading.map((s) => ({ id: s.id, unread: unreadOf(s) })).filter((x) => x.unread > 0).sort((a, b) => b.unread - a.unread);
  const waiting = { chapters: waitingList.reduce((a, x) => a + x.unread, 0), titles: waitingList.length, most: waitingList[0] ?? null };

  const firstChapter = done[0] ? { seriesId: done[0].s.id, chapterId: done[0].c.id, at: done[0].at } : null;
  const lastD = done[done.length - 1];
  const lastChapter = lastD && done.length > 1 ? { seriesId: lastD.s.id, chapterId: lastD.c.id, at: lastD.at } : null;

  const dir = new Map<ReadingMode, number>();
  for (const d of done) dir.set(modeOf(d.s), (dir.get(modeOf(d.s)) ?? 0) + 1);
  const directions = [...dir.entries()].map(([mode, n]) => ({ mode, chapters: n, share: done.length ? n / done.length : 0 })).sort((a, b) => b.chapters - a.chapters);

  const paged = rsAll.filter((r) => r.pages > 0);
  const pages = paged.reduce((a, r) => a + r.pages, 0);
  const secondsPerPage = pages >= 50 ? Math.round(paged.reduce((a, r) => a + r.readMs, 0) / pages / 100) / 10 : null;

  // Pages: the ones counted, else about 20 a chapter. A sheet of paper is ~0.1 mm; a long-strip
  // page is about one and a half phone screens (~22 cm).
  const pageCount = y.pages || y.chapters * 20;
  const stripPages = directions.find((d) => d.mode === 'webtoon')?.chapters ?? 0;
  const adds = {
    movies: Math.round((y.ms / (2 * 3_600_000)) * 10) / 10,
    fullDays: Math.round((y.ms / DAY) * 10) / 10,
    stackCm: Math.round(pageCount * 0.01 * 10) / 10,
    stripKm: Math.round(stripPages * 20 * 0.22) / 1000,
  };

  const dayShare = readDays / daysInRange;
  const weekendShare = readDays ? weekendDays / readDays : 0;
  const totalHours = y.hours.reduce((a, b) => a + b, 0);
  const morningShare = totalHours ? y.hours.slice(5, 12).reduce((a, b) => a + b, 0) / totalHours : 0;
  const genresAll = new Set(readList.flatMap((s) => s.tags));

  const badges: Badge[] = [];
  const add = (b: Badge, on: boolean) => on && badges.push(b);
  add({ key: 'owl', name: 'Night Owl', line: `${Math.round(w.nightShare * 100)}% of your reading after 10 pm`, icon: 'moon' }, w.nightShare >= 0.3 && w.nightShare >= morningShare);
  add({ key: 'bird', name: 'Early Bird', line: `${Math.round(morningShare * 100)}% of your reading before noon`, icon: 'sun' }, morningShare >= 0.3 && morningShare > w.nightShare);
  add({ key: 'marathon', name: 'Marathoner', line: 'A sitting of 2 hours or more', icon: 'trophy' }, !!w.longest && w.longest.ms >= 2 * 3_600_000);
  add({ key: 'streak', name: 'On Fire', line: `${w.streak} days in a row`, icon: 'fire' }, w.streak >= 7);
  add({ key: 'daily', name: 'Every Day', line: `You read on ${Math.round(dayShare * 100)}% of the days`, icon: 'calendar' }, dayShare >= 0.6 && daysInRange >= 7);
  add({ key: 'finisher', name: 'Finisher', line: `${y.completed.length} titles completed`, icon: 'target' }, y.completed.length >= 3);
  add({ key: 'explorer', name: 'Explorer', line: `${y.started.length} new titles`, icon: 'sparkle' }, y.started.length >= 8);
  add({ key: 'loyal', name: 'Loyal', line: 'Half your reading was one story', icon: 'heart' }, (titles[0]?.share ?? 0) >= 0.5 && y.titles >= 2);
  add({ key: 'hopper', name: 'Genre Hopper', line: `${genresAll.size} different genres`, icon: 'book' }, genresAll.size >= 12);
  add({ key: 'critic', name: 'Critic', line: `${rated.length} titles rated`, icon: 'star' }, rated.length >= 8);
  add({ key: 'speed', name: 'Speed Reader', line: `A page every ${secondsPerPage} seconds`, icon: 'fast' }, secondsPerPage !== null && secondsPerPage <= 6);
  add({ key: 'weekend', name: 'Weekend Reader', line: `${Math.round(weekendShare * 100)}% of your reading days were weekends`, icon: 'medal' }, weekendShare >= 0.5 && readDays >= 4);

  // A badge that only repeats your reader type (Night Owl and "The Night Owl") is left out; six at most.
  const SAME: Record<string, string> = { night: 'owl', finisher: 'finisher', binger: 'marathon', devotee: 'loyal', explorer: 'explorer' };
  const shownBadges = badges.filter((b) => b.key !== SAME[w.type.key]).slice(0, 6);
  badges.length = 0;
  badges.push(...shownBadges);

  const quizzes: Quiz[] = [];
  const hours = y.ms / 3_600_000;
  if (hours >= 2) {
    const real = Math.round(hours);
    const decoys = [Math.round(real * 0.45), Math.round(real * 1.7), Math.round(real * 2.6)].map((n, i) => (n === real || n < 1 ? real + (i + 1) * 3 : n));
    const opts = [...new Set([real, ...decoys])].slice(0, 4);
    const order = [...opts].sort((a, b) => a - b);
    quizzes.push({ key: 'hours', question: 'How many hours did you read?', options: order.map((n) => `${n} h`), answer: order.indexOf(real) });
  }
  if (calendar.length > 62) {
    const ranked = months.map((m, i) => ({ i, v: m.ms || m.chapters * CHAPTER_MS })).filter((m) => m.v > 0).sort((a, b) => b.v - a.v);
    if (ranked.length >= 3) {
      const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const opts = [ranked[0].i, ...ranked.slice(1, 4).map((m) => m.i)].sort((a, b) => a - b);
      quizzes.push({ key: 'month', question: 'Which month did you read the most?', options: opts.map((m) => MONTHS[m]), answer: opts.indexOf(ranked[0].i) });
    }
  }
  if (w.partOfDay) {
    const parts = ['Morning', 'Afternoon', 'Evening', 'Night'];
    quizzes.push({ key: 'when', question: 'When do you read the most?', options: parts, answer: ['morning', 'afternoon', 'evening', 'night'].indexOf(w.partOfDay) });
  }

  return { y, w, titles, calendar, months, sessions, ratings, gem, dropped, waiting, firstChapter, lastChapter, directions, secondsPerPage, adds, dayShare, weekendShare, badges, quizzes };
}

/** Which chapter to show pages of for a title: one on the phone first (fast, offline), else the last one you read. */
export function chapterToShow(s: Pick<MangaSeries, 'chapters'>, start: number, end: number): string | null {
  const onPhone = s.chapters.filter((c) => c.folder && c.pages.length > 2);
  const inRange = s.chapters.filter((c) => c.readAt && c.readAt >= start && c.readAt < end);
  const pick = onPhone.find((c) => inRange.includes(c)) ?? onPhone[0] ?? inRange[inRange.length - 1] ?? s.chapters.find((c) => c.readAt) ?? s.chapters[0];
  return pick?.id ?? null;
}
