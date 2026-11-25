/**
 * Rank your favourites: two things at a time, "which did you like more?".
 * Each item carries an Elo-style score; a rated item starts where its rating
 * puts it, so a few picks refine your ratings instead of starting from zero.
 * Pure, so it runs in Node tests; the UI saves the state after every pick.
 */

export type RankScore = { s: number; n: number };
export type RankState = { v: 1; scores: Record<string, RankScore>; recent: string[]; picks: number };
/** rating: 1..10, or null / 0 when not rated. */
export type RankItem = { id: string; rating: number | null };
export type RankChange = { id: string; from: number | null; to: number };
export type PickResult = 'a' | 'b' | 'tie';

const BASE = 1500;
const PER_POINT = 60;
const RECENT_KEEP = 300;

export const emptyRank = (): RankState => ({ v: 1, scores: {}, recent: [], picks: 0 });

const rated = (r: number | null | undefined): r is number => typeof r === 'number' && r > 0;

export function parseRank(json: string | null): RankState {
  try {
    const raw = json ? JSON.parse(json) : null;
    if (!raw || raw.v !== 1 || typeof raw.scores !== 'object' || !raw.scores) return emptyRank();
    const scores: Record<string, RankScore> = {};
    for (const [id, v] of Object.entries(raw.scores as Record<string, any>)) {
      if (v && Number.isFinite(v.s) && Number.isInteger(v.n) && v.n >= 0) scores[id] = { s: v.s, n: v.n };
    }
    const recent = Array.isArray(raw.recent) ? raw.recent.filter((k: unknown) => typeof k === 'string').slice(-RECENT_KEEP) : [];
    const picks = Number.isInteger(raw.picks) && raw.picks >= 0 ? raw.picks : 0;
    return { v: 1, scores, recent, picks };
  } catch {
    return emptyRank();
  }
}

export function scoreOf(state: RankState, item: RankItem): number {
  const known = state.scores[item.id];
  if (known) return known.s;
  return rated(item.rating) ? BASE + (item.rating - 5.5) * PER_POINT : BASE;
}

const countOf = (state: RankState, id: string) => state.scores[id]?.n ?? 0;

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function recordPick(state: RankState, a: RankItem, b: RankItem, winner: PickResult): RankState {
  const sa = scoreOf(state, a);
  const sb = scoreOf(state, b);
  const na = countOf(state, a.id);
  const nb = countOf(state, b.id);
  // Big steps while an item is new, small ones once it has been compared a lot.
  const k = 24 + 40 / (1 + Math.min(na, nb));
  const expectA = 1 / (1 + 10 ** ((sb - sa) / 400));
  const resultA = winner === 'a' ? 1 : winner === 'b' ? 0 : 0.5;
  const delta = k * (resultA - expectA);
  return {
    v: 1,
    scores: { ...state.scores, [a.id]: { s: sa + delta, n: na + 1 }, [b.id]: { s: sb - delta, n: nb + 1 } },
    recent: [...state.recent, pairKey(a.id, b.id)].slice(-RECENT_KEEP),
    picks: state.picks + 1,
  };
}

/** "Skip": no score change, but the pair is not offered again for a while. */
export function skipPair(state: RankState, a: RankItem, b: RankItem): RankState {
  return { ...state, recent: [...state.recent, pairKey(a.id, b.id)].slice(-RECENT_KEEP) };
}

function weighted<T>(list: T[], weight: (t: T) => number, rng: () => number): T {
  const ws = list.map(weight);
  const total = ws.reduce((x, y) => x + y, 0);
  let r = rng() * total;
  for (let i = 0; i < list.length; i++) {
    r -= ws[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

/**
 * The next two to compare: an item that has been asked about little, against
 * one with a close score (the pick that teaches the most), never a pair from
 * the recent ones while another is left.
 */
export function nextPair<T extends RankItem>(state: RankState, items: T[], rng: () => number = Math.random): [T, T] | null {
  if (items.length < 2) return null;
  const recent = new Set(state.recent);
  const score = new Map(items.map((i) => [i.id, scoreOf(state, i)]));
  const anchors = [...items];
  const anchorWeight = (i: T) => 1 / (1 + countOf(state, i.id)) ** 2;
  while (anchors.length) {
    const a = weighted(anchors, anchorWeight, rng);
    const open = items.filter((o) => o.id !== a.id && !recent.has(pairKey(a.id, o.id)));
    if (open.length) {
      const sa = score.get(a.id)!;
      const near = open
        .map((o) => ({ o, w: Math.exp(-Math.abs(score.get(o.id)! - sa) / 150) * (1 + 1 / (1 + countOf(state, o.id))) }))
        .sort((x, y) => y.w - x.w)
        .slice(0, 6);
      const b = weighted(near, (x) => x.w, rng).o;
      return rng() < 0.5 ? [a, b] : [b, a];
    }
    anchors.splice(anchors.indexOf(a), 1);
  }
  // Every pair has been asked lately: ask again rather than stop.
  const a = weighted(items, anchorWeight, rng);
  const b = weighted(items.filter((o) => o.id !== a.id), () => 1, rng);
  return [a, b];
}

/** Rated or compared items, best first. Unrated items nobody has compared stay out. */
export function ranked<T extends RankItem>(state: RankState, items: T[]): T[] {
  return items
    .filter((i) => rated(i.rating) || countOf(state, i.id) > 0)
    .map((i) => ({ i, s: scoreOf(state, i) }))
    .sort((x, y) => y.s - x.s || (y.i.rating ?? 0) - (x.i.rating ?? 0) || (x.i.id < y.i.id ? -1 : 1))
    .map((x) => x.i);
}

/**
 * New ratings from the ranking, on your own scale: the item at the top 10 %
 * gets the rating your top 10 % already has. Whole numbers unless you rate
 * with decimals. Only items compared enough, and only real moves.
 */
export function suggestRatings(state: RankState, items: RankItem[]): RankChange[] {
  const list = ranked(state, items);
  if (list.length < 2) return [];
  const scale = items.filter((i) => rated(i.rating)).map((i) => i.rating as number).sort((x, y) => y - x);
  const decimals = scale.some((r) => !Number.isInteger(r));
  const round = (x: number) => Math.min(10, Math.max(1, decimals ? Math.round(x * 10) / 10 : Math.round(x)));
  const out: RankChange[] = [];
  list.forEach((item, i) => {
    const p = i / (list.length - 1);
    let target: number;
    if (scale.length >= 3) {
      const at = p * (scale.length - 1);
      const lo = Math.floor(at);
      const hi = Math.ceil(at);
      target = scale[lo] + (scale[hi] - scale[lo]) * (at - lo);
    } else {
      target = 9 - 6 * p;
    }
    const to = round(target);
    const from = rated(item.rating) ? item.rating : null;
    const n = countOf(state, item.id);
    if (n < (from === null ? 2 : 3)) return;
    if (from !== null && Math.abs(to - from) < (decimals ? 0.5 : 1)) return;
    out.push({ id: item.id, from, to });
  });
  return out;
}

/** Share of the items compared at least three times (how settled the order is). */
export function confidence(state: RankState, items: RankItem[]): number {
  if (!items.length) return 0;
  return items.filter((i) => countOf(state, i.id) >= 3).length / items.length;
}
