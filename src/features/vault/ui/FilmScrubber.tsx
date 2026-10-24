/**
 * The playback bar as a film strip, like HashPhotos: the video's frames side by
 * side, with a white playhead over them and bookmark ticks along the bottom.
 * Drag anywhere to scrub, tap to jump. While your finger is down the playhead
 * grows and a time bubble follows it. Slide your finger up off the bar for
 * fine scrubbing: it moves at half, a quarter, then a tenth of the speed. VoiceOver gets an adjustable control
 * that moves 10 seconds at a time.
 */

import { useRef, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';

import { tick } from './haptics';
import { DUR, EASE_OUT } from './motion';
import { fmtClock } from '../stats';
import type { ThumbSource } from './types';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function FilmScrubber({
  fraction,
  durationSec,
  frames,
  cover,
  marks = [],
  markColor,
  height = 38,
  onStart,
  onMove,
  onEnd,
}: {
  /** Where playback is, 0..1 (ignored while dragging). */
  fraction: number;
  durationSec: number;
  /** Frames along the video; the cover stands in until they are ready. */
  frames: ThumbSource[];
  cover?: ThumbSource;
  /** Bookmarks, in ms. */
  marks?: number[];
  markColor: string;
  height?: number;
  onStart: () => void;
  onMove: (fraction: number) => void;
  onEnd: (fraction: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const widthRef = useRef(0);
  const active = useSharedValue(0);
  const lastTick = useRef(-1);
  /** Fine scrubbing: slide your finger up off the bar and it moves slower (half, a quarter, a tenth). */
  const anchor = useRef({ x: 0, f: 0, speed: 1 });
  const [speed, setSpeed] = useState(1);

  const shown = drag ?? clamp01(fraction);
  const at = (x: number) => clamp01(x / Math.max(1, widthRef.current));

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .hitSlop({ top: 12, bottom: 12, left: 4, right: 4 })
    .shouldCancelWhenOutside(false)
    .onBegin((e) => {
      const f = at(e.x);
      anchor.current = { x: e.x, f, speed: 1 };
      setSpeed(1);
      active.value = withTiming(1, { duration: DUR.fast, easing: EASE_OUT });
      setDrag(f);
      onStart();
      onMove(f);
    })
    .onUpdate((e) => {
      const dy = Math.abs(e.translationY);
      const sp = dy > 140 ? 0.1 : dy > 80 ? 0.25 : dy > 40 ? 0.5 : 1;
      const a = anchor.current;
      if (sp !== a.speed) {
        // Re-anchor where the finger is, so changing speed never jumps.
        a.f = clamp01(a.f + ((e.x - a.x) / Math.max(1, widthRef.current)) * a.speed);
        a.x = e.x;
        a.speed = sp;
        setSpeed(sp);
        tick();
      }
      const f = clamp01(a.f + ((e.x - a.x) / Math.max(1, widthRef.current)) * a.speed);
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
      const a = anchor.current;
      const f = clamp01(a.f + ((e.x - a.x) / Math.max(1, widthRef.current)) * a.speed);
      setSpeed(1);
      active.value = withTiming(0, { duration: DUR.base, easing: EASE_OUT });
      lastTick.current = -1;
      setDrag(null);
      onEnd(f);
    });

  const headStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: 1 + active.value * 0.6 }, { scaleY: 1 + active.value * 0.18 }] }));
  const bubbleStyle = useAnimatedStyle(() => ({ opacity: active.value, transform: [{ translateY: (1 - active.value) * 6 }] }));

  const x = shown * Math.max(0, width);
  const step = Math.max(1, Math.min(10, durationSec / 10));
  // As many frames as fit at roughly the strip's height, picked evenly from the ones there are.
  const slots = width > 0 ? Math.max(1, Math.round(width / (height * 0.8))) : 0;
  const pics: (ThumbSource | undefined)[] = Array.from({ length: slots }, (_, i) =>
    frames.length ? frames[Math.min(frames.length - 1, Math.floor(((i + 0.5) / slots) * frames.length))] : cover
  );

  return (
    <GestureDetector gesture={pan}>
      <View
        style={{ flex: 1, height: height + 8, justifyContent: 'center' }}
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
        <View style={{ height, borderRadius: 7, overflow: 'hidden', flexDirection: 'row', backgroundColor: 'rgba(127,127,127,0.25)' }} pointerEvents="none">
          {pics.map((src, i) => (
            <Image key={i} source={src} style={{ flex: 1, height }} contentFit="cover" transition={0} />
          ))}
        </View>
        {durationSec > 0 &&
          marks.map((m) => (
            <View
              key={m}
              pointerEvents="none"
              style={{ position: 'absolute', bottom: 2, left: clamp01(m / 1000 / durationSec) * width - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: markColor }}
            />
          ))}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: Math.min(Math.max(0, x - 2), Math.max(0, width - 4)),
              width: 4,
              height: height + 8,
              borderRadius: 2,
              backgroundColor: '#fff',
              shadowColor: '#000',
              shadowOpacity: 0.45,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 0 },
            },
            headStyle,
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              bottom: height + 14,
              left: Math.min(Math.max(0, x - 45), Math.max(0, width - 90)),
              width: 90,
              alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.8)',
              borderRadius: 8,
              paddingVertical: 3,
            },
            bubbleStyle,
          ]}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmtClock(shown * durationSec * 1000)}</Text>
          {speed < 1 && <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700' }}>{speed === 0.5 ? 'Half speed' : speed === 0.25 ? 'Quarter speed' : 'Fine'}</Text>}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
