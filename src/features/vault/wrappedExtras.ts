/**
 * More for Wrapped, worked out from what the story already knows:
 * - Video age: how long ago, on average, what you watched was filmed (each
 *   video counts by how long you watched it), with a word for it.
 * - Your club: one of six watching styles (like Spotify's), from when and how
 *   you watch; all six are shown with yours lit.
 * - The rewatch meter: plays per video.
 * Pure: no React, no database.
 */

export type AgeInput = { ms: number; createdAt: number | null | undefined }[];

export type VideoAge = { years: number; label: string; blurb: string } | null;

const YEAR = 365.25 * 86_400_000;

export function videoAge(watched: AgeInput, at: number): VideoAge {
  const rows = watched.filter((x) => x.ms > 0 && typeof x.createdAt === 'number' && x.createdAt > 0 && x.createdAt <= at);
  const total = rows.reduce((a, x) => a + x.ms, 0);
  if (!total) return null;
  const years = rows.reduce((a, x) => a + ((at - (x.createdAt as number)) / YEAR) * x.ms, 0) / total;
  const r = Math.round(years * 10) / 10;
  if (years < 0.25) return { years: r, label: 'Fresh off the camera', blurb: 'Almost everything you watched was filmed in the last few months.' };
  if (years < 1) return { years: r, label: 'This year’s stuff', blurb: 'You mostly watched what you filmed this past year.' };
  if (years < 3) return { years: r, label: 'A few years back', blurb: 'A mix of new clips and ones from a couple of years ago.' };
  if (years < 6) return { years: r, label: 'The nostalgic', blurb: 'You love going back. Most of it is years old.' };
  return { years: r, label: 'Deep in the archive', blurb: 'You watch the old stuff. Really old stuff.' };
}

export type ClubKey = 'night' | 'sunrise' | 'comfort' | 'newwave' | 'marathon' | 'snack';

export type Club = { key: ClubKey; name: string; blurb: string; color: string; icon: string };

export const CLUBS: Club[] = [
  { key: 'night', name: 'Night Shift', blurb: 'Lights off, video on.', color: '#5E5CE6', icon: 'moon' },
  { key: 'sunrise', name: 'Sunrise Society', blurb: 'A video with your coffee.', color: '#FF9F0A', icon: 'sun' },
  { key: 'comfort', name: 'Comfort Crew', blurb: 'The same favourites, again and again.', color: '#FF375F', icon: 'heart' },
  { key: 'newwave', name: 'New Wave', blurb: 'Always on to the next one.', color: '#30D158', icon: 'sparkle' },
  { key: 'marathon', name: 'Marathon Club', blurb: 'Long sittings, big days.', color: '#BF5AF2', icon: 'hourglass' },
  { key: 'snack', name: 'Snack Pack', blurb: 'A bit here, a bit there.', color: '#64D2FF', icon: 'fast' },
];

export type ClubInput = {
  plays: number;
  firsts: number;
  returns: number;
  dayparts: { key: 'morning' | 'afternoon' | 'evening' | 'night'; share: number }[];
  /** How much of a video you watch when you press play (0..1). */
  completion: number | null;
  longestMs: number | null;
  biggestDayMs: number | null;
};

/** Which club you are in, and how strongly each one fits (0..1, for the grid). */
export function clubOf(f: ClubInput): { club: Club; fit: Record<ClubKey, number> } | null {
  if (f.plays < 3) return null;
  const share = (k: string) => f.dayparts.find((d) => d.key === k)?.share ?? 0;
  const seen = f.firsts + f.returns || 1;
  const fit: Record<ClubKey, number> = {
    night: Math.min(1, share('night') / 0.4),
    sunrise: Math.min(1, share('morning') / 0.4),
    comfort: Math.min(1, (f.returns / seen) / 0.65),
    newwave: Math.min(1, (f.firsts / seen) / 0.7),
    marathon: Math.min(1, Math.max((f.longestMs ?? 0) / (45 * 60_000), (f.biggestDayMs ?? 0) / (3 * 3_600_000))),
    snack: f.completion === null ? 0 : Math.min(1, (1 - f.completion) / 0.6),
  };
  const best = (Object.keys(fit) as ClubKey[]).sort((a, b) => fit[b] - fit[a])[0];
  return { club: CLUBS.find((c) => c.key === best)!, fit };
}

/** Plays per video, and a word for it. */
export function rewatchMeter(plays: number, videos: number): { perVideo: number; label: string } | null {
  if (!videos || plays < 2) return null;
  const perVideo = Math.round((plays / videos) * 10) / 10;
  const label = perVideo >= 3 ? 'On repeat' : perVideo >= 1.6 ? 'Second helpings' : perVideo > 1.1 ? 'Now and again' : 'Once is enough';
  return { perVideo, label };
}

/** The club for a story's facts (or a month of them). */
export function clubFor(f: {
  plays: number;
  firsts: number;
  returns: number;
  dayparts: ClubInput['dayparts'];
  completion: number | null;
  longest: { ms: number } | null;
  biggestDay: { ms: number } | null;
}): Club | null {
  return clubOf({ plays: f.plays, firsts: f.firsts, returns: f.returns, dayparts: f.dayparts, completion: f.completion, longestMs: f.longest?.ms ?? null, biggestDayMs: f.biggestDay?.ms ?? null })?.club ?? null;
}

/** Your club month by month: how often you switched, where you started and ended, and the one you were in most. */
export function clubJourney(months: { label: string; club: ClubKey | null }[]): { switches: number; first: Club; last: Club; most: Club; months: number } | null {
  const seen = months.filter((m): m is { label: string; club: ClubKey } => !!m.club);
  if (seen.length < 2) return null;
  let switches = 0;
  for (let i = 1; i < seen.length; i++) if (seen[i].club !== seen[i - 1].club) switches++;
  const n = new Map<ClubKey, number>();
  for (const m of seen) n.set(m.club, (n.get(m.club) ?? 0) + 1);
  const most = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const club = (k: ClubKey) => CLUBS.find((c) => c.key === k)!;
  return { switches, first: club(seen[0].club), last: club(seen[seen.length - 1].club), most: club(most), months: seen.length };
}

/**
 * A guess with three answers: the biggest of `list` and two others (one
 * close, one further down), mixed by `seed`. Null when there is no clear winner.
 */
export function quizFrom(list: { id: string; label: string; value: number }[], seed: number): { options: { id: string; label: string }[]; answer: string } | null {
  const sorted = list.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length < 3 || sorted[0].value === sorted[1].value) return null;
  const picks = [sorted[0], sorted[1], sorted[Math.min(sorted.length - 1, 2 + (seed % Math.max(1, sorted.length - 2)))]];
  const order = [[0, 1, 2], [1, 0, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [2, 1, 0]][Math.abs(seed) % 6];
  return { options: order.map((i) => ({ id: picks[i].id, label: picks[i].label })), answer: sorted[0].id };
}

/** The same range one year earlier ("October" -> last October). */
export function yearBefore(r: { start: number; end: number; label: string }): { start: number; end: number; label: string } {
  const shift = (t: number) => {
    const d = new Date(t);
    d.setFullYear(d.getFullYear() - 1);
    return d.getTime();
  };
  return { start: shift(r.start), end: shift(r.end), label: 'a year before' };
}
