/**
 * Review duplicates and look-alikes, a group at a time: the copy worth keeping
 * is picked for you (sharpest, longest, best rated, most watched - tap another
 * to keep that one instead), the others' keywords and best rating are carried
 * over to it, and the rest go to Recently Deleted (30 days to change your mind).
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from './screen';
import { Image } from 'expo-image';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyName } from '../names';
import { fmtDuration, fmtSize } from './format';
import { success, tick } from './haptics';
import Icon from './Icon';
import { pickKeeper } from './logic';
import { enterUp, PressableScale } from './motion';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

export type CleanupPlan = { keep: VaultItem; remove: VaultItem[]; addTags: string[]; rating: number | null };

export function DuplicateReview({
  groups,
  items,
  plays,
  kind,
  onApply,
  onOpen,
  onClose,
}: {
  groups: string[][];
  items: VaultItem[];
  /** Plays per video, to prefer the one you watch. */
  plays: Map<string, number>;
  kind: 'duplicates' | 'similar';
  onApply: (plans: CleanupPlan[]) => Promise<void>;
  onOpen: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);
  const list = useMemo(() => groups.map((g) => g.map((id) => byId.get(id)).filter((v): v is VaultItem => !!v)).filter((g) => g.length > 1), [groups, byId]);
  const [keepers, setKeepers] = useState<Record<number, string>>({});
  const [done, setDone] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const planFor = (gi: number): CleanupPlan => {
    const g = list[gi];
    const keepId = keepers[gi] ?? pickKeeper(g, plays) ?? g[0].id;
    const keep = g.find((v) => v.id === keepId)!;
    const remove = g.filter((v) => v.id !== keepId);
    const have = new Set(keep.tagNames.map((t) => t.toLowerCase()));
    const addTags = [...new Set(remove.flatMap((v) => v.tagNames))].filter((t) => !have.has(t.toLowerCase()));
    const best = Math.max(keep.rating, ...remove.map((v) => v.rating));
    return { keep, remove, addTags, rating: best > keep.rating ? best : null };
  };
  const open = list.map((_, i) => i).filter((i) => !done.has(i));
  const savable = open.reduce((a, i) => a + planFor(i).remove.reduce((b, v) => b + v.sizeBytes, 0), 0);

  const apply = async (idx: number[]) => {
    if (!idx.length || busy) return;
    setBusy(true);
    try {
      await onApply(idx.map(planFor));
      success();
      setDone((d) => new Set([...d, ...idx]));
    } finally {
      setBusy(false);
    }
  };

  const tileW = Math.min(150, (width - 64) / 2.3);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={[styles.screen, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{kind === 'duplicates' ? 'DUPLICATES' : 'LOOK-ALIKES'}</Text>
            <Text style={styles.title}>Review and clean up</Text>
          </View>
          <TouchableOpacity style={styles.round} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={15} color={p.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.summary}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sumValue}>{fmtSize(savable)}</Text>
            <Text style={styles.sumLabel}>
              to free in {open.length} {open.length === 1 ? 'group' : 'groups'}
            </Text>
          </View>
          <PressableScale style={[styles.allBtn, (!open.length || busy) && { opacity: 0.5 }]} disabled={!open.length || busy} onPress={() => apply(open)} accessibilityLabel="Clean up every group">
            <Icon name="sparkle" size={15} color="#fff" />
            <Text style={styles.allText}>{busy ? 'Cleaning…' : 'Clean up all'}</Text>
          </PressableScale>
        </View>
        <Text style={styles.note}>
          {kind === 'duplicates' ? 'Byte-for-byte the same file.' : 'Probably the same clip saved twice: the same length and shape, or filmed in the same second.'} The best copy is picked for you;
          tap another to keep that instead. Removed copies go to Recently Deleted.
        </Text>

        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 30 }}>
          {list.map((g, gi) => {
            if (done.has(gi)) return null;
            const plan = planFor(gi);
            return (
              <Animated.View key={g.map((v) => v.id).join()} entering={enterUp(Math.min(gi, 6))} exiting={FadeOut} layout={LinearTransition} style={styles.group}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {g.map((v) => {
                    const keep = v.id === plan.keep.id;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[styles.tile, { width: tileW }, keep && styles.tileKeep]}
                        onPress={() => {
                          tick();
                          setKeepers((k) => ({ ...k, [gi]: v.id }));
                        }}
                        onLongPress={() => onOpen(v)}
                        accessibilityLabel={`${friendlyName(v)}${keep ? ', kept' : ''}`}>
                        <View style={[styles.thumb, { height: tileW * 0.62 }]}>
                          <Image source={v.thumbSource} style={StyleSheet.absoluteFill} contentFit="cover" />
                          <View style={[styles.tag, { backgroundColor: keep ? p.success : 'rgba(0,0,0,0.6)' }]}>
                            <Text style={styles.tagText}>{keep ? 'KEEP' : 'REMOVE'}</Text>
                          </View>
                        </View>
                        <Text style={styles.name} numberOfLines={1}>
                          {friendlyName(v)}
                        </Text>
                        <Text style={styles.fact} numberOfLines={1}>
                          {v.width && v.height ? `${Math.min(v.width, v.height)}p` : '?'} · {fmtSize(v.sizeBytes)}
                        </Text>
                        <Text style={styles.fact} numberOfLines={1}>
                          {fmtDuration(v.durationMs) ?? '–'}
                          {v.rating ? ` · ★ ${v.rating}` : ''}
                          {plays.get(v.id) ? ` · ${plays.get(v.id)}×` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <View style={styles.groupFoot}>
                  <Text style={styles.footText} numberOfLines={2}>
                    Frees {fmtSize(plan.remove.reduce((a, v) => a + v.sizeBytes, 0))}
                    {plan.addTags.length ? ` · keeps ${plan.addTags.length} keyword${plan.addTags.length === 1 ? '' : 's'}` : ''}
                    {plan.rating ? ` · keeps ★ ${plan.rating}` : ''}
                  </Text>
                  <TouchableOpacity style={styles.oneBtn} disabled={busy} onPress={() => apply([gi])}>
                    <Text style={styles.oneText}>Clean up</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            );
          })}
          {open.length === 0 && (
            <View style={styles.doneBox}>
              <Icon name="checkCircle" size={40} color={p.success} />
              <Text style={styles.doneTitle}>All tidy</Text>
              <Text style={styles.note}>Nothing left to review here.</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg, paddingHorizontal: 16, paddingTop: 18, gap: 12 },
    head: { flexDirection: 'row', alignItems: 'center' },
    kicker: { color: p.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    title: { color: p.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
    round: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.circle, alignItems: 'center', justifyContent: 'center' },
    summary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.elevated, borderRadius: 18, padding: 14 },
    sumValue: { color: p.text, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
    sumLabel: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    allBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11 },
    allText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    note: { color: p.textSecondary, fontSize: 13 },
    group: { backgroundColor: p.elevated, borderRadius: 18, padding: 12, gap: 10 },
    tile: { borderRadius: 14, padding: 6, gap: 3, borderWidth: 2, borderColor: 'transparent', backgroundColor: p.card },
    tileKeep: { borderColor: p.success },
    thumb: { borderRadius: 10, overflow: 'hidden', backgroundColor: p.bg },
    tag: { position: 'absolute', left: 6, top: 6, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    tagText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
    name: { color: p.text, fontSize: 13, fontWeight: '700', marginTop: 4 },
    fact: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    groupFoot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    footText: { color: p.textSoft, fontSize: 13, fontWeight: '600', flex: 1 },
    oneBtn: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    oneText: { color: p.link, fontWeight: '800' },
    doneBox: { alignItems: 'center', gap: 8, paddingVertical: 40 },
    doneTitle: { color: p.text, fontSize: 20, fontWeight: '800' },
  });
