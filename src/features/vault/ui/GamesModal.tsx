/**
 * Games with your own library: Knockout cup (a bracket of your videos), Zoom
 * detective, Put it in order, Who said that (words read off the screen),
 * Which episode is this?, Higher or lower (your ratings) and Name that show
 * (a Simkl poster coming into focus). Best scores and a daily streak are kept.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { posterUrl, type SimklItem } from '@/features/simkl/logic';
import { emptyGames, episodeRound, higherLowerPair, parseGames, recordGame, showRound, type GameKind, type GamesState } from '../games';
import { orderRound, saidRound, zoomRound } from '../gameRules';
import type { SceneRow } from '../sceneLogic';
import { CupGame, OrderGame, SaidGame, useBestBefore, ZoomGame, type CupEntry } from './gamesKit';
import { friendlyName } from '../names';
import EmptyState from './EmptyState';
import { success, tick, warn } from './haptics';
import Icon from './Icon';
import type { IconName } from './icons';
import { Rows, Row, SheetFrame } from './sheets';
import { raised, sheet, usePalette, useStyles, type Palette } from './theme';
import type { OverviewData, ThumbSource, VaultActions, VaultItem } from './types';

const ROUNDS = 10;

type Props = {
  items: VaultItem[];
  overview: OverviewData;
  actions: VaultActions;
  /** Your Simkl titles (for Name that show); null while loading or not signed in. */
  loadTitles?: () => Promise<SimklItem[]>;
  /** Clips play in the Knockout cup (off in the browser preview). */
  enableVideo?: boolean;
  /** Words read off the videos' screens, for Who said that. */
  sceneRows?: { current: SceneRow[] };
  /** Plays a video (the cup's champion). */
  onOpen?: (v: VaultItem) => void;
  onClose: () => void;
};

type GameKindHere = Exclude<GameKind, 'mangaCup' | 'mangaZoom' | 'mangaOrder'>;

const GAMES: { kind: GameKindHere; icon: IconName; tint: string; title: string; sub: string }[] = [
  { kind: 'cup', icon: 'trophy', tint: '#FF5A36', title: 'Knockout cup', sub: '16 of your videos, two at a time, until one is left.' },
  { kind: 'zoom', icon: 'search', tint: '#30D158', title: 'Zoom detective', sub: 'A close-up zooms out. Name it before it is whole.' },
  { kind: 'order', icon: 'sort', tint: '#64D2FF', title: 'Put it in order', sub: 'Four moments of one video, shuffled. Tap them in order.' },
  { kind: 'said', icon: 'quote', tint: '#FFD60A', title: 'Who said that', sub: 'Words from a video\'s screen. Which video?' },
  { kind: 'episode', icon: 'videos', tint: '#0A84FF', title: 'Which episode is this?', sub: 'A still from one of your series. Pick the episode.' },
  { kind: 'higher', icon: 'star', tint: '#FF9F0A', title: 'Higher or lower', sub: 'Did you rate the next video higher or lower?' },
  { kind: 'show', icon: 'tv', tint: '#BF5AF2', title: 'Name that show', sub: 'A poster comes into focus. Name it fast.' },
];

export default function GamesModal({ items, overview, actions, loadTitles, enableVideo = true, sceneRows, onOpen, onClose }: Props) {
  const styles = useStyles(makeStyles);
  const [state, setState] = useState<GamesState>(emptyGames());
  const [playing, setPlaying] = useState<GameKindHere | null>(null);
  const [titles, setTitles] = useState<SimklItem[] | null>(null);

  useEffect(() => {
    actions
      .loadGames()
      .then((j) => setState(parseGames(j)))
      .catch(() => undefined);
    loadTitles?.()
      .then(setTitles)
      .catch(() => setTitles([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(items.filter((v) => !v.isPrivate && !v.deletedAt).map((v) => [v.id, v])), [items]);
  const series = useMemo(
    () =>
      overview.series
        .map((s) => ({
          name: s.name,
          episodes: overview.members
            .filter((m) => m.seriesId === s.id && byId.has(m.videoId))
            .sort((a, b) => a.position - b.position)
            .map((m) => m.videoId),
          labels: new Map(overview.members.filter((m) => m.seriesId === s.id).map((m) => [m.videoId, m.label])),
        }))
        .filter((s) => s.episodes.length >= 2),
    [overview, byId]
  );
  const rated = useMemo(() => [...byId.values()].filter((v) => v.rating > 0), [byId]);
  const shows = useMemo(() => (titles ?? []).filter((t) => t.poster && t.status !== 'plantowatch'), [titles]);

  const all = useMemo(() => [...byId.values()], [byId]);
  const long = useMemo(() => all.filter((v) => (v.durationMs ?? 0) >= 20_000), [all]);
  const rows = sceneRows?.current ?? [];
  const saidReady = useMemo(() => saidRound(rows.filter((r) => byId.has(r.videoId))) !== null, [rows, byId]);

  const can: Record<GameKindHere, boolean> = {
    cup: all.length >= 4,
    zoom: all.length >= 4,
    order: long.length >= 1,
    said: saidReady,
    episode: series.length > 0,
    higher: new Set(rated.map((v) => v.rating)).size >= 2,
    show: shows.length >= 4,
  };
  const why: Record<GameKindHere, string> = {
    cup: 'Needs four or more videos.',
    zoom: 'Needs four or more videos.',
    order: 'Needs a video of 20 seconds or more.',
    said: 'Needs text read off your videos\' screens. Search for a word on screen to start the reading.',
    episode: 'Needs a series with two or more episodes (Overview).',
    higher: 'Needs videos with at least two different ratings.',
    show: titles === null ? 'Loading your Simkl titles…' : 'Needs four or more titles on your Simkl.',
  };

  // ── the rounds of the new games ──
  const entries = useMemo(
    () =>
      new Map<string, CupEntry>(
        all.map((v) => [
          v.id,
          { id: v.id, title: friendlyName(v), sub: v.rating ? `Rated ${v.rating}` : undefined, pic: v.thumbSource, uri: v.uri, startMs: v.durationMs && v.durationMs >= 6000 ? Math.round(v.durationMs * 0.3) : 0 },
        ])
      ),
    [all]
  );
  const pools = useMemo(() => {
    const ids = (list: VaultItem[]) => list.map((v) => v.id);
    const tags = new Map<string, string[]>();
    for (const v of all) for (const t of v.tagNames) tags.set(t, [...(tags.get(t) ?? []), v.id]);
    return [
      { key: 'all', label: 'All videos', ids: ids(all) },
      { key: 'fav', label: 'Rated 8+', ids: ids(all.filter((v) => v.rating >= 8)) },
      { key: 'unrated', label: 'Not rated yet', ids: ids(all.filter((v) => !v.rating)) },
      ...[...tags.entries()]
        .filter(([, list]) => list.length >= 4)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 8)
        .map(([t, list]) => ({ key: `tag:${t}`, label: `#${t}`, ids: list })),
    ].filter((x) => x.key === 'all' || x.ids.length >= 4);
  }, [all]);

  /** A sharp frame from the middle part of a video (not the opening most episodes share), or its cover. */
  const frameOf = async (v: VaultItem) => {
    const d = v.durationMs ?? 0;
    const at = d > 4000 ? Math.round(d * (0.2 + Math.random() * 0.65)) : 0;
    return (await actions.gameFrame?.(v, at).catch(() => null)) ?? v.thumbSource;
  };
  const makeZoom = async () => {
    // Series when there are four: name the series; otherwise name the video.
    if (series.length >= 4) {
      const r = zoomRound(series.map((x) => x.name));
      const s = r && series.find((x) => x.name === r.answer);
      const v = s && byId.get(s.episodes[Math.floor(Math.random() * s.episodes.length)]);
      if (!r || !v) return null;
      return { pic: await frameOf(v), answer: r.answer, options: r.options.map((o) => ({ key: o, label: o })), focus: r.focus };
    }
    const r = zoomRound(all.map((v) => v.id));
    const v = r && byId.get(r.answer);
    if (!r || !v) return null;
    return { pic: await frameOf(v), answer: r.answer, options: r.options.map((id) => ({ key: id, label: friendlyName(byId.get(id)!) })), focus: r.focus };
  };
  const makeOrder = async () => {
    const v = long[Math.floor(Math.random() * long.length)];
    if (!v) return null;
    const frames = await actions.loadFrames(v).catch(() => []);
    const r = orderRound(frames.length);
    if (!r) return null;
    return { title: friendlyName(v), pics: r.shown.map((i) => ({ key: i, pic: frames[i] })), truth: r.truth };
  };
  const makeSaid = async () => {
    const r = saidRound(rows.filter((x) => byId.has(x.videoId)));
    if (!r) return null;
    const mins = Math.floor(r.atMs / 60000);
    const secs = String(Math.floor((r.atMs % 60000) / 1000)).padStart(2, '0');
    return {
      quote: r.quote,
      answer: r.answer,
      sub: `On screen at ${mins}:${secs}`,
      options: r.options.map((id) => ({ key: id, label: friendlyName(byId.get(id)!), pic: byId.get(id)!.thumbSource })),
    };
  };

  const finish = (kind: GameKind, score: number) => {
    const next = recordGame(state, kind, score, Date.now());
    setState(next);
    void actions.saveGames(JSON.stringify(next)).catch(() => undefined);
  };

  return (
    <SheetFrame page title={GAMES.find((g) => g.kind === playing)?.title ?? 'Games'} onClose={playing ? () => setPlaying(null) : onClose}>
      {!playing ? (
        <View style={styles.body}>
          <Text style={styles.lead}>
            {state.streak > 1 ? `${state.streak} days in a row. Play one today to keep it going.` : 'Little games with your own videos and shows. Play one a day for a streak.'}
          </Text>
          {[
            { label: 'Games', list: GAMES.slice(0, 4) },
            { label: 'Quick rounds', list: GAMES.slice(4) },
          ].map((group) => (
            <Rows key={group.label} label={group.label}>
              {group.list.map((g) => (
                <Row
                  key={g.kind}
                  icon={g.icon}
                  tint={g.tint}
                  title={g.title}
                  sub={can[g.kind] ? `${g.sub}${state.best[g.kind] ? (g.kind === 'cup' ? ` Cups played: ${state.best.cup}` : ` Best: ${state.best[g.kind]}`) : ''}` : why[g.kind]}
                  onPress={can[g.kind] ? () => setPlaying(g.kind) : undefined}
                />
              ))}
            </Rows>
          ))}
        </View>
      ) : playing === 'cup' ? (
        <CupGame
          entries={entries}
          pools={pools}
          videos
          enableVideo={enableVideo}
          onFinished={() => finish('cup', state.best.cup + 1)}
          onOpen={onOpen ? (id) => byId.get(id) && onOpen(byId.get(id)!) : undefined}
        />
      ) : playing === 'zoom' ? (
        <ZoomGame make={makeZoom} aspect={1} best={state.best.zoom} intro={series.length >= 4 ? 'Which series is this from?' : 'Which video is this?'} onDone={(s) => finish('zoom', s)} />
      ) : playing === 'order' ? (
        <OrderGame make={makeOrder} aspect={1} best={state.best.order} onDone={(s) => finish('order', s)} />
      ) : playing === 'said' ? (
        <SaidGame make={makeSaid} best={state.best.said} onDone={(s) => finish('said', s)} />
      ) : playing === 'episode' ? (
        <EpisodeGame series={series} byId={byId} actions={actions} best={state.best.episode} onDone={(s) => finish('episode', s)} />
      ) : playing === 'higher' ? (
        <HigherGame rated={rated} best={state.best.higher} onDone={(s) => finish('higher', s)} />
      ) : (
        <ShowGame shows={shows} best={state.best.show} onDone={(s) => finish('show', s)} />
      )}
    </SheetFrame>
  );
}

/** Right / wrong for a moment, then the next round. */
function useAnswer(onNext: (right: boolean) => void) {
  const [picked, setPicked] = useState<string | number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const answer = (choice: string | number, right: boolean) => {
    if (picked !== null) return;
    setPicked(choice);
    if (right) success();
    else warn();
    timer.current = setTimeout(() => {
      setPicked(null);
      onNext(right);
    }, 900);
  };
  return { picked, answer };
}

function Score({ score, round, best }: { score: number; round?: number; best: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.scoreRow}>
      <Text style={styles.scoreBig}>{score}</Text>
      <Text style={styles.scoreSub}>{[round !== undefined ? `Round ${Math.min(round + 1, ROUNDS)} of ${ROUNDS}` : 'In a row', best ? `Best ${best}` : null].filter(Boolean).join(' · ')}</Text>
    </View>
  );
}

function Done({ score, best, outOf, onAgain }: { score: number; best: number; outOf?: number; onAgain: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const record = score > best;
  return (
    <View style={styles.body}>
      <EmptyState
        icon={record ? 'trophy' : 'target'}
        title={outOf ? `${score} out of ${outOf}` : `${score} in a row`}
        text={record ? 'A new best.' : best ? `Your best is ${best}.` : undefined}
        tint={record ? '#FF9F0A' : p.textSecondary}
        action={{ label: 'Play again', onPress: onAgain }}
      />
    </View>
  );
}

function EpisodeGame({
  series,
  byId,
  actions,
  best,
  onDone,
}: {
  series: { name: string; episodes: string[]; labels: Map<string, string | null> }[];
  byId: Map<string, VaultItem>;
  actions: VaultActions;
  best: number;
  onDone: (score: number) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const before = useBestBefore(best, over);
  const [q, setQ] = useState(() => episodeRound(series));
  const [still, setStill] = useState<ThumbSource | null>(null);
  const { picked, answer } = useAnswer((right) => {
    const s = score + (right ? 1 : 0);
    setScore(s);
    if (round + 1 >= ROUNDS) {
      setOver(true);
      onDone(s);
      return;
    }
    setRound(round + 1);
    setQ(episodeRound(series));
  });
  useEffect(() => {
    setStill(null);
    const v = q ? byId.get(q.answer) : undefined;
    if (!v) return;
    let live = true;
    actions
      .loadFrames(v)
      .then((frames) => {
        // A frame from the middle part, not the opening every episode shares.
        const inner = frames.length > 4 ? frames.slice(Math.floor(frames.length * 0.25), Math.ceil(frames.length * 0.85)) : frames;
        if (live) setStill(inner[Math.floor(Math.random() * inner.length)] ?? v.thumbSource);
      })
      .catch(() => live && setStill(v.thumbSource));
    return () => {
      live = false;
    };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (over)
    return (
      <Done
        score={score}
        best={before}
        outOf={ROUNDS}
        onAgain={() => {
          setOver(false);
          setScore(0);
          setRound(0);
          setQ(episodeRound(series));
        }}
      />
    );
  if (!q) return null;
  const s = series.find((x) => x.name === q.series);
  const label = (id: string) => s?.labels.get(id) || friendlyName(byId.get(id) ?? { filename: '?' });
  return (
    <View style={styles.body}>
      <Score score={score} round={round} best={best} />
      <View style={[styles.still, { backgroundColor: raised(p) }]}>{still ? <Image source={still} style={styles.stillImg} contentFit="cover" transition={200} /> : null}</View>
      <Text style={styles.question}>Which episode of {q.series}?</Text>
      <View style={styles.options}>
        {q.options.map((id) => (
          <Option key={id} label={label(id)} state={picked === null ? 'idle' : id === q.answer ? 'right' : picked === id ? 'wrong' : 'idle'} onPress={() => answer(id, id === q.answer)} />
        ))}
      </View>
    </View>
  );
}

function HigherGame({ rated, best, onDone }: { rated: VaultItem[]; best: number; onDone: (score: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [pair, setPair] = useState(() => higherLowerPair(rated));
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const before = useBestBefore(best, over);
  const { picked, answer } = useAnswer((right) => {
    if (!right) {
      setOver(true);
      onDone(score);
      return;
    }
    setScore(score + 1);
    // The second becomes the first; a new second with a different rating.
    const [, b] = pair!;
    const others = rated.filter((v) => v.id !== b.id && v.rating !== b.rating);
    setPair(others.length ? [b, others[Math.floor(Math.random() * others.length)]] : higherLowerPair(rated));
  });
  if (over)
    return (
      <Done
        score={score}
        best={before}
        onAgain={() => {
          setOver(false);
          setScore(0);
          setPair(higherLowerPair(rated));
        }}
      />
    );
  if (!pair) return null;
  const [a, b] = pair;
  const reveal = picked !== null;
  const card = (v: VaultItem, hidden: boolean) => (
    <View style={[styles.hlCard, { backgroundColor: raised(p) }]}>
      <Image source={v.thumbSource} style={styles.hlThumb} contentFit="cover" />
      <View style={styles.hlText}>
        <Text style={styles.hlName} numberOfLines={2}>
          {friendlyName(v)}
        </Text>
        <Text style={[styles.hlRating, hidden && { color: p.textMuted }]}>{hidden ? '?' : v.rating}</Text>
      </View>
    </View>
  );
  return (
    <View style={styles.body}>
      <Score score={score} best={best} />
      {card(a, false)}
      <Text style={styles.question}>Is this one rated higher or lower?</Text>
      {card(b, !reveal)}
      <View style={styles.hlButtons}>
        <Option grow label="Higher" icon="arrowUp" state={!reveal ? 'idle' : b.rating > a.rating ? 'right' : picked === 'up' ? 'wrong' : 'idle'} onPress={() => answer('up', b.rating > a.rating)} />
        <Option grow label="Lower" icon="arrowDown" state={!reveal ? 'idle' : b.rating < a.rating ? 'right' : picked === 'down' ? 'wrong' : 'idle'} onPress={() => answer('down', b.rating < a.rating)} />
      </View>
    </View>
  );
}

function ShowGame({ shows, best, onDone }: { shows: SimklItem[]; best: number; onDone: (score: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const before = useBestBefore(best, over);
  const [q, setQ] = useState(() => showRound(shows));
  const [blur, setBlur] = useState(40);
  const byId = useMemo(() => new Map(shows.map((s) => [s.simklId, s])), [shows]);
  // The poster sharpens over six seconds.
  useEffect(() => {
    setBlur(40);
    const t = setInterval(() => setBlur((b) => Math.max(0, b - 4)), 600);
    return () => clearInterval(t);
  }, [q]);
  const { picked, answer } = useAnswer((right) => {
    const s = score + (right ? 1 : 0);
    setScore(s);
    if (round + 1 >= ROUNDS) {
      setOver(true);
      onDone(s);
      return;
    }
    setRound(round + 1);
    setQ(showRound(shows));
  });
  if (over)
    return (
      <Done
        score={score}
        best={before}
        outOf={ROUNDS}
        onAgain={() => {
          setOver(false);
          setScore(0);
          setRound(0);
          setQ(showRound(shows));
        }}
      />
    );
  if (!q) return null;
  const poster = byId.get(q.answer)?.poster ?? null;
  return (
    <View style={styles.body}>
      <Score score={score} round={round} best={best} />
      <View style={[styles.posterBox, { backgroundColor: raised(p) }]}>
        {poster && <Image source={{ uri: posterUrl(poster, '_m') }} style={styles.poster} contentFit="cover" blurRadius={picked !== null ? 0 : blur} />}
      </View>
      <View style={styles.options}>
        {q.options.map((id) => (
          <Option key={id} label={byId.get(id)?.title ?? '?'} state={picked === null ? 'idle' : id === q.answer ? 'right' : picked === id ? 'wrong' : 'idle'} onPress={() => answer(id, id === q.answer)} />
        ))}
      </View>
    </View>
  );
}

function Option({ label, icon, state, grow, onPress }: { label: string; icon?: IconName; state: 'idle' | 'right' | 'wrong'; grow?: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const bg = state === 'right' ? p.success : state === 'wrong' ? p.danger : raised(p);
  const fg = state === 'idle' ? p.text : '#fff';
  return (
    <TouchableOpacity
      style={[styles.option, grow && { flex: 1 }, { backgroundColor: bg }]}
      onPress={() => {
        tick();
        onPress();
      }}
      accessibilityRole="button">
      {icon && <Icon name={icon} size={15} color={fg} weight="bold" />}
      <Text style={[styles.optionText, { color: fg }]} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { gap: 16 },
    lead: { color: p.textSoft, fontSize: 15, lineHeight: 21 },
    scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    scoreBig: { color: p.text, fontSize: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
    scoreSub: { color: p.textSecondary, fontSize: 14, fontWeight: '600' },
    still: { width: '100%', aspectRatio: 16 / 9, borderRadius: 18, overflow: 'hidden' },
    stillImg: { width: '100%', height: '100%' },
    question: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    options: { gap: 10 },
    option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10 },
    optionText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
    hlCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 10 },
    hlThumb: { width: 96, height: 64, borderRadius: 10, backgroundColor: p.tile },
    hlText: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
    hlName: { flex: 1, color: p.text, fontSize: 15, fontWeight: '700' },
    hlRating: { color: p.text, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 34, textAlign: 'right' },
    hlButtons: { flexDirection: 'row', gap: 10 },
    posterBox: { alignSelf: 'center', width: 200, height: 300, borderRadius: 16, overflow: 'hidden' },
    poster: { width: '100%', height: '100%' },
  });
