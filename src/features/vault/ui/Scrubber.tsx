/**
 * The playback bar: drag anywhere on it (or the dot) to scrub, tap to jump.
 * While your finger is down the bar grows, a time bubble follows it, and the
 * player's own time updates are ignored so the dot never fights you. VoiceOver
 * gets an adjustable control that moves 10 seconds at a time.
 */

import { useRef, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { tick } from './haptics';
import { DUR, EASE_OUT } from './motion';
import { fmtClock } from '../stats';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function Scrubber({
  fraction,
  durationSec,
  marks = [],
  color,
  trackColor,
  markColor,
  onStart,
  onMove,
  onEnd,
}: {
  /** Where playback is, 0..1 (ignored while dragging). */
  fraction: number;
  durationSec: number;
  /** Bookmarks, in ms. */
  marks?: number[];
  color: string;
  trackColor: string;
  markColor: string;
  onStart: () => void;
  onMove: (fraction: number) => void;
  onEnd: (fraction: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const widthRef = useRef(0);
  const active = useSharedValue(0);
  const lastTick = useRef(-1);

  const shown = drag ?? clamp01(fraction);
  const at = (x: number) => clamp01(x / Math.max(1, widthRef.current));

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .hitSlop({ top: 18, bottom: 18, left: 6, right: 6 })
    .shouldCancelWhenOutside(false)
    .onBegin((e) => {
      const f = at(e.x);
      active.value = withTiming(1, { duration: DUR.fast, easing: EASE_OUT });
      setDrag(f);
      onStart();
      onMove(f);
    })
    .onUpdate((e) => {
      const f = at(e.x);
      setDrag(f);
      onMove(f);
      // A light tick every 10% so you can feel where you are.
      const step = Math.floor(f * 10);
      if (step !== lastTick.current) {
        lastTick.current = step;
        tick();
      }
    })
    .onFinalize((e) => {
      const f = at(e.x);
      active.value = withTiming(0, { duration: DUR.base, easing: EASE_OUT });
      lastTick.current = -1;
      setDrag(null);
      onEnd(f);
    });

  const trackStyle = useAnimatedStyle(() => ({ height: 3 + active.value * 4, borderRadius: 2 + active.value * 2 }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + active.value * 0.8 }] }));
  const bubbleStyle = useAnimatedStyle(() => ({ opacity: active.value, transform: [{ translateY: (1 - active.value) * 6 }] }));

  const x = shown * Math.max(0, width);
  const step = Math.max(1, Math.min(10, durationSec / 10));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={{ flex: 1, height: 30, justifyContent: 'center' }}
        onLayout={(e: LayoutChangeEvent) => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{ text: `${fmtClock(shown * durationSec * 1000)} of ${fmtClock(durationSec * 1000)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const delta = (e.nativeEvent.actionName === 'increment' ? step : -step) / Math.max(1, durationSec);
          const f = clamp01(shown + delta);
          onStart();
          onEnd(f);
        }}>
        <Animated.View style={[{ backgroundColor: trackColor, overflow: 'hidden' }, trackStyle]}>
          <View style={{ width: x, height: '100%', backgroundColor: color }} />
        </Animated.View>
        {durationSec > 0 &&
          marks.map((m) => (
            <View
              key={m}
              pointerEvents="none"
              style={{ position: 'absolute', left: clamp01(m / 1000 / durationSec) * width - 1.5, width: 3, height: 11, borderRadius: 1.5, backgroundColor: markColor }}
            />
          ))}
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', left: x - 6, width: 12, height: 12, borderRadius: 6, backgroundColor: color, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }, thumbStyle]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              bottom: 26,
              left: Math.min(Math.max(0, x - 30), Math.max(0, width - 60)),
              width: 60,
              alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.78)',
              borderRadius: 8,
              paddingVertical: 3,
            },
            bubbleStyle,
          ]}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmtClock(shown * durationSec * 1000)}</Text>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
