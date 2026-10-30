/**
 * Two ways to get through a lot of videos fast, one at a time, full screen,
 * each video playing (with sound) while you decide:
 *
 * - Quick tagging: untagged videos. Tap keywords (your most used ones, or type
 *   a new one), tap a rating, then Next (or swipe left). Skip leaves it as is.
 * - Keep or delete: videos you never watch, biggest first. Swipe right or tap
 *   Keep, swipe left or tap Delete (it goes to Recently Deleted, so nothing is
 *   lost yet), or Later. Undo takes back the last one. The space you freed
 *   adds up at the top.
 *
 * The list is fixed when it opens, so saving doesn't reshuffle it.
 * Presentational only.
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from './screen';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { friendlyName } from '../names';
import { aspectOf, Backdrop, fitFor } from './frame';
import { fmtDuration, fmtSize } from './format';
import { success, tick, warn } from './haptics';
import Icon from './Icon';
import { DUR, EASE_OUT, SPRING } from './motion';
import type { UiTag, VaultActions, VaultItem } from './types';

export type TriageMode = 'tag' | 'keep';

/** The video, playing on a loop from a third of the way in (a cover in the browser preview). */
function Clip({ item, enableVideo }: { item: VaultItem; enableVideo: boolean }) {
  const { width, height } = useWindowDimensions();
  const player = useVideoPlayer(enableVideo ? item.uri : null, (pl) => {
    pl.loop = true;
    if (item.durationMs) pl.currentTime = item.durationMs / 3000;
    pl.play();
  });
  const fit = fitFor(aspectOf(item), width / (height * 0.55));
  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop source={item.thumbSource} dim={0.35} />
      {enableVideo ? (
        <VideoView pointerEvents="none" player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} />
      ) : (
        <Image source={item.thumbSource} style={StyleSheet.absoluteFill} contentFit={fit} />
      )}
    </View>
  );
}

export function Triage({
  mode,
  queue: initial,
  tags,
  actions,
  enableVideo,
  onClose,
}: {
  mode: TriageMode;
  queue: VaultItem[];
  tags: UiTag[];
  actions: VaultActions;
  enableVideo: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [queue] = useState(initial);
  const [i, setI] = useState(0);
  const [done, setDone] = useState<{ id: string; what: 'keep' | 'delete' | 'later' | 'tagged' | 'skip' }[]>([]);
  const [videoTags, setVideoTags] = useState<UiTag[]>([]);
  const [rating, setRating] = useState(0);
  const [draft, setDraft] = useState('');
  const [usedNow, setUsedNow] = useState<string[]>([]);
  const item = queue[i];

  useEffect(() => {
    if (!item || mode !== 'tag') return;
    setRating(item.rating);
    setDraft('');
    actions
      .loadTags(item.id)
      .then(setVideoTags)
      .catch(() => setVideoTags([]));
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keywords to offer: the ones used in this session first, then the most used.
  const offer = useMemo(() => {
    const names = new Set<string>();
    for (const n of usedNow) names.add(n);
    for (const t of tags) names.add(t.name);
    return [...names].slice(0, 24);
  }, [tags, usedNow]);

  const freed = done.filter((d) => d.what === 'delete').reduce((a, d) => a + (queue.find((v) => v.id === d.id)?.sizeBytes ?? 0), 0);
  const kept = done.filter((d) => d.what === 'keep').length;
  const tagged = done.filter((d) => d.what === 'tagged').length;

  const next = (what: (typeof done)[number]['what']) => {
    if (!item) return;
    setDone((d) => [...d, { id: item.id, what }]);
    setI((n) => n + 1);
  };

  // The card follows your finger (Keep or delete): far enough right keeps, left deletes.
  const x = useSharedValue(0);
  useEffect(() => {
    x.set(0);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = (dir: 1 | -1) => {
    if (!item) return;
    if (mode === 'keep') {
      if (dir === 1) {
        tick();
        next('keep');
      } else {
        warn();
        actions.onDeleteOne(item).catch(() => undefined);
        next('delete');
      }
    } else if (dir === -1) saveAndNext();
  };
  const pan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-24, 24])
    .onUpdate((e) => {
      'worklet';
      x.set(e.translationX);
    })
    .onEnd((e) => {
      'worklet';
      const dir = e.translationX > width * 0.28 || e.velocityX > 900 ? 1 : e.translationX < -width * 0.28 || e.velocityX < -900 ? -1 : 0;
      if (dir !== 0 && (mode === 'keep' || dir === -1)) {
        x.set(
          withTiming(dir * width * 1.2, { duration: DUR.base, easing: EASE_OUT }, (fin) => {
            if (fin) scheduleOnRN(decide, dir as 1 | -1);
          })
        );
      } else x.set(withSpring(0, SPRING));
    });
  const card = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { rotate: `${x.value / 40}deg` }] }));
  const keepHint = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, x.value / 120)) }));
  const delHint = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, -x.value / 120)) }));

  const undo = () => {
    const last = done[done.length - 1];
    if (!last) return;
    tick();
    const v = queue.find((q) => q.id === last.id);
    if (last.what === 'delete' && v) actions.onRestoreMany([v]).catch(() => undefined);
    setDone((d) => d.slice(0, -1));
    setI((n) => Math.max(0, n - 1));
  };

  async function toggleTag(name: string) {
    if (!item) return;
    tick();
    const has = videoTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (has) await actions.onRemoveTag(item.id, has.id);
    else {
      await actions.onAddTag(item.id, name);
      setUsedNow((u) => [name, ...u.filter((x) => x !== name)].slice(0, 8));
    }
    setVideoTags(await actions.loadTags(item.id));
  }

  function saveAndNext() {
    if (!item) return;
    const pending = draft.trim();
    const jobs: Promise<unknown>[] = [];
    if (pending) jobs.push(actions.onAddTag(item.id, pending));
    if (rating !== item.rating) jobs.push(actions.onRate(item.id, rating));
    Promise.all(jobs).catch(() => undefined);
    if (pending) setUsedNow((u) => [pending, ...u.filter((x) => x !== pending)].slice(0, 8));
    success();
    next(videoTags.length || pending || rating !== item.rating ? 'tagged' : 'skip');
  }

  const title = mode === 'tag' ? 'Quick tagging' : 'Keep or delete';
  const finished = !item;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <GestureHandlerRootView style={[s.screen, { paddingTop: insets.top + 6 }]}>
        <View style={s.top}>
          <TouchableOpacity style={s.round} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={16} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.title}>{title}</Text>
            <Text style={s.sub}>
              {finished ? 'All done' : `${i + 1} of ${queue.length}`}
              {mode === 'keep' && freed > 0 ? ` · ${fmtSize(freed)} freed` : ''}
              {mode === 'tag' && tagged > 0 ? ` · ${tagged} tagged` : ''}
            </Text>
          </View>
          <TouchableOpacity style={[s.round, !done.length && { opacity: 0.35 }]} disabled={!done.length} onPress={undo} accessibilityLabel="Undo the last one">
            <Icon name="rewatch" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={s.progress}>
          <View style={[s.progressFill, { width: `${(Math.min(i, queue.length) / Math.max(1, queue.length)) * 100}%` }]} />
        </View>

        {finished ? (
          <Animated.View entering={FadeIn.duration(DUR.slow)} style={s.end}>
            <Icon name="checkCircle" size={54} color="#30D158" />
            <Text style={s.endTitle}>{queue.length ? 'Done' : 'Nothing to go through'}</Text>
            <Text style={s.endSub}>
              {mode === 'keep'
                ? queue.length
                  ? `${kept} kept · ${done.filter((d) => d.what === 'delete').length} to Recently Deleted (${fmtSize(freed)}) · ${done.filter((d) => d.what === 'later').length} for later`
                  : 'Every video has been watched lately.'
                : queue.length
                  ? `${tagged} videos tagged or rated.`
                  : 'Every video has a keyword.'}
            </Text>
            {mode === 'keep' && freed > 0 && <Text style={s.endHint}>Deleted videos stay in Recently Deleted for a while, then the space comes back for good.</Text>}
            <TouchableOpacity style={s.primary} onPress={onClose}>
              <Text style={s.primaryText}>Close</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <>
            <GestureDetector gesture={pan}>
              <Animated.View style={[s.card, { height: height * 0.55 }, card]}>
                <Clip key={item.id} item={item} enableVideo={enableVideo} />
                {mode === 'keep' && (
                  <>
                    <Animated.View style={[s.stamp, s.stampKeep, keepHint]} pointerEvents="none">
                      <Text style={[s.stampText, { color: '#30D158' }]}>KEEP</Text>
                    </Animated.View>
                    <Animated.View style={[s.stamp, s.stampDel, delHint]} pointerEvents="none">
                      <Text style={[s.stampText, { color: '#FF453A' }]}>DELETE</Text>
                    </Animated.View>
                  </>
                )}
                <View style={s.cardFoot} pointerEvents="none">
                  <Text style={s.name} numberOfLines={1}>
                    {friendlyName(item)}
                  </Text>
                  <Text style={s.meta} numberOfLines={1}>
                    {new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    {item.durationMs ? ` · ${fmtDuration(item.durationMs)}` : ''} · {fmtSize(item.sizeBytes)}
                    {item.rating ? ` · ★ ${item.rating}` : ''}
                  </Text>
                </View>
              </Animated.View>
            </GestureDetector>

            {mode === 'keep' ? (
              <View style={s.keepRow}>
                <TouchableOpacity style={[s.bigBtn, { backgroundColor: 'rgba(255,69,58,0.18)' }]} onPress={() => decide(-1)} accessibilityLabel="Delete">
                  <Icon name="trash" size={24} color="#FF453A" />
                  <Text style={[s.bigText, { color: '#FF453A' }]}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.bigBtn, { backgroundColor: 'rgba(255,255,255,0.1)' }]}
                  onPress={() => {
                    tick();
                    next('later');
                  }}
                  accessibilityLabel="Decide later">
                  <Icon name="later" size={22} color="#fff" />
                  <Text style={s.bigText}>Later</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.bigBtn, { backgroundColor: 'rgba(48,209,88,0.18)' }]} onPress={() => decide(1)} accessibilityLabel="Keep">
                  <Icon name="heart" size={24} color="#30D158" />
                  <Text style={[s.bigText, { color: '#30D158' }]}>Keep</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={s.tagPanel} keyboardShouldPersistTaps="handled">
                <View style={s.stars}>
                  {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => {
                        tick();
                        setRating(rating === n ? 0 : n);
                      }}
                      hitSlop={4}
                      accessibilityLabel={`Rate ${n}`}>
                      <Text style={[s.star, n <= rating && s.starOn]}>{n <= rating ? '★' : '☆'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.chips}>
                  {offer.map((name) => {
                    const on = videoTags.some((t) => t.name.toLowerCase() === name.toLowerCase());
                    return (
                      <TouchableOpacity key={name} style={[s.chip, on && s.chipOn]} onPress={() => void toggleTag(name)}>
                        <Text style={[s.chipText, on && { color: '#fff' }]}>#{name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={s.input}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="New keyword"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  autoCapitalize="none"
                  keyboardAppearance="dark"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    const n = draft.trim();
                    if (n) void toggleTag(n).then(() => setDraft(''));
                  }}
                />
                <View style={s.keepRow}>
                  <TouchableOpacity
                    style={[s.bigBtn, { backgroundColor: 'rgba(255,255,255,0.1)' }]}
                    onPress={() => {
                      tick();
                      next('skip');
                    }}>
                    <Text style={s.bigText}>Skip</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.bigBtn, { backgroundColor: '#0A84FF', flex: 2 }]} onPress={saveAndNext}>
                    <Text style={[s.bigText, { color: '#fff' }]}>Next</Text>
                    <Icon name="forward" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05060A', gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  progress: { height: 3, marginHorizontal: 16, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: '#0A84FF' },
  card: { marginHorizontal: 14, borderRadius: 26, overflow: 'hidden', backgroundColor: '#111' },
  cardFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, paddingTop: 30, backgroundColor: 'rgba(0,0,0,0.45)' },
  name: { color: '#fff', fontSize: 19, fontWeight: '800' },
  meta: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  stamp: { position: 'absolute', top: 22, borderWidth: 3, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  stampKeep: { left: 18, borderColor: '#30D158', transform: [{ rotate: '-12deg' }] },
  stampDel: { right: 18, borderColor: '#FF453A', transform: [{ rotate: '12deg' }] },
  stampText: { fontSize: 26, fontWeight: '900', letterSpacing: 2 },
  keepRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14 },
  bigBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 18, paddingVertical: 16 },
  bigText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  tagPanel: { gap: 12, paddingBottom: 30 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 4 },
  star: { color: 'rgba(255,255,255,0.35)', fontSize: 26 },
  starOn: { color: '#FFD60A' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: '#0A84FF', borderColor: '#0A84FF' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  input: { marginHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  end: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 30 },
  endTitle: { color: '#fff', fontSize: 28, fontWeight: '900' },
  endSub: { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  endHint: { color: 'rgba(255,255,255,0.55)', fontSize: 13, textAlign: 'center' },
  primary: { marginTop: 8, borderRadius: 999, backgroundColor: '#fff', paddingHorizontal: 30, paddingVertical: 13 },
  primaryText: { color: '#000', fontSize: 16, fontWeight: '900' },
});
