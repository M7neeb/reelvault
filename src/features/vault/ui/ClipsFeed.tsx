/**
 * Clips: your short videos (3 minutes or less) one after another, full
 * screen, swiping up for the next. Sound on, each clip loops. Double tap to
 * make it a favourite; rate, add a keyword or open it in the player from the
 * side. Only the clip on screen plays; its neighbours are ready, paused.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TouchableOpacity, View, type ViewToken } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clipsOf } from '../clips';
import { friendlyName } from '../names';
import { fmtDuration } from './format';
import { success, tick } from './haptics';
import Icon from './Icon';
import { PromptSheet } from './prompts';
import RatingPicker from './RatingPicker';
import { Modal, useWindowDimensions } from './screen';
import EmptyState from './EmptyState';
import { sheet, useStyles, type Palette } from './theme';
import type { VaultActions, VaultItem } from './types';

/** The vault's own definition of a favourite (same as the player's heart). */
const FAVOURITE = 8;

function Clip({ item, active, near, enableVideo, height, paused }: { item: VaultItem; active: boolean; near: boolean; enableVideo: boolean; height: number; paused: boolean }) {
  const styles = useStyles(makeStyles);
  const player = useVideoPlayer(enableVideo && near ? item.uri : null, (pl) => {
    pl.loop = true;
  });
  useEffect(() => {
    if (!enableVideo || !near) return;
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, near, enableVideo, player]);
  // Back to the start when it scrolls away, so it begins fresh next time.
  useEffect(() => {
    if (!active && near && enableVideo) player.currentTime = 0;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <Image source={item.thumbSource} style={styles.fill} contentFit="contain" />
      {enableVideo && near && <VideoView pointerEvents="none" player={player} style={styles.fill} contentFit="contain" nativeControls={false} />}
    </View>
  );
}

export default function ClipsFeed({
  items,
  actions,
  enableVideo,
  onOpen,
  onClose,
}: {
  items: VaultItem[];
  actions: VaultActions;
  enableVideo: boolean;
  /** Open one in the normal player. */
  onOpen: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [order, setOrder] = useState<'newest' | 'shuffle'>('newest');
  const [seed, setSeed] = useState(1);
  // The list is made once per order; ratings and keywords change in place without reshuffling.
  const ids = useMemo(() => clipsOf(items, order, seed).map((v) => v.id), [order, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);
  const clips = useMemo(() => ids.map((id) => byId.get(id)).filter((v): v is VaultItem => !!v && !v.deletedAt), [ids, byId]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [heart, setHeart] = useState(0);
  const [rating, setRating] = useState<VaultItem | null>(null);
  const [tagging, setTagging] = useState<VaultItem | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const list = useRef<FlatList<VaultItem>>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  const current = clips[Math.min(index, clips.length - 1)];
  const ratingOf = (v: VaultItem) => ratings[v.id] ?? v.rating;

  const rate = useCallback(
    (v: VaultItem, n: number) => {
      setRatings((r) => ({ ...r, [v.id]: n }));
      actions.onRate(v.id, n).catch(() => setRatings((r) => ({ ...r, [v.id]: v.rating })));
    },
    [actions]
  );

  const tap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      // Double tap: favourite (never takes it away; the heart on the side does).
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = 0;
      if (current && ratingOf(current) < FAVOURITE) rate(current, FAVOURITE);
      success();
      setHeart((h) => h + 1);
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      setPaused((x) => !x);
    }, 280);
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<VaultItem>[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index !== null);
    if (first?.index != null) {
      setIndex(first.index);
      setPaused(false);
    }
  }).current;

  const reshuffle = () => {
    tick();
    if (order === 'shuffle') setSeed((s) => s + 1);
    else setOrder('shuffle');
    setIndex(0);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };

  return (
    <Modal fullBleed visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.screen}>
        {clips.length === 0 ? (
          <View style={[styles.emptyWrap, { paddingTop: insets.top + 60 }]}>
            <EmptyState icon="videos" title="No clips yet" text="Videos of three minutes or less show up here, one after another." tint="#fff" />
          </View>
        ) : (
          <FlatList
            ref={list}
            data={clips}
            keyExtractor={(v) => v.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            decelerationRate="fast"
            getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            renderItem={({ item, index: i }) => (
              <Pressable onPress={tap} accessibilityLabel={`${friendlyName(item)}. Tap to pause, double tap to make it a favourite.`}>
                <Clip item={item} active={i === index} near={Math.abs(i - index) <= 1} enableVideo={enableVideo} height={height} paused={paused} />
              </Pressable>
            )}
          />
        )}

        {/* The heart that pops up on a double tap. */}
        {heart > 0 && (
          <Animated.View key={heart} entering={ZoomIn.springify().damping(12)} exiting={FadeOut.duration(400)} style={styles.burst} pointerEvents="none">
            <HeartBurst onDone={() => setHeart(0)} />
          </Animated.View>
        )}
        {paused && current && (
          <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)} style={styles.pausedWrap} pointerEvents="none">
            <View style={styles.pausedCircle}>
              <Icon name="play" size={30} color="#fff" />
            </View>
          </Animated.View>
        )}

        <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <TouchableOpacity style={styles.round} onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
            <Icon name="close" size={14} color="#fff" weight="bold" />
          </TouchableOpacity>
          <Text style={styles.title}>Clips</Text>
          <TouchableOpacity
            style={[styles.round, order === 'shuffle' && styles.roundOn]}
            onPress={reshuffle}
            accessibilityLabel={order === 'shuffle' ? 'Shuffle again' : 'Shuffle'}
            hitSlop={8}>
            <Icon name="shuffle" size={16} color={order === 'shuffle' ? '#000' : '#fff'} />
          </TouchableOpacity>
        </View>

        {current && (
          <>
            <View style={[styles.side, { bottom: insets.bottom + 110 }]} pointerEvents="box-none">
              <SideButton
                icon={ratingOf(current) >= FAVOURITE ? 'heart' : 'heartOff'}
                label={ratingOf(current) >= FAVOURITE ? 'Favourite' : 'Like'}
                on={ratingOf(current) >= FAVOURITE}
                onPress={() => {
                  tick();
                  rate(current, ratingOf(current) >= FAVOURITE ? 0 : FAVOURITE);
                }}
              />
              <SideButton icon="star" label={ratingOf(current) > 0 ? String(ratingOf(current)) : 'Rate'} onPress={() => setRating(current)} />
              <SideButton icon="tag" label="Keyword" onPress={() => setTagging(current)} />
              <SideButton
                icon="fullScreen"
                label="Player"
                onPress={() => {
                  tick();
                  onOpen(current);
                }}
              />
            </View>
            <View style={[styles.info, { paddingBottom: insets.bottom + 24 }]} pointerEvents="none">
              <Text style={styles.name} numberOfLines={2}>
                {friendlyName(current)}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {[fmtDuration(current.durationMs), current.tagNames.length ? current.tagNames.map((t) => `#${t}`).join(' ') : null, `${index + 1} of ${clips.length}`].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </>
        )}
      </View>
      {rating && (
        <RatingPicker
          value={ratingOf(rating)}
          onPick={(n) => {
            rate(rating, n ?? 0);
            setRating(null);
          }}
          onClose={() => setRating(null)}
        />
      )}
      {tagging && (
        <PromptSheet
          title="Add a keyword"
          placeholder="e.g. funny"
          confirmLabel="Add"
          onSubmit={(name) => actions.onAddTag(tagging.id, name).catch(() => undefined)}
          onClose={() => setTagging(null)}
        />
      )}
    </Modal>
  );
}

function HeartBurst({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 700);
    return () => clearTimeout(t);
  }, [onDone]);
  return <Icon name="heart" size={96} color="#FF375F" />;
}

function SideButton({ icon, label, on, onPress }: { icon: import('./icons').IconName; label: string; on?: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.sideBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <View style={styles.sideCircle}>
        <Icon name={icon} size={22} color={on ? '#FF375F' : '#fff'} />
      </View>
      <Text style={styles.sideText} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Always on black, like the player.
const makeStyles = (_p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: '#000' },
    fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
    emptyWrap: { flex: 1 },
    top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
    title: { color: '#fff', fontSize: 18, fontWeight: '800' },
    round: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
    roundOn: { backgroundColor: '#fff' },
    side: { position: 'absolute', right: 10, gap: 18, alignItems: 'center' },
    sideBtn: { alignItems: 'center', gap: 4, width: 64 },
    sideCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)' },
    sideText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
    info: { position: 'absolute', left: 16, right: 90, bottom: 0, gap: 4 },
    name: { color: '#fff', fontSize: 17, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
    meta: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
    burst: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    pausedWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    pausedCircle: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  });
