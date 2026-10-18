/**
 * Badges: your trophy room.
 *
 * - Your level: a ring that fills, XP counting up, the badge you are closest
 *   to and how many of each tier you hold, on a moving colour background.
 * - New badges: earned since you last looked, each one revealed full screen
 *   with the video that earned it, rays and confetti (and a red dot on the tab
 *   until you have seen them).
 * - A showcase of three badges you pinned, with a shine running over them.
 * - This week's and this month's challenges, with days left.
 * - Personal records as photos dropped on a table, almost-there rings,
 *   recently earned, every badge by group (filter: all, earned, to do; secret
 *   ones show "???"), challenges won and your journey.
 * Tap a badge for its page: tilt the medal with your finger, read what it
 * takes, every step of its ladder and the video behind it.
 * Presentational only; achievements.ts and recap.ts work it out.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { summarize, TIER_NAMES, type AchGroup, type Achievement } from '../achievements';
import type { Milestone, Record_ } from '../recap';
import { success, tick } from './haptics';
import Icon from './Icon';
import { Card, gradient, iconOr, Medallion, PhotoCard, Ring, SectionTitle, ShareBar, TIER_COLORS } from './insightParts';
import { DUR, EASE_OUT, enterUp, PressableScale, SPRING_POP, useReducedMotion } from './motion';
import { Segment, SheetFrame } from './sheets';
import { Aurora, Confetti, CountUp, Float, GrowBar, hexA, KenBurns, Rays, Tilt, Words } from './storyKit';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

const GROUPS: { key: AchGroup; blurb: string; icon: string; color: string }[] = [
  { key: 'Watching', blurb: 'Time spent with your videos', icon: 'play', color: '#0A84FF' },
  { key: 'Habits', blurb: 'When and how often you watch', icon: 'trending', color: '#FF9F0A' },
  { key: 'Memories', blurb: 'Memories, Wrapped and looking back', icon: 'memories', color: '#FF375F' },
  { key: 'Library', blurb: 'What you collect, rate and film', icon: 'videos', color: '#30D158' },
  { key: 'Organising', blurb: 'Keywords, albums, captions, series and Overview', icon: 'tag', color: '#BF5AF2' },
  { key: 'Simkl', blurb: 'Movies, shows and anime', icon: 'tv', color: '#64D2FF' },
];

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
const progressText = (a: Achievement) => `${num(Math.min(a.current, a.target))} / ${num(a.target)}${a.unit ? ` ${a.unit}` : ''}`;
const hidden = (a: Achievement) => !!a.secret && !a.unlocked;
const tierOf = (a: Achievement) => TIER_COLORS[Math.min(5, Math.max(1, a.tier))];

export type Level = { xp: number; level: number; title: string; into: number; need: number };

/** A medal with a band of light running across it every few seconds. */
function ShinyMedal({ icon, tier, size, delay = 0 }: { icon: string; tier: number; size: number; delay?: number }) {
  const reduce = useReducedMotion();
  const x = useSharedValue(-1);
  useEffect(() => {
    if (reduce) return;
    x.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 900, easing: EASE_OUT }), withTiming(1, { duration: 2600 }), withTiming(-1, { duration: 0 })), -1, false));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * size * 1.2 }, { rotate: '25deg' }] }));
  return (
    <View style={{ width: size, height: size }}>
      <Medallion icon={icon} tier={tier} unlocked size={size} />
      <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
        <Animated.View style={[{ position: 'absolute', top: -size * 0.3, bottom: -size * 0.3, left: size * 0.4, width: size * 0.22 }, gradient('linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 100%)', 'transparent'), band]} />
      </View>
    </View>
  );
}

/** A medal you can tilt with your finger; it springs back when you let go. */
function TiltMedal({ a, size }: { a: Achievement; size: number }) {
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const spin = useSharedValue(a.unlocked ? 1 : 0);
  useEffect(() => {
    if (a.unlocked) spin.value = withSequence(withTiming(0, { duration: 0 }), withSpring(1, { damping: 12, stiffness: 90 }));
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      ry.value = Math.max(-35, Math.min(35, e.translationX / 3));
      rx.value = Math.max(-35, Math.min(35, -e.translationY / 3));
    })
    .onEnd(() => {
      'worklet';
      rx.value = withSpring(0, SPRING_POP);
      ry.value = withSpring(0, SPRING_POP);
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ perspective: 600 }, { rotateX: `${rx.value}deg` }, { rotateY: `${ry.value + (1 - spin.value) * 360}deg` }, { scale: 0.6 + spin.value * 0.4 }],
  }));
  const shine = useAnimatedStyle(() => ({ opacity: 0.15 + Math.min(0.5, (Math.abs(rx.value) + Math.abs(ry.value)) / 60), transform: [{ translateX: ry.value * 1.6 }, { translateY: -rx.value * 1.6 }] }));
  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ width: size, height: size }, style]}>
          {hidden(a) ? <SecretMedal size={size} /> : <Medallion icon={a.icon} tier={a.tier} unlocked={a.unlocked} size={size} />}
          {a.unlocked && (
            <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
              <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2 }, gradient('radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 45%)', 'transparent'), shine]} />
            </View>
          )}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

function SecretMedal({ size }: { size: number }) {
  const p = usePalette();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderStyle: 'dashed', borderColor: p.border, alignItems: 'center', justifyContent: 'center', backgroundColor: p.card }}>
      <Icon name="question" size={size * 0.4} color={p.textMuted} />
    </View>
  );
}

/**
 * New badges, full screen. A few are revealed one by one (tap anywhere for the
 * next, the left edge to go back, or Skip all); many at once open straight on
 * the haul: every new medal on one page, with the tiers they reached.
 */
function UnlockReveal({ list, thumbs, onPin, pinned, onDone }: { list: Achievement[]; thumbs: Map<string, VaultItem['thumbSource']>; onPin: (id: string) => void; pinned: string[]; onDone: () => void }) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [i, setI] = useState(0);
  // More than six: show them all together first (one by one is still a tap away).
  const [haul, setHaul] = useState(list.length > 6);
  const a = list[Math.min(i, list.length - 1)];
  useEffect(() => {
    success();
  }, [i, haul]);
  if (!a) return null;
  if (haul)
    return (
      <RevealHaul
        list={list}
        onOneByOne={() => {
          setI(0);
          setHaul(false);
        }}
        onDone={onDone}
      />
    );
  const [light, dark] = tierOf(a);
  const thumb = a.videoId ? thumbs.get(a.videoId) : undefined;
  const last = i >= list.length - 1;
  const next = () => (last ? (list.length > 1 ? setHaul(true) : onDone()) : setI(i + 1));
  const back = () => i > 0 && setI(i - 1);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View key={a.id} style={styles.reveal}>
        <Aurora colors={[dark, '#05030F']} accent={light} width={width} height={height} />
        {thumb && (
          <View style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}>
            <KenBurns source={thumb} ms={9000} seed={i} />
          </View>
        )}
        <View style={[StyleSheet.absoluteFill, gradient(`radial-gradient(circle at 50% 40%, ${hexA(dark, 0.2)} 0%, rgba(5,3,15,0.92) 75%)`, 'rgba(5,3,15,0.7)')]} />
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: height * 0.18 }]} pointerEvents="none">
          <Rays size={Math.max(width, height) * 1.4} color={light} opacity={0.18} count={18} />
        </View>
        <View style={[StyleSheet.absoluteFill, { paddingBottom: height * 0.18 }]} pointerEvents="none">
          <Confetti colors={[light, dark, '#ffffff', '#FFD60A']} count={46} delay={500} />
        </View>

        {/* Tap the left third to go back, anywhere else for the next one. */}
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }} onPress={back} accessibilityLabel="Previous badge" />
          <TouchableOpacity activeOpacity={1} style={{ flex: 2 }} onPress={next} accessibilityLabel="Next badge" />
        </View>

        {list.length > 1 && (
          <View style={[styles.revealTop, { top: insets.top + 10 }]} pointerEvents="box-none">
            <View style={styles.revealDots} pointerEvents="none">
              {list.slice(0, 30).map((x, n) => (
                <View key={x.id} style={[styles.revealDot, { flex: 1, backgroundColor: n <= i ? '#fff' : 'rgba(255,255,255,0.28)' }]} />
              ))}
            </View>
            <TouchableOpacity style={styles.revealSkipAll} onPress={() => setHaul(true)} hitSlop={10} accessibilityLabel="Skip all and see every new badge">
              <Text style={styles.revealSkipAllText}>Skip all</Text>
              <Icon name="forward" size={12} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.revealBody, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 30 }]} pointerEvents="box-none">
          <Animated.Text entering={FadeIn.duration(DUR.slow)} style={[styles.revealKicker, { color: light }]}>
            {list.length > 1 ? `NEW BADGE · ${i + 1} OF ${list.length}` : 'NEW BADGE'}
          </Animated.Text>
          <View pointerEvents="box-none">
            <Float amount={5}>
              <TiltMedal a={a} size={Math.min(190, width * 0.48)} />
            </Float>
          </View>
          <View pointerEvents="none" style={{ alignItems: 'center', gap: 14 }}>
            <Words text={a.title} style={styles.revealTitle} delay={500} />
            {a.kind === 'ladder' && (
              <Animated.Text entering={FadeIn.delay(800)} style={[styles.revealTier, { color: light }]}>
                {TIER_NAMES[a.tier]}
              </Animated.Text>
            )}
            <Animated.Text entering={FadeInDown.delay(900).duration(DUR.slow)} style={styles.revealDetail}>
              {a.detail}
              {a.earnedAt ? ` · ${day(a.earnedAt)}` : ''}
            </Animated.Text>
          </View>
          <Animated.View entering={FadeInDown.delay(1100).duration(DUR.slow)} style={styles.revealButtons}>
            {a.kind !== 'monthly' && a.kind !== 'weekly' && (
              <TouchableOpacity style={styles.revealGhost} onPress={() => onPin(a.id)}>
                <Icon name="pin" size={14} color="#fff" />
                <Text style={styles.revealGhostText}>{pinned.includes(a.id) ? 'Pinned' : 'Pin'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.revealPrimary} onPress={next}>
              <Text style={styles.revealPrimaryText}>{last ? (list.length > 1 ? 'See them all' : 'Done') : `Next (${list.length - i - 1} more)`}</Text>
            </TouchableOpacity>
          </Animated.View>
          {list.length > 1 && (
            <Text style={styles.revealSkip} pointerEvents="none">
              Tap anywhere for the next one
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Every new badge on one page: the count, the tiers they reached, and each medal. */
function RevealHaul({ list, onOneByOne, onDone }: { list: Achievement[]; onOneByOne: () => void; onDone: () => void }) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const best = [...list].sort((x, y) => y.tier - x.tier)[0];
  const [light, dark] = tierOf(best);
  const cols = width > 600 ? 5 : 3;
  const cell = (width - 40 - (cols - 1) * 10) / cols;
  const byTier = [5, 4, 3, 2, 1].map((t) => ({ t, n: list.filter((x) => x.kind === 'ladder' && x.tier === t).length })).filter((x) => x.n);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={styles.reveal}>
        <Aurora colors={[dark, '#05030F']} accent={light} width={width} height={height} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(5,3,15,0.55)' }]} />
        <View style={[StyleSheet.absoluteFill, { height: height * 0.45 }]} pointerEvents="none">
          <Confetti colors={[light, dark, '#ffffff', '#FFD60A']} count={60} delay={200} />
        </View>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 36, paddingBottom: insets.bottom + 120, paddingHorizontal: 20, gap: 14 }}>
          <Animated.Text entering={FadeIn.duration(DUR.slow)} style={[styles.revealKicker, { color: light, textAlign: 'center' }]}>
            YOU UNLOCKED
          </Animated.Text>
          <View style={{ alignItems: 'center' }}>
            <CountUp to={list.length} format={(n) => String(Math.round(n))} style={styles.haulCount} ms={900} />
            <Text style={styles.haulWord}>{list.length === 1 ? 'new badge' : 'new badges'}</Text>
          </View>
          {byTier.length > 0 && (
            <View style={styles.haulTiers}>
              {byTier.map(({ t, n }) => (
                <View key={t} style={[styles.haulTier, { borderColor: TIER_COLORS[t][0] }]}>
                  <View style={[styles.haulTierDot, { backgroundColor: TIER_COLORS[t][0] }]} />
                  <Text style={styles.haulTierText}>
                    {n} {TIER_NAMES[t]}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.haulGrid}>
            {list.map((x, n) => (
              <Animated.View key={x.id} entering={ZoomIn.delay(Math.min(n, 18) * 45)} style={[styles.haulCell, { width: cell }]}>
                <ShinyMedal icon={x.icon} tier={x.tier} size={Math.min(84, cell * 0.72)} delay={n * 120} />
                <Text style={styles.haulName} numberOfLines={2}>
                  {x.title}
                </Text>
                {x.kind === 'ladder' && <Text style={[styles.haulTierName, { color: tierOf(x)[0] }]}>{TIER_NAMES[x.tier]}</Text>}
              </Animated.View>
            ))}
          </View>
        </ScrollView>
        <View style={[styles.haulBar, { paddingBottom: insets.bottom + 16 }]}>
          {list.length > 1 && (
            <TouchableOpacity style={styles.revealGhost} onPress={onOneByOne}>
              <Icon name="play" size={13} color="#fff" />
              <Text style={styles.revealGhostText}>One by one</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.revealPrimary, { flex: 1, alignItems: 'center' }]} onPress={onDone}>
            <Text style={styles.revealPrimaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** A challenge: its ring, what it asks, and the days left. */
function ChallengeCard({ a, label, left, color, onPress }: { a: Achievement; label: string; left: number; color: string; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <PressableScale onPress={onPress} style={styles.challenge}>
      <View style={[StyleSheet.absoluteFill, gradient(`linear-gradient(150deg, ${hexA(color, 0.28)} 0%, ${hexA(color, 0.04)} 100%)`, hexA(color, 0.12))]} />
      <View style={styles.challengeTop}>
        <Text style={[styles.challengeKicker, { color }]}>{label}</Text>
        <Text style={styles.challengeLeft}>{a.unlocked ? 'Done ✓' : `${left} ${left === 1 ? 'day' : 'days'} left`}</Text>
      </View>
      <Ring size={70} stroke={7} progress={a.current / a.target} color={a.unlocked ? p.success : color}>
        <Text style={styles.challengePct}>{Math.min(100, Math.round((a.current / a.target) * 100))}%</Text>
      </Ring>
      <Text style={styles.challengeTitle} numberOfLines={1}>
        {a.title.split(': ')[1] ?? a.title}
      </Text>
      <Text style={styles.muted} numberOfLines={2}>
        {a.unlocked ? `Won${a.earnedAt ? ` on ${day(a.earnedAt)}` : ''}.` : a.detail}
      </Text>
      <Text style={styles.progress}>{progressText(a)}</Text>
    </PressableScale>
  );
}

export default function Badges({
  list,
  all,
  simkl,
  level,
  records,
  milestones,
  thumbs,
  showcase,
  fresh = [],
  onSeen,
  onShowcase,
  onOpenVideo,
}: {
  list: Achievement[];
  /** The same, with every step of every ladder (for a badge's page). */
  all: Achievement[];
  simkl: boolean;
  level: Level;
  records: Record_[];
  milestones: Milestone[];
  thumbs: Map<string, VaultItem['thumbSource']>;
  /** Pinned badge ids (up to three). */
  showcase: string[];
  /** Earned since you last looked: revealed one by one. */
  fresh?: Achievement[];
  onSeen?: () => void;
  onShowcase: (ids: string[]) => void;
  onOpenVideo: (id: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState<Achievement | null>(null);
  const [picking, setPicking] = useState(false);
  const [showAllJourney, setShowAllJourney] = useState(false);
  const [filter, setFilter] = useState<'all' | 'earned' | 'todo'>('all');
  const [revealing, setRevealing] = useState(fresh.length > 0);
  const [revealList] = useState(() => [...fresh].sort((a, b) => (a.earnedAt ?? 0) - (b.earnedAt ?? 0)));
  const s = useMemo(() => summarize(list, 6), [list]);
  const now = new Date();
  const month = list.find((a) => a.kind === 'monthly' && a.id === `month-${now.getFullYear()}-${now.getMonth() + 1}`);
  const week = list.find((a) => a.kind === 'weekly' && a.title.startsWith('This week'));
  const won = list.filter((a) => (a.kind === 'monthly' || a.kind === 'weekly') && a.unlocked && a !== month && a !== week);
  const tierCounts = [1, 2, 3, 4, 5].map((t) => list.filter((a) => a.unlocked && a.kind === 'ladder' && a.tier === t).length);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const monthLeft = Math.max(0, Math.ceil((monthEnd - Date.now()) / 86_400_000));
  const weekLeft = 7 - ((now.getDay() + 6) % 7);
  const earned = list.filter((a) => a.unlocked && a.kind !== 'weekly' && a.kind !== 'monthly');
  const pinned = (showcase.length ? showcase.map((id) => earned.find((a) => a.id === id)).filter((a): a is Achievement => !!a) : [])
    .concat(showcase.length ? [] : [...earned].sort((a, b) => b.tier - a.tier || (b.earnedAt ?? 0) - (a.earnedAt ?? 0)).slice(0, 3))
    .slice(0, 3);
  const cardW = Math.min(240, (width - 32 - 10) / 1.6);
  const journey = showAllJourney ? milestones : milestones.slice(0, 6);
  const closest = s.next[0];
  const togglePin = (id: string) => {
    success();
    onShowcase(showcase.includes(id) ? showcase.filter((x) => x !== id) : [...showcase, id].slice(-3));
  };
  const allBadges = list.filter((a) => a.kind !== 'monthly' && a.kind !== 'weekly');

  return (
    <>
      {/* ── level ──────────────────────────────────────────────── */}
      <Animated.View entering={enterUp(0)} style={styles.hero}>
        <Aurora colors={['#5E5CE6', '#120A33']} accent="#FF375F" width={width - 32} height={250} />
        <View style={styles.heroRow}>
          <Ring size={108} stroke={10} progress={level.into / level.need} color="#FFD60A" track="rgba(255,255,255,0.18)">
            <CountUp to={level.level} format={(n) => String(Math.round(n))} style={styles.levelNum} ms={700} />
            <Text style={styles.levelWord}>LEVEL</Text>
          </Ring>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.heroKicker}>YOU ARE A</Text>
            <Text style={styles.heroTitle} numberOfLines={1} adjustsFontSizeToFit>
              {level.title}
            </Text>
            <CountUp to={level.xp} format={(n) => `${Math.round(n).toLocaleString()} XP`} style={styles.heroXp} />
            <GrowBar share={level.into / level.need} color="#FFD60A" track="rgba(255,255,255,0.2)" height={8} delay={300} />
            <Text style={styles.heroSub}>
              {(level.need - level.into).toLocaleString()} XP to level {level.level + 1}
            </Text>
          </View>
        </View>
        <View style={styles.tierRow}>
          {tierCounts.map((n, i) => (
            <View key={i} style={styles.tierItem}>
              <View style={[styles.tierDot, gradient(`linear-gradient(145deg, ${TIER_COLORS[i + 1][0]}, ${TIER_COLORS[i + 1][1]})`)]} />
              <View>
                <Text style={styles.tierText}>{n}</Text>
                <Text style={styles.tierName}>{TIER_NAMES[i + 1]}</Text>
              </View>
            </View>
          ))}
        </View>
        {closest && (
          <TouchableOpacity style={styles.heroNext} onPress={() => setOpen(closest)}>
            <Icon name={iconOr(closest.icon)} size={14} color="#fff" />
            <Text style={styles.heroNextText} numberOfLines={1}>
              Next up: {closest.title} · {Math.round((closest.current / closest.target) * 100)} %
            </Text>
            <Icon name="forward" size={12} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        )}
      </Animated.View>

      {fresh.length > 0 && !revealing && (
        <Animated.View entering={enterUp(1)}>
          <PressableScale style={styles.freshBanner} onPress={() => setRevealing(true)}>
            <View style={styles.freshIcon}>
              <Icon name="sparkle" size={16} color="#000" />
            </View>
            <Text style={styles.freshText}>
              {fresh.length} new {fresh.length === 1 ? 'badge' : 'badges'} to open
            </Text>
            <Icon name="forward" size={14} color={p.textMuted} />
          </PressableScale>
        </Animated.View>
      )}

      {/* ── showcase ──────────────────────────────────────────── */}
      <SectionTitle index={1} title="Showcase" detail={`${earned.length} earned`} action={earned.length ? { label: 'Edit', onPress: () => setPicking(true) } : undefined} />
      <Animated.View entering={enterUp(2)} style={styles.showcase}>
        {[0, 1, 2].map((n) => {
          const a = pinned[n];
          return a ? (
            <PressableScale key={a.id} style={[styles.showcaseCell, n === 1 && styles.showcaseMiddle]} onPress={() => setOpen(a)}>
              {a.videoId && thumbs.get(a.videoId) ? <Image source={thumbs.get(a.videoId)} style={styles.fill} contentFit="cover" blurRadius={12} /> : null}
              <View style={[styles.fill, gradient(`linear-gradient(180deg, ${tierOf(a)[1]}88 0%, rgba(0,0,0,0.82) 100%)`, 'rgba(0,0,0,0.55)')]} />
              <Float amount={3} ms={2400 + n * 300}>
                <ShinyMedal icon={a.icon} tier={a.tier} size={n === 1 ? 70 : 58} delay={n * 700} />
              </Float>
              <Text style={styles.showcaseTitle} numberOfLines={2}>
                {a.title}
              </Text>
              <Text style={[styles.showcaseTier, { color: tierOf(a)[0] }]}>{a.kind === 'ladder' ? TIER_NAMES[a.tier] : 'Earned'}</Text>
            </PressableScale>
          ) : (
            <TouchableOpacity key={n} style={[styles.showcaseCell, styles.showcaseEmpty]} onPress={() => earned.length && setPicking(true)}>
              <Icon name="pin" size={20} color={p.textMuted} />
              <Text style={styles.muted}>{earned.length ? 'Pin a badge' : 'Earn a badge'}</Text>
            </TouchableOpacity>
          );
        })}
      </Animated.View>

      {/* ── challenges ────────────────────────────────────────── */}
      {(week || month) && (
        <>
          <SectionTitle index={3} title="Challenges" detail="A new one every week and month" />
          <Animated.View entering={enterUp(3)} style={styles.challenges}>
            {week && <ChallengeCard a={week} label="THIS WEEK" left={weekLeft} color="#FF9F0A" onPress={() => setOpen(week)} />}
            {month && <ChallengeCard a={month} label={now.toLocaleDateString(undefined, { month: 'long' }).toUpperCase()} left={monthLeft} color="#0A84FF" onPress={() => setOpen(month)} />}
          </Animated.View>
        </>
      )}

      {/* ── records ───────────────────────────────────────────── */}
      {records.length > 0 && (
        <>
          <SectionTitle index={4} title="Records" detail="Your personal bests" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { paddingVertical: 10 }]} style={styles.bleed}>
            {records.map((r, i) => (
              <Tilt key={r.key} rotate={i % 2 ? 2.5 : -2.5} delay={150 + i * 90}>
                <PhotoCard
                  source={r.videoId ? thumbs.get(r.videoId) : undefined}
                  kicker={r.label}
                  value={r.value}
                  detail={r.detail}
                  icon={r.icon}
                  width={cardW}
                  height={176}
                  onPress={r.videoId ? () => onOpenVideo(r.videoId!) : undefined}
                />
              </Tilt>
            ))}
          </ScrollView>
        </>
      )}

      {/* ── almost there ──────────────────────────────────────── */}
      {s.next.length > 0 && (
        <>
          <SectionTitle index={6} title="Almost there" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.bleed}>
            {s.next.map((a, i) => (
              <Animated.View key={a.id} entering={enterUp(7 + i)}>
                <PressableScale onPress={() => setOpen(a)} style={styles.nextCard}>
                  <Ring size={62} stroke={6} progress={a.current / a.target} color={tierOf(a)[0]}>
                    <Icon name={iconOr(a.icon)} size={22} color={p.text} />
                  </Ring>
                  <Text style={styles.nextTitle} numberOfLines={1}>
                    {a.title}
                  </Text>
                  <Text style={styles.muted} numberOfLines={2}>
                    {a.detail}
                  </Text>
                  <ShareBar ratio={a.current / a.target} height={5} color={tierOf(a)[0]} />
                  <Text style={styles.progress}>
                    {progressText(a)} · {Math.round((a.current / a.target) * 100)} %
                  </Text>
                </PressableScale>
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      {/* ── recently earned ───────────────────────────────────── */}
      {s.recent.length > 0 && (
        <>
          <SectionTitle index={8} title="Recently earned" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.bleed}>
            {s.recent.map((a, i) => (
              <Animated.View key={a.id} entering={enterUp(9 + i)}>
                <PressableScale onPress={() => setOpen(a)} style={[styles.recentCard, { width: cardW }]}>
                  {a.videoId && thumbs.get(a.videoId) ? <Image source={thumbs.get(a.videoId)} style={styles.fill} contentFit="cover" /> : null}
                  <View style={[styles.fill, gradient(`linear-gradient(180deg, rgba(0,0,0,0.1) 0%, ${tierOf(a)[1]}DD 100%)`, 'rgba(0,0,0,0.45)')]} />
                  <ShinyMedal icon={a.icon} tier={a.tier} size={52} delay={i * 500} />
                  <View style={{ marginTop: 'auto' }}>
                    <Text style={styles.recentTitle} numberOfLines={1}>
                      {a.title}
                    </Text>
                    <Text style={styles.recentSub}>
                      {a.kind === 'ladder' ? `${TIER_NAMES[a.tier]} · ` : ''}
                      {day(a.earnedAt!)}
                    </Text>
                  </View>
                </PressableScale>
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      {/* ── the trophy room ───────────────────────────────────── */}
      <SectionTitle index={10} title="Trophy room" detail={`${allBadges.filter((a) => a.unlocked).length} of ${allBadges.length}`} />
      <Animated.View entering={enterUp(10)}>
        <Segment
          options={[
            { key: 'all', label: 'All' },
            { key: 'earned', label: 'Earned' },
            { key: 'todo', label: 'To do' },
          ]}
          value={filter}
          onChange={(k) => {
            tick();
            setFilter(k);
          }}
        />
      </Animated.View>
      {GROUPS.filter((g) => g.key !== 'Simkl' || simkl).map((g, gi) => {
        const inGroup = list.filter((a) => a.group === g.key);
        const items = inGroup.filter((a) => (filter === 'all' ? true : filter === 'earned' ? a.unlocked : !a.unlocked));
        if (!items.length) return null;
        const got = inGroup.filter((a) => a.unlocked).length;
        return (
          <Animated.View key={`${g.key}${filter}`} entering={FadeIn.duration(DUR.base)} style={styles.shelf}>
            <View style={styles.shelfHead}>
              <View style={[styles.shelfIcon, { backgroundColor: hexA(g.color, 0.18) }]}>
                <Icon name={iconOr(g.icon)} size={16} color={g.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.shelfTitle}>{g.key}</Text>
                <Text style={styles.muted}>{g.blurb}</Text>
              </View>
              <Ring size={40} stroke={4} progress={got / inGroup.length} color={g.color}>
                <Text style={styles.shelfCount}>{got}</Text>
              </Ring>
            </View>
            <View style={styles.grid}>
              {items.map((a, i) => (
                <Animated.View key={a.id} entering={FadeInDown.delay(Math.min(i, 12) * 30 + gi * 40).duration(DUR.base).easing(EASE_OUT)} style={styles.cell}>
                  <PressableScale
                    onPress={() => setOpen(a)}
                    style={[styles.cellInner, a.unlocked && { borderColor: `${tierOf(a)[0]}66`, backgroundColor: hexA(tierOf(a)[1], 0.14) }]}
                    accessibilityLabel={hidden(a) ? 'Secret badge' : `${a.title}, ${a.unlocked ? 'earned' : progressText(a)}`}>
                    {hidden(a) ? <SecretMedal size={58} /> : <Medallion icon={a.icon} tier={a.tier} unlocked={a.unlocked} size={58} progress={a.current / a.target} />}
                    <Text style={[styles.cellTitle, !a.unlocked && { color: p.textSoft }]} numberOfLines={2}>
                      {hidden(a) ? '???' : a.title}
                    </Text>
                    <Text style={styles.cellSub} numberOfLines={1}>
                      {hidden(a) ? 'Secret' : a.unlocked ? (a.kind === 'ladder' ? TIER_NAMES[a.tier] : 'Earned') : progressText(a)}
                    </Text>
                  </PressableScale>
                </Animated.View>
              ))}
            </View>
          </Animated.View>
        );
      })}

      {won.length > 0 && (
        <Card index={16} title="Challenges won" sub={`${won.length} weeks and months`}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {won.map((a) => (
              <TouchableOpacity key={a.id} style={styles.wonCell} onPress={() => setOpen(a)}>
                <Medallion icon={a.icon} tier={a.kind === 'weekly' ? 2 : 3} unlocked size={50} />
                <Text style={styles.wonText} numberOfLines={2}>
                  {a.title.split(':')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Card>
      )}

      {/* ── journey ──────────────────────────────────────────── */}
      {milestones.length > 0 && (
        <Card index={17} title="Your journey" sub="Your story with ReelVault, newest first">
          <View>
            {journey.map((m, i) => (
              <Animated.View key={`${m.at}-${m.title}`} entering={FadeInDown.delay(i * 60).duration(DUR.base)}>
                <TouchableOpacity style={styles.jRow} disabled={!m.videoId} onPress={() => m.videoId && onOpenVideo(m.videoId)}>
                  <View style={styles.jRail}>
                    <View style={styles.jDot}>
                      <Icon name={iconOr(m.icon)} size={12} color="#fff" />
                    </View>
                    {i < journey.length - 1 && <View style={styles.jLine} />}
                  </View>
                  <View style={{ flex: 1, paddingBottom: 16 }}>
                    <Text style={styles.jDate}>{day(m.at)}</Text>
                    <Text style={styles.recentTitleDark}>{m.title}</Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {m.detail}
                    </Text>
                  </View>
                  {m.videoId && thumbs.get(m.videoId) ? <Image source={thumbs.get(m.videoId)} style={styles.jThumb} contentFit="cover" /> : null}
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>
          {milestones.length > 6 && (
            <TouchableOpacity onPress={() => setShowAllJourney(!showAllJourney)}>
              <Text style={styles.link}>{showAllJourney ? 'Show less' : `Show all ${milestones.length}`}</Text>
            </TouchableOpacity>
          )}
        </Card>
      )}

      <Text style={styles.foot}>
        Everything here is worked out from your library and what you do in ReelVault, so it can never be lost. XP: 100 per badge tier, 10 per hour watched, 2 per video.
      </Text>

      {open && (
        <BadgeSheet
          a={open}
          family={all.filter((x) => x.family === open.family && x.kind === 'ladder')}
          thumb={open.videoId ? thumbs.get(open.videoId) : undefined}
          pinned={showcase.includes(open.id)}
          onPin={open.unlocked && open.kind !== 'weekly' && open.kind !== 'monthly' ? () => togglePin(open.id) : undefined}
          onPlay={open.videoId ? () => onOpenVideo(open.videoId!) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
      {picking && (
        <SheetFrame title="Showcase" onClose={() => setPicking(false)} action={{ label: 'Done', onPress: () => setPicking(false) }}>
          <Text style={styles.muted}>Pick up to three badges to show at the top. Tap again to take one off.</Text>
          <View style={styles.grid}>
            {earned.map((a) => {
              const on = showcase.includes(a.id);
              return (
                <TouchableOpacity
                  key={a.id}
                  style={styles.cell}
                  onPress={() => {
                    tick();
                    onShowcase(on ? showcase.filter((x) => x !== a.id) : [...showcase, a.id].slice(-3));
                  }}>
                  <View style={[styles.cellInner, on && { borderColor: p.accent, borderWidth: 2 }]}>
                    <Medallion icon={a.icon} tier={a.tier} unlocked size={50} />
                    <Text style={styles.cellTitle} numberOfLines={2}>
                      {a.title}
                    </Text>
                    {on && <Icon name="pin" size={14} color={p.accent} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </SheetFrame>
      )}
      {revealing && revealList.length > 0 && (
        <UnlockReveal
          list={revealList}
          thumbs={thumbs}
          pinned={showcase}
          onPin={togglePin}
          onDone={() => {
            setRevealing(false);
            onSeen?.();
          }}
        />
      )}
    </>
  );
}

function BadgeSheet({
  a,
  family,
  thumb,
  pinned,
  onPin,
  onPlay,
  onClose,
}: {
  a: Achievement;
  family: Achievement[];
  thumb?: VaultItem['thumbSource'];
  pinned: boolean;
  onPin?: () => void;
  onPlay?: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const secret = hidden(a);
  const [light, dark] = tierOf(a);
  return (
    <SheetFrame title={a.unlocked ? 'Earned' : secret ? 'Secret badge' : 'Not yet'} onClose={onClose}>
      <View style={styles.sheetHero}>
        <View style={[styles.sheetPhoto, !thumb && { height: 120 }]}>
          {thumb ? <Image source={thumb} style={styles.fill} contentFit="cover" /> : <View style={[styles.fill, gradient(`linear-gradient(150deg, ${a.unlocked ? dark : p.card} 0%, ${p.panel} 100%)`)]} />}
          <View style={[styles.fill, gradient(`linear-gradient(180deg, rgba(0,0,0,0) 30%, ${p.panel} 100%)`, 'rgba(0,0,0,0.3)')]} />
          {a.unlocked && (
            <View style={[styles.fill, { alignItems: 'center', justifyContent: 'center' }]}>
              <Rays size={420} color={light} opacity={0.2} />
            </View>
          )}
        </View>
        <Animated.View entering={ZoomIn.springify().damping(SPRING_POP.damping).stiffness(SPRING_POP.stiffness)} style={{ marginTop: -80 }}>
          <TiltMedal a={a} size={124} />
        </Animated.View>
        <Text style={styles.sheetTitle}>{secret ? '???' : a.title}</Text>
        {a.kind === 'ladder' && <Text style={[styles.sheetTier, { color: dark }]}>{TIER_NAMES[a.tier]}</Text>}
        <Text style={styles.sheetDetail}>{secret ? 'A secret. Keep watching and you might stumble on it.' : a.detail}</Text>
        {a.unlocked ? (
          <Text style={styles.sheetDone}>{a.earnedAt ? `Earned on ${day(a.earnedAt)}` : 'Earned'}</Text>
        ) : secret ? null : (
          <View style={{ alignSelf: 'stretch', gap: 6 }}>
            <GrowBar share={Math.min(1, a.current / a.target)} color={p.accent} track={p.card} height={10} />
            <Text style={[styles.progress, { textAlign: 'center' }]}>
              {progressText(a)} · {Math.round(Math.min(1, a.current / a.target) * 100)} %
            </Text>
          </View>
        )}
        {a.unlocked && <Text style={[styles.muted, { textAlign: 'center' }]}>Drag the medal to tilt it.</Text>}
        <View style={styles.sheetButtons}>
          {onPlay && (
            <TouchableOpacity style={styles.sheetBtn} onPress={onPlay}>
              <Icon name="play" size={14} color={p.text} />
              <Text style={styles.sheetBtnText}>The video that did it</Text>
            </TouchableOpacity>
          )}
          {onPin && (
            <TouchableOpacity style={styles.sheetBtn} onPress={onPin}>
              <Icon name="pin" size={14} color={pinned ? p.accent : p.text} />
              <Text style={styles.sheetBtnText}>{pinned ? 'Unpin' : 'Pin to showcase'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {family.length > 1 && (
        <Animated.View entering={FadeIn} style={{ gap: 10 }}>
          <Text style={styles.sheetSection}>Every step</Text>
          {[...family]
            .sort((x, y) => x.target - y.target)
            .map((st, i) => (
              <Animated.View key={st.id} entering={FadeInDown.delay(i * 60).duration(DUR.base)} style={styles.stepRow}>
                <Medallion icon={a.icon} tier={st.tier} unlocked={st.unlocked} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.recentTitleDark, !st.unlocked && { color: p.textSoft }]}>{st.title}</Text>
                  <Text style={styles.muted}>
                    {st.unlocked ? (st.earnedAt ? `Earned ${day(st.earnedAt)}` : 'Earned') : `${TIER_NAMES[st.tier]} · ${num(st.target)}${a.unit ? ` ${a.unit}` : ''}`}
                  </Text>
                </View>
                {st.unlocked ? <Icon name="checkCircle" size={18} color={p.success} /> : <Text style={styles.progress}>{Math.round(Math.min(1, st.current / st.target) * 100)} %</Text>}
              </Animated.View>
            ))}
        </Animated.View>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    muted: { color: p.textSecondary, fontSize: 12, lineHeight: 16 },
    progress: { color: p.textSoft, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    link: { color: p.link, fontSize: 14, fontWeight: '700', textAlign: 'center' },
    bleed: { marginHorizontal: -16 },
    row: { gap: 10, paddingHorizontal: 16 },
    fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },

    hero: { borderRadius: 28, padding: 18, gap: 16, overflow: 'hidden', backgroundColor: '#2B1A6E' },
    heroRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
    levelNum: { color: '#fff', fontSize: 36, fontWeight: '900', letterSpacing: -1, marginBottom: -4 },
    levelWord: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    heroKicker: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    heroTitle: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
    heroXp: { color: '#FFD60A', fontSize: 15, fontWeight: '900', marginBottom: 4 },
    heroSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700', marginTop: 2 },
    tierRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 16, padding: 10 },
    tierItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tierDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' },
    tierText: { color: '#fff', fontSize: 15, fontWeight: '900' },
    tierName: { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '800' },
    heroNext: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    heroNextText: { color: '#fff', fontSize: 13, fontWeight: '800', flex: 1 },

    freshBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.elevated, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: '#FFD60A66' },
    freshIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFD60A', alignItems: 'center', justifyContent: 'center' },
    freshText: { color: p.text, fontSize: 15, fontWeight: '800', flex: 1 },

    showcase: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
    showcaseCell: { flex: 1, height: 158, borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, backgroundColor: p.elevated },
    showcaseMiddle: { height: 182 },
    showcaseTitle: { color: '#fff', fontSize: 12, fontWeight: '800', textAlign: 'center' },
    showcaseTier: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
    showcaseEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.border, backgroundColor: 'transparent' },

    challenges: { flexDirection: 'row', gap: 10 },
    challenge: { flex: 1, borderRadius: 22, padding: 14, gap: 6, overflow: 'hidden', backgroundColor: p.elevated },
    challengeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    challengeKicker: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
    challengeLeft: { color: p.textSecondary, fontSize: 11, fontWeight: '800' },
    challengePct: { color: p.text, fontSize: 16, fontWeight: '900' },
    challengeTitle: { color: p.text, fontSize: 16, fontWeight: '800', marginTop: 4 },

    nextCard: { width: 172, backgroundColor: p.elevated, borderRadius: 20, padding: 14, gap: 6 },
    nextTitle: { color: p.text, fontSize: 15, fontWeight: '800', marginTop: 4 },

    recentCard: { height: 172, borderRadius: 20, overflow: 'hidden', padding: 12, backgroundColor: p.elevated },
    recentTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    recentSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
    recentTitleDark: { color: p.text, fontSize: 15, fontWeight: '700' },

    shelf: { backgroundColor: p.elevated, borderRadius: 24, padding: 12, gap: 10 },
    shelfHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingTop: 2 },
    shelfIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    shelfTitle: { color: p.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
    shelfCount: { color: p.text, fontSize: 12, fontWeight: '900' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
    cell: { width: '33.333%', padding: 4 },
    cellInner: { alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 6, minHeight: 148, borderWidth: 1, borderColor: 'transparent' },
    cellTitle: { color: p.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
    cellSub: { color: p.textSecondary, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
    wonCell: { width: 86, alignItems: 'center', gap: 6 },
    wonText: { color: p.text, fontSize: 11, fontWeight: '700', textAlign: 'center' },

    jRow: { flexDirection: 'row', gap: 12 },
    jRail: { width: 26, alignItems: 'center' },
    jDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    jLine: { flex: 1, width: 2, backgroundColor: p.separator, marginVertical: 2 },
    jDate: { color: p.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    jThumb: { width: 54, height: 40, borderRadius: 8 },

    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17 },

    reveal: { flex: 1, backgroundColor: '#05030F' },
    revealBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 28 },
    revealKicker: { fontSize: 13, fontWeight: '900', letterSpacing: 1.6, marginBottom: 10 },
    revealTitle: { color: '#fff', fontSize: 38, fontWeight: '900', letterSpacing: -1.2, textAlign: 'center', marginTop: 16 },
    revealTier: { fontSize: 14, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
    revealDetail: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '600', textAlign: 'center', lineHeight: 22 },
    revealButtons: { flexDirection: 'row', gap: 10, marginTop: 18 },
    revealGhost: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 13, backgroundColor: 'rgba(255,255,255,0.14)' },
    revealGhostText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    revealPrimary: { borderRadius: 999, paddingHorizontal: 26, paddingVertical: 13, backgroundColor: '#fff' },
    revealPrimaryText: { color: '#000', fontSize: 15, fontWeight: '900' },
    revealSkip: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', marginTop: 6 },
    revealTop: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 12, zIndex: 5 },
    revealDots: { flex: 1, flexDirection: 'row', gap: 3 },
    revealDot: { height: 3, borderRadius: 2 },
    revealSkipAll: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
    revealSkipAllText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    haulCount: { color: '#fff', fontSize: 92, fontWeight: '900', letterSpacing: -4, lineHeight: 96 },
    haulWord: { color: 'rgba(255,255,255,0.85)', fontSize: 18, fontWeight: '800', marginTop: -6 },
    haulTiers: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
    haulTier: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.25)' },
    haulTierDot: { width: 8, height: 8, borderRadius: 4 },
    haulTierText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    haulGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
    haulCell: { alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)' },
    haulName: { color: '#fff', fontSize: 12, fontWeight: '800', textAlign: 'center', paddingHorizontal: 6 },
    haulTierName: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
    haulBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 14, backgroundColor: 'rgba(5,3,15,0.85)' },

    sheetHero: { alignItems: 'center', gap: 8, paddingBottom: 8 },
    sheetPhoto: { alignSelf: 'stretch', height: 170, borderRadius: 20, overflow: 'hidden' },
    sheetTitle: { color: p.text, fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: 8, letterSpacing: -0.5 },
    sheetTier: { fontSize: 13, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
    sheetDetail: { color: p.textSoft, fontSize: 15, textAlign: 'center' },
    sheetDone: { color: p.success, fontSize: 14, fontWeight: '800' },
    sheetButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
    sheetBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    sheetBtnText: { color: p.text, fontSize: 14, fontWeight: '700' },
    sheetSection: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  });
