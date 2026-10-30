/**
 * Zoom for the long webtoon strip. Pinch to zoom in (up to 4x) where your
 * fingers are; drag sideways to look along the page while zoomed (up and
 * down still scrolls the strip as usual); double-tap to zoom in there, or
 * back out. Pinching back to normal size, or a new chapter, resets it.
 */

import { useEffect, type ReactElement } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const MAX = 4;
const DOUBLE = 2.2;

export default function ZoomStrip({ width, height, resetKey, children }: { width: number; height: number; resetKey: string; children: ReactElement }) {
  const scale = useSharedValue(1);
  const start = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  useEffect(() => {
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
  }, [resetKey, scale, tx, ty]);

  // How far the zoomed strip can move before its edge would show the background.
  const clamp = (v: number, s: number, size: number) => {
    'worklet';
    const m = ((s - 1) * size) / 2;
    return Math.min(m, Math.max(-m, v));
  };
  const reset = () => {
    'worklet';
    scale.value = withTiming(1, { duration: 180 });
    tx.value = withTiming(0, { duration: 180 });
    ty.value = withTiming(0, { duration: 180 });
  };

  // The strip's own scrolling keeps working alongside the zoom gestures.
  const native = Gesture.Native();
  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.value = scale.value;
      sx.value = tx.value;
      sy.value = ty.value;
    })
    .onUpdate((e) => {
      const s = Math.min(MAX, Math.max(1, start.value * e.scale));
      // Keep the spot between your fingers under your fingers.
      const fx = e.focalX - width / 2;
      const fy = e.focalY - height / 2;
      const k = s / start.value;
      tx.value = clamp(fx - (fx - sx.value) * k, s, width);
      ty.value = clamp(fy - (fy - sy.value) * k, s, height);
      scale.value = s;
    })
    .onEnd(() => {
      if (scale.value < 1.08) reset();
    })
    .simultaneousWithExternalGesture(native);
  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      sx.value = tx.value;
    })
    .onUpdate((e) => {
      if (scale.value <= 1.01) return;
      tx.value = clamp(sx.value + e.translationX, scale.value, width);
    })
    .simultaneousWithExternalGesture(native);
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((e) => {
      if (scale.value > 1.01) return reset();
      const fx = e.x - width / 2;
      const fy = e.y - height / 2;
      scale.value = withTiming(DOUBLE, { duration: 200 });
      tx.value = withTiming(clamp(-fx * (DOUBLE - 1), DOUBLE, width), { duration: 200 });
      ty.value = withTiming(clamp(-fy * (DOUBLE - 1), DOUBLE, height), { duration: 200 });
    })
    .simultaneousWithExternalGesture(native);

  const style = useAnimatedStyle(() => ({
    flex: 1,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <View style={{ flex: 1, overflow: 'hidden' }} collapsable={false}>
        <Animated.View style={style}>
          <GestureDetector gesture={native}>{children}</GestureDetector>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
