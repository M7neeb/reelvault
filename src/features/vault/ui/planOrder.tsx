/**
 * Plan to Watch in your order: drag a title by its handle to where it
 * belongs, or send it straight to the top. Number 1 is what you watch next.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Modal } from './screen';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import type { OvEntry } from '../overview';
import { fmtMs } from '../stats';
import { success, tick } from './haptics';
import Icon from './Icon';
import { Cover } from './overviewParts';
import { sheet, usePalette, useStyles, type Palette } from './theme';

const ROW = 68;

export default function PlanOrder({ planned, onSave, onClose }: { planned: OvEntry[]; onSave: (keys: string[]) => void; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [picked, setOrder] = useState(() => planned.map((e) => e.key));
  const byKey = new Map(planned.map((e) => [e.key, e]));
  // Titles that left Plan to Watch while this is open drop out; new ones go last.
  const order = [...picked.filter((k) => byKey.has(k)), ...planned.map((e) => e.key).filter((k) => !picked.includes(k))];
  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const changed = order.join('|') !== planned.map((e) => e.key).join('|');

  // The rows move to their new places after React has drawn the new order.
  useEffect(() => {
    from.set(-1);
    to.set(-1);
    dragY.set(0);
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (a: number, b: number) => {
    if (a === b) {
      from.set(-1);
      dragY.set(0);
      return;
    }
    tick();
    const next = [...order];
    const [k] = next.splice(a, 1);
    next.splice(b, 0, k);
    setOrder(next);
  };
  const toTop = (i: number) => move(i, 0);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.screen}>
        <View style={styles.head}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Plan to Watch</Text>
          <TouchableOpacity
            onPress={() => {
              success();
              onSave(order);
              onClose();
            }}
            hitSlop={10}
            disabled={!changed}>
            <Text style={[styles.save, !changed && { opacity: 0.4 }]}>Save</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Drag ≡ to put them in the order you want to watch them. Number 1 is next.</Text>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} scrollEnabled>
          <View style={{ height: order.length * ROW }}>
            {order.map((key, i) => {
              const e = byKey.get(key);
              if (!e) return null;
              return <DragRow key={key} entry={e} index={i} count={order.length} from={from} to={to} dragY={dragY} onMove={move} onTop={() => toTop(i)} />;
            })}
          </View>
        </ScrollView>
        {order.length === 0 && <Text style={[styles.hint, { textAlign: 'center', paddingTop: 30 }]}>Nothing planned yet. Set a title&apos;s status to Plan to Watch.</Text>}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: p.bg }} />
      </GestureHandlerRootView>
    </Modal>
  );
}

function DragRow({
  entry,
  index,
  count,
  from,
  to,
  dragY,
  onMove,
  onTop,
}: {
  entry: OvEntry;
  index: number;
  count: number;
  from: SharedValue<number>;
  to: SharedValue<number>;
  dragY: SharedValue<number>;
  onMove: (a: number, b: number) => void;
  onTop: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();

  const pan = Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      from.set(index);
      to.set(index);
      dragY.set(0);
    })
    .onUpdate((e) => {
      dragY.set(e.translationY);
      to.set(Math.max(0, Math.min(count - 1, Math.round(index + e.translationY / ROW))));
    })
    .onEnd(() => {
      scheduleOnRN(onMove, index, to.value);
    });

  const style = useAnimatedStyle(() => {
    const top = index * ROW;
    if (from.value === index) return { top, transform: [{ translateY: dragY.value }, { scale: 1.03 }], zIndex: 10, shadowOpacity: 0.35, elevation: 8 };
    if (from.value < 0) return { top, transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, shadowOpacity: 0, elevation: 0 };
    let shift = 0;
    if (from.value < index && to.value >= index) shift = -ROW;
    else if (from.value > index && to.value <= index) shift = ROW;
    return { top, transform: [{ translateY: withTiming(shift, { duration: 140 }) }, { scale: 1 }], zIndex: 0, shadowOpacity: 0, elevation: 0 };
  });

  return (
    <Animated.View style={[styles.row, style]}>
      <Text style={[styles.num, index === 0 && { color: p.accent }]}>{index + 1}</Text>
      <Cover source={entry.cover} title={entry.title} width={72} height={48} radius={8} hideTitle />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {entry.kind === 'series' ? `${entry.episodes.length} episodes` : fmtMs(entry.totalMs)}
          {index === 0 ? ' · next up' : ''}
        </Text>
      </View>
      {index > 0 && (
        <TouchableOpacity onPress={onTop} hitSlop={8} accessibilityLabel={`Move ${entry.title} to the top`}>
          <Icon name="toTop" size={16} color={p.textSecondary} />
        </TouchableOpacity>
      )}
      <GestureDetector gesture={pan}>
        <View style={styles.handle} accessibilityLabel={`Drag ${entry.title}`}>
          <Text style={styles.handleText}>≡</Text>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
    title: { color: p.text, fontSize: 17, fontWeight: '800' },
    cancel: { color: p.link, fontSize: 16 },
    save: { color: p.link, fontSize: 16, fontWeight: '800' },
    hint: { color: p.textSecondary, fontSize: 13, paddingHorizontal: 18, paddingBottom: 10 },
    row: {
      position: 'absolute',
      left: 12,
      right: 12,
      height: ROW - 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 10,
      borderRadius: 14,
      backgroundColor: p.elevated,
      shadowColor: '#000',
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    num: { width: 22, textAlign: 'center', color: p.textSecondary, fontSize: 16, fontWeight: '900' },
    name: { color: p.text, fontSize: 15, fontWeight: '700' },
    sub: { color: p.textSecondary, fontSize: 12 },
    handle: { width: 40, height: ROW - 8, alignItems: 'center', justifyContent: 'center' },
    handleText: { color: p.textSecondary, fontSize: 24, fontWeight: '700' },
  });
