/**
 * The shelf: your series standing side by side like box sets. Each spine has
 * its title set top to bottom, an obi band in the series' colour carrying the
 * episode count, and how far you are as a fill in that band. The one you are
 * watching stands pulled out a little; a tapped one slides up off the shelf.
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInRight, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { spineColor } from '../spineColor';
import { tick } from './haptics';
import { EASE_OUT, PressableScale, useReducedMotion } from './motion';
import { DISPLAY_FONT } from './paletteMath';
import { usePalette, type Palette } from './theme';

export type ShelfBox = { key: string; title: string; count: number; watched: number; pulled?: boolean };

const W = 62;
const H = 216;
const OBI = 64;
const TITLE_LEN = H - OBI - 20;

export default function Shelf({ boxes, onOpen, side = 16 }: { boxes: ShelfBox[]; onOpen: (key: string) => void; side?: number }) {
  const p = usePalette();
  const reduce = useReducedMotion();
  if (!boxes.length) return null;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: side, gap: 6, alignItems: 'flex-end', paddingTop: 34 }}>
        {boxes.map((b, i) => (
          <Animated.View key={b.key} entering={reduce ? undefined : FadeInRight.duration(320).delay(Math.min(i, 10) * 35).easing(EASE_OUT)}>
            <SpineBox box={b} p={p} reduce={reduce} onPress={() => onOpen(b.key)} />
          </Animated.View>
        ))}
      </ScrollView>
      <View style={[styles.board, { marginHorizontal: side, backgroundColor: p.scheme === 'dark' ? '#2a2a2e' : '#d6d6da' }]} />
    </View>
  );
}

function SpineBox({ box, p, reduce, onPress }: { box: ShelfBox; p: Palette; reduce: boolean; onPress: () => void }) {
  const color = spineColor(box.title, p.scheme);
  const share = box.count ? Math.min(1, box.watched / box.count) : 0;
  const dark = p.scheme === 'dark';
  // Taken off the shelf: the box slides up, its page opens, and it settles back.
  const rest = box.pulled ? -12 : 0;
  const lift = useSharedValue(rest);
  const lifted = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));
  const take = () => {
    tick();
    if (reduce) return onPress();
    lift.value = withSequence(
      withTiming(rest - 22, { duration: 150, easing: EASE_OUT }, (done) => {
        if (done) runOnJS(onPress)();
      }),
      withDelay(500, withTiming(rest, { duration: 240, easing: EASE_OUT }))
    );
  };
  return (
    <Animated.View style={lifted}>
      <PressableScale
        onPress={take}
        scaleTo={0.96}
        style={[styles.box, { backgroundColor: dark ? '#161618' : '#fbfbfc', borderColor: dark ? '#26262a' : '#dcdce0' }]}
        accessibilityRole="button"
        accessibilityLabel={`${box.title}, ${box.count} episodes, ${box.watched} watched`}>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: p.text }]}>
            {box.title}
          </Text>
        </View>
        <View style={[styles.obi, { backgroundColor: color }]}>
          <View style={[styles.done, { height: `${Math.round(share * 100)}%` }]} />
          <Text style={styles.count}>{String(box.count).padStart(2, '0')}</Text>
          <Text style={styles.eps}>{share >= 1 ? 'all seen' : box.watched ? `${box.watched} seen` : 'episodes'}</Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { width: W, height: H, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  titleWrap: { position: 'absolute', width: TITLE_LEN, height: W, left: (W - TITLE_LEN) / 2, top: 10 + (TITLE_LEN - W) / 2, transform: [{ rotate: '90deg' }], justifyContent: 'center' },
  title: { fontFamily: DISPLAY_FONT.bold, fontSize: 24, paddingHorizontal: 4 },
  obi: { position: 'absolute', left: 0, right: 0, bottom: 0, height: OBI, alignItems: 'center', justifyContent: 'center' },
  done: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.22)' },
  count: { fontFamily: DISPLAY_FONT.bold, fontSize: 30, lineHeight: 32, color: '#0b0b0c' },
  eps: { fontSize: 10, fontWeight: '600', color: 'rgba(0,0,0,0.7)' },
  board: { height: 3, borderRadius: 1.5 },
});
