/**
 * What Overview keeps besides ratings and status, per title (by its key,
 * 's:<series id>' or 'v:<video id>'):
 * - a short review with its date,
 * - rewatches (the days you watched it all again),
 * - your Plan to Watch order,
 * - every rating you gave, with when (for how your ratings changed).
 * And the stats Overview shows from them. Pure: no React, no database.
 */

/** Where it is saved (the settings table). */
export const OV_EXTRA_KEY = 'vault.ovExtra';

export type OvReview = { text: string; at: number };

export type OvExtra = {
  reviews: Record<string, OvReview>;
  rewatches: Record<string, number[]>;
  planOrder: string[];
  ratingLog: { key: string; rating: number; at: number }[];
};

export const EMPTY_OV_EXTRA: OvExtra = { reviews: {}, rewatches: {}, planOrder: [], ratingLog: [] };

export function parseOvExtra(json: string | null): OvExtra {
  try {
    const r = json ? JSON.parse(json) : {};
    const reviews: Record<string, OvReview> = {};
    for (const [k, v] of Object.entries(r?.reviews ?? {})) {
      const x = v as { text?: unknown; at?: unknown };
      if (typeof x?.text === 'string' && x.text.trim() && typeof x.at === 'number') reviews[k] = { text: x.text.slice(0, 2000), at: x.at };
    }
    const rewatches: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(r?.rewatches ?? {})) if (Array.isArray(v)) rewatches[k] = v.filter((t) => typeof t === 'number').slice(-100);
    return {
      reviews,
      rewatches,
      planOrder: Array.isArray(r?.planOrder) ? r.planOrder.filter((k: unknown) => typeof k === 'string').slice(0, 500) : [],
      ratingLog: Array.isArray(r?.ratingLog)
        ? r.ratingLog.filter((x: { key?: unknown; rating?: unknown; at?: unknown }) => typeof x?.key === 'string' && typeof x.rating === 'number' && typeof x.at === 'number').slice(-2000)
        : [],
    };
  } catch {
    return EMPTY_OV_EXTRA;
  }
}

export function setReview(x: OvExtra, key: string, text: string, now: number): OvExtra {
  const reviews = { ...x.reviews };
  if (text.trim()) reviews[key] = { text: text.trim().slice(0, 2000), at: now };
  else delete reviews[key];
  return { ...x, reviews };
}

export function addRewatch(x: OvExtra, key: string, now: number): OvExtra {
  return { ...x, rewatches: { ...x.rewatches, [key]: [...(x.rewatches[key] ?? []), now].slice(-100) } };
}

export function removeLastRewatch(x: OvExtra, key: string): OvExtra {
  const list = (x.rewatches[key] ?? []).slice(0, -1);
  const rewatches = { ...x.rewatches };
  if (list.length) rewatches[key] = list;
  else delete rewatches[key];
  return { ...x, rewatches };
}

/** A rating given (0 = taken away). Two changes within a minute count as one. */
export function logRating(x: OvExtra, key: string, rating: number, now: number): OvExtra {
  const last = x.ratingLog[x.ratingLog.length - 1];
  const log = last && last.key === key && now - last.at < 60_000 ? x.ratingLog.slice(0, -1) : x.ratingLog;
  return { ...x, ratingLog: [...log, { key, rating, at: now }].slice(-2000) };
}

/** Plan to Watch in your order: titles you placed first, then new ones (newest added first). */
export function orderPlanned<T extends { key: string; addedAt: number }>(planned: T[], order: string[]): T[] {
  const at = new Map(order.map((k, i) => [k, i]));
  return [...planned].sort((a, b) => {
    const ia = at.get(a.key);
    const ib = at.get(b.key);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return b.addedAt - a.addedAt;
  });
}

/** Moves a title up (-1), down (1) or to the top ('top') of the Plan to Watch order. */
export function movePlanned(keys: string[], key: string, how: -1 | 1 | 'top'): string[] {
  const list = keys.filter((k) => k !== key);
  const i = keys.indexOf(key);
  if (i < 0) return keys;
  const to = how === 'top' ? 0 : Math.max(0, Math.min(list.length, i + how));
  list.splice(to, 0, key);
  return list;
}

/**
 * For the backup file. Series ids differ on another phone, so series are
 * named ('S:<name>'); private videos and titles not in `keep` are left out.
 */
export function ovExtraForBackup(x: OvExtra, seriesName: Map<string, string>, keep: (key: string) => boolean): OvExtra {
  const key = (k: string): string | null => {
    if (k.startsWith('s:')) {
      const name = seriesName.get(k.slice(2));
      return name ? `S:${name}` : null;
    }
    return keep(k) ? k : null;
  };
  return remap(x, key);
}

/**
 * Joins a backup's extras with what is on the phone. `mapKey` turns a backup
 * key into this phone's key (null = no such title here). What is on the phone
 * wins for reviews; rewatches and the rating log are joined.
 */
export function mergeOvExtra(current: OvExtra, incoming: OvExtra, mapKey: (key: string) => string | null): OvExtra {
  const add = remap(incoming, mapKey);
  const reviews = { ...add.reviews, ...current.reviews };
  const rewatches: Record<string, number[]> = { ...current.rewatches };
  for (const [k, list] of Object.entries(add.rewatches)) rewatches[k] = [...new Set([...(rewatches[k] ?? []), ...list])].sort((a, b) => a - b).slice(-100);
  const planOrder = [...current.planOrder, ...add.planOrder.filter((k) => !current.planOrder.includes(k))];
  const seen = new Set(current.ratingLog.map((r) => `${r.key}|${r.at}`));
  const ratingLog = [...current.ratingLog, ...add.ratingLog.filter((r) => !seen.has(`${r.key}|${r.at}`))].sort((a, b) => a.at - b.at).slice(-2000);
  return { reviews, rewatches, planOrder, ratingLog };
}

function remap(x: OvExtra, key: (k: string) => string | null): OvExtra {
  const reviews: Record<string, OvReview> = {};
  for (const [k, v] of Object.entries(x.reviews)) {
    const to = key(k);
    if (to) reviews[to] = v;
  }
  const rewatches: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(x.rewatches)) {
    const to = key(k);
    if (to) rewatches[to] = v;
  }
  const planOrder = x.planOrder.map(key).filter((k): k is string => !!k);
  const ratingLog = x.ratingLog.flatMap((r) => {
    const to = key(r.key);
    return to ? [{ ...r, key: to }] : [];
  });
  return { reviews, rewatches, planOrder, ratingLog };
}

/** Plan to Watch keys in order, after a move, for every planned title (so new ones get a place too). */
export function planKeys<T extends { key: string; addedAt: number }>(planned: T[], order: string[]): string[] {
  return orderPlanned(planned, order).map((e) => e.key);
}

type StatEntry = { key: string; kind: 'series' | 'single'; title: string; rating: number; episodes: { watched: boolean; lastWatchedAt: number | null; firstAt?: number | null }[]; plays: number; lastWatchedAt: number | null; gone: boolean };

export type OvStats = {
  /** Average rating you gave, month by month (from the rating log; last 12 months with ratings). */
  ratingsByMonth: { key: string; label: string; avg: number; count: number }[];
  /** Series you finished, with how many days from first to last episode. */
  fastest: { key: string; title: string; days: number }[];
  mostRewatched: { key: string; title: string; times: number }[];
  finished: number;
  inProgress: number;
  reviewed: number;
  /** Ratings that went up or down since first given. */
  changedMinds: { key: string; title: string; from: number; to: number }[];
};

export function ovStats(entries: StatEntry[], x: OvExtra, firstPlay: Map<string, number>): OvStats {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const months = new Map<string, { sum: number; count: number; t: number }>();
  for (const r of x.ratingLog) {
    if (!r.rating) continue;
    const d = new Date(r.at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = months.get(k) ?? { sum: 0, count: 0, t: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
    m.sum += r.rating;
    m.count++;
    months.set(k, m);
  }
  const ratingsByMonth = [...months.entries()]
    .sort((a, b) => a[1].t - b[1].t)
    .slice(-12)
    .map(([key, m]) => ({ key, label: new Date(m.t).toLocaleDateString('en-GB', { month: 'short' }), avg: Math.round((m.sum / m.count) * 10) / 10, count: m.count }));

  const series = entries.filter((e) => e.kind === 'series' && e.episodes.length > 0);
  const done = series.filter((e) => e.episodes.every((ep) => ep.watched));
  const fastest = done
    .map((e) => {
      const first = firstPlay.get(e.key);
      const last = Math.max(0, ...e.episodes.map((ep) => ep.lastWatchedAt ?? 0));
      return first && last ? { key: e.key, title: e.title, days: Math.max(1, Math.round((last - first) / 86_400_000)) } : null;
    })
    .filter((v): v is { key: string; title: string; days: number } => !!v)
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  const mostRewatched = Object.entries(x.rewatches)
    .map(([key, list]) => ({ key, title: byKey.get(key)?.title ?? '', times: list.length }))
    .filter((r) => r.title && r.times > 0)
    .sort((a, b) => b.times - a.times)
    .slice(0, 5);

  const firstGiven = new Map<string, number>();
  for (const r of x.ratingLog) if (r.rating && !firstGiven.has(r.key)) firstGiven.set(r.key, r.rating);
  const changedMinds = [...firstGiven.entries()]
    .map(([key, from]) => ({ key, title: byKey.get(key)?.title ?? '', from, to: byKey.get(key)?.rating ?? 0 }))
    .filter((c) => c.title && c.to > 0 && Math.abs(c.to - c.from) >= 1)
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
    .slice(0, 5);

  return {
    ratingsByMonth,
    fastest,
    mostRewatched,
    finished: done.length,
    inProgress: series.filter((e) => e.episodes.some((ep) => ep.watched) && !e.episodes.every((ep) => ep.watched)).length,
    reviewed: Object.keys(x.reviews).filter((k) => byKey.has(k)).length,
    changedMinds,
  };
}
