/**
 * An empty list or page: a small drawing (the section's icon on a stack of
 * faint tiles), a title, one line on what goes here, and at most one button.
 */

import { Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import Icon from './Icon';
import type { IconName } from './icons';
import { enterUp } from './motion';
import { sheet, usePalette, useStyles, type Palette } from './theme';

export default function EmptyState({
  icon,
  title,
  text,
  action,
  secondary,
  tint,
  style,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  /** The drawing's colour; the accent by default. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const c = tint ?? p.accent;
  return (
    <Animated.View entering={enterUp(1)} style={[styles.box, style]}>
      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.tile, styles.tileBack, { borderColor: c }]} />
        <View style={[styles.tile, styles.tileMid, { borderColor: c }]} />
        <View style={[styles.tile, styles.tileFront, { backgroundColor: p.bg, borderColor: c }]}>
          <View style={[styles.wash, { backgroundColor: c }]} />
          <Icon name={icon} size={28} color={c} />
        </View>
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {!!text && <Text style={styles.text}>{text}</Text>}
      {action && (
        <TouchableOpacity style={styles.button} onPress={action.onPress} accessibilityRole="button">
          <Text style={styles.buttonText}>{action.label}</Text>
        </TouchableOpacity>
      )}
      {secondary && (
        <TouchableOpacity style={styles.ghost} onPress={secondary.onPress} accessibilityRole="button">
          <Text style={styles.ghostText}>{secondary.label}</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    box: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 36, gap: 10 },
    art: { width: 120, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
    tile: { position: 'absolute', width: 72, height: 72, borderRadius: 20, borderWidth: 1.5 },
    tileBack: { opacity: 0.18, transform: [{ rotate: '-14deg' }, { translateX: -22 }, { translateY: 4 }] },
    tileMid: { opacity: 0.3, transform: [{ rotate: '10deg' }, { translateX: 20 }, { translateY: 2 }] },
    tileFront: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    wash: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.14 },
    title: { color: p.text, fontSize: 20, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
    text: { color: p.textSecondary, fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 340 },
    button: { marginTop: 8, height: 46, paddingHorizontal: 24, borderRadius: 23, backgroundColor: p.text, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: p.bg, fontSize: 16, fontWeight: '800' },
    ghost: { paddingVertical: 8 },
    ghostText: { color: p.link, fontSize: 15, fontWeight: '600' },
  });
