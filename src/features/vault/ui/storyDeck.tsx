/**
 * A story you tap through, like Wrapped: full-screen cards that move on by
 * themselves, with progress bars at the top. Hold to pause, tap right for the
 * next card and left to go back, drag down to close. Used by the Simkl
 * Wrapped and the Audio Wrapped; the video Wrapped has its own (it plays your
 * videos behind the cards). `useStoryText` gives the same big type as Wrapped.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, FadeIn, FadeInDown, Keyframe, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import Fade from './Fade';
import { gradient } from './insightParts';
import { success, tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import { DUR, EASE_OUT, SPRING, useReducedMotion } from './motion';
import { Modal, useWindowDimensions } from './screen';
import { Aurora, GrowBar, Words } from './storyKit';
import { sheet, useStyles } from './theme';

export type DeckCard = {
  key: string;
  colors: [string, string];
  ms: number;
  body: ReactNode;
  /** Drawn behind the words: posters, covers, rays. */
  backdrop?: ReactNode;
  /** Has buttons: only the far edges of the screen move to another card. */
  interactive?: boolean;
  /** A small celebration when this card opens. */
  cheer?: boolean;
  /** Its backdrop covers the whole card (pages, a video): the story's ambient scene is not drawn under it. */
  solid?: boolean;
};

const bodyIn = new Keyframe({
  0: { opacity: 0.4, transform: [{ scale: 1.04 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(420);

/** The words of a story card: a small kicker, a big line, normal lines and bars. */
export function useStoryText() {
  const styles = useStyles(makeStyles);
  const t = (delay: number) => FadeInDown.delay(80 + delay * 110).duration(DUR.slow).easing(EASE_OUT);
  return {
    kicker: (s: string, i = 0) => (
      <Animated.Text entering={t(i)} style={styles.kicker}>
        {s}
      </Animated.Text>
    ),
    big: (s: string, i = 1) => <Words text={s} delay={80 + i * 110} style={[styles.big, s.length > 22 && { fontSize: 36, lineHeight: 40 }, s.length > 40 && { fontSize: 29, lineHeight: 33 }]} />,
    huge: (s: string, i = 1) => (
      <Animated.Text entering={t(i)} style={styles.huge} adjustsFontSizeToFit numberOfLines={1}>
        {s}
      </Animated.Text>
    ),
    line: (s: string, i = 2) => (
      <Animated.Text key={s} entering={t(i)} style={styles.line}>
        {s}
      </Animated.Text>
    ),
    bars: (rows: { label: string; share: number; sub: string }[], i = 3) => (
      <Animated.View entering={t(i)} style={{ gap: 12, marginTop: 10 }}>
        {rows.map((r, n) => (
          <View key={r.label} style={{ gap: 5 }}>
            <View style={styles.barHead}>
              <Text style={styles.barLabel} numberOfLines={1}>
                {r.label}
              </Text>
              <Text style={styles.barValue}>{r.sub}</Text>
            </View>
            <GrowBar share={r.share} delay={250 + i * 110 + n * 130} />
          </View>
        ))}
      </Animated.View>
    ),
    enter: t,
  };
}

export function StoryDeck({
  cards,
  onClose,
  onEnd,
  ambient,
  onIndex,
  onPaused,
  sound,
}: {
  cards: DeckCard[];
  onClose: () => void;
  onEnd?: () => void;
  /** Told which card is showing (a story with sound switches what it plays). */
  onIndex?: (index: number) => void;
  /** Told when holding the screen pauses the story, and when it carries on. */
  onPaused?: (paused: boolean) => void;
  /** A story with sound gets a speaker button. */
  sound?: { muted: boolean; onToggle: () => void };
  /** The story's own living background for each card (pages, posters, covers), under its backdrop and words. */
  ambient?: (card: DeckCard, index: number) => ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  // The browser preview can open a given card (`&card=3`), paused, for screenshots.
  const previewCard = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('card') : null;
  const [i, setI] = useState(() => Math.min(cards.length - 1, Math.max(0, Number(previewCard ?? 0) || 0)));
  const [paused, setPaused] = useState(previewCard !== null);
  // How far the current card has run (0 to 1), animated on the UI thread: no re-render while it runs.
  const progress = useSharedValue(0);
  // Bumped to restart the current card's clock (tapping back on the first card).
  const [restart, setRestart] = useState(0);
  const iRef = useRef(0);
  iRef.current = i;
  const ended = useRef(false);
  const card = cards[Math.min(i, cards.length - 1)];
  useEffect(() => onIndex?.(i), [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onPaused?.(paused), [paused]); // eslint-disable-line react-hooks/exhaustive-deps
  // The living background is built once per card, not on every tick of the progress bar.
  const scene = useMemo(() => (ambient && card && !card.solid ? ambient(card, i) : null), [ambient, card, i]);

  const go = (n: number) => {
    if (n < 0) {
      progress.value = 0;
      return setRestart((r) => r + 1);
    }
    if (n >= cards.length) return onClose();
    if (cards[n].cheer) success();
    else tick();
    if (n === cards.length - 1 && !ended.current) {
      ended.current = true;
      onEnd?.();
    }
    progress.value = 0;
    setI(n);
  };
  const next = () => go(iRef.current + 1);

  // The clock of the current card: runs from where it is to the end, then moves on. Holding pauses it.
  useEffect(() => {
    if (!cards.length) return;
    if (paused) {
      cancelAnimation(progress);
      return;
    }
    const ms = cards[Math.min(i, cards.length - 1)].ms;
    progress.value = withTiming(1, { duration: Math.max(0, (1 - progress.value) * ms), easing: Easing.linear }, (done) => {
      if (done) scheduleOnRN(next);
    });
    return () => cancelAnimation(progress);
  }, [i, paused, restart, cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ty = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-30, 30])
    .onUpdate((e) => {
      'worklet';
      ty.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 120 || e.velocityY > 900) ty.value = withTiming(height, { duration: DUR.base }, (d) => d && scheduleOnRN(onClose));
      else ty.value = withSpring(0, SPRING);
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(250)
    .onEnd((e, ok) => {
      if (!ok || e.y < insets.top + 70) return;
      const last = iRef.current >= cards.length - 1;
      if (last || cards[iRef.current].interactive) {
        if (e.x < width * 0.2) go(iRef.current - 1);
        else if (!last && e.x > width * 0.85) go(iRef.current + 1);
        return;
      }
      go(e.x < width / 3 ? iRef.current - 1 : iRef.current + 1);
    });
  const hold = Gesture.LongPress()
    .runOnJS(true)
    .minDuration(200)
    .onStart(() => setPaused(true))
    .onFinalize(() => setPaused(false));
  const gestures = Gesture.Race(pan, hold, tap);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }, { scale: 1 - Math.min(0.1, ty.value / 3000) }], borderRadius: Math.min(30, ty.value / 4) }));

  if (!card) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
        <GestureDetector gesture={gestures}>
          <Animated.View style={[styles.story, sheetStyle]}>
            {/* Colour only where a story has nothing of yours to show: its scene or the card's own pictures fill it otherwise. */}
            {!card.solid && !scene && (
              <Animated.View key={`bg${i}`} entering={FadeIn.duration(DUR.slow)} style={StyleSheet.absoluteFill}>
                <Aurora colors={card.colors} width={width} height={height} />
              </Animated.View>
            )}
            {scene && (
              <Animated.View key={`am${i}`} entering={FadeIn.duration(DUR.slow)} style={StyleSheet.absoluteFill} pointerEvents="none">
                {scene}
              </Animated.View>
            )}
            {card.backdrop && (
              <Animated.View key={`bd${i}`} entering={FadeIn.duration(DUR.slow)} style={StyleSheet.absoluteFill} pointerEvents="none">
                {card.backdrop}
              </Animated.View>
            )}
            {scene || card.solid ? (
              // Over pictures: a plain dark shade (no colour) so the words read and the pictures still show.
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.28) 22%, rgba(0,0,0,0.42) 55%, rgba(0,0,0,0.78) 100%)', 'rgba(0,0,0,0.45)')]} />
            ) : (
              <Fade color="0,0,0" from={0} to={0.35} style={StyleSheet.absoluteFill} />
            )}
            <View style={[styles.bars, { top: insets.top + 8 }]}>
              {cards.map((c, n) => (
                <View key={c.key} style={styles.bar}>
                  {n < i ? <View style={[styles.barFill, { width: '100%' }]} /> : n === i ? <BarFill progress={progress} /> : null}
                </View>
              ))}
            </View>
            <View style={[styles.top, { top: insets.top + 20 }]}>
              {sound && <IconButton icon={sound.muted ? 'muted' : 'sound'} label={sound.muted ? 'Sound on' : 'Mute'} clear color="#fff" onPress={sound.onToggle} size={36} />}
              <IconButton icon="close" label="Close" clear color="#fff" onPress={onClose} size={36} />
            </View>
            <Animated.View key={`b${i}`} entering={reduce ? undefined : bodyIn} style={[styles.body, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}>
              {card.body}
            </Animated.View>
            {paused && (
              <Animated.View entering={FadeIn.duration(DUR.fast)} style={[styles.pausePill, { bottom: insets.bottom + 18 }]}>
                <Icon name="pause" size={12} color="#fff" />
                <Text style={styles.pauseText}>Paused</Text>
              </Animated.View>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** The current card's bar: grows with the clock, on the UI thread. */
function BarFill({ progress }: { progress: SharedValue<number> }) {
  const styles = useStyles(makeStyles);
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  return <Animated.View style={[styles.barFill, { width: '100%', transformOrigin: 'left' }, anim]} />;
}

const makeStyles = () =>
  sheet({
    story: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', backgroundColor: '#000' },
    bars: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 3, zIndex: 2 },
    bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    barFill: { height: 3, backgroundColor: '#fff' },
    top: { position: 'absolute', right: 12, zIndex: 3, flexDirection: 'row', gap: 8 },
    body: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
    kicker: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '900', letterSpacing: 1.4, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 1 } },
    big: { color: '#fff', fontSize: 44, fontWeight: '900', letterSpacing: -1.5, lineHeight: 48, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 1 } },
    huge: { color: '#fff', fontSize: 84, fontWeight: '900', letterSpacing: -3, lineHeight: 88, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 1 } },
    line: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 25, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 1 } },
    barHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    barLabel: { color: '#fff', fontSize: 16, fontWeight: '800', flexShrink: 1, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 1 } },
    barValue: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700' },
    pausePill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    pauseText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  });
