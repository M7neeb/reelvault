/**
 * The deeper numbers behind Wrapped, the dashboard and badges: what you
 * discovered and came back to, your comfort video and hidden gems, your
 * personal records, your journey, your level, "things we noticed", memories
 * (On this day) and space you could free. Everything is worked out from your
 * own library and plays; nothing leaves the phone. Pure, so it is tested in Node.
 */

import { friendlyName } from './names.ts';

export type RVideo = {
  id: string;
  title: string | null;
  filename: string;
  createdAt: number;
  importedAt: number;
  durationMs: number | null;
  sizeBytes: number;
  rating: number;
  tagNames: string[];
  notes?: string | null;
  flag?: number;
  meta?: { codec?: string } | null;
};

export type RPlay = { videoId: string; startedAt: number; watchedMs: number };
export type RRange = { start: number; end: number; label: string };

const DAY = 86_400_000;
const HOUR = 3_600_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const nameOf = (v: RVideo) => friendlyName(v);
const sum = <T>(l: T[], f: (x: T) => number) => l.reduce((a, x) => a + f(x), 0);

/* ----------------------------------------------------------------- ranges */

/** Months of a year (only up to now), newest first. */
export function monthRanges(now: number, count = 12): RRange[] {
  const d = new Date(now);
  const out: RRange[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
    out.push({ start: start.getTime(), end, label: start.toLocaleDateString(undefined, { month: 'long', year: start.getFullYear() === d.getFullYear() ? undefined : 'numeric' }) });
  }
  return out;
}

export function yearRange(year: number, now: number): RRange {
  const start = new Date(year, 0, 1).getTime();
  const end = Math.min(new Date(year + 1, 0, 1).getTime(), sod(now) + DAY);
  return { start, end, label: String(year) };
}

/* ------------------------------------------------------- the story's facts */

export type Pick5 = { id: string; label: string; ms: number; plays: number; days: number; firstAt: number };

export type Persona = { name: string; blurb: string; icon: string };

export type StoryFacts = {
  range: RRange;
  watchedMs: number;
  plays: number;
  videos: number;
  activeDays: number;
  /** Days in the range (so far). */
  rangeDays: number;
  /** Videos watched for the first time ever, and ones you came back to. */
  firsts: number;
  returns: number;
  top: Pick5[];
  /** Watched before this range and again the most in it. */
  comfort: Pick5 | null;
  /** Morning (5-12), afternoon (12-17), evening (17-22), night (22-5): share of time. */
  dayparts: { key: 'morning' | 'afternoon' | 'evening' | 'night'; label: string; share: number }[];
  favouriteWeekday: number | null;
  biggestDay: { day: number; ms: number; videoId: string | null } | null;
  longest: { videoId: string; ms: number; at: number } | null;
  /** The video filmed longest ago that you watched. */
  throwback: { videoId: string; years: number; createdAt: number } | null;
  /** Average rating of what you watched (rated ones), and the best of them. */
  avgRating: number | null;
  bestRated: { videoId: string; rating: number } | null;
  /** A great video you have not watched in a long time. */
  gem: { videoId: string; rating: number; lastAt: number | null } | null;
  /** How much of a video you watch on average when you press play (0..1). */
  completion: number | null;
  /** Minutes per month (year-long ranges) or per day. */
  timeline: { key: number; label: string; ms: number }[];
  /** Fun comparisons ("That's 3 trips through Titanic"). */
  equivalents: string[];
  traits: string[];
  persona: Persona;
};

const PERSONAS: Record<string, Persona> = {
  owl: { name: 'The Night Owl', blurb: 'When the house goes quiet, your videos come out.', icon: 'moon' },
  rewatcher: { name: 'The Rewatcher', blurb: 'You know what you love, and you love it again and again.', icon: 'rewatch' },
  explorer: { name: 'The Explorer', blurb: 'Always something new. Your library is a map, and you go everywhere.', icon: 'globe' },
  binger: { name: 'The Binger', blurb: 'One more? Always one more. Your big days are really big.', icon: 'hourglass' },
  weekender: { name: 'The Weekend Watcher', blurb: 'Weekdays are for life; weekends are for your videos.', icon: 'calendar' },
  critic: { name: 'The Critic', blurb: 'You watch with opinions, and the stars to back them up.', icon: 'star' },
  sunrise: { name: 'The Early Riser', blurb: 'Coffee, and a video before the day starts.', icon: 'sun' },
  completionist: { name: 'The Finisher', blurb: 'You start it, you finish it. Every time.', icon: 'checkCircle' },
  collector: { name: 'The Collector', blurb: 'You gathered more than you watched. The best is still waiting.', icon: 'videos' },
  regular: { name: 'The Regular', blurb: 'Steady, every few days, like clockwork.', icon: 'film' },
};

/** "Titanic" is 3 h 15 min; a sitcom episode 22 min; a football match 90 min. */
function equivalents(ms: number): string[] {
  const min = ms / 60000;
  if (min < 10) return [];
  const out: string[] = [];
  const times = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  if (min >= 195) out.push(`That's watching Titanic ${times(min / 195)} times over.`);
  if (min >= 22) out.push(`Or ${times(min / 22)} sitcom episodes back to back.`);
  if (min >= 90 && out.length < 2) out.push(`Or ${times(min / 90)} full football matches.`);
  if (min >= 60 * 24) out.push(`More than ${Math.floor(min / (60 * 24))} whole ${Math.floor(min / (60 * 24)) === 1 ? 'day' : 'days'} without a break.`);
  if (!out.length) out.push(`About ${Math.round(min / 3.5)} songs' worth of time.`);
  return out.slice(0, 2);
}

export function storyFacts(range: RRange, videos: RVideo[], plays: RPlay[], now: number): StoryFacts {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const own = plays.filter((p) => byId.has(p.videoId));
  const inR = own.filter((p) => p.startedAt >= range.start && p.startedAt < range.end).sort((a, b) => a.startedAt - b.startedAt);
  const before = new Set(own.filter((p) => p.startedAt < range.start).map((p) => p.videoId));

  const per = new Map<string, { ms: number; plays: number; days: Set<number>; firstAt: number }>();
  const byDay = new Map<number, Map<string, number>>();
  const parts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const weekday = Array(7).fill(0);
  let longest: StoryFacts['longest'] = null;
  for (const p of inR) {
    const s = per.get(p.videoId) ?? { ms: 0, plays: 0, days: new Set<number>(), firstAt: p.startedAt };
    s.ms += p.watchedMs;
    s.plays++;
    s.days.add(sod(p.startedAt));
    per.set(p.videoId, s);
    const day = sod(p.startedAt);
    const dm = byDay.get(day) ?? new Map<string, number>();
    dm.set(p.videoId, (dm.get(p.videoId) ?? 0) + p.watchedMs);
    byDay.set(day, dm);
    const h = new Date(p.startedAt).getHours();
    parts[h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night'] += p.watchedMs;
    weekday[(new Date(p.startedAt).getDay() + 6) % 7] += p.watchedMs;
    if (!longest || p.watchedMs > longest.ms) longest = { videoId: p.videoId, ms: p.watchedMs, at: p.startedAt };
  }
  const watchedMs = sum(inR, (p) => p.watchedMs);
  const pick = (id: string): Pick5 => {
    const s = per.get(id)!;
    return { id, label: nameOf(byId.get(id)!), ms: s.ms, plays: s.plays, days: s.days.size, firstAt: s.firstAt };
  };
  const ranked = [...per.keys()].sort((a, b) => per.get(b)!.ms - per.get(a)!.ms);
  const top = ranked.slice(0, 5).map(pick);
  const comfortId = [...per.keys()].filter((id) => before.has(id)).sort((a, b) => per.get(b)!.plays - per.get(a)!.plays || per.get(b)!.ms - per.get(a)!.ms)[0];

  const days = [...byDay.entries()].map(([day, m]) => ({ day, ms: sum([...m.values()], (x) => x), top: [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }));
  const big = days.sort((a, b) => b.ms - a.ms)[0];

  const watchedVideos = [...per.keys()].map((id) => byId.get(id)!);
  const oldest = [...watchedVideos].sort((a, b) => a.createdAt - b.createdAt)[0];
  const years = oldest ? Math.floor((now - oldest.createdAt) / (365.25 * DAY)) : 0;
  const rated = watchedVideos.filter((v) => v.rating > 0);
  const bestRated = [...rated].sort((a, b) => b.rating - a.rating)[0];

  const lastPlay = new Map<string, number>();
  for (const p of own) lastPlay.set(p.videoId, Math.max(lastPlay.get(p.videoId) ?? 0, p.startedAt));
  const gem = videos
    .filter((v) => v.rating >= 8 && !per.has(v.id) && (lastPlay.get(v.id) ?? 0) < now - 30 * DAY)
    .sort((a, b) => b.rating - a.rating || (lastPlay.get(a.id) ?? 0) - (lastPlay.get(b.id) ?? 0))[0];

  const withLen = inR.filter((p) => (byId.get(p.videoId)!.durationMs ?? 0) > 0);
  const completion = withLen.length ? sum(withLen, (p) => Math.min(1, p.watchedMs / byId.get(p.videoId)!.durationMs!)) / withLen.length : null;

  const rangeDays = Math.max(1, Math.round((Math.min(range.end, sod(now) + DAY) - range.start) / DAY));
  const long = rangeDays > 62;
  const timeline: StoryFacts['timeline'] = [];
  if (long) {
    const s = new Date(range.start);
    for (let m = new Date(s.getFullYear(), s.getMonth(), 1); m.getTime() < range.end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const next = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
      timeline.push({ key: m.getTime(), label: m.toLocaleDateString(undefined, { month: 'narrow' }), ms: sum(inR.filter((p) => p.startedAt >= m.getTime() && p.startedAt < next), (p) => p.watchedMs) });
    }
  } else {
    for (let t = sod(range.start); t < range.end && t <= now; t = sod(t + DAY + HOUR)) {
      timeline.push({ key: t, label: String(new Date(t).getDate()), ms: sum([...(byDay.get(t)?.values() ?? [])], (x) => x) });
    }
  }

  const share = (n: number) => (watchedMs ? n / watchedMs : 0);
  const dayparts = (
    [
      ['morning', 'Morning'],
      ['afternoon', 'Afternoon'],
      ['evening', 'Evening'],
      ['night', 'Night'],
    ] as const
  ).map(([key, label]) => ({ key, label, share: share(parts[key]) }));

  // Traits and the persona: the strongest signals win.
  const weekendShare = share(weekday[5] + weekday[6]);
  const rewatchRatio = per.size ? inR.length / per.size : 0;
  const scores: [string, number][] = [
    ['owl', share(parts.night) * 2.2],
    ['sunrise', share(parts.morning) * 2],
    ['rewatcher', rewatchRatio >= 2 ? rewatchRatio / 2.5 : 0],
    ['explorer', per.size >= 8 ? Math.min(1.4, per.size / 20) + share(watchedMs) * 0 : 0],
    ['binger', big && watchedMs && big.ms >= HOUR ? (big.ms / watchedMs) * (big.ms >= 2 * HOUR ? 2 : 0.8) : 0],
    ['weekender', weekendShare > 0.55 ? weekendShare * 1.4 : 0],
    ['critic', rated.length >= 5 ? (rated.length / Math.max(1, watchedVideos.length)) * 1.2 : 0],
    ['completionist', completion !== null && completion > 0.85 && inR.length >= 5 ? completion * 1.1 : 0],
  ];
  const sorted = scores.filter(([, v]) => v > 0.35).sort((a, b) => b[1] - a[1]);
  const persona = !inR.length ? PERSONAS.collector : PERSONAS[sorted[0]?.[0] ?? 'regular'];
  const traitText: Record<string, string> = {
    owl: `${Math.round(share(parts.night) * 100)} % after 10 pm`,
    sunrise: `${Math.round(share(parts.morning) * 100)} % before noon`,
    rewatcher: `${rewatchRatio.toFixed(1)} plays per video`,
    explorer: `${per.size} different videos`,
    binger: big ? `a ${Math.round(big.ms / 60000)}-minute day` : '',
    weekender: `${Math.round(weekendShare * 100)} % on weekends`,
    critic: `${rated.length} of them rated`,
    completionist: `${Math.round((completion ?? 0) * 100)} % of each video, on average`,
  };
  const traits = sorted.slice(0, 3).map(([k]) => traitText[k]).filter(Boolean);

  return {
    range,
    watchedMs,
    plays: inR.length,
    videos: per.size,
    activeDays: byDay.size,
    rangeDays,
    firsts: [...per.keys()].filter((id) => !before.has(id)).length,
    returns: [...per.keys()].filter((id) => before.has(id)).length,
    top,
    comfort: comfortId ? pick(comfortId) : null,
    dayparts,
    favouriteWeekday: Math.max(...weekday) > 0 ? weekday.indexOf(Math.max(...weekday)) : null,
    biggestDay: big ? { day: big.day, ms: big.ms, videoId: big.top } : null,
    longest,
    throwback: oldest && years >= 1 ? { videoId: oldest.id, years, createdAt: oldest.createdAt } : null,
    avgRating: rated.length ? Math.round((sum(rated, (v) => v.rating) / rated.length) * 10) / 10 : null,
    bestRated: bestRated ? { videoId: bestRated.id, rating: bestRated.rating } : null,
    gem: gem ? { videoId: gem.id, rating: gem.rating, lastAt: lastPlay.get(gem.id) ?? null } : null,
    completion,
    timeline,
    equivalents: equivalents(watchedMs),
    traits,
    persona,
  };
}

/** Where a clip of a video starts in the story: your first bookmark, else a quarter in. */
export function highlightAt(durationMs: number | null, bookmarks: number[] = [], clipMs = 8000): number {
  const d = durationMs ?? 0;
  if (bookmarks.length) return Math.max(0, Math.min(bookmarks[0], d - clipMs));
  if (d <= clipMs * 1.5) return 0;
  return Math.round(d * 0.25);
}

/* -------------------------------------------------------- personal records */

export type Record_ = { key: string; label: string; value: string; detail: string; videoId: string | null; at: number | null; icon: string };

export function personalRecords(videos: RVideo[], plays: RPlay[], fmt: (ms: number) => string): Record_[] {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const own = plays.filter((p) => byId.has(p.videoId)).sort((a, b) => a.startedAt - b.startedAt);
  if (!own.length) return [];
  const out: Record_[] = [];
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  const longest = own.reduce((a, p) => (p.watchedMs > a.watchedMs ? p : a));
  out.push({ key: 'sitting', label: 'Longest sitting', value: fmt(longest.watchedMs), detail: `${nameOf(byId.get(longest.videoId)!)} · ${day(longest.startedAt)}`, videoId: longest.videoId, at: longest.startedAt, icon: 'hourglass' });

  const days = new Map<number, { ms: number; per: Map<string, number>; count: Set<string> }>();
  for (const p of own) {
    const d = sod(p.startedAt);
    const s = days.get(d) ?? { ms: 0, per: new Map(), count: new Set() };
    s.ms += p.watchedMs;
    s.per.set(p.videoId, (s.per.get(p.videoId) ?? 0) + p.watchedMs);
    s.count.add(p.videoId);
    days.set(d, s);
  }
  const [bigDay, big] = [...days.entries()].sort((a, b) => b[1].ms - a[1].ms)[0];
  const bigTop = [...big.per.entries()].sort((a, b) => b[1] - a[1])[0][0];
  out.push({ key: 'day', label: 'Biggest day', value: fmt(big.ms), detail: new Date(bigDay).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }), videoId: bigTop, at: bigDay, icon: 'calendar' });

  const [manyDay, many] = [...days.entries()].sort((a, b) => b[1].count.size - a[1].count.size)[0];
  if (many.count.size > 1)
    out.push({ key: 'variety', label: 'Most videos in a day', value: String(many.count.size), detail: day(manyDay), videoId: [...many.count][0], at: manyDay, icon: 'videos' });

  const counts = new Map<string, number>();
  for (const p of own) counts.set(p.videoId, (counts.get(p.videoId) ?? 0) + 1);
  const [favId, favN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (favN > 1) out.push({ key: 'repeat', label: 'Most plays of one video', value: `×${favN}`, detail: nameOf(byId.get(favId)!), videoId: favId, at: null, icon: 'rewatch' });

  // The best Monday-to-Sunday week.
  const weeks = new Map<number, number>();
  for (const p of own) {
    const d = new Date(p.startedAt);
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    weeks.set(mon, (weeks.get(mon) ?? 0) + p.watchedMs);
  }
  const [wk, wkMs] = [...weeks.entries()].sort((a, b) => b[1] - a[1])[0];
  out.push({ key: 'week', label: 'Best week', value: fmt(wkMs), detail: `Week of ${new Date(wk).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`, videoId: null, at: wk, icon: 'trending' });

  // Longest run of days in a row, and when it ended.
  const ds = [...days.keys()].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let end = ds[0];
  for (let i = 0; i < ds.length; i++) {
    run = i > 0 && Math.round((ds[i] - ds[i - 1]) / DAY) === 1 ? run + 1 : 1;
    if (run > best) {
      best = run;
      end = ds[i];
    }
  }
  if (best > 1) out.push({ key: 'streak', label: 'Longest streak', value: `${best} days`, detail: `Up to ${day(end)}`, videoId: null, at: end, icon: 'trending' });
  return out;
}

/* ----------------------------------------------------------------- journey */

export type Milestone = { at: number; title: string; detail: string; videoId: string | null; icon: string };

/** Your story with ReelVault in dates: firsts and big moments (badges with a date included). */
export function journey(videos: RVideo[], plays: RPlay[], earned: { at: number; title: string; videoId?: string | null; icon: string }[]): Milestone[] {
  const out: Milestone[] = [];
  const byImport = [...videos].sort((a, b) => a.importedAt - b.importedAt);
  if (byImport[0]) out.push({ at: byImport[0].importedAt, title: 'Your first video', detail: nameOf(byImport[0]), videoId: byImport[0].id, icon: 'import' });
  const first = [...plays].filter((p) => videos.some((v) => v.id === p.videoId)).sort((a, b) => a.startedAt - b.startedAt)[0];
  if (first) {
    const v = videos.find((x) => x.id === first.videoId)!;
    out.push({ at: first.startedAt, title: 'First watch in ReelVault', detail: nameOf(v), videoId: v.id, icon: 'play' });
  }
  for (const e of earned) out.push({ at: e.at, title: e.title, detail: 'Badge earned', videoId: e.videoId ?? null, icon: e.icon });
  return out.sort((a, b) => b.at - a.at);
}

/* -------------------------------------------------------------------- level */

const LEVEL_NAMES = ['Newcomer', 'Viewer', 'Regular', 'Fan', 'Enthusiast', 'Devotee', 'Connoisseur', 'Archivist', 'Curator', 'Legend'];

/**
 * XP: 100 per badge tier (a gold step is 300), plus 10 per hour watched and 2
 * per video in the library. Each level needs 250 more XP than the one before.
 */
export function levelFor(points: number, watchedMs: number, videos: number) {
  const xp = Math.round(points * 100 + (watchedMs / HOUR) * 10 + videos * 2);
  let level = 1;
  let floor = 0;
  let need = 250;
  while (xp >= floor + need) {
    floor += need;
    level++;
    need = 250 * level;
  }
  return { xp, level, title: LEVEL_NAMES[Math.min(LEVEL_NAMES.length - 1, level - 1)], into: xp - floor, need };
}

/* ---------------------------------------------------- dashboard: insights */

export type Insight = { key: string; icon: string; title: string; body: string; tone: 'good' | 'info' | 'nudge'; videoId?: string };

export function noticed(
  videos: RVideo[],
  plays: RPlay[],
  now: number,
  d: { watchedMs: number; prevMs: number | null; change: number | null; peakWeekday: number | null; label: string },
  streakNow: number,
  fmt: (ms: number) => string
): Insight[] {
  const out: Insight[] = [];
  const own = new Set(videos.map((v) => v.id));
  const ps = plays.filter((p) => own.has(p.videoId));
  const today = sod(now);
  if (d.change !== null && Math.abs(d.change) >= 0.15)
    out.push({
      key: 'change',
      icon: d.change > 0 ? 'arrowUp' : 'arrowDown',
      title: d.change > 0 ? `Up ${Math.round(d.change * 100)} %` : `Down ${Math.round(-d.change * 100)} %`,
      body: `${fmt(d.watchedMs)} in ${d.label.toLowerCase()}, against ${fmt(d.prevMs ?? 0)} before.`,
      tone: d.change > 0 ? 'good' : 'info',
    });
  const watchedToday = ps.some((p) => p.startedAt >= today);
  if (streakNow >= 2 && !watchedToday)
    out.push({ key: 'streak', icon: 'trending', title: `${streakNow}-day streak`, body: 'Watch something today to keep it going.', tone: 'nudge' });
  else if (streakNow >= 3) out.push({ key: 'streak', icon: 'trending', title: `${streakNow} days in a row`, body: 'Your streak is alive. Nice.', tone: 'good' });
  if (d.peakWeekday !== null)
    out.push({ key: 'weekday', icon: 'calendar', title: `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][d.peakWeekday]}s are yours`, body: `That's when you watch the most (${d.label.toLowerCase()}).`, tone: 'info' });
  const watched = new Set(ps.map((p) => p.videoId));
  const never = videos.filter((v) => !watched.has(v.id) && v.importedAt < now - 14 * DAY);
  if (never.length)
    out.push({ key: 'never', icon: 'eye', title: `${never.length} never watched`, body: `Imported more than two weeks ago and never played here. Maybe tonight?`, tone: 'nudge', videoId: never[0].id });
  const unrated = videos.filter((v) => v.rating <= 0 && watched.has(v.id)).length;
  if (unrated >= 3) out.push({ key: 'unrated', icon: 'star', title: `${unrated} watched, not rated`, body: 'Rating them makes your favourites and Wrapped sharper.', tone: 'nudge' });
  const recs = personalRecords(videos, ps, fmt);
  const dayRec = recs.find((r) => r.key === 'day');
  if (dayRec?.at && dayRec.at >= today - 6 * DAY) out.push({ key: 'record', icon: 'trophy', title: 'New record this week', body: `Your biggest day ever: ${dayRec.value}.`, tone: 'good', videoId: dayRec.videoId ?? undefined });
  return out;
}

/* ----------------------------------------------------------- memories */

/** Videos filmed on this day in earlier years (or within 3 days of it when there are none). */
export function onThisDay(videos: RVideo[], now: number): { videos: RVideo[]; exact: boolean } {
  const n = new Date(now);
  const near = (v: RVideo, days: number) => {
    const c = new Date(v.createdAt);
    if (c.getFullYear() >= n.getFullYear()) return false;
    const same = new Date(n.getFullYear(), c.getMonth(), c.getDate()).getTime();
    return Math.abs(same - sod(now)) <= days * DAY;
  };
  const exact = videos.filter((v) => near(v, 0)).sort((a, b) => b.createdAt - a.createdAt);
  if (exact.length) return { videos: exact, exact: true };
  return { videos: videos.filter((v) => near(v, 3)).sort((a, b) => b.createdAt - a.createdAt), exact: false };
}

/** Favourites you have not watched in a while, then videos never watched. */
export function rediscover(videos: RVideo[], plays: RPlay[], now: number, max = 10): { video: RVideo; why: string }[] {
  const last = new Map<string, number>();
  for (const p of plays) last.set(p.videoId, Math.max(last.get(p.videoId) ?? 0, p.startedAt));
  const ago = (t: number) => {
    const d = Math.floor((now - t) / DAY);
    return d >= 60 ? `${Math.floor(d / 30)} months ago` : `${d} days ago`;
  };
  const faves = videos
    .filter((v) => v.rating >= 7 && (last.get(v.id) ?? 0) < now - 45 * DAY)
    .sort((a, b) => b.rating - a.rating)
    .map((v) => ({ video: v, why: last.has(v.id) ? `★ ${v.rating} · last watched ${ago(last.get(v.id)!)}` : `★ ${v.rating} · never watched here` }));
  const never = videos
    .filter((v) => !last.has(v.id) && v.rating < 7)
    .sort((a, b) => a.importedAt - b.importedAt)
    .map((v) => ({ video: v, why: `Never watched · added ${ago(v.importedAt)}` }));
  return [...faves, ...never].slice(0, max);
}

/* -------------------------------------------------------------- storage */

export type SpaceIdea = { key: string; title: string; detail: string; bytes: number; count: number; action: 'deleted' | 'duplicates' | 'rejects' | 'smaller' | 'unwatched'; ids: string[] };

/** Ways to free space, biggest first: only what the app can really act on. */
export function spaceIdeas(videos: RVideo[], deleted: RVideo[], duplicateGroups: string[][], plays: RPlay[], now: number): SpaceIdea[] {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const size = (ids: string[]) => sum(ids, (id) => byId.get(id)?.sizeBytes ?? 0);
  const out: SpaceIdea[] = [];
  if (deleted.length)
    out.push({ key: 'deleted', title: 'Empty Recently Deleted', detail: 'Removed videos still take space for 30 days.', bytes: sum(deleted, (v) => v.sizeBytes), count: deleted.length, action: 'deleted', ids: deleted.map((v) => v.id) });
  const extra = duplicateGroups.flatMap((g) => g.slice(1)).filter((id) => byId.has(id));
  if (extra.length) out.push({ key: 'dups', title: 'Remove duplicates', detail: 'The same file more than once; the oldest import is kept.', bytes: size(extra), count: extra.length, action: 'duplicates', ids: extra });
  const rejects = videos.filter((v) => (v.flag ?? 0) < 0);
  if (rejects.length) out.push({ key: 'rejects', title: 'Review your rejects', detail: 'Videos you marked Reject.', bytes: sum(rejects, (v) => v.sizeBytes), count: rejects.length, action: 'rejects', ids: rejects.map((v) => v.id) });
  const h264 = videos.filter((v) => /avc|264/i.test(v.meta?.codec ?? ''));
  if (h264.length) out.push({ key: 'smaller', title: 'Make older videos smaller', detail: 'H.264 videos re-saved as HEVC are about half the size, same quality.', bytes: Math.round(sum(h264, (v) => v.sizeBytes) * 0.45), count: h264.length, action: 'smaller', ids: h264.map((v) => v.id) });
  const watched = new Set(plays.map((p) => p.videoId));
  const cold = videos.filter((v) => !watched.has(v.id) && v.importedAt < now - 60 * DAY && v.sizeBytes > 50 * 1024 * 1024).sort((a, b) => b.sizeBytes - a.sizeBytes);
  if (cold.length) out.push({ key: 'cold', title: 'Big and never watched', detail: 'Over 50 MB, here for 2 months and never played.', bytes: sum(cold, (v) => v.sizeBytes), count: cold.length, action: 'unwatched', ids: cold.map((v) => v.id) });
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** Bytes added per month (for the growth chart), oldest first, the last `months`. */
export function growth(videos: RVideo[], now: number, months = 12): { key: number; label: string; bytes: number; count: number }[] {
  const n = new Date(now);
  return Array.from({ length: months }, (_, i) => {
    const m = new Date(n.getFullYear(), n.getMonth() - (months - 1 - i), 1);
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
    const list = videos.filter((v) => v.importedAt >= m.getTime() && v.importedAt < next);
    return { key: m.getTime(), label: m.toLocaleDateString(undefined, { month: 'narrow' }), bytes: sum(list, (v) => v.sizeBytes), count: list.length };
  });
}
