/**
 * Rank your favourites: set up a round, play it (RankStage), then look at the
 * ranking and the new ratings it suggests. Ratings change only when you tap
 * Apply. The same screens serve Videos, Movies, Shows and Anime.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { emptyRank, nextPair, parseRank, ranked, recordPick, skipPair, suggestRatings, type RankChange, type RankState } from '../../rank';
import { confirmAction, plural } from '../confirm';
import { success, tick } from '../haptics';
import Icon from '../Icon';
import { Chip, Row, Rows, Segment, SheetFrame, Wrap } from '../sheets';
import { raised, sheet, useStyles, usePalette, type Palette } from '../theme';
import EmptyState from '../EmptyState';
import RankStage from './RankStage';
import { fmtRating, NOUNS, type RankCandidate, type RankGroup, type RankKind } from './rankTypes';

/** Preview only: a ranking after a few rounds, so the results have something in them. */
function demoState(items: RankCandidate[]): RankState {
  let st = emptyRank();
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < Math.min(80, items.length * 6); i++) {
    const pr = nextPair(st, items, rng);
    if (!pr) break;
    st = recordPick(st, pr[0], pr[1], pr[0].title.length % 3 > pr[1].title.length % 3 ? 'a' : 'b');
  }
  return st;
}

const LENGTHS: { value: number; label: string }[] = [
  { value: 10, label: '10 pairs' },
  { value: 25, label: '25 pairs' },
  { value: 0, label: 'Until I stop' },
];

type Step = 'setup' | 'results';

export type RankModalProps = {
  kind: RankKind;
  items: RankCandidate[];
  /** Keywords, albums, statuses: extra groups to rank on their own. */
  groups: RankGroup[];
  load: () => Promise<string | null>;
  save: (json: string) => Promise<void>;
  /** Apply the ratings you switched on. */
  onApply: (changes: RankChange[]) => Promise<void>;
  /** Open one from the ranked list (the video in the player, a title's page). */
  onOpen?: (id: string) => void;
  /** Posters for movies / shows / anime; videos use `thumb`. */
  renderArt?: (c: RankCandidate, w: number, h: number) => ReactNode;
  /** False in the browser preview. */
  enableVideo: boolean;
  onClose: () => void;
  /** Preview only. */
  dev?: { step?: Step | 'play'; state?: RankState };
};

export default function RankModal({ kind, items, groups, load, save, onApply, onOpen, renderArt, enableVideo, onClose, dev }: RankModalProps) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const noun = NOUNS[kind];
  const videos = kind === 'video';
  // "1 anime" / "2 anime" reads badly as a count; titles it is.
  const one = kind === 'anime' ? 'title' : noun.one;
  const [state, setState] = useState<RankState>(() => dev?.state ?? (dev?.step && dev.step !== 'setup' ? demoState(items) : emptyRank()));
  const [loaded, setLoaded] = useState(!!dev);
  const [step, setStep] = useState<Step>(dev?.step === 'results' ? 'results' : 'setup');
  const [filter, setFilter] = useState('all');
  const [length, setLength] = useState(25);
  const [playVideos, setPlayVideos] = useState(true);
  const [playing, setPlaying] = useState(dev?.step === 'play');
  const [done, setDone] = useState(0);
  const [history, setHistory] = useState<{ state: RankState; pair: [RankCandidate, RankCandidate]; counted: boolean }[]>([]);
  const [start, setStart] = useState<RankState | null>(null);
  const [pair, setPair] = useState<[RankCandidate, RankCandidate] | null>(null);
  const [tab, setTab] = useState<'changes' | 'list'>('changes');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    if (dev) return;
    let live = true;
    load()
      .then((json) => live && setState(parseRank(json)))
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const ratingChips = useMemo(() => {
    const counts = new Map<number, number>();
    for (const i of items) if (i.rating) counts.set(Math.floor(i.rating), (counts.get(Math.floor(i.rating)) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[0] - x[0]);
  }, [items]);
  const pool = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'unrated') return items.filter((i) => !i.rating);
    if (filter.startsWith('rating:')) {
      const r = Number(filter.slice(7));
      return items.filter((i) => i.rating && Math.floor(i.rating) === r);
    }
    return items.filter((i) => i.groups.includes(filter));
  }, [items, filter]);

  // The preview opens straight on a round.
  useEffect(() => {
    if (dev?.step === 'play' && !pair) setPair(nextPair(state, items));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next: RankState) => {
    const json = JSON.stringify(next);
    saving.current = saving.current.then(() => save(json)).catch(() => {});
  };

  const begin = () => {
    const first = nextPair(state, pool);
    if (!first) return;
    setStart(state);
    setHistory([]);
    setDone(0);
    setPair(first);
    setPlaying(true);
  };

  const finish = () => {
    setPlaying(false);
    setPair(null);
    setOff(new Set());
    setApplied(0);
    setTab('changes');
    setStep('results');
  };

  const advance = (next: RankState, counted: boolean) => {
    const nDone = counted ? done + 1 : done;
    setState(next);
    persist(next);
    if (length && nDone >= length) {
      setDone(nDone);
      finish();
      return;
    }
    setDone(nDone);
    const np = nextPair(next, pool);
    if (!np) finish();
    else setPair(np);
  };

  const pick = (w: 'a' | 'b' | 'tie') => {
    if (!pair) return;
    tick();
    setHistory((h) => [...h.slice(-49), { state, pair, counted: true }]);
    advance(recordPick(state, pair[0], pair[1], w), true);
  };

  const skip = () => {
    if (!pair) return;
    setHistory((h) => [...h.slice(-49), { state, pair, counted: false }]);
    advance(skipPair(state, pair[0], pair[1]), false);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setState(last.state);
    persist(last.state);
    if (last.counted) setDone((d) => Math.max(0, d - 1));
    setPair(last.pair);
  };

  const order = useMemo(() => ranked(state, items), [state, items]);
  const before = useMemo(() => {
    const m = new Map<string, number>();
    if (start) ranked(start, items).forEach((it, i) => m.set(it.id, i));
    return m;
  }, [start, items]);
  const changes = useMemo(() => suggestRatings(state, items).filter((c) => byId.has(c.id)), [state, items, byId]);
  const chosen = changes.filter((c) => !off.has(c.id));

  const apply = async () => {
    if (!chosen.length || applying) return;
    setApplying(true);
    try {
      await onApply(chosen);
      success();
      setApplied(chosen.length);
      setOff(new Set());
    } finally {
      setApplying(false);
    }
  };

  const reset = () =>
    confirmAction(`Start your ${noun.many} ranking over?`, 'The order you built is forgotten. Your ratings stay as they are.', () => {
      const fresh = emptyRank();
      setState(fresh);
      persist(fresh);
      setStart(null);
      setHistory([]);
    }, { label: 'Start over' });

  const thumbFor = (c: RankCandidate, size: number) => (
    <View style={[styles.thumb, { width: size, height: videos ? size : size * 1.5 }]}>
      {videos || !renderArt ? (c.thumb ? <Image source={c.thumb} style={{ width: size, height: videos ? size : size * 1.5 }} contentFit="cover" /> : null) : renderArt(c, size, size * 1.5)}
    </View>
  );

  const filterLabel = (key: string) => {
    if (key === 'all') return `All ${noun.many}`;
    if (key === 'unrated') return 'Not rated yet';
    if (key.startsWith('rating:')) return `Your ${key.slice(7)}s`;
    return groups.find((g) => g.key === key)?.label ?? key;
  };

  const setup = (
    <>
      <Text style={styles.lead}>
        Two at a time, tap the one you like more. After a few rounds you get new ratings to accept or leave. Nothing changes until you say so.
      </Text>
      {order.length > 0 && (
        <Rows>
          <Row icon="trophy" tint="#FF9F0A" title="Your ranking" sub={`${plural(order.length, one)} in order so far`} onPress={() => setStep('results')} />
        </Rows>
      )}
      <Rows label="What to rank" footer={pool.length < 2 ? `This group has ${plural(pool.length, one)}. Pick a bigger one.` : `${plural(pool.length, one)} to compare.`}>
        <View style={styles.chipBox}>
          <Wrap>
            <Chip label={filterLabel('all')} on={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label="Not rated yet" on={filter === 'unrated'} onPress={() => setFilter('unrated')} />
            {ratingChips.map(([r]) => (
              <Chip key={r} label={`Your ${r}s`} on={filter === `rating:${r}`} onPress={() => setFilter(`rating:${r}`)} />
            ))}
            {groups.map((g) => (
              <Chip key={g.key} label={g.label} on={filter === g.key} onPress={() => setFilter(g.key)} />
            ))}
          </Wrap>
        </View>
      </Rows>
      <Rows label="How long">
        <View style={styles.chipBox}>
          <Segment options={LENGTHS.map((l) => ({ key: String(l.value), label: l.label }))} value={String(length)} onChange={(k) => setLength(Number(k))} />
        </View>
      </Rows>
      {videos && (
        <Rows footer="Muted, from each video's cover. Open one big to hear it and scrub through.">
          <Row icon="play" tint="#30D158" title="Play the videos" toggle={{ value: playVideos, onChange: setPlayVideos }} />
        </Rows>
      )}
      <TouchableOpacity style={[styles.primary, (pool.length < 2 || !loaded) && styles.disabled]} disabled={pool.length < 2 || !loaded} onPress={begin} accessibilityRole="button">
        <Text style={styles.primaryText}>{filter === 'all' ? 'Start ranking' : `Rank ${filterLabel(filter).replace(/^All /, '')}`}</Text>
      </TouchableOpacity>
      {state.picks > 0 && (
        <TouchableOpacity onPress={reset} style={styles.quiet} accessibilityRole="button">
          <Text style={styles.quietDanger}>Start over</Text>
        </TouchableOpacity>
      )}
    </>
  );

  const shownList = showAll ? order : order.slice(0, 50);
  const results = (
    <>
      <Segment
        options={[
          { key: 'changes', label: changes.length ? `New ratings (${changes.length})` : 'New ratings' },
          { key: 'list', label: 'Full list' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'changes' ? (
        changes.length ? (
          <>
            <Rows footer="Switch off any you'd rather keep as they are.">
              {changes.map((c) => {
                const it = byId.get(c.id)!;
                const up = c.from === null || c.to > c.from;
                return (
                  <View key={c.id} style={styles.changeRow}>
                    {thumbFor(it, 44)}
                    <View style={styles.changeText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {it.title}
                      </Text>
                      <View style={styles.changeLine}>
                        <Text style={styles.from}>{c.from === null ? 'Not rated' : fmtRating(c.from)}</Text>
                        <Icon name={up ? 'arrowUp' : 'arrowDown'} size={11} color={up ? p.success : p.danger} weight="bold" />
                        <Text style={[styles.to, { color: up ? p.success : p.danger }]}>{fmtRating(c.to)}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        tick();
                        setOff((s) => {
                          const n = new Set(s);
                          if (n.has(c.id)) n.delete(c.id);
                          else n.add(c.id);
                          return n;
                        });
                      }}
                      style={[styles.check, !off.has(c.id) && styles.checkOn]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !off.has(c.id) }}
                      accessibilityLabel={`Change ${it.title} to ${fmtRating(c.to)}`}>
                      {!off.has(c.id) && <Icon name="check" size={13} color="#fff" weight="bold" />}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </Rows>
            <TouchableOpacity style={[styles.primary, (!chosen.length || applying) && styles.disabled]} disabled={!chosen.length || applying} onPress={apply} accessibilityRole="button">
              <Text style={styles.primaryText}>{applying ? 'Saving…' : `Apply ${plural(chosen.length, 'new rating')}`}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <EmptyState
            icon={applied ? 'checkCircle' : 'target'}
            title={applied ? `${plural(applied, 'rating')} updated` : 'No new ratings yet'}
            text={applied ? 'Your ratings now follow your ranking.' : `A few more rounds and the order is clear enough to suggest some. Each ${one} needs a couple of picks first.`}
            tint={applied ? p.success : p.textSecondary}
          />
        )
      ) : order.length ? (
        <>
          <View style={[styles.list, { backgroundColor: raised(p) }]}>
            {shownList.map((it, i) => {
              const was = before.get(it.id);
              const moved = was === undefined || !start ? 0 : was - i;
              return (
                <TouchableOpacity key={it.id} disabled={!onOpen} onPress={() => onOpen?.(it.id)} style={[styles.listRow, i > 0 && styles.listLine]} accessibilityRole={onOpen ? 'button' : undefined}>
                  <Text style={[styles.place, i < 3 && styles.placeTop]}>{i + 1}</Text>
                  {thumbFor(it, 40)}
                  <View style={styles.changeText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {it.title}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {[it.rating ? `Rated ${fmtRating(it.rating)}` : 'Not rated', it.sub].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {moved !== 0 && (
                    <View style={styles.moved}>
                      <Icon name={moved > 0 ? 'arrowUp' : 'arrowDown'} size={10} color={moved > 0 ? p.success : p.textMuted} weight="bold" />
                      <Text style={[styles.movedText, { color: moved > 0 ? p.success : p.textMuted }]}>{Math.abs(moved)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          {order.length > 50 && !showAll && (
            <TouchableOpacity onPress={() => setShowAll(true)} style={styles.quiet} accessibilityRole="button">
              <Text style={styles.quietText}>Show all {order.length}</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <EmptyState icon="trophy" title="Nothing ranked yet" text={`Rate a few ${noun.many} or play a round, and your order shows up here.`} tint="#FF9F0A" />
      )}
      <TouchableOpacity
        style={styles.secondary}
        onPress={() => {
          setStep('setup');
        }}
        accessibilityRole="button">
        <Text style={styles.secondaryText}>Keep ranking</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <SheetFrame page title={step === 'setup' ? `Rank your ${noun.many}` : 'Your ranking'} onClose={onClose}>
      <View style={styles.body}>{step === 'setup' ? setup : results}</View>
      {playing && pair && (
        <RankStage
          pair={pair}
          videos={videos}
          playVideos={playVideos}
          enableVideo={enableVideo}
          done={done}
          total={length}
          canUndo={history.length > 0}
          renderArt={renderArt}
          onPick={pick}
          onSkip={skip}
          onUndo={undo}
          onEnd={finish}
        />
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { gap: 18 },
    lead: { color: p.textSoft, fontSize: 15, lineHeight: 21 },
    chipBox: { padding: 12 },
    primary: { height: 54, borderRadius: 27, backgroundColor: p.text, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: p.bg, fontSize: 17, fontWeight: '800' },
    secondary: { height: 50, borderRadius: 25, backgroundColor: raised(p), alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: p.text, fontSize: 16, fontWeight: '700' },
    disabled: { opacity: 0.35 },
    quiet: { alignItems: 'center', paddingVertical: 8 },
    quietText: { color: p.link, fontSize: 15, fontWeight: '600' },
    quietDanger: { color: p.dangerText, fontSize: 15, fontWeight: '600' },
    thumb: { borderRadius: 8, overflow: 'hidden', backgroundColor: p.tile },
    changeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
    changeText: { flex: 1, minWidth: 0, gap: 2 },
    changeLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowTitle: { color: p.text, fontSize: 16, fontWeight: '600' },
    rowSub: { color: p.textSecondary, fontSize: 13 },
    from: { color: p.textSecondary, fontSize: 14, fontVariant: ['tabular-nums'] },
    to: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
    check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: p.border, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: p.accent, borderColor: p.accent },
    list: { borderRadius: 18, overflow: 'hidden' },
    listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 9 },
    listLine: { borderTopWidth: 0.5, borderTopColor: p.separator },
    place: { width: 28, color: p.textSecondary, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' },
    placeTop: { color: p.text, fontWeight: '900' },
    moved: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    movedText: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
    empty: { alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 20 },
    emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: raised(p), alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    emptyTitle: { color: p.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  });
