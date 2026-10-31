/**
 * Everything the Audio Wrapped tells, for one range (usually a year): your
 * time and sittings, the top five with their story, the day-by-day calendar,
 * month by month, when you listen (clock, part of the day, weekday), your
 * longest sitting and streak, your author, the voice you heard most, genres,
 * books vs other audio, what you started and finished, your ratings, the
 * range before for "then vs now", what the time adds up to, badges, quizzes
 * and the kind of listener you are. Pure (tested in tests/audio-wrapped.test.mjs).
 */

import type { AudioItem, AudioPlay } from './audioLogic.ts';

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export type ListenerType = { key: 'night' | 'marathon' | 'commuter' | 'finisher' | 'collector' | 'devoted' | 'steady'; name: string; line: string };
export type AudioBadge = { key: string; name: string; line: string; icon: 'moon' | 'sun' | 'fire' | 'trophy' | 'target' | 'sparkle' | 'star' | 'calendar' | 'headphones' | 'heart' | 'book' | 'medal' };
export type AudioQuiz = { key: string; question: string; options: string[]; answer: number };

export type AudioWrappedData = {
  ms: number;
  days: number;
  sessions: number;
  averageSessionMs: number;
  top: { id: string; ms: number; share: number; sessions: number; firstAt: number; lastAt: number; bestDay: { day: number; ms: number } | null }[];
  calendar: { day: number; v: number }[];
  months: number[];
  hours: number[];
  peakHour: number | null;
  partOfDay: 'morning' | 'afternoon' | 'evening' | 'night' | null;
  nightShare: number;
  weekday: { day: number; ms: number } | null;
  longest: { id: string; ms: number; at: number } | null;
  streak: number;
  biggestDay: { day: number; ms: number } | null;
  author: { name: string; ms: number; titles: number } | null;
  narrator: { name: string; ms: number; titles: number } | null;
  genres: { name: string; ms: number }[];
  /** Audiobooks vs other audio (by time). */
  books: { ms: number; share: number };
  started: string[];
  finished: string[];
  ratings: { average: number | null; histogram: number[]; rated: number };
  prev: { ms: number; days: number; titles: number };
  titles: number;
  /** What it adds up to. */
  adds: { films: number; walkKm: number; fullDays: number; booksOf10h: number };
  badges: AudioBadge[];
  quizzes: AudioQuiz[];
  type: ListenerType;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function inRange(plays: AudioPlay[], ids: Set<string>, start: number, end: number) {
  return plays.filter((p) => ids.has(p.itemId) && p.startedAt >= start && p.startedAt < end && p.listenedMs > 0);
}

/** `prevStart`: where the period before begins (1 January last year); compared over the same length of time as this one so far. */
export function audioWrapped(items: AudioItem[], plays: AudioPlay[], start: number, end: number, now: number, prevStart?: number): AudioWrappedData {
  const live = items.filter((i) => !i.deletedAt);
  const byId = new Map(live.map((i) => [i.id, i]));
  const ids = new Set(byId.keys());
  const ps = inRange(plays, ids, start, end).sort((a, b) => a.startedAt - b.startedAt);
  const ms = ps.reduce((a, p) => a + p.listenedMs, 0);

  const per = new Map<string, { ms: number; sessions: number; firstAt: number; lastAt: number; days: Map<number, number> }>();
  const dayMs = new Map<number, number>();
  const hours = Array.from({ length: 24 }, () => 0);
  const months = Array.from({ length: 12 }, () => 0);
  const wd = Array.from({ length: 7 }, () => 0);
  for (const p of ps) {
    const v = per.get(p.itemId) ?? { ms: 0, sessions: 0, firstAt: p.startedAt, lastAt: p.startedAt, days: new Map<number, number>() };
    v.ms += p.listenedMs;
    v.sessions++;
    v.lastAt = Math.max(v.lastAt, p.startedAt);
    v.days.set(sod(p.startedAt), (v.days.get(sod(p.startedAt)) ?? 0) + p.listenedMs);
    per.set(p.itemId, v);
    dayMs.set(sod(p.startedAt), (dayMs.get(sod(p.startedAt)) ?? 0) + p.listenedMs);
    const d = new Date(p.startedAt);
    hours[d.getHours()] += p.listenedMs;
    months[d.getMonth()] += p.listenedMs;
    wd[(d.getDay() + 6) % 7] += p.listenedMs;
  }
  const top = [...per.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 5)
    .map(([id, v]) => {
      const best = [...v.days.entries()].sort((a, b) => b[1] - a[1])[0];
      return { id, ms: v.ms, share: ms ? v.ms / ms : 0, sessions: v.sessions, firstAt: v.firstAt, lastAt: v.lastAt, bestDay: best ? { day: best[0], ms: best[1] } : null };
    });

  const calendar: { day: number; v: number }[] = [];
  const last = Math.min(end, now + 1);
  for (let d = sod(start); d < last && calendar.length < 370; d = sod(d + DAY + 3 * 3_600_000)) calendar.push({ day: d, v: dayMs.get(d) ?? 0 });

  const total = hours.reduce((a, b) => a + b, 0);
  const sum = (a: number, b: number) => hours.slice(a, b).reduce((x, y) => x + y, 0);
  const parts = { morning: sum(5, 12), afternoon: sum(12, 17), evening: sum(17, 22), night: sum(22, 24) + sum(0, 5) };
  const partOfDay = total ? (Object.entries(parts).sort((a, b) => b[1] - a[1])[0][0] as AudioWrappedData['partOfDay']) : null;
  // The peak hour is taken inside your part of the day, so the two never disagree.
  const range = partOfDay === 'morning' ? [5, 6, 7, 8, 9, 10, 11] : partOfDay === 'afternoon' ? [12, 13, 14, 15, 16] : partOfDay === 'evening' ? [17, 18, 19, 20, 21] : [22, 23, 0, 1, 2, 3, 4];
  const peakHour = total ? range.reduce((b, h) => (hours[h] > hours[b] ? h : b), range[0]) : null;
  const bestWd = wd.map((v, day) => ({ day, ms: v })).sort((a, b) => b.ms - a.ms)[0];
  const weekday = bestWd && bestWd.ms > 0 ? bestWd : null;

  const longP = ps.reduce<AudioPlay | null>((b, p) => (!b || p.listenedMs > b.listenedMs ? p : b), null);
  const longest = longP ? { id: longP.itemId, ms: longP.listenedMs, at: longP.startedAt } : null;

  const daysSorted = [...dayMs.keys()].sort((a, b) => a - b);
  let streak = 0;
  let run = 0;
  for (let n = 0; n < daysSorted.length; n++) {
    run = n && daysSorted[n] - daysSorted[n - 1] <= DAY + 7_200_000 ? run + 1 : 1;
    streak = Math.max(streak, run);
  }
  const bd = [...dayMs.entries()].sort((a, b) => b[1] - a[1])[0];
  const biggestDay = bd ? { day: bd[0], ms: bd[1] } : null;

  const group = (key: (i: AudioItem) => string | null) => {
    const m = new Map<string, { name: string; ms: number; titles: Set<string> }>();
    for (const [id, v] of per) {
      const name = key(byId.get(id)!)?.trim();
      if (!name) continue;
      const k = name.toLowerCase();
      const cur = m.get(k) ?? { name, ms: 0, titles: new Set<string>() };
      cur.ms += v.ms;
      cur.titles.add(id);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.ms - a.ms).map((x) => ({ name: x.name, ms: x.ms, titles: x.titles.size }));
  };
  const author = group((i) => i.author)[0] ?? null;
  const narr = group((i) => i.narrator)[0] ?? null;
  const narrator = narr && narr.name.toLowerCase() !== author?.name.toLowerCase() ? narr : null;
  const genres = group((i) => i.genre)
    .slice(0, 3)
    .map((g) => ({ name: g.name, ms: g.ms }));
  const bookMs = [...per.entries()].filter(([id]) => byId.get(id)!.kind === 'book').reduce((a, [, v]) => a + v.ms, 0);
  const books = { ms: bookMs, share: ms ? bookMs / ms : 0 };

  const firstEver = new Map<string, number>();
  for (const p of plays) if (p.listenedMs > 0) firstEver.set(p.itemId, Math.min(firstEver.get(p.itemId) ?? Infinity, p.startedAt));
  const started = [...per.keys()].filter((id) => (firstEver.get(id) ?? 0) >= start);
  const finished = live.filter((i) => i.finishedAt && i.finishedAt >= start && i.finishedAt < end).map((i) => i.id);

  const rated = [...per.keys()].map((id) => byId.get(id)!).filter((i) => i.rating > 0);
  const histogram = Array.from({ length: 10 }, () => 0);
  for (const i of rated) histogram[Math.min(9, Math.max(0, Math.round(i.rating) - 1))]++;
  const ratings = { average: rated.length ? Math.round((rated.reduce((a, i) => a + i.rating, 0) / rated.length) * 10) / 10 : null, histogram, rated: rated.length };

  const len = Math.min(end, now + 1) - start;
  const from = prevStart ?? start - len;
  const pp = inRange(plays, ids, from, Math.min(start, from + len));
  const prev = { ms: pp.reduce((a, p) => a + p.listenedMs, 0), days: new Set(pp.map((p) => sod(p.startedAt))).size, titles: new Set(pp.map((p) => p.itemId)).size };

  const hoursL = ms / 3_600_000;
  const adds = { films: Math.round((hoursL / 2) * 10) / 10, walkKm: Math.round(hoursL * 5), fullDays: Math.round((ms / DAY) * 10) / 10, booksOf10h: Math.round((hoursL / 10) * 10) / 10 };

  const nightShare = total ? parts.night / total : 0;
  const morningShare = total ? parts.morning / total : 0;
  // Commutes: weekday mornings 7-9 and evenings 17-19.
  const commute = ps.filter((p) => {
    const d = new Date(p.startedAt);
    const h = d.getHours();
    return d.getDay() >= 1 && d.getDay() <= 5 && ((h >= 7 && h < 9) || (h >= 17 && h < 19));
  }).reduce((a, p) => a + p.listenedMs, 0);
  const commuteShare = ms ? commute / ms : 0;

  const badges: AudioBadge[] = [];
  const add = (b: AudioBadge, on: boolean) => on && badges.push(b);
  add({ key: 'night', name: 'Night Listener', line: `${Math.round(nightShare * 100)}% after 10 pm`, icon: 'moon' }, nightShare >= 0.3 && nightShare >= morningShare);
  add({ key: 'bird', name: 'Early Bird', line: `${Math.round(morningShare * 100)}% before noon`, icon: 'sun' }, morningShare >= 0.3 && morningShare > nightShare);
  add({ key: 'marathon', name: 'Marathon', line: 'A sitting of 2 hours or more', icon: 'trophy' }, !!longest && longest.ms >= 2 * 3_600_000);
  add({ key: 'streak', name: 'On Repeat', line: `${streak} days in a row`, icon: 'fire' }, streak >= 7);
  add({ key: 'finisher', name: 'Finisher', line: `${finished.length} finished`, icon: 'target' }, finished.length >= 3);
  add({ key: 'explorer', name: 'Explorer', line: `${started.length} new to you`, icon: 'sparkle' }, started.length >= 5);
  add({ key: 'commuter', name: 'Commuter', line: `${Math.round(commuteShare * 100)}% on weekday commutes`, icon: 'headphones' }, commuteShare >= 0.3);
  add({ key: 'loyal', name: 'Devoted', line: 'Half your time on one', icon: 'heart' }, (top[0]?.share ?? 0) >= 0.5 && per.size >= 2);
  add({ key: 'bookworm', name: 'Bookworm', line: `${Math.round(books.share * 100)}% audiobooks`, icon: 'book' }, books.share >= 0.8 && ms >= 3_600_000);
  add({ key: 'critic', name: 'Critic', line: `${rated.length} rated`, icon: 'star' }, rated.length >= 5);

  const type: ListenerType =
    longest && longest.ms >= 2 * 3_600_000
      ? { key: 'marathon', name: 'The Marathon Listener', line: 'Hours at a time, without pressing pause.' }
      : nightShare >= 0.4
        ? { key: 'night', name: 'The Night Listener', line: 'Stories in the dark, the best kind.' }
        : commuteShare >= 0.35
          ? { key: 'commuter', name: 'The Commuter', line: 'Every trip is a chapter.' }
          : (top[0]?.share ?? 0) >= 0.5 && per.size >= 2
            ? { key: 'devoted', name: 'The Devoted', line: 'One story had your ears.' }
            : finished.length >= 3
              ? { key: 'finisher', name: 'The Finisher', line: 'You hear things to the last word.' }
              : started.length >= 5
                ? { key: 'collector', name: 'The Collector', line: 'Always something new in your ears.' }
                : { key: 'steady', name: 'The Steady Listener', line: 'A little every day adds up.' };

  // A badge that only repeats your listener type is left out; six at most.
  const SAME: Record<string, string> = { night: 'night', marathon: 'marathon', commuter: 'commuter', devoted: 'loyal', finisher: 'finisher', collector: 'explorer' };
  const shown = badges.filter((b) => b.key !== SAME[type.key]).slice(0, 6);

  const quizzes: AudioQuiz[] = [];
  if (hoursL >= 2) {
    const real = Math.round(hoursL);
    const opts = [...new Set([real, Math.max(1, Math.round(real * 0.45)), Math.round(real * 1.7), Math.round(real * 2.6)])];
    while (opts.length < 4) opts.push(opts[opts.length - 1] + 3);
    const order = opts.sort((a, b) => a - b);
    quizzes.push({ key: 'hours', question: 'How many hours did you listen?', options: order.map((n) => `${n} h`), answer: order.indexOf(real) });
  }
  const ranked = months.map((v, i) => ({ i, v })).filter((m) => m.v > 0).sort((a, b) => b.v - a.v);
  if (calendar.length > 62 && ranked.length >= 3) {
    const opts = ranked.slice(0, 4).map((m) => m.i).sort((a, b) => a - b);
    quizzes.push({ key: 'month', question: 'Which month did you listen the most?', options: opts.map((m) => MONTHS[m]), answer: opts.indexOf(ranked[0].i) });
  }

  return {
    ms,
    days: dayMs.size,
    sessions: ps.length,
    averageSessionMs: ps.length ? ms / ps.length : 0,
    top,
    calendar,
    months,
    hours,
    peakHour,
    partOfDay,
    nightShare,
    weekday,
    longest,
    streak,
    biggestDay,
    author,
    narrator,
    genres,
    books,
    started,
    finished,
    ratings,
    prev,
    titles: per.size,
    adds,
    badges: shown,
    quizzes,
    type,
  };
}
