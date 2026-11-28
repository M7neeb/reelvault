/**
 * The bigger games, shared by Videos and Manga: Knockout cup, Zoom detective,
 * Put it in order and Who said that. Each takes plain entries or a function
 * that makes the next round, so the same screens work for frames of a video
 * and pages of a chapter. Rules in ../gameRules.ts. Presentational only.
 */

import { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import Animated, { cancelAnimation, Easing, ReduceMotion, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withTiming, ZoomIn } from 'react-native-reanimated';

import { cupChampion, cupMatch, cupPick, cupPodium, cupStage, cupUndo, newCup, orderScore, ZOOM_FROM, ZOOM_MS, zoomPoints, type Cup } from '../gameRules';
import EmptyState from './EmptyState';
import { success, tick, warn } from './haptics';
import Icon from './Icon';
import { DUR, EASE_OUT, PressableScale, SPRING_POP, useReducedMotion } from './motion';
import { VideoPane } from './rank/RankStage';
import { Chip, Rows, Segment, Wrap } from './sheets';
import { raised, sheet, usePalette, useStyles, type Palette } from './theme';
import type { ThumbSource } from './types';

/** A picture: a cover or frame, or a manga page (which may need headers to load). */
export type Pic = ThumbSource | { uri: string; headers?: Record<string, string> };

// ── shared bits ─────────────────────────────────────────────────────────

function ScoreLine({ score, label, best }: { score: number; label: string; best: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.scoreRow}>
      <Animated.Text key={score} entering={ZoomIn.duration(DUR.fast)} style={styles.scoreBig}>
        {score}
      </Animated.Text>
      <Text style={styles.scoreSub}>{[label, best ? `Best ${best}` : null].filter(Boolean).join(' · ')}</Text>
    </View>
  );
}

function Finished({ title, text, record, onAgain }: { title: string; text?: string; record: boolean; onAgain: () => void }) {
  const p = usePalette();
  return (
    <EmptyState
      icon={record ? 'trophy' : 'target'}
      title={title}
      text={record ? 'A new best.' : text}
      tint={record ? '#FF9F0A' : p.textSecondary}
      action={{ label: 'Play again', onPress: onAgain }}
    />
  );
}

function Choice({ label, pic, state, onPress }: { label: string; pic?: Pic | null; state: 'idle' | 'right' | 'wrong' | 'dim'; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const bg = state === 'right' ? p.success : state === 'wrong' ? p.danger : raised(p);
  const fg = state === 'right' || state === 'wrong' ? '#fff' : p.text;
  return (
    <PressableScale
      style={[styles.choice, { backgroundColor: bg }, state === 'dim' && { opacity: 0.45 }]}
      onPress={() => {
        tick();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}>
      {pic ? <Image source={pic} style={styles.choicePic} contentFit="cover" transition={150} /> : null}
      <Text style={[styles.choiceText, { color: fg }]} numberOfLines={2}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Tells the caller the final score once a game ends (again after Play again). */
export function useReportOnce(over: boolean, score: number, onDone: (score: number) => void) {
  const done = useRef(false);
  useEffect(() => {
    if (over && !done.current) {
      done.current = true;
      onDone(score);
    }
    if (!over) done.current = false;
  }, [over]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The best score from before this game: the game saves its score as it ends, before the end screen shows. */
export function useBestBefore(best: number, over: boolean): number {
  const before = useRef(best);
  if (!over) before.current = best;
  return before.current;
}

/** Answer once; after a moment the next round. */
function useReveal(delay = 1100) {
  const [picked, setPicked] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const choose = (choice: string, right: boolean, then: () => void) => {
    if (picked !== null) return;
    setPicked(choice);
    if (right) success();
    else warn();
    timer.current = setTimeout(() => {
      setPicked(null);
      then();
    }, delay);
  };
  return { picked, choose };
}

/** Rounds made one at a time (a frame or a page has to load first); null when none can be made. */
function useRounds<R>(make: () => Promise<R | null>, total: number) {
  const [round, setRound] = useState(0);
  const [q, setQ] = useState<R | null>(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setQ(null);
    (async () => {
      // A round whose picture won't load is skipped, a few times at most.
      for (let tries = 0; tries < 4; tries++) {
        const r = await make().catch(() => null);
        if (!live) return;
        if (r) return setQ(r);
      }
      setFailed(true);
    })();
    return () => {
      live = false;
    };
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    round,
    q,
    failed,
    over: round >= total,
    next: () => {
      setRound((r) => r + 1);
      setN((x) => x + 1);
    },
    restart: () => {
      setRound(0);
      setFailed(false);
      setN((x) => x + 1);
    },
  };
}

// ── Knockout cup ────────────────────────────────────────────────────────

export type CupEntry = { id: string; title: string; sub?: string; pic: Pic | null; uri?: string | null; startMs?: number | null };

export function CupGame({
  entries,
  pools,
  videos,
  enableVideo,
  onFinished,
  onOpen,
}: {
  entries: Map<string, CupEntry>;
  /** What can go in a cup: all of them, your favourites, one keyword... */
  pools: { key: string; label: string; ids: string[] }[];
  /** Video clips stacked and playing; otherwise covers side by side. */
  videos: boolean;
  enableVideo: boolean;
  /** A champion was crowned. */
  onFinished: () => void;
  onOpen?: (id: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const reduce = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [poolKey, setPoolKey] = useState(pools[0]?.key ?? '');
  const [size, setSize] = useState<'8' | '16'>('16');
  const [cup, setCup] = useState<Cup | null>(null);
  const [history, setHistory] = useState<Cup[]>([]);
  const [sound, setSound] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const pool = pools.find((x) => x.key === poolKey) ?? pools[0];
  const usable = (pool?.ids ?? []).filter((id) => entries.has(id));

  const start = () => {
    const c = newCup(usable, Number(size));
    if (!c) return;
    tick();
    setHistory([]);
    setCup(c);
  };

  if (!cup)
    return (
      <View style={styles.body}>
        <Text style={styles.lead}>
          {videos ? 'Your videos' : 'Your manga'} in a bracket. Two at a time, the one you like more goes through, until one is left.
        </Text>
        <Rows label="Who plays">
          <View style={styles.pad}>
            <Wrap>
              {pools.map((x) => (
                <Chip key={x.key} label={`${x.label} · ${x.ids.filter((id) => entries.has(id)).length}`} on={x.key === pool?.key} onPress={() => setPoolKey(x.key)} />
              ))}
            </Wrap>
          </View>
        </Rows>
        <Rows label="Size" footer={usable.length < 4 ? 'This group has fewer than 4. Pick a bigger one.' : usable.length < 16 && size === '16' ? `${usable.length} to choose from, so a cup of ${usable.length >= 8 ? 8 : 4}.` : undefined}>
          <View style={styles.pad}>
            <Segment
              options={[
                { key: '8', label: '8 · 7 matches' },
                { key: '16', label: '16 · 15 matches' },
              ]}
              value={size}
              onChange={setSize}
            />
          </View>
        </Rows>
        <TouchableOpacity style={[styles.primary, usable.length < 4 && { opacity: 0.4 }]} disabled={usable.length < 4} onPress={start} accessibilityRole="button">
          <Icon name="trophy" size={17} color={p.bg} />
          <Text style={styles.primaryText}>Start the cup</Text>
        </TouchableOpacity>
      </View>
    );

  const champ = cupChampion(cup);
  if (champ) {
    const podium = cupPodium(cup).map((id) => entries.get(id)).filter((e): e is CupEntry => !!e);
    const [first, ...rest] = podium;
    return (
      <View style={styles.body}>
        <Animated.View entering={reduce ? undefined : FadeInDown.duration(DUR.slow).easing(EASE_OUT)} style={styles.champWrap}>
          <TouchableOpacity disabled={!onOpen} onPress={() => onOpen?.(first.id)} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={`Champion: ${first.title}`}>
            <View style={[styles.champPic, videos ? { aspectRatio: 16 / 9 } : { aspectRatio: 2 / 3, width: '62%', alignSelf: 'center' }]}>
              {first.pic ? <Image source={first.pic} style={styles.fill} contentFit="cover" /> : null}
              {onOpen && (
                <View style={styles.champPlay}>
                  <Icon name={videos ? 'play' : 'book'} size={16} color="#fff" />
                </View>
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.champKicker}>Champion</Text>
          <Text style={styles.champTitle} numberOfLines={2}>
            {first.title}
          </Text>
        </Animated.View>
        <Rows label="The final four">
          {rest.map((e, i) => (
            <View key={e.id} style={styles.podiumRow}>
              <Text style={styles.place}>{i + 2}</Text>
              {e.pic ? <Image source={e.pic} style={videos ? styles.podiumThumb : styles.podiumCover} contentFit="cover" /> : null}
              <Text style={styles.podiumTitle} numberOfLines={1}>
                {e.title}
              </Text>
            </View>
          ))}
        </Rows>
        <TouchableOpacity
          style={styles.primary}
          onPress={() => setCup(null)}
          accessibilityRole="button">
          <Text style={styles.primaryText}>New cup</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const match = cupMatch(cup)!;
  const stage = cupStage(cup);
  const choose = (id: string) => {
    if (picked) return;
    tick();
    setPicked(id);
    setTimeout(
      () => {
        setPicked(null);
        setSound(null);
        setHistory((h) => [...h, cup]);
        const next = cupPick(cup, id);
        if (cupChampion(next)) {
          success();
          onFinished();
        }
        setCup(next);
      },
      reduce ? 60 : 300
    );
  };
  const paneW = videos ? width - 32 : (width - 32 - 12) / 2;
  const paneH = videos ? Math.min((height - 330) / 2, paneW * 0.75) : paneW * 1.5;
  const total = (cup.played[0] ?? cup.round).length - 1;
  const done = cup.played.reduce((n, r) => n + r.length / 2, 0) + cup.winners.length;
  const pct = total ? done / total : 0;

  return (
    <View style={styles.body}>
      <View style={styles.stageRow}>
        <Text style={styles.stageName}>{stage.round}</Text>
        <Text style={styles.stageSub}>
          {stage.matches > 1 ? `Match ${stage.match} of ${stage.matches}` : 'One match left'}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${Math.max(3, pct * 100)}%` }]} />
      </View>
      <View style={[styles.versus, { flexDirection: videos ? 'column' : 'row' }]}>
        {match.map((id, i) => {
          const e = entries.get(id)!;
          const state = picked === null ? 'idle' : picked === id ? 'won' : 'lost';
          return (
            <Animated.View key={`${cup.played.length}-${cup.winners.length}-${id}`} entering={reduce ? undefined : FadeIn.duration(DUR.base).delay(i * 60)}>
              <PressableScale
                onPress={() => choose(id)}
                scaleTo={0.97}
                style={[styles.pane, { width: paneW, height: paneH }, state === 'lost' && { opacity: 0.3 }, state === 'won' && styles.paneWon]}
                accessibilityRole="button"
                accessibilityLabel={`${e.title} goes through`}>
                {videos && enableVideo && e.uri ? (
                  <VideoPane item={{ uri: e.uri, startMs: e.startMs ?? 0, thumb: (e.pic as ThumbSource) ?? null }} play={picked === null} muted={sound !== id} />
                ) : e.pic ? (
                  <Image source={e.pic} style={styles.fill} contentFit="cover" transition={150} />
                ) : null}
                <View style={styles.paneInfo} pointerEvents="none">
                  <Text style={styles.paneTitle} numberOfLines={videos ? 1 : 2}>
                    {e.title}
                  </Text>
                  {!!e.sub && (
                    <Text style={styles.paneSub} numberOfLines={1}>
                      {e.sub}
                    </Text>
                  )}
                </View>
                {videos && enableVideo && e.uri && (
                  <TouchableOpacity
                    style={[styles.soundBtn, sound === id && { backgroundColor: '#fff' }]}
                    onPress={() => setSound((now) => (now === id ? null : id))}
                    hitSlop={8}
                    accessibilityLabel={sound === id ? `Mute ${e.title}` : `Sound on for ${e.title}`}>
                    <Icon name={sound === id ? 'sound' : 'muted'} size={15} color={sound === id ? '#000' : '#fff'} />
                  </TouchableOpacity>
                )}
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>
      <View style={styles.cupBar}>
        <TouchableOpacity
          style={[styles.ghost, !history.length && { opacity: 0.35 }]}
          disabled={!history.length || picked !== null}
          onPress={() => {
            tick();
            setCup(cupUndo(cup));
            setHistory((h) => h.slice(0, -1));
          }}
          accessibilityRole="button">
          <Icon name="back" size={14} color={p.text} weight="bold" />
          <Text style={styles.ghostText}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghost} onPress={() => setCup(null)} accessibilityRole="button">
          <Text style={styles.ghostText}>Stop</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Zoom detective ──────────────────────────────────────────────────────

export type ZoomQ = { pic: Pic; answer: string; options: { key: string; label: string }[]; focus: { x: number; y: number } };

const ZOOM_ROUNDS = 10;

export function ZoomGame({ make, aspect, best, intro, onDone }: { make: () => Promise<ZoomQ | null>; aspect: number; best: number; intro: string; onDone: (score: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const rounds = useRounds(make, ZOOM_ROUNDS);
  const [score, setScore] = useState(0);
  const [gain, setGain] = useState<number | null>(null);
  const { picked, choose } = useReveal(1300);
  const [box, setBox] = useState(0);
  const win = useWindowDimensions();
  // Tall pictures (manga pages) are kept short enough that the four answers stay on screen.
  const boxW = Math.min(win.width - 32, win.height * 0.42 * aspect);
  const t = useSharedValue(0);
  const started = useRef(0);
  const q = rounds.q;
  useReportOnce(rounds.over, score, onDone);
  const before = useBestBefore(best, rounds.over);

  // The picture starts close in and zooms out to whole over ZOOM_MS; an answer shows it whole at once.
  useEffect(() => {
    if (!q) return;
    cancelAnimation(t);
    t.value = 0;
    started.current = Date.now();
    // The zoom is the game's clock, so it runs even with Reduce Motion on.
    t.value = withTiming(1, { duration: ZOOM_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const fx = q?.focus.x ?? 0.5;
  const fy = q?.focus.y ?? 0.5;
  const h = box / aspect;
  const zoomed = useAnimatedStyle(() => {
    const e = 1 - (1 - t.value) * (1 - t.value);
    const s = ZOOM_FROM + (1 - ZOOM_FROM) * e;
    return { transform: [{ translateX: -(s - 1) * (fx - 0.5) * box }, { translateY: -(s - 1) * (fy - 0.5) * h }, { scale: s }] };
  });
  const timeLeft = useAnimatedStyle(() => ({ width: `${(1 - t.value) * 100}%` }));

  if (rounds.over)
    return (
      <View style={styles.body}>
        <Finished
          title={`${score} points`}
          text={before ? `Your best is ${before}.` : `Out of ${ZOOM_ROUNDS * 10}.`}
          record={score > before}
          onAgain={() => {
            setScore(0);
            rounds.restart();
          }}
        />
      </View>
    );
  if (rounds.failed) return <EmptyState icon="photo" title="No pictures to zoom into" text="The frames or pages couldn't be loaded. Try again later." tint={p.textSecondary} />;

  const answer = (key: string) => {
    if (!q || picked) return;
    const right = key === q.answer;
    const pts = right ? zoomPoints(Date.now() - started.current) : 0;
    cancelAnimation(t);
    t.value = withTiming(1, { duration: DUR.slow, easing: Easing.out(Easing.cubic) });
    setGain(pts);
    choose(key, right, () => {
      setScore((s) => s + pts);
      setGain(null);
      rounds.next();
    });
  };

  return (
    <View style={styles.body}>
      <ScoreLine score={score} label={`Round ${Math.min(rounds.round + 1, ZOOM_ROUNDS)} of ${ZOOM_ROUNDS}`} best={best} />
      <View style={[styles.zoomBox, { width: boxW, aspectRatio: aspect, backgroundColor: raised(p) }]} onLayout={(e: LayoutChangeEvent) => setBox(e.nativeEvent.layout.width)}>
        {q && box > 0 && (
          <Animated.View style={[styles.fill, zoomed]}>
            <Image source={q.pic} style={styles.fill} contentFit="cover" transition={0} />
          </Animated.View>
        )}
        {gain !== null && (
          <Animated.View entering={ZoomIn.springify().damping(SPRING_POP.damping)} style={[styles.gain, { backgroundColor: gain ? p.success : p.danger }]}>
            <Text style={styles.gainText}>{gain ? `+${gain}` : 'Missed'}</Text>
          </Animated.View>
        )}
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.trackFill, { backgroundColor: p.accent }, timeLeft]} />
      </View>
      <Text style={styles.question}>{intro}</Text>
      <View style={styles.grid}>
        {(q?.options ?? []).map((o) => (
          <View key={o.key} style={styles.gridCell}>
            <Choice
              label={o.label}
              state={!picked ? 'idle' : o.key === q!.answer ? 'right' : o.key === picked ? 'wrong' : 'dim'}
              onPress={() => answer(o.key)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Put it in order ─────────────────────────────────────────────────────

export type OrderQ = { title: string; sub?: string; pics: { key: number; pic: Pic }[]; truth: number[] };

const ORDER_ROUNDS = 6;

export function OrderGame({ make, aspect, best, onDone }: { make: () => Promise<OrderQ | null>; aspect: number; best: number; onDone: (score: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const rounds = useRounds(make, ORDER_ROUNDS);
  const [score, setScore] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const [checked, setChecked] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const q = rounds.q;
  useEffect(() => {
    setOrder([]);
    setChecked(null);
  }, [q]);
  useReportOnce(rounds.over, score, onDone);
  const before = useBestBefore(best, rounds.over);

  if (rounds.over)
    return (
      <View style={styles.body}>
        <Finished
          title={`${score} out of ${ORDER_ROUNDS * 4}`}
          text={before ? `Your best is ${before}.` : 'Every one in the right place counts.'}
          record={score > before}
          onAgain={() => {
            setScore(0);
            rounds.restart();
          }}
        />
      </View>
    );
  if (rounds.failed) return <EmptyState icon="photo" title="Nothing to put in order" text="The frames or pages couldn't be loaded. Try again later." tint={p.textSecondary} />;

  const tap = (key: number) => {
    if (!q || checked !== null) return;
    tick();
    const at = order.indexOf(key);
    // Tapping a numbered one takes it (and the ones after it) back off.
    const next = at >= 0 ? order.slice(0, at) : [...order, key];
    setOrder(next);
    if (next.length === 4) {
      const got = orderScore(next, q.truth);
      setChecked(got);
      if (got === 4) success();
      else warn();
      timer.current = setTimeout(() => {
        setScore((s) => s + got);
        rounds.next();
      }, 1700);
    }
  };

  return (
    <View style={styles.body}>
      <ScoreLine score={score} label={`Round ${Math.min(rounds.round + 1, ORDER_ROUNDS)} of ${ORDER_ROUNDS}`} best={best} />
      <View>
        <Text style={styles.question} numberOfLines={2}>
          {q ? q.title : ' '}
        </Text>
        <Text style={styles.stageSub}>{checked === null ? (q?.sub ?? 'Tap them in the order they come. Tap one again to take it back.') : checked === 4 ? 'All four, spot on.' : `${checked} of 4 in the right place.`}</Text>
      </View>
      <View style={styles.grid}>
        {(q?.pics ?? []).map(({ key, pic }) => {
          const n = order.indexOf(key);
          const truthAt = q!.truth.indexOf(key);
          const right = checked !== null && n === truthAt;
          return (
            <View key={key} style={styles.gridCell}>
              <PressableScale onPress={() => tap(key)} scaleTo={0.96} style={[styles.orderPic, { aspectRatio: aspect }]} accessibilityRole="button" accessibilityLabel={n >= 0 ? `Number ${n + 1}` : 'Not numbered yet'}>
                <Image source={pic} style={styles.fill} contentFit="cover" transition={150} />
                {n >= 0 && (
                  <Animated.View entering={ZoomIn.springify().damping(SPRING_POP.damping)} style={[styles.badge, checked !== null && { backgroundColor: right ? p.success : p.danger }]}>
                    <Text style={styles.badgeText}>{n + 1}</Text>
                  </Animated.View>
                )}
                {checked !== null && !right && (
                  <View style={styles.truth}>
                    <Text style={styles.truthText}>{truthAt + 1}</Text>
                  </View>
                )}
              </PressableScale>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Who said that ───────────────────────────────────────────────────────

export type SaidQ = { quote: string; answer: string; options: { key: string; label: string; pic: Pic | null }[]; sub?: string };

const SAID_ROUNDS = 10;

export function SaidGame({ make, best, onDone }: { make: () => Promise<SaidQ | null>; best: number; onDone: (score: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const rounds = useRounds(make, SAID_ROUNDS);
  const [score, setScore] = useState(0);
  const { picked, choose } = useReveal();
  const q = rounds.q;
  useReportOnce(rounds.over, score, onDone);
  const before = useBestBefore(best, rounds.over);
  if (rounds.over)
    return (
      <View style={styles.body}>
        <Finished
          title={`${score} out of ${SAID_ROUNDS}`}
          text={before ? `Your best is ${before}.` : undefined}
          record={score > before}
          onAgain={() => {
            setScore(0);
            rounds.restart();
          }}
        />
      </View>
    );
  if (rounds.failed) return <EmptyState icon="search" title="No words to go on" text="Who said that uses text ReelVault read on your videos' screens. Let it look inside more videos first." tint={p.textSecondary} />;
  return (
    <View style={styles.body}>
      <ScoreLine score={score} label={`Round ${Math.min(rounds.round + 1, SAID_ROUNDS)} of ${SAID_ROUNDS}`} best={best} />
      <View style={[styles.quoteCard, { backgroundColor: raised(p) }]}>
        <Text style={styles.quoteMark}>“</Text>
        <Text style={styles.quote}>{q?.quote ?? ' '}</Text>
        {!!q?.sub && picked && <Text style={styles.stageSub}>{q.sub}</Text>}
      </View>
      <Text style={styles.question}>Which video was it on?</Text>
      <View style={styles.grid}>
        {(q?.options ?? []).map((o) => (
          <View key={o.key} style={styles.gridCell}>
            <Choice
              label={o.label}
              pic={o.pic}
              state={!picked ? 'idle' : o.key === q!.answer ? 'right' : o.key === picked ? 'wrong' : 'dim'}
              onPress={() =>
                q &&
                choose(o.key, o.key === q.answer, () => {
                  setScore((s) => s + (o.key === q.answer ? 1 : 0));
                  rounds.next();
                })
              }
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { gap: 16 },
    pad: { padding: 12 },
    lead: { color: p.textSoft, fontSize: 15, lineHeight: 21 },
    fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
    scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    scoreBig: { color: p.text, fontSize: 44, fontWeight: '700', fontVariant: ['tabular-nums'] },
    scoreSub: { color: p.textSecondary, fontSize: 14, fontWeight: '600' },
    question: { color: p.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14, backgroundColor: p.text },
    primaryText: { color: p.bg, fontSize: 17, fontWeight: '700' },
    ghost: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: 14, backgroundColor: raised(p) },
    ghostText: { color: p.text, fontSize: 16, fontWeight: '600' },
    track: { height: 4, borderRadius: 2, backgroundColor: p.tile, overflow: 'hidden' },
    trackFill: { height: 4, borderRadius: 2, backgroundColor: p.text },

    stageRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    stageName: { color: p.text, fontSize: 30, fontWeight: '700' },
    stageSub: { color: p.textSecondary, fontSize: 14, fontWeight: '500' },
    versus: { gap: 12, alignItems: 'center' },
    pane: { borderRadius: 12, overflow: 'hidden', backgroundColor: p.tile },
    paneWon: { borderWidth: 3, borderColor: p.accent },
    paneInfo: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 22, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.5)' },
    paneTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
    paneSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '500' },
    soundBtn: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
    cupBar: { flexDirection: 'row', gap: 10 },

    champWrap: { gap: 6 },
    champPic: { width: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: p.tile, borderWidth: 3, borderColor: p.accent },
    champPlay: { position: 'absolute', right: 10, bottom: 10, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
    champKicker: { color: p.accent, fontSize: 15, fontWeight: '700', marginTop: 8 },
    champTitle: { color: p.text, fontSize: 32, fontWeight: '700', lineHeight: 36 },
    podiumRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
    place: { color: p.textSecondary, fontSize: 22, fontWeight: '700', width: 22, fontVariant: ['tabular-nums'] },
    podiumThumb: { width: 64, height: 40, borderRadius: 6, backgroundColor: p.tile },
    podiumCover: { width: 34, height: 50, borderRadius: 4, backgroundColor: p.tile },
    podiumTitle: { flex: 1, color: p.text, fontSize: 15, fontWeight: '600' },

    zoomBox: { alignSelf: 'center', borderRadius: 12, overflow: 'hidden' },
    gain: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 12, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    gainText: { color: '#fff', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    gridCell: { width: '48%', flexGrow: 1 },
    choice: { minHeight: 56, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 8, justifyContent: 'center' },
    choicePic: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: p.tile },
    choiceText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },

    orderPic: { width: '100%', borderRadius: 10, overflow: 'hidden', backgroundColor: p.tile },
    badge: { position: 'absolute', top: 8, left: 8, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent },
    badgeText: { color: '#fff', fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
    truth: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)' },
    truthText: { color: '#fff', fontSize: 13, fontWeight: '700' },

    quoteCard: { borderRadius: 14, padding: 18, gap: 4 },
    quoteMark: { color: p.accent, fontSize: 48, lineHeight: 48, fontWeight: '700', height: 30 },
    quote: { color: p.text, fontSize: 21, lineHeight: 28, fontWeight: '600' },
  });
