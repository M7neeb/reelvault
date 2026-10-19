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

import type { ReactNode } from 'react';
import { Modal as RNModal, useWindowDimensions as useRNWindow, View, type ModalProps, type StyleProp, type ViewStyle } from 'react-native';
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
export function Modal({ children, fullBleed, ...props }: ModalProps & { fullBleed?: boolean }) {
  return (
    <RNModal supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} {...props}>
      {props.transparent || fullBleed ? children : <SideSafe>{children}</SideSafe>}
    </RNModal>
  );
}
