// Pieces of the "About you" part of Wrapped, shared by the video and the manga story. Always drawn
// light on the dark story cards, whatever the app's theme.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeInRight, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { Axis } from '../aboutYou';
import { success, warn } from './haptics';
import Icon from './Icon';
import { useReducedMotion } from './motion';
import { useLater } from './storyKit';

/** The profile: five sliders, each dot gliding from the middle to where you are. */
export function TraitSliders({ axes, delay = 300 }: { axes: readonly Axis[]; delay?: number }) {
  return (
    <View style={s.sliders}>
      {axes.map((a, i) => (
        <TraitSlider key={a.key} axis={a} delay={delay + i * 180} />
      ))}
    </View>
  );
}

function TraitSlider({ axis, delay }: { axis: Axis; delay: number }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const at = useSharedValue(reduce ? axis.value : 0.5);
  useEffect(() => {
    at.value = reduce ? axis.value : withDelay(delay, withTiming(axis.value, { duration: 1100, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
  }, [axis.value, delay, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const dot = useAnimatedStyle(() => ({ transform: [{ translateX: at.value * Math.max(0, w - DOT) }] }));
  const leans = axis.value >= 0.5 ? 1 : 0;
  const strong = Math.abs(axis.value - 0.5) >= 0.12;
  return (
    <Animated.View entering={reduce ? FadeIn : FadeInDown.delay(delay - 150).duration(500)} style={{ gap: 7 }} accessible accessibilityLabel={`${axis.left} to ${axis.right}: ${Math.round(axis.value * 100)} percent ${axis.right}`}>
      <View style={s.ends}>
        <Text style={[s.end, strong && leans === 0 && s.endOn]}>{axis.left}</Text>
        <Text style={[s.end, strong && leans === 1 && s.endOn]}>{axis.right}</Text>
      </View>
      <View style={s.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <View style={s.mid} />
        {w > 0 && <Animated.View style={[s.dot, dot]} />}
      </View>
    </Animated.View>
  );
}

/** Two truths and a lie: tap the one that is made up. */
export function LieQuiz({ statements, lie, reveal, onAnswer, onDone }: { statements: string[]; lie: number; reveal: string; onAnswer?: (right: boolean) => void; onDone: () => void }) {
  const reduce = useReducedMotion();
  const [pick, setPick] = useState<number | null>(null);
  const later = useLater();
  return (
    <View style={{ gap: 10, marginTop: 14 }}>
      {statements.map((text, n) => {
        const isLie = pick !== null && n === lie;
        const missed = pick === n && n !== lie;
        return (
          <Animated.View key={text} entering={reduce ? FadeIn : FadeInRight.delay(350 + n * 140).springify().damping(15)}>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={pick !== null}
              onPress={() => {
                setPick(n);
                if (n === lie) success();
                else warn();
                onAnswer?.(n === lie);
                later(onDone, 4200);
              }}
              style={[s.opt, isLie && s.optLie, missed && s.optMissed, pick !== null && !isLie && !missed && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel={text}>
              <Text style={[s.optText, isLie && s.optLieText]}>{text}</Text>
              {isLie && <Text style={s.tag}>LIE</Text>}
              {pick !== null && !isLie && <Icon name="check" size={16} color="rgba(255,255,255,0.8)" />}
            </TouchableOpacity>
          </Animated.View>
        );
      })}
      {pick !== null ? (
        <Animated.View entering={FadeInDown.duration(450)} style={{ gap: 4 }}>
          <Text style={s.verdict}>{pick === lie ? 'Caught it. You know yourself.' : 'Fooled you. The made-up one was the other one.'}</Text>
          <Text style={s.reveal}>The truth: {reveal}</Text>
        </Animated.View>
      ) : (
        <Animated.Text entering={FadeIn.delay(1000)} style={s.hint}>
          Tap the lie
        </Animated.Text>
      )}
    </View>
  );
}

const DOT = 22;

const s = StyleSheet.create({
  sliders: { gap: 18, marginTop: 18 },
  ends: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  end: { color: 'rgba(255,255,255,0.62)', fontSize: 14, fontWeight: '700' },
  endOn: { color: '#fff', fontWeight: '900' },
  track: { height: DOT, justifyContent: 'center' },
  mid: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  dot: { position: 'absolute', left: 0, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.26)' },
  optLie: { backgroundColor: '#fff', borderColor: '#fff' },
  optMissed: { borderColor: '#FF453A' },
  optText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 21 },
  optLieText: { color: '#000', textDecorationLine: 'line-through' },
  tag: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  verdict: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 6 },
  reveal: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600', lineHeight: 21 },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', marginTop: 16 },
});
