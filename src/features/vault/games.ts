/**
 * Games with your own library: which episode is this still from, higher or
 * lower with your ratings, and name the show from its poster. Pure (rounds,
 * best scores, the daily streak), so it runs in Node tests.
 */

export const GAME_KINDS = ['episode', 'higher', 'show', 'cup', 'zoom', 'order', 'said', 'mangaCup', 'mangaZoom', 'mangaOrder'] as const;
export type GameKind = (typeof GAME_KINDS)[number];
/** `best` is the best score; for the cups, how many you have played. */
export type GamesState = { best: Record<GameKind, number>; streak: number; lastDay: string | null };

export const emptyGames = (): GamesState => ({ best: Object.fromEntries(GAME_KINDS.map((k) => [k, 0])) as Record<GameKind, number>, streak: 0, lastDay: null });

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const yesterdayKey = (ms: number) => dayKey(new Date(new Date(ms).setHours(12, 0, 0, 0)).getTime() - 86_400_000);

export function parseGames(json: string | null): GamesState {
  try {
    const r = json ? JSON.parse(json) : null;
    if (!r || typeof r !== 'object') return emptyGames();
    const n = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : 0);
    return {
      best: Object.fromEntries(GAME_KINDS.map((k) => [k, n(r.best?.[k])])) as Record<GameKind, number>,
      streak: n(r.streak),
      lastDay: typeof r.lastDay === 'string' ? r.lastDay : null,
    };
  } catch {
    return emptyGames();
  }
}

/** A game finished with this score: best kept, and the streak goes on (played yesterday) or starts again. */
export function recordGame(state: GamesState, kind: GameKind, score: number, now: number): GamesState {
  const today = dayKey(now);
  const streak = state.lastDay === today ? state.streak : state.lastDay === yesterdayKey(now) ? state.streak + 1 : 1;
  return { best: { ...state.best, [kind]: Math.max(state.best[kind], score) }, streak, lastDay: today };
}

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length) % list.length];
}

function sample<T>(list: T[], n: number, rand: () => number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/** A still from one episode of a series; the answer hidden among up to four of its episodes. Null without a series of 2+. */
export function episodeRound(series: { name: string; episodes: string[] }[], rand: () => number = Math.random): { series: string; answer: string; options: string[] } | null {
  const usable = series.filter((s) => s.episodes.length >= 2);
  if (!usable.length) return null;
  const s = pick(usable, rand);
  const options = sample(s.episodes, Math.min(4, s.episodes.length), rand);
  return { series: s.name, answer: pick(options, rand), options };
}

/** Two rated videos with different ratings: is the second higher or lower? Null when there aren't two. */
export function higherLowerPair<T extends { id: string; rating: number }>(items: T[], rand: () => number = Math.random): [T, T] | null {
  const rated = items.filter((i) => i.rating > 0);
  if (new Set(rated.map((i) => i.rating)).size < 2) return null;
  for (let tries = 0; tries < 50; tries++) {
    const [a, b] = sample(rated, 2, rand);
    if (a && b && a.rating !== b.rating) return [a, b];
  }
  const a = rated[0];
  const b = rated.find((x) => x.rating !== a.rating)!;
  return [a, b];
}

/** A poster and four titles to choose from. Null with fewer than four titles that have a poster. */
export function showRound<T extends { simklId: number; title: string; poster: string | null }>(titles: T[], rand: () => number = Math.random): { answer: number; options: number[] } | null {
  const withPoster = titles.filter((t) => t.poster);
  if (withPoster.length < 4) return null;
  const options = sample(withPoster, 4, rand).map((t) => t.simklId);
  return { answer: pick(options, rand), options };
}
