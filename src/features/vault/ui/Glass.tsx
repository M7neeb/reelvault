/**
 * iOS 26 Liquid Glass behind floating controls. Where the system has no glass
 * (older iOS, a beta without the API, the browser preview, Reduce Transparency)
 * it is a translucent fill in the theme's colours, so the layout never changes.
 */

import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

import { usePalette } from './theme';

const HAS_GLASS = (() => {
  if (Platform.OS !== 'ios') return false;
  try {
    return isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
})();

function useReduceTransparency(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!HAS_GLASS) return;
    AccessibilityInfo.isReduceTransparencyEnabled().then(setOn).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOn);
    return () => sub.remove();
  }, []);
  return on;
}

export default function Glass({
  style,
  tint,
  interactive,
  clear,
  fallback,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  /** A coloured glass (e.g. the accent for a primary button). */
  tint?: string;
  interactive?: boolean;
  /** The see-through variant, for controls over pictures. */
  clear?: boolean;
  /** Fill used when there is no glass. Defaults to the theme's round-button grey. */
  fallback?: string;
  children?: React.ReactNode;
}) {
  const p = usePalette();
  const reduce = useReduceTransparency();
  // Settings → Personalise → Glass: solid turns it off, see-through uses the clear glass everywhere.
  if (!HAS_GLASS || reduce || p.glass === 'solid') {
    return <View style={[{ backgroundColor: tint ?? fallback ?? p.glassFallback }, style]}>{children}</View>;
  }
  return (
    <GlassView
      style={style}
      glassEffectStyle={clear || p.glass === 'clear' ? 'clear' : 'regular'}
      colorScheme={p.scheme}
      tintColor={tint}
      isInteractive={interactive}>
      {children}
    </GlassView>
  );
}
