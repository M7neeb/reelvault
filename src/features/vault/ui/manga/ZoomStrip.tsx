/**
 * Zoom for the long webtoon strip. Pinch to zoom in (up to 4x) where your
 * fingers are; drag sideways to look along the page while zoomed (up and
 * down still scrolls the strip as usual); double-tap to zoom in there, or
 * back out. Pinching back to normal size, or a new chapter, resets it.
 *
 * Against zooming by accident while scrolling: a pinch only starts once the
 * fingers have spread or closed a clear amount, and a double-tap only counts
 * when the strip was not moving and the finger stayed put.
 *
 * The move and the size sit on two nested views (move outside, size inside),
 * so the spot under your fingers stays there whatever order the phone
 * applies transforms in.
 */

import { useContext, useEffect, useMemo, type ReactElement } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { EdgeBackGesture } from "../screen";

const MAX = 4;
const DOUBLE = 2.2;
/** How far the fingers must spread or close (10%) before a pinch zooms. */
const PINCH_START = 0.1;
/** A double-tap this soon after the strip moved is a scroll, not a zoom. */
const STILL_MS = 450;

export default function ZoomStrip({
  width,
  height,
  resetKey,
  lastScrollAt,
  onTap,
  children,
}: {
  width: number;
  height: number;
  resetKey: string;
  /** When the strip last scrolled (ms), so a tap that stops a scroll is not a zoom. */
  lastScrollAt: { current: number };
  /** A single tap (shows or hides the reader's controls); waits a moment so a double-tap can zoom instead. */
  onTap?: () => void;
  children: ReactElement;
}) {
  const scale = useSharedValue(1);
  const start = useSharedValue(1);
  const base = useSharedValue(1);
  const pinching = useSharedValue(false);
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
    "worklet";
    const m = ((s - 1) * size) / 2;
    return Math.min(m, Math.max(-m, v));
  };
  const reset = () => {
    "worklet";
    scale.value = withTiming(1, { duration: 180 });
    tx.value = withTiming(0, { duration: 180 });
    ty.value = withTiming(0, { duration: 180 });
  };

  // Turned sideways (or back): a zoomed strip stays inside its new edges.
  useEffect(() => {
    tx.value = clamp(tx.value, scale.value, width);
    ty.value = clamp(ty.value, scale.value, height);
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const edge = useContext(EdgeBackGesture);
  // Built once (not on every page turn), so the links between them never point at old ones.
  const { native, all } = useMemo(() => {
    // The strip's own scrolling keeps working alongside the zoom gestures.
    const native = Gesture.Native();
    // ...and so does the swipe from the left edge that closes the reader.
    if (edge) native.simultaneousWithExternalGesture(edge);
    const pinch = Gesture.Pinch()
      .onStart(() => {
        pinching.value = false;
      })
      .onUpdate((e) => {
        if (!pinching.value) {
          if (Math.abs(e.scale - 1) < PINCH_START) return;
          // From here on it is a real pinch: measure from this moment, so it does not jump.
          pinching.value = true;
          base.value = e.scale;
          start.value = scale.value;
          sx.value = tx.value;
          sy.value = ty.value;
        }
        const s = Math.min(
          MAX,
          Math.max(1, (start.value * e.scale) / base.value),
        );
        // Keep the spot between your fingers under your fingers:
        // on screen, a point p of the strip (from the centre) sits at t + s * p.
        const fx = e.focalX - width / 2;
        const fy = e.focalY - height / 2;
        const k = s / start.value;
        tx.value = clamp(fx - (fx - sx.value) * k, s, width);
        ty.value = clamp(fy - (fy - sy.value) * k, s, height);
        scale.value = s;
      })
      .onEnd(() => {
        pinching.value = false;
        if (scale.value < 1.08) reset();
      })
      .simultaneousWithExternalGesture(native);
    // Only takes the finger while zoomed in; otherwise it steps aside at once, so the
    // swipe from the left edge still closes the reader.
    const pan = Gesture.Pan()
      .maxPointers(1)
      .manualActivation(true)
      .onTouchesMove((_e, state) => {
        if (scale.value > 1.01 && !pinching.value) state.activate();
        else state.fail();
      })
      .onStart(() => {
        sx.value = tx.value;
      })
      .onUpdate((e) => {
        if (scale.value <= 1.01 || pinching.value) return;
        tx.value = clamp(sx.value + e.translationX, scale.value, width);
      })
      .simultaneousWithExternalGesture(native);
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(220)
      .maxDelay(240)
      .maxDistance(12)
      .runOnJS(true)
      .onEnd((e, ok) => {
        if (!ok || Date.now() - lastScrollAt.current < STILL_MS) return;
        if (scale.value > 1.01) {
          scale.value = withTiming(1, { duration: 180 });
          tx.value = withTiming(0, { duration: 180 });
          ty.value = withTiming(0, { duration: 180 });
          return;
        }
        const fx = e.x - width / 2;
        const fy = e.y - height / 2;
        scale.value = withTiming(DOUBLE, { duration: 200 });
        tx.value = withTiming(clamp(-fx * (DOUBLE - 1), DOUBLE, width), {
          duration: 200,
        });
        ty.value = withTiming(clamp(-fy * (DOUBLE - 1), DOUBLE, height), {
          duration: 200,
        });
      })
      .simultaneousWithExternalGesture(native);
    // One tap shows or hides the controls; not when it only stopped the strip scrolling.
    const single = Gesture.Tap()
      .maxDuration(250)
      .maxDistance(10)
      .runOnJS(true)
      .onEnd((_e, ok) => {
        if (ok && Date.now() - lastScrollAt.current >= STILL_MS) onTap?.();
      })
      .simultaneousWithExternalGesture(native);
    return {
      native,
      all: Gesture.Simultaneous(
        pinch,
        pan,
        Gesture.Exclusive(doubleTap, single),
      ),
    };
  }, [width, height, edge, onTap]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));
  const sizeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={all}>
      <View style={{ flex: 1, overflow: "hidden" }} collapsable={false}>
        <Animated.View style={[{ flex: 1 }, moveStyle]}>
          <Animated.View style={[{ flex: 1 }, sizeStyle]}>
            <GestureDetector gesture={native}>{children}</GestureDetector>
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
