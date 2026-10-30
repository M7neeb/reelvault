/**
 * Landscape everywhere (Settings → Personalise → Turn with the phone).
 *
 * Sideways, an iPhone's Dynamic Island and rounded corners sit on the left
 * and right. Screens and full-screen pages keep that much clear on both
 * sides, and `useWindowDimensions` here gives the width between those
 * margins, so grids and cards are laid out for the space they really have.
 * `Modal` lets every page and sheet turn with the phone (React Native keeps
 * them upright otherwise) and adds the same margins to full-screen pages.
 * Upright, nothing changes.
 */

import { createContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Modal as RNModal, Platform, useWindowDimensions as useRNWindow, View, type ModalProps, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePalette } from './theme';

/** How much to keep clear on each side: the larger of the two side insets, when sideways. */
export function useSide(): number {
  const d = useRNWindow();
  const i = useSafeAreaInsets();
  return d.width > d.height ? Math.max(i.left, i.right) : 0;
}

/** The window size, its width without the side margins (see above). `fullWidth` is the whole window. */
export function useWindowDimensions() {
  const d = useRNWindow();
  const side = useSide();
  return { ...d, width: d.width - side * 2, fullWidth: d.width, side, landscape: d.width > d.height };
}

/** Keeps its content clear of the Dynamic Island when sideways. */
export function SideSafe({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const side = useSide();
  const p = usePalette();
  return <View style={[{ flex: 1, paddingHorizontal: side, backgroundColor: p.bg }, style]}>{children}</View>;
}

/**
 * React Native's Modal that turns with the phone. Full-screen pages get the
 * side margins; see-through ones (sheets, players) and `fullBleed` ones lay
 * themselves out.
 */
export function Modal({ children, fullBleed, ...props }: ModalProps & { fullBleed?: boolean; edgeBack?: boolean }) {
  return <GatedModal {...props}>{props.transparent || fullBleed ? children : <SideSafe>{children}</SideSafe>}</GatedModal>;
}

/*
 * iOS shows one page or sheet at a time and silently refuses a new one while
 * the last is still going away (closing a menu and opening Browse in the same
 * tap did nothing). So a page that opens while another is closing waits until
 * that one has gone. Every page and sheet goes through here.
 */
const CLOSE_MS = Platform.OS === 'ios' ? 480 : 0;
let closingUntil = 0;

/** Runs `job` once every page or sheet that is closing has gone (for pickers and share sheets opened after one). */
export function afterModals(job: () => void): void {
  // Let the close reach the screen first, then wait for it to finish.
  setTimeout(() => {
    const wait = closingUntil - Date.now();
    if (wait > 0) setTimeout(job, wait);
    else job();
  }, 60);
}

/**
 * The swipe-back gesture of the page around you, for a scroll view inside that
 * tells the gesture system about itself (the manga strip's zoom): it lets the
 * two run together, so its scrolling does not cancel the swipe back.
 */
export const EdgeBackGesture = createContext<ReturnType<typeof Gesture.Pan> | null>(null);

/** Where a swipe back has to start: this close to the left edge. */
const EDGE = 28;

/**
 * Swipe right from the left edge to go back, like iOS pages: the page follows
 * your finger and closes past a third of the screen (or with a quick flick).
 * Only a drag that starts at the very edge counts, so taps and the page's own
 * swipes elsewhere are untouched.
 */
export function EdgeBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const { width } = useRNWindow();
  const x = useSharedValue(0);
  const pan = Gesture.Pan()
    .hitSlop({ left: 0, width: EDGE })
    .activeOffsetX(12)
    .failOffsetY([-18, 18])
    .onUpdate((e) => {
      'worklet';
      x.value = Math.max(0, e.translationX);
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationX > width / 3 || (e.velocityX > 700 && e.translationX > 40)) {
        x.value = withTiming(width, { duration: 160 });
        scheduleOnRN(onBack);
      } else x.value = withSpring(0, { damping: 22, stiffness: 260 });
    });
  const style = useAnimatedStyle(() => ({ flex: 1, transform: [{ translateX: x.value }], opacity: 1 - Math.min(0.35, x.value / (width * 2)) }));
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={style}>
          <EdgeBackGesture.Provider value={pan}>{children}</EdgeBackGesture.Provider>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/** React Native's Modal, turning with the phone, that waits its turn (see above). Full-screen pages close with a swipe from the left edge (`edgeBack={false}` turns it off). */
export function GatedModal({ visible = true, edgeBack = true, children, ...props }: ModalProps & { edgeBack?: boolean }) {
  const [shown, setShown] = useState(false);
  const wasShown = useRef(false);
  useLayoutEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const wait = closingUntil - Date.now();
    if (wait <= 0) {
      setShown(true);
      return;
    }
    const t = setTimeout(() => setShown(true), wait);
    return () => clearTimeout(t);
  }, [visible]);
  useLayoutEffect(() => {
    if (shown) wasShown.current = true;
    else if (wasShown.current) {
      wasShown.current = false;
      closingUntil = Math.max(closingUntil, Date.now() + CLOSE_MS);
    }
  }, [shown]);
  // Closed by going away altogether (the usual way here).
  useLayoutEffect(
    () => () => {
      if (wasShown.current) closingUntil = Math.max(closingUntil, Date.now() + CLOSE_MS);
    },
    []
  );
  // Sheets close with a swipe down already; see-through ones are overlays.
  const swipeBack = edgeBack && !props.transparent && props.presentationStyle !== 'pageSheet' && props.presentationStyle !== 'formSheet' && !!props.onRequestClose;
  return (
    <RNModal supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} {...props} visible={shown}>
      {swipeBack ? <EdgeBack onBack={() => props.onRequestClose?.({} as never)}>{children}</EdgeBack> : children}
    </RNModal>
  );
}
