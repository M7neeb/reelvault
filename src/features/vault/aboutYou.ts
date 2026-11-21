// "About you": the part of Wrapped that says what kind of watcher or reader you are, not only how
// much. Built the same way for videos and manga from sittings (a play or a reading session) so both
// Wrapped get the same profile, awards, quiz and lines. Pure: runs in the tests and the preview.

export type Sitting = { titleId: string; at: number; ms: number };
export type TitleInfo = { id: string; name: string; rating: number; finished?: boolean };
export type AboutKind = 'video' | 'manga';

export type AboutInput = {
  kind: AboutKind;
  /** Every sitting you ever had (not only this range): comebacks and old favourites need the past. */
  sittings: readonly Sitting[];
  titles: ReadonlyMap<string, TitleInfo>;
  start: number;
  end: number;
  /** For the quiz and anything picked "at random": the same range always tells the same story. */
  seed?: number;
};

export type AxisKey = 'clock' | 'pace' | 'loyalty' | 'nostalgia' | 'week';
/** One slider of the profile. 0 = all the way to `left`, 1 = all the way to `right`. */
export type Axis = { key: AxisKey; left: string; right: string; value: number };
/** `icon` is an icon name of the app's set (moon, sun, fire…). */
export type Archetype = { name: string; line: string; icon: string };
export type Award = { key: string; title: string; titleId: string; line: string };
export type TwoTruths = { statements: string[]; lie: number; reveal: string };

export type AboutYou = {
  axes: Axis[];
  archetype: Archetype;
  awards: Award[];
  quiz: TwoTruths | null;
  roast: string;
  toast: string;
  predictions: string[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Where `x` sits between `lo` (0) and `hi` (1). */
const between = (x: number, lo: number, hi: number) => clamp01((x - lo) / (hi - lo));
const dayKey = (t: number) => {
  const d = new Date(t);
  return d.getFullYear() * 10_000 + d.getMonth() * 100 + d.getDate();
};

/** Small, steady random numbers from a seed (mulberry32), so a story never changes between replays. */
function rng(seed: number) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** "45 min", "2 h", "2 h 10 min". */
export function lengthText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const WORDS = {
  video: { past: 'watched', ing: 'watching', thing: 'video', things: 'videos', sitting: 'sitting' },
  manga: { past: 'read', ing: 'reading', thing: 'title', things: 'titles', sitting: 'session' },
} as const;

/** A guess, said roughly: "about 70 h", not "about 71 h 24 min". */
export function roughLength(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return lengthText(Math.max(5, Math.round(min / 5) * 5) * 60_000);
  if (min < 600) return lengthText(Math.round(min / 15) * 15 * 60_000);
  return lengthText(Math.round(min / 60) * 60 * 60_000);
}

/* ------------------------------------------------------------------ profile */

/** Each pole of a slider: a word for the name (adjective + noun) and a line about you. */
const POLES: Record<`${AxisKey}:${0 | 1}`, { adj: string; noun: Record<AboutKind, string>; line: Record<AboutKind, string> }> = {
  'clock:0': { adj: 'Sunrise', noun: { video: 'Early Bird', manga: 'Early Bird' }, line: { video: 'Your best viewing happens before most people have had coffee.', manga: 'You read while the day is still quiet.' } },
  'clock:1': { adj: 'Midnight', noun: { video: 'Night Owl', manga: 'Night Owl' }, line: { video: 'The later it gets, the more you press play.', manga: 'Your pages turn fastest after dark.' } },
  'pace:0': { adj: 'Bite-Sized', noun: { video: 'Sampler', manga: 'Nibbler' }, line: { video: 'A little here, a little there. You never overdo it.', manga: 'A chapter here, a chapter there.' } },
  'pace:1': { adj: 'Marathon', noun: { video: 'Marathoner', manga: 'Binge Reader' }, line: { video: 'Once you sit down, you stay down.', manga: '"One more chapter" is never just one.' } },
  'loyalty:0': { adj: 'Wandering', noun: { video: 'Explorer', manga: 'Explorer' }, line: { video: 'You spread your time over lots of different things.', manga: 'You hop between a lot of stories.' } },
  'loyalty:1': { adj: 'Devoted', noun: { video: 'Superfan', manga: 'Superfan' }, line: { video: 'A few favourites got almost all of your time.', manga: 'A few stories got almost all of your time.' } },
  'nostalgia:0': { adj: 'Trailblazing', noun: { video: 'Discoverer', manga: 'Discoverer' }, line: { video: 'Mostly things you had never seen before.', manga: 'Mostly stories you had never opened before.' } },
  'nostalgia:1': { adj: 'Nostalgic', noun: { video: 'Rewatcher', manga: 'Rereader' }, line: { video: 'You keep going back to old favourites.', manga: 'You keep going back to stories you already know.' } },
  'week:0': { adj: 'Weeknight', noun: { video: 'Regular', manga: 'Regular' }, line: { video: 'Your screen time lives on weekdays.', manga: 'Reading is part of your weekdays.' } },
  'week:1': { adj: 'Weekend', noun: { video: 'Warrior', manga: 'Warrior' }, line: { video: 'Saturdays and Sundays are when it really happens.', manga: 'Weekends are when the stories come out.' } },
};

/** A sitting counts as going back to something when you first had it at least this long before. */
const RETURN_AFTER = 30 * DAY;

const POLE_ICONS: Record<`${AxisKey}:${0 | 1}`, string> = {
  'clock:0': 'sun',
  'clock:1': 'moon',
  'pace:0': 'clock',
  'pace:1': 'fire',
  'loyalty:0': 'globe',
  'loyalty:1': 'heart',
  'nostalgia:0': 'sparkle',
  'nostalgia:1': 'rewatch',
  'week:0': 'calendar',
  'week:1': 'star',
};

function axesOf(kind: AboutKind, inRange: Sitting[], firstEver: ReadonlyMap<string, number>): Axis[] {
  const total = inRange.reduce((a, s) => a + s.ms, 0) || 1;
  let night = 0;
  let morning = 0;
  let weekend = 0;
  let back = 0;
  const per = new Map<string, number>();
  for (const s of inRange) {
    const d = new Date(s.at);
    const h = d.getHours();
    if (h >= 22 || h < 5) night += s.ms;
    else if (h >= 5 && h < 11) morning += s.ms;
    if (d.getDay() === 0 || d.getDay() === 6) weekend += s.ms;
    per.set(s.titleId, (per.get(s.titleId) ?? 0) + s.ms);
    // Judged per sitting, so it works for any range, all time included.
    if (s.at - (firstEver.get(s.titleId) ?? s.at) >= RETURN_AFTER) back += s.ms;
  }
  // Long sittings carry the most time, so the typical minute sits in a sitting this long.
  const sorted = inRange.map((s) => s.ms).sort((a, b) => a - b);
  let acc = 0;
  let typical = 0;
  for (const ms of sorted) {
    acc += ms;
    if (acc >= total / 2) {
      typical = ms;
      break;
    }
  }
  const shares = [...per.values()].sort((a, b) => b - a);
  const top3 = shares.slice(0, 3).reduce((a, x) => a + x, 0) / total;
  const old = back / total;
  const clock = night + morning ? night / (night + morning) : 0.5;
  // Two of seven days are weekend days: that share is the middle of the slider.
  const wk = weekend / total;
  const week = wk <= 2 / 7 ? 0.5 * (wk / (2 / 7)) : 0.5 + 0.5 * ((wk - 2 / 7) / (5 / 7));
  return [
    { key: 'clock', left: 'Early bird', right: 'Night owl', value: clock },
    { key: 'pace', left: kind === 'video' ? 'Sampler' : 'Nibbler', right: kind === 'video' ? 'Marathoner' : 'Binge reader', value: between(typical, 8 * 60_000, 75 * 60_000) },
    { key: 'loyalty', left: 'Explorer', right: 'Superfan', value: shares.length <= 1 ? 1 : between(top3, 0.3, 0.85) },
    { key: 'nostalgia', left: 'Discoverer', right: kind === 'video' ? 'Rewatcher' : 'Rereader', value: old },
    { key: 'week', left: 'Weekdays', right: 'Weekends', value: clamp01(week) },
  ];
}

/** The name: the strongest leaning gives the first word, the next one the second. */
export function archetypeOf(kind: AboutKind, axes: readonly Axis[]): Archetype {
  const ranked = [...axes].sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5));
  const pole = (a: Axis) => POLES[`${a.key}:${a.value >= 0.5 ? 1 : 0}`];
  const first = pole(ranked[0]);
  const second = pole(ranked[1] ?? ranked[0]);
  if (Math.abs(ranked[0].value - 0.5) < 0.12) {
    return { name: kind === 'video' ? 'The All-Rounder' : 'The Balanced Reader', line: 'No extremes: a bit of everything, at every hour. Hard to pin down, and that is the point.', icon: 'target' };
  }
  return { name: `The ${first.adj} ${second.noun[kind]}`, line: `${first.line[kind]} ${second.line[kind]}`, icon: POLE_ICONS[`${ranked[0].key}:${ranked[0].value >= 0.5 ? 1 : 0}`] };
}

/* ------------------------------------------------------------------- awards */

function awardsOf(kind: AboutKind, inRange: Sitting[], all: readonly Sitting[], titles: ReadonlyMap<string, TitleInfo>, start: number, end: number): Award[] {
  const w = WORDS[kind];
  const name = (id: string) => titles.get(id)?.name ?? `A ${w.thing}`;
  const out: Award[] = [];
  const used = new Set<string>();
  const add = (a: Award) => {
    if (used.has(a.titleId)) return;
    used.add(a.titleId);
    out.push(a);
  };
  const per = new Map<string, { ms: number; days: Set<number>; first: number; last: number }>();
  for (const s of inRange) {
    const e = per.get(s.titleId) ?? { ms: 0, days: new Set<number>(), first: s.at, last: s.at };
    e.ms += s.ms;
    e.days.add(dayKey(s.at));
    e.first = Math.min(e.first, s.at);
    e.last = Math.max(e.last, s.at);
    per.set(s.titleId, e);
  }
  const lastBefore = new Map<string, number>();
  for (const s of all) if (s.at < start) lastBefore.set(s.titleId, Math.max(lastBefore.get(s.titleId) ?? 0, s.at));

  // Ride or die: on the most different days.
  const loyal = [...per.entries()].sort((a, b) => b[1].days.size - a[1].days.size || b[1].ms - a[1].ms)[0];
  if (loyal && loyal[1].days.size >= 3) add({ key: 'loyal', title: 'Ride or die', titleId: loyal[0], line: `${name(loyal[0])} was there on ${loyal[1].days.size} different days.` });

  // The marathon: your longest single sitting.
  const long = [...inRange].sort((a, b) => b.ms - a.ms).find((x) => !used.has(x.titleId));
  if (long && long.ms >= 20 * 60_000) add({ key: 'marathon', title: 'The marathon', titleId: long.titleId, line: `${lengthText(long.ms)} of ${name(long.titleId)} in one go, on a ${WEEKDAYS[new Date(long.at).getDay()]}.` });

  // Comeback of the year: back after the longest time away.
  let back: { id: string; gap: number } | null = null;
  for (const [id, e] of per) {
    const before = lastBefore.get(id);
    if (before === undefined) continue;
    const gap = e.first - before;
    if (gap >= 60 * DAY && (!back || gap > back.gap)) back = { id, gap };
  }
  if (back) {
    const months = Math.round(back.gap / (30 * DAY));
    add({ key: 'comeback', title: 'The comeback', titleId: back.id, line: `You hadn't touched ${name(back.id)} in ${months >= 24 ? `${Math.round(months / 12)} years` : `${months} months`}. Then, out of nowhere, you were back.` });
  }

  // Guilty pleasure: lots of your time, not much of your rating.
  const byTime = [...per.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 5);
  const guilty = byTime.find(([id]) => {
    const r = titles.get(id)?.rating ?? 0;
    return r > 0 && r <= 5;
  });
  if (guilty) add({ key: 'guilty', title: 'Guilty pleasure', titleId: guilty[0], line: `You gave ${name(guilty[0])} a ${titles.get(guilty[0])!.rating}/10. You also gave it ${lengthText(guilty[1].ms)}. We won't tell.` });

  // One-night stand: a big night with something new, and never again.
  const fling = [...per.entries()]
    .filter(([id, e]) => e.days.size === 1 && !lastBefore.has(id) && e.ms >= 30 * 60_000 && end - e.last > 14 * DAY)
    .sort((a, b) => b[1].ms - a[1].ms)[0];
  if (fling) add({ key: 'fling', title: 'One-night stand', titleId: fling[0], line: `${lengthText(fling[1].ms)} with ${name(fling[0])} in one day. Then nothing. Ever again.` });

  // Left hanging (stories you can finish): started, dropped halfway through the range, not finished.
  if (kind === 'manga') {
    const mid = start + (end - start) / 2;
    const hanging = [...per.entries()].filter(([id, e]) => !titles.get(id)?.finished && e.last < mid && e.ms >= 15 * 60_000).sort((a, b) => b[1].ms - a[1].ms)[0];
    if (hanging) add({ key: 'hanging', title: 'Left on read', titleId: hanging[0], line: `${name(hanging[0])} is still waiting for you to come back.` });
  }
  return out.slice(0, 4);
}

/* -------------------------------------------------------- two truths, a lie */

type Fact = { truth: string; lie: string };

function factsOf(kind: AboutKind, inRange: Sitting[], titles: ReadonlyMap<string, TitleInfo>, startedBefore: (id: string) => boolean, random: () => number): Fact[] {
  const w = WORDS[kind];
  const name = (id: string) => titles.get(id)?.name ?? `a ${w.thing}`;
  const facts: Fact[] = [];
  const per = new Map<string, number>();
  const byWeekday = new Array(7).fill(0) as number[];
  let night = 0;
  let morning = 0;
  for (const s of inRange) {
    per.set(s.titleId, (per.get(s.titleId) ?? 0) + s.ms);
    const d = new Date(s.at);
    byWeekday[d.getDay()] += s.ms;
    if (d.getHours() >= 22 || d.getHours() < 5) night += s.ms;
    if (d.getHours() >= 5 && d.getHours() < 11) morning += s.ms;
  }
  const ranked = [...per.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length >= 4) facts.push({ truth: `${name(ranked[0][0])} got more of your time than anything else.`, lie: `${name(ranked[3][0])} got more of your time than anything else.` });
  const best = byWeekday.indexOf(Math.max(...byWeekday));
  const worst = byWeekday.indexOf(Math.min(...byWeekday));
  if (byWeekday[best] > 0 && best !== worst) facts.push({ truth: `${WEEKDAYS[best]} was your biggest day of the week.`, lie: `${WEEKDAYS[worst]} was your biggest day of the week.` });
  if (night !== morning && night + morning > 0) {
    const more = night > morning ? 'after 10 at night' : 'before 11 in the morning';
    const less = night > morning ? 'before 11 in the morning' : 'after 10 at night';
    facts.push({ truth: `You ${w.past} more ${more} than ${less}.`, lie: `You ${w.past} more ${less} than ${more}.` });
  }
  const longest = Math.max(0, ...inRange.map((s) => s.ms));
  if (longest >= 10 * 60_000) {
    const off = random() < 0.5 ? 0.55 : 1.7;
    facts.push({ truth: `Your longest ${w.sitting} was ${lengthText(longest)}.`, lie: `Your longest ${w.sitting} was ${lengthText(Math.max(longest * off, longest + 12 * 60_000 * (off > 1 ? 1 : -1), 5 * 60_000))}.` });
  }
  const fresh = ranked.filter(([id]) => !startedBefore(id)).length;
  if (ranked.length >= 3) {
    const wrong = fresh <= 2 ? fresh + 3 : random() < 0.5 ? fresh + Math.max(2, Math.round(fresh * 0.4)) : Math.max(0, fresh - Math.max(2, Math.round(fresh * 0.4)));
    const say = (n: number) =>
      kind === 'video'
        ? n === 0
          ? 'Everything you watched, you had seen before.'
          : `You watched ${n} ${n === 1 ? 'video' : 'videos'} for the first time.`
        : n === 0
          ? `You didn't start a single new ${w.thing}.`
          : `You started ${n} new ${n === 1 ? w.thing : w.things}.`;
    if (wrong !== fresh) facts.push({ truth: say(fresh), lie: say(wrong) });
  }
  return facts;
}

/** Three things about you: two true, one made up. Null with too little to go on. */
function quizOf(facts: Fact[], random: () => number): TwoTruths | null {
  if (facts.length < 3) return null;
  const pool = [...facts];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, 3);
  const lie = Math.floor(random() * 3);
  return {
    statements: picked.map((f, i) => (i === lie ? f.lie : f.truth)),
    lie,
    reveal: picked[lie].truth,
  };
}

/* ------------------------------------------------------- roast, toast, next */

const ROASTS: Record<`${AxisKey}:${0 | 1}`, Record<AboutKind, string>> = {
  'clock:0': { video: 'Who presses play at 7 in the morning? You. You do.', manga: 'Reading before breakfast. Show-off.' },
  'clock:1': { video: 'Your bedtime is more of a suggestion.', manga: 'Your bedtime is more of a suggestion.' },
  'pace:0': { video: 'You treat videos like snacks and never finish the bag.', manga: 'A chapter, then gone. Commitment issues?' },
  'pace:1': { video: '"Just one more" did a lot of heavy lifting this time.', manga: '"Just one more chapter" did a lot of heavy lifting this time.' },
  'loyalty:0': { video: 'Bit of everything, never settling down.', manga: 'So many open stories. Do they know about each other?' },
  'loyalty:1': { video: 'You found what you like and decided that was enough.', manga: 'Other stories exist. Just saying.' },
  'nostalgia:0': { video: 'Always chasing the next new thing.', manga: 'Always chasing the next new story.' },
  'nostalgia:1': { video: 'You could probably mouth along to some of these by now.', manga: 'You already know how it ends. You read it anyway.' },
  'week:0': { video: 'Weekdays only. Your weekends must be very busy.', manga: 'Weekdays only. Your weekends must be very busy.' },
  'week:1': { video: 'Monday to Friday you hold it together. Then Saturday happens.', manga: 'Monday to Friday you hold it together. Then Saturday happens.' },
};

const TOASTS: Record<`${AxisKey}:${0 | 1}`, Record<AboutKind, string>> = {
  'clock:0': { video: 'Starting the day with something you love is a good habit.', manga: 'Starting the day with a story is a good habit.' },
  'clock:1': { video: 'Night is when you make time just for yourself, and that counts.', manga: 'Night is when you make time just for yourself, and that counts.' },
  'pace:0': { video: 'You know how to enjoy things without overdoing it.', manga: 'Slow and steady: you actually take the story in.' },
  'pace:1': { video: 'When something grabs you, you give it everything.', manga: 'When a story grabs you, you give it everything.' },
  'loyalty:0': { video: 'Curious about everything. That is a good way to be.', manga: 'Curious about every kind of story. That is a good way to be.' },
  'loyalty:1': { video: 'When you love something, you really love it.', manga: 'When you love a story, you really love it.' },
  'nostalgia:0': { video: 'Always open to something new.', manga: 'Always open to a new story.' },
  'nostalgia:1': { video: 'You know what you like, and it still makes you happy.', manga: 'Your favourites still hold up, and you prove it.' },
  'week:0': { video: 'Little moments in busy weeks add up.', manga: 'Little moments in busy weeks add up.' },
  'week:1': { video: 'You save the good stuff for when you can enjoy it properly.', manga: 'You save the good stories for when you can enjoy them properly.' },
};

function predictionsOf(kind: AboutKind, inRange: Sitting[], prevMs: number, titles: ReadonlyMap<string, TitleInfo>, startedBefore: (id: string) => boolean, start: number, end: number): string[] {
  const w = WORDS[kind];
  const out: string[] = [];
  const total = inRange.reduce((a, s) => a + s.ms, 0);
  if (total > 0) {
    // A soft guess: halfway between staying the same and keeping the same trend.
    const trend = prevMs > 0 ? total / prevMs : 1;
    const guess = total * (1 + (Math.min(2, Math.max(0.5, trend)) - 1) / 2);
    out.push(`Next time round: about ${roughLength(guess)} of ${w.ing}${guess > total * 1.05 ? ', a bit more than now' : guess < total * 0.95 ? ', a bit less than now' : ''}.`);
  }
  // The one you keep returning to will be back.
  const days = new Map<string, Set<number>>();
  for (const s of inRange) {
    const d = days.get(s.titleId) ?? new Set<number>();
    d.add(dayKey(s.at));
    days.set(s.titleId, d);
  }
  const keeper = [...days.entries()].filter(([id]) => startedBefore(id)).sort((a, b) => b[1].size - a[1].size)[0];
  if (keeper && keeper[1].size >= 2) out.push(`You'll go back to ${titles.get(keeper[0])?.name ?? 'an old favourite'}. You always do.`);
  const fresh = [...days.keys()].filter((id) => !startedBefore(id)).length;
  const weeks = Math.max(1, (end - start) / (7 * DAY));
  if (fresh > 0) {
    const perWeek = fresh / weeks;
    out.push(perWeek >= 1 ? `At this pace, about ${Math.round(perWeek)} new ${Math.round(perWeek) === 1 ? w.thing : w.things} a week.` : `Somewhere out there is your next favourite ${w.thing}. You'll find it.`);
  }
  return out.slice(0, 3);
}

/* -------------------------------------------------------------------- whole */

export function aboutYou(input: AboutInput, prevMs = 0): AboutYou | null {
  const { kind, sittings, titles, start, end } = input;
  const inRange = sittings.filter((s) => s.at >= start && s.at < end && s.ms > 0);
  if (inRange.length < 2) return null;
  const firstEver = new Map<string, number>();
  for (const s of sittings) firstEver.set(s.titleId, Math.min(firstEver.get(s.titleId) ?? Infinity, s.at));
  const startedBefore = (id: string) => (firstEver.get(id) ?? Infinity) < start;
  const random = rng(input.seed ?? Math.floor(start / DAY));

  const axes = axesOf(kind, inRange, firstEver);
  const archetype = archetypeOf(kind, axes);
  const ranked = [...axes].sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5));
  const poleKey = (a: Axis) => `${a.key}:${a.value >= 0.5 ? 1 : 0}` as const;
  return {
    axes,
    archetype,
    awards: awardsOf(kind, inRange, sittings, titles, start, end),
    quiz: quizOf(factsOf(kind, inRange, titles, startedBefore, random), random),
    roast: ROASTS[poleKey(ranked[0])][kind],
    // The compliment comes from a different side of you than the roast.
    toast: TOASTS[poleKey(ranked[1] ?? ranked[0])][kind],
    predictions: predictionsOf(kind, inRange, prevMs, titles, startedBefore, start, end),
  };
}
