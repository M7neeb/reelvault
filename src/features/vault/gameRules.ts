/**
 * The rules of the bigger games: Knockout cup (a bracket, two at a time),
 * Zoom detective (a close-up that zooms out; quicker answers score more),
 * Put it in order (four moments of one video or chapter) and Who said that
 * (words read off a video's screen). Pure, so it runs in Node tests; the
 * screens are in ui/gamesKit.tsx.
 */

export type Rand = () => number;

export function shuffle<T>(list: T[], rand: Rand = Math.random): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ── Knockout cup ────────────────────────────────────────────────────────

/** A bracket: the rounds already played, the one being played and the winners it has given so far. */
export type Cup = { played: string[][]; round: string[]; winners: string[] };

/** The biggest bracket the pool fills, up to `wanted`: 16, 8 or 4 (0 when fewer than 4). */
export function cupSize(pool: number, wanted = 16): number {
  for (const n of [16, 8, 4]) if (n <= wanted && pool >= n) return n;
  return 0;
}

/** A new bracket: `size` entrants drawn at random from the pool. */
export function newCup(ids: string[], size: number, rand: Rand = Math.random): Cup | null {
  const unique = [...new Set(ids)];
  const n = cupSize(unique.length, size);
  if (!n) return null;
  return { played: [], round: shuffle(unique, rand).slice(0, n), winners: [] };
}

/** The two to choose between now, or null once there is a champion. */
export function cupMatch(cup: Cup): [string, string] | null {
  const i = cup.winners.length * 2;
  const a = cup.round[i];
  const b = cup.round[i + 1];
  return cup.round.length >= 2 && a && b ? [a, b] : null;
}

/** The winner of the current match goes through; a finished round starts the next. */
export function cupPick(cup: Cup, winner: string): Cup {
  const match = cupMatch(cup);
  if (!match || !match.includes(winner)) return cup;
  const winners = [...cup.winners, winner];
  if (winners.length * 2 < cup.round.length) return { ...cup, winners };
  return { played: [...cup.played, cup.round], round: winners, winners: [] };
}

/** Where the bracket is: the round's name and the match within it. */
export function cupStage(cup: Cup): { round: string; match: number; matches: number } {
  const n = cup.round.length;
  const round = n <= 2 ? 'Final' : n <= 4 ? 'Semi-finals' : n <= 8 ? 'Quarter-finals' : `Round of ${n}`;
  return { round, match: cup.winners.length + 1, matches: Math.max(1, n / 2) };
}

/** The champion, or null while matches are left. */
export function cupChampion(cup: Cup): string | null {
  return cup.round.length === 1 && cup.played.length > 0 ? cup.round[0] : null;
}

/** The final four in finishing order: champion, runner-up, then the two semi-final losers. */
export function cupPodium(cup: Cup): string[] {
  const champ = cupChampion(cup);
  if (!champ) return [];
  const final = cup.played[cup.played.length - 1] ?? [];
  const semis = cup.played[cup.played.length - 2] ?? [];
  return [champ, ...final.filter((x) => x !== champ), ...semis.filter((x) => !final.includes(x))];
}

/** Undo the last pick (a misstap): back to the match before it. */
export function cupUndo(cup: Cup): Cup {
  if (cup.winners.length) return { ...cup, winners: cup.winners.slice(0, -1) };
  const prev = cup.played[cup.played.length - 1];
  if (!prev) return cup;
  return { played: cup.played.slice(0, -1), round: prev, winners: cup.round.slice(0, -1) };
}

// ── Zoom detective ──────────────────────────────────────────────────────

export const ZOOM_MS = 8000;
export const ZOOM_FROM = 5;

/** Points for a right answer: 10 straight away, one fewer for each 0.8 s, never below 1. */
export function zoomPoints(elapsedMs: number): number {
  return Math.max(1, 10 - Math.floor(Math.max(0, elapsedMs) / (ZOOM_MS / 10)));
}

/** How far in the picture is after `elapsedMs`: ZOOM_FROM at the start, whole at ZOOM_MS (eases out). */
export function zoomScale(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / ZOOM_MS));
  const eased = 1 - (1 - t) * (1 - t);
  return ZOOM_FROM + (1 - ZOOM_FROM) * eased;
}

/** One round: the answer and three others to choose from, and where the close-up starts (away from the edges). */
export function zoomRound(names: string[], rand: Rand = Math.random): { answer: string; options: string[]; focus: { x: number; y: number } } | null {
  const unique = [...new Set(names)];
  if (unique.length < 4) return null;
  const options = shuffle(unique, rand).slice(0, 4);
  const answer = options[Math.floor(rand() * 4) % 4];
  return { answer, options, focus: { x: 0.25 + rand() * 0.5, y: 0.25 + rand() * 0.5 } };
}

// ── Put it in order ─────────────────────────────────────────────────────

/** Four moments spread through `count` (frames or pages), in true order, and the order they are shown in (never already sorted). */
export function orderRound(count: number, rand: Rand = Math.random): { truth: number[]; shown: number[] } | null {
  if (count < 4) return null;
  // One from each quarter, so no two are next to each other and look the same.
  const truth = [0, 1, 2, 3].map((q) => {
    const lo = Math.floor((q * count) / 4);
    const hi = Math.max(lo, Math.floor(((q + 1) * count) / 4) - 1);
    return lo + Math.floor(rand() * (hi - lo + 1));
  });
  let shown = shuffle(truth, rand);
  for (let i = 0; i < 10 && shown.every((x, k) => x === truth[k]); i++) shown = shuffle(truth, rand);
  if (shown.every((x, k) => x === truth[k])) shown = [truth[1], truth[0], truth[3], truth[2]];
  return { truth, shown };
}

/** How many of the four sit in the right place. */
export function orderScore(picked: number[], truth: number[]): number {
  return truth.filter((x, i) => picked[i] === x).length;
}

// ── Who said that ───────────────────────────────────────────────────────

/** Words read off a screen worth asking about: a few real words, not a timestamp or a watermark. */
export function quoteOf(words: string): string | null {
  const text = words.replace(/\s+/g, ' ').trim();
  const real = text.split(' ').filter((w) => /\p{L}{2,}/u.test(w));
  if (real.length < 3 || text.length < 14) return null;
  if (/^(tiktok|@\S+|www\.|https?:)/i.test(text)) return null;
  return text.length > 90 ? `${text.slice(0, 88).replace(/\s+\S*$/, '')}…` : text;
}

/** One round: a quote from one video and four videos to choose from (each quote's text appears in only one of them). */
export function saidRound(
  rows: { videoId: string; atMs: number; words: string }[],
  rand: Rand = Math.random
): { quote: string; answer: string; atMs: number; options: string[] } | null {
  const byText = new Map<string, Set<string>>();
  const usable: { videoId: string; atMs: number; quote: string }[] = [];
  for (const r of rows) {
    const quote = quoteOf(r.words);
    if (!quote) continue;
    const key = quote.toLowerCase();
    byText.set(key, (byText.get(key) ?? new Set()).add(r.videoId));
    usable.push({ videoId: r.videoId, atMs: r.atMs, quote });
  }
  // The same words on several videos (a channel name, a recurring title) would have more than one right answer.
  const unique = usable.filter((u) => byText.get(u.quote.toLowerCase())!.size === 1);
  const videos = [...new Set(usable.map((u) => u.videoId))];
  if (!unique.length || videos.length < 4) return null;
  const pick = unique[Math.floor(rand() * unique.length) % unique.length];
  const others = shuffle(videos.filter((v) => v !== pick.videoId), rand).slice(0, 3);
  return { quote: pick.quote, answer: pick.videoId, atMs: pick.atMs, options: shuffle([pick.videoId, ...others], rand) };
}
