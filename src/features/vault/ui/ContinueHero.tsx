/**
 * The video you stopped most recently, big, at the top of All Videos: its picture edge to edge
 * under the status bar, the mode switch floating on it, and Resume one tap away. Text sits on dark
 * fades over the picture, so it is white in light and dark mode alike (like the Shows "Up Next" card).
 */

import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fmtClock } from '../stats';
import Fade from './Fade';
import Icon from './Icon';
import IconButton from './IconButton';
import { heroHeight, stoppedLine } from './logic';
import { PressableScale } from './motion';
import { useWindowDimensions } from './screen';
import { sheet, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

/** The viewer's favourite (see ViewerModal): rated 8 or more. */
const FAVOURITE_RATING = 8;
const FAVOURITE_RED = '#FF375F';


export default function ContinueHero({
  item,
  name,
  atMs,
  top,
  topSpace,
  onResume,
  onFavourite,
}: {
  item: VaultItem;
  /** The title shown for the video (its own title, or a tidied file name). */
  name: string;
  /** Where it was stopped. */
  atMs: number;
  /** What floats at the top of the picture (the mode switch). */
  top?: ReactNode;
  /** Room for the status bar and the floating header above `top`. */
  topSpace: number;
  onResume: () => void;
  onFavourite: (rating: number) => void;
}) {
  const styles = useStyles(makeStyles);
  const { width, height: screenH } = useWindowDimensions();
  const height = heroHeight(width, screenH);
  const line = stoppedLine(atMs, item.durationMs, fmtClock);
  const progress = item.durationMs ? Math.min(1, Math.max(0, atMs / item.durationMs)) : 0;
  const favourite = (item.rating ?? 0) >= FAVOURITE_RATING;

  return (
    <View style={[styles.hero, { height }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onResume} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Image source={item.thumbSource} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} recyclingKey={item.id} />
      </Pressable>
      {/* Dark at the top for the status bar and the floating buttons, dark at the bottom for the words. */}
      <Fade color="0,0,0" from={0} to={0.55} reverse style={[styles.fadeTop, { height: topSpace + 90 }]} />
      <Fade color="0,0,0" from={0} to={0.9} style={styles.fadeBottom} />

      {top && <View style={[styles.top, { paddingTop: topSpace }]}>{top}</View>}

      <View style={styles.body} pointerEvents="box-none">
        <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={1.2}>
          {name}
        </Text>
        <Text style={styles.line} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {line}
        </Text>
        <View style={styles.actions}>
          <PressableScale style={styles.resume} onPress={onResume} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Resume ${name}. ${line}`}>
            <Icon name="play" size={15} color="#000" />
            <Text style={styles.resumeText} maxFontSizeMultiplier={1.3}>
              Resume
            </Text>
          </PressableScale>
          <IconButton
            icon={favourite ? 'heart' : 'heartOff'}
            color={favourite ? FAVOURITE_RED : '#fff'}
            clear
            size={44}
            label={favourite ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
            onPress={() => onFavourite(favourite ? 0 : FAVOURITE_RATING)}
          />
          {item.durationMs ? (
            <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    hero: { width: '100%', justifyContent: 'flex-end', overflow: 'hidden', backgroundColor: p.tile },
    fadeTop: { position: 'absolute', top: 0, left: 0, right: 0 },
    fadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' },
    top: { position: 'absolute', top: 0, left: 0, right: 0 },
    body: { paddingHorizontal: 20, paddingBottom: 22, gap: 6 },
    title: { color: '#fff', fontSize: 30, fontWeight: '800', lineHeight: 35, letterSpacing: -0.7 },
    line: { color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
    resume: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 22, minHeight: 46 },
    resumeText: { color: '#000', fontSize: 16, fontWeight: '700' },
    track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden', marginLeft: 4 },
    fill: { height: 4, borderRadius: 2, backgroundColor: '#fff' },
  });
