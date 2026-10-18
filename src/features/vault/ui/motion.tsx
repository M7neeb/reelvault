/**
 * The app's motion vocabulary, kept small so everything moves the same way:
 * short, eased, and tied to what you touched. Reanimated skips these when
 * Reduce Motion is on (its animations follow the system setting by default),
 * and `useReducedMotion` lets a screen pick a plain fade instead.
 */

import { type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  Keyframe,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

export { useReducedMotion };

/** iOS-like "ease out": fast start, soft landing. */
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

export const DUR = { fast: 160, base: 240, slow: 360 } as const;

/** A settle with no bounce, for things that follow a finger. */
export const SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;
/** A touch of life, for things that pop in. */
export const SPRING_POP = { damping: 16, stiffness: 320, mass: 0.7 } as const;

/** Sections appearing as a screen opens, one after another. */
export const enterUp = (i = 0) => FadeInDown.duration(DUR.base).delay(Math.min(i, 8) * 45).easing(EASE_OUT);
export const fadeIn = FadeIn.duration(DUR.fast);
export const fadeOut = FadeOut.duration(DUR.fast);

/** Opening the video viewer: a slight zoom from where it was tapped. */
export const zoomIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.92 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(DUR.base);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A button that dips a little under your finger and springs back - the
 * feedback iOS gives on cards and tiles.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & { children?: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        if (!reduce) scale.value = withTiming(scaleTo, { duration: 90, easing: EASE_OUT });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, SPRING_POP);
        onPressOut?.(e);
      }}
      style={[style, anim]}>
      {children}
    </AnimatedPressable>
  );
}
