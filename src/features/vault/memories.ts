/**
 * Memories: your videos gathered into little films, the way Photos does it.
 * On this day in earlier years, trips away from home (from the videos' GPS),
 * days you filmed a lot, the best of a month, seasons, themes from your tags,
 * favourites, forgotten gems, whole years and what's on repeat. Each memory
 * picks its best videos (rating, plays) and plays them in the order they were
 * filmed, as short clips. Everything is worked out on the phone. Pure, so it
 * is tested in Node.
 */

import { highlightAt, type RPlay, type RVideo } from './recap.ts';

export type MVideo = RVideo & { location?: { lat: number; lon: number } | null; albumIds?: number[] };

export type MemoryKind = 'custom' | 'onThisDay' | 'trip' | 'day' | 'recent' | 'repeat' | 'month' | 'season' | 'theme' | 'favourites' | 'gems' | 'year';

/** How a memory plays: slow and warm, quick cuts, or wide and cinematic. */
export type Mood = 'gentle' | 'upbeat' | 'epic';

export type Memory = {
  /** Stable, so favourites and hidden memories survive new imports. */
  id: string;
  kind: MemoryKind;
  kicker: string;
  title: string;
  subtitle: string;
  /** Chronological: the order the clips play in. */
  videoIds: string[];
  coverId: string;
  /** All the videos it was made from (the clips are the best of them). */
  total: number;
  start: number;
  end: number;
  mood: Mood;
  /** Colour pair for the card (index into the UI's list). */
  tone: number;
  /** Higher = shown first in For you. */
  score: number;
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const fmtDay = (t: number, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) => new Date(t).toLocaleDateString('en-GB', o);
const monthName = (t: number) => new Date(t).toLocaleDateString('en-GB', { month: 'long' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where most of your located videos were filmed (a ~10 km cell). */
export function homeOf(videos: MVideo[]): { lat: number; lon: number } | null {
  const cells = new Map<string, { n: number; lat: number; lon: number }>();
  for (const v of videos) {
    if (!v.location) continue;
    const k = `${Math.round(v.location.lat * 10)}:${Math.round(v.location.lon * 10)}`;
    const c = cells.get(k) ?? { n: 0, lat: 0, lon: 0 };
    c.n++;
    c.lat += v.location.lat;
    c.lon += v.location.lon;
    cells.set(k, c);
  }
  const best = [...cells.values()].sort((a, b) => b.n - a.n)[0];
  return best ? { lat: best.lat / best.n, lon: best.lon / best.n } : null;
}

/** The best `max` of a group (rating, then plays, then length), played in filming order. */
function pickClips(list: MVideo[], playsOf: Map<string, number>, max = 12): { ids: string[]; cover: string } {
  const ranked = [...list].sort((a, b) => b.rating - a.rating || (playsOf.get(b.id) ?? 0) - (playsOf.get(a.id) ?? 0) || (b.durationMs ?? 0) - (a.durationMs ?? 0));
  const chosen = ranked.slice(0, max);
  return { ids: chosen.sort((a, b) => a.createdAt - b.createdAt).map((v) => v.id), cover: ranked[0].id };
}

/** Videos filmed close together (gaps under `gapMs`), oldest first. */
function sessions(sorted: MVideo[], gapMs: number): MVideo[][] {
  const out: MVideo[][] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && v.createdAt - last[last.length - 1].createdAt <= gapMs) last.push(v);
    else out.push([v]);
  }
  return out;
}

const SEASONS = [
  { key: 'winter', name: 'Winter', months: [11, 0, 1] },
  { key: 'spring', name: 'Spring', months: [2, 3, 4] },
  { key: 'summer', name: 'Summer', months: [5, 6, 7] },
  { key: 'autumn', name: 'Autumn', months: [8, 9, 10] },
] as const;

function daypartTitle(list: MVideo[]): string {
  const h = new Date(list[Math.floor(list.length / 2)].createdAt).getHours();
  return h < 12 ? 'A morning to remember' : h < 17 ? 'An afternoon to remember' : h < 22 ? 'An evening to remember' : 'A night to remember';
}

/** The tag most of a group shares, if one does. */
function sharedTag(list: MVideo[]): string | null {
  const n = new Map<string, number>();
  for (const v of list) for (const t of v.tagNames) n.set(t, (n.get(t) ?? 0) + 1);
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= Math.max(2, list.length * 0.5) ? best[0] : null;
}

export function memories(videos: MVideo[], plays: RPlay[], now: number): Memory[] {
  const all = videos.filter((v) => v.createdAt > 0 && v.createdAt <= now + DAY).sort((a, b) => a.createdAt - b.createdAt);
  if (!all.length) return [];
  const playsOf = new Map<string, number>();
  const lastPlay = new Map<string, number>();
  for (const p of plays) {
    playsOf.set(p.videoId, (playsOf.get(p.videoId) ?? 0) + 1);
    lastPlay.set(p.videoId, Math.max(lastPlay.get(p.videoId) ?? 0, p.startedAt));
  }
  const out: Memory[] = [];
  const add = (kind: MemoryKind, id: string, list: MVideo[], m: Pick<Memory, 'kicker' | 'title' | 'subtitle' | 'mood' | 'tone' | 'score'>, max = 12) => {
    if (!list.length) return;
    const { ids, cover } = pickClips(list, playsOf, max);
    out.push({ id, kind, videoIds: ids, coverId: cover, total: list.length, start: list[0].createdAt, end: list[list.length - 1].createdAt, ...m });
  };
  const ageDays = (t: number) => (now - t) / DAY;
  const recency = (t: number) => Math.max(0, 40 - ageDays(t) / 9);

  // On this day: filmed within three days of today's date in an earlier year.
  const today = new Date(now);
  const byYear = new Map<number, MVideo[]>();
  for (const v of all) {
    const d = new Date(v.createdAt);
    const years = today.getFullYear() - d.getFullYear();
    if (years < 1) continue;
    const same = new Date(today.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
    if (Math.abs(same - sod(now) - 12 * HOUR) <= 3 * DAY + HOUR) byYear.set(years, [...(byYear.get(years) ?? []), v]);
  }
  for (const [years, list] of byYear) {
    const exact = list.some((v) => new Date(v.createdAt).getDate() === today.getDate() && new Date(v.createdAt).getMonth() === today.getMonth());
    add('onThisDay', `otd:${today.getFullYear() - years}`, list, {
      kicker: 'ON THIS DAY',
      title: `${plural(years, 'year')} ago${exact ? ' today' : ' this week'}`,
      subtitle: `${fmtDay(list[0].createdAt)} · ${plural(list.length, 'video')}`,
      mood: 'gentle',
      tone: 0,
      score: 100 - years,
    });
  }

  // Trips: runs of videos filmed 60 km or more from home, no more than three days apart.
  const home = homeOf(all);
  const inTrip = new Set<string>();
  if (home) {
    const located = all.filter((v) => v.location);
    let run: MVideo[] = [];
    const flush = () => {
      const span = run.length ? run[run.length - 1].createdAt - run[0].createdAt : 0;
      if (run.length >= 3 || (run.length >= 2 && span >= 20 * HOUR)) {
        const far = Math.round(Math.max(...run.map((v) => distanceKm(home, v.location!))));
        const days = Math.round((sod(run[run.length - 1].createdAt) - sod(run[0].createdAt)) / DAY) + 1;
        const startDow = new Date(run[0].createdAt).getDay();
        const weekend = days <= 3 && (startDow === 5 || startDow === 6);
        const title = days === 1 ? 'A day away' : weekend ? 'A weekend away' : `${days} days away`;
        add('trip', `trip:${sod(run[0].createdAt)}`, run, {
          kicker: 'TRIP',
          title: `${title}, ${monthName(run[0].createdAt)} ${new Date(run[0].createdAt).getFullYear()}`,
          subtitle: `${far >= 1000 ? `${(far / 1000).toFixed(1)}k` : far} km from home · ${plural(run.length, 'video')}`,
          mood: 'epic',
          tone: 1,
          score: 70 + recency(run[0].createdAt) + Math.min(10, run.length),
        });
        for (const v of run) inTrip.add(v.id);
      }
      run = [];
    };
    for (const v of located) {
      const away = distanceKm(home, v.location!) >= 60;
      const last = run[run.length - 1];
      if (away && (!last || v.createdAt - last.createdAt <= 3 * DAY)) run.push(v);
      else {
        flush();
        if (away) run.push(v);
      }
    }
    flush();
  }

  // Days you filmed a lot: three or more videos within a few hours of each other.
  for (const s of sessions(all, 6 * HOUR)) {
    if (s.length < 3 || s.every((v) => inTrip.has(v.id))) continue;
    const tag = sharedTag(s);
    add('day', `day:${sod(s[0].createdAt)}`, s, {
      kicker: fmtDay(s[0].createdAt, { weekday: 'long' }).toUpperCase(),
      title: tag ? `${cap(tag)}, ${fmtDay(s[0].createdAt, { day: 'numeric', month: 'long' })}` : daypartTitle(s),
      subtitle: `${fmtDay(s[0].createdAt)} · ${plural(s.length, 'video')}`,
      mood: 'upbeat',
      tone: 2,
      score: 55 + recency(s[0].createdAt) + Math.min(8, s.length),
    });
  }

  // The last two weeks.
  const recent = all.filter((v) => ageDays(v.createdAt) <= 14);
  if (recent.length >= 4)
    add('recent', 'recent', recent, { kicker: 'RECENTLY', title: 'The last two weeks', subtitle: plural(recent.length, 'video'), mood: 'upbeat', tone: 3, score: 60 });

  // On repeat: what you play most.
  const repeat = all.filter((v) => (playsOf.get(v.id) ?? 0) >= 3).sort((a, b) => (playsOf.get(b.id) ?? 0) - (playsOf.get(a.id) ?? 0)).slice(0, 10);
  if (repeat.length >= 3)
    add('repeat', 'repeat', [...repeat].sort((a, b) => a.createdAt - b.createdAt), {
      kicker: 'MOST PLAYED',
      title: 'On repeat',
      subtitle: `The ${repeat.length} videos you play again and again`,
      mood: 'upbeat',
      tone: 4,
      score: 45,
    });

  // Best of a month (the last 18 complete or current months).
  const monthGroups = new Map<number, MVideo[]>();
  for (const v of all) {
    const d = new Date(v.createdAt);
    const k = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    if (ageDays(k) <= 18 * 31) monthGroups.set(k, [...(monthGroups.get(k) ?? []), v]);
  }
  for (const [k, list] of monthGroups) {
    if (list.length < 4) continue;
    add('month', `month:${new Date(k).getFullYear()}-${new Date(k).getMonth() + 1}`, list, {
      kicker: 'BEST OF THE MONTH',
      title: `Best of ${monthName(k)}`,
      subtitle: `${new Date(k).getFullYear()} · ${plural(list.length, 'video')}`,
      mood: 'gentle',
      tone: 5,
      score: 30 + recency(k),
    }, 10);
  }

  // Seasons.
  const seasonGroups = new Map<string, { name: string; year: number; list: MVideo[] }>();
  for (const v of all) {
    const d = new Date(v.createdAt);
    const s = SEASONS.find((x) => (x.months as readonly number[]).includes(d.getMonth()))!;
    const year = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
    const k = `${year}-${s.key}`;
    const g = seasonGroups.get(k) ?? { name: s.name, year, list: [] };
    g.list.push(v);
    seasonGroups.set(k, g);
  }
  for (const [k, g] of seasonGroups) {
    if (g.list.length < 5) continue;
    add('season', `season:${k}`, g.list, {
      kicker: 'SEASON',
      title: `${g.name} ${g.year}`,
      subtitle: plural(g.list.length, 'video'),
      mood: g.name === 'Summer' ? 'upbeat' : 'gentle',
      tone: 6,
      score: 25 + recency(g.list[g.list.length - 1].createdAt) / 2,
    });
  }

  // Themes from your tags.
  const tagGroups = new Map<string, MVideo[]>();
  for (const v of all) for (const t of v.tagNames) tagGroups.set(t, [...(tagGroups.get(t) ?? []), v]);
  for (const [tag, list] of [...tagGroups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    if (list.length < 3) continue;
    const y1 = new Date(list[0].createdAt).getFullYear();
    const y2 = new Date(list[list.length - 1].createdAt).getFullYear();
    add('theme', `theme:${tag.toLowerCase()}`, list, {
      kicker: 'THEME',
      title: `${cap(tag)} moments`,
      subtitle: `${plural(list.length, 'video')} · ${y1 === y2 ? y1 : `${y1}–${y2}`}`,
      mood: 'upbeat',
      tone: 7,
      score: 20 + Math.min(15, list.length),
    });
  }

  // Favourites and forgotten gems.
  const favs = all.filter((v) => v.rating >= 8);
  if (favs.length >= 3)
    add('favourites', 'favourites', favs, { kicker: 'TOP RATED', title: 'Your favourites', subtitle: `${plural(favs.length, 'video')} rated 8 or more`, mood: 'epic', tone: 8, score: 40 });
  const gems = all.filter((v) => v.rating >= 7 && (lastPlay.get(v.id) ?? v.importedAt) < now - 90 * DAY);
  if (gems.length >= 3)
    add('gems', 'gems', gems, { kicker: 'REDISCOVER', title: 'Forgotten gems', subtitle: 'Great videos you haven’t watched in months', mood: 'gentle', tone: 9, score: 42 });

  // Whole years.
  const years = new Map<number, MVideo[]>();
  for (const v of all) years.set(new Date(v.createdAt).getFullYear(), [...(years.get(new Date(v.createdAt).getFullYear()) ?? []), v]);
  for (const [y, list] of years) {
    if (list.length < 6) continue;
    add('year', `year:${y}`, list, {
      kicker: y === today.getFullYear() ? 'SO FAR THIS YEAR' : 'YEAR IN VIDEOS',
      title: `${y} in videos`,
      subtitle: plural(list.length, 'video'),
      mood: 'epic',
      tone: 10,
      score: 15 + (y === today.getFullYear() ? 10 : 0),
    }, 16);
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Clip length and the gap between clips for each mood. */
export const MOODS: Record<Mood, { label: string; clipMs: number; fadeMs: number; blurb: string }> = {
  gentle: { label: 'Gentle', clipMs: 6000, fadeMs: 900, blurb: 'Slow and warm' },
  upbeat: { label: 'Upbeat', clipMs: 3200, fadeMs: 180, blurb: 'Quick cuts' },
  epic: { label: 'Epic', clipMs: 4500, fadeMs: 500, blurb: 'Wide and cinematic' },
};

export type Clip = { videoId: string; startMs: number; ms: number };

/** The clips a memory plays: each video once, from its highlight, short videos in full. */
export function memoryClips(m: Memory, videos: Map<string, Pick<MVideo, 'durationMs'>>, mood: Mood, bookmarks: Map<string, number[]> = new Map()): Clip[] {
  const clipMs = MOODS[mood].clipMs;
  return m.videoIds
    .filter((id) => videos.has(id))
    .map((id) => {
      const d = videos.get(id)!.durationMs;
      const ms = d && d > 0 ? Math.max(1500, Math.min(clipMs, d)) : clipMs;
      return { videoId: id, startMs: d && d <= clipMs ? 0 : highlightAt(d, bookmarks.get(id) ?? [], ms), ms };
    });
}

/** "1 min 12 s" for the memory's length. */
export function memoryLength(clips: Clip[]): string {
  const s = Math.round(clips.reduce((a, c) => a + c.ms, 0) / 1000) + 3;
  return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
}

/** Memories grouped for the Memories tab, without the ones you hid. */
export function memorySections(list: Memory[], hidden: string[], favs: string[]) {
  const shown = list.filter((m) => !hidden.includes(m.id));
  const of = (...k: MemoryKind[]) => shown.filter((m) => k.includes(m.kind));
  return {
    featured: shown.filter((m) => m.kind !== 'custom').slice(0, 6),
    favourites: shown.filter((m) => favs.includes(m.id)),
    mine: of('custom'),
    onThisDay: of('onThisDay'),
    moments: of('trip', 'day', 'recent').sort((a, b) => b.start - a.start),
    themes: of('theme', 'favourites', 'gems', 'repeat'),
    months: of('month', 'season').sort((a, b) => b.start - a.start),
    years: of('year').sort((a, b) => b.start - a.start),
  };
}

/** A memory you made yourself: a keyword, an album, dates and a lowest rating, any mix. */
export type CustomMemory = {
  id: string;
  title: string;
  tag: string | null;
  albumId: number | null;
  from: number | null;
  to: number | null;
  minRating: number;
  mood: Mood;
  createdAt: number;
};

export function isCustomMemory(x: unknown): x is CustomMemory {
  const c = x as CustomMemory;
  return !!c && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.createdAt === 'number' && ['gentle', 'upbeat', 'epic'].includes(c.mood);
}

/** The videos a custom memory picks. */
export function customMatches(c: Pick<CustomMemory, 'tag' | 'albumId' | 'from' | 'to' | 'minRating'>, videos: MVideo[]): MVideo[] {
  const tag = c.tag?.toLowerCase() ?? null;
  return videos
    .filter(
      (v) =>
        (!tag || v.tagNames.some((t) => t.toLowerCase() === tag)) &&
        (c.albumId === null || (v.albumIds ?? []).includes(c.albumId)) &&
        (c.from === null || v.createdAt >= c.from) &&
        (c.to === null || v.createdAt < c.to + DAY) &&
        v.rating >= c.minRating
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** A custom memory, made into a playable memory (null if nothing matches any more). */
export function customMemory(c: CustomMemory, videos: MVideo[], plays: RPlay[]): Memory | null {
  const list = customMatches(c, videos);
  if (!list.length) return null;
  const playsOf = new Map<string, number>();
  for (const p of plays) playsOf.set(p.videoId, (playsOf.get(p.videoId) ?? 0) + 1);
  const { ids, cover } = pickClips(list, playsOf, 20);
  return {
    id: c.id,
    kind: 'custom',
    kicker: 'MADE BY YOU',
    title: c.title,
    subtitle: plural(list.length, 'video'),
    videoIds: ids,
    coverId: cover,
    total: list.length,
    start: list[0].createdAt,
    end: list[list.length - 1].createdAt,
    mood: c.mood,
    tone: 4,
    score: 0,
  };
}
