/**
 * Choose Cover Frame: scrub through the video on a filmstrip, see the exact
 * frame large, nudge it a frame or a second either way, and set it as the
 * video's thumbnail. On the phone the big picture is the real frame (a paused
 * player that seeks as you drag); in the browser preview it is the nearest
 * filmstrip frame.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from './screen';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { friendlyName } from '../names';
import { fmtDuration } from './format';
import { success, tick } from './haptics';
import Icon from './Icon';
import { PressableScale } from './motion';
import type { ThumbSource, VaultItem } from './types';

const FRAME = 1 / 30;

export function CoverPicker({
  item,
  frames,
  enableVideo,
  startMs,
  onUse,
  onClose,
}: {
  item: VaultItem;
  /** The filmstrip (evenly spaced frames). */
  frames: ThumbSource[];
  enableVideo: boolean;
  /** Where to start (the viewer's position). */
  startMs: number;
  onUse: (timeMs: number) => Promise<void>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const total = Math.max(0.1, (item.durationMs ?? 0) / 1000);
  const [t, setT] = useState(Math.min(total, Math.max(0, startMs / 1000)));
  const [saving, setSaving] = useState(false);
  const stripW = width - 40;
  const x = useSharedValue((t / total) * stripW);
  const seekAt = useRef(0);

  const player = useVideoPlayer(enableVideo ? item.uri : null, (pl) => {
    pl.muted = true;
    pl.currentTime = t;
    pl.pause();
  });

  // Seek as the time changes, at most every 80 ms (a seek per frame of dragging is too much).
  useEffect(() => {
    if (!enableVideo) return;
    const now = Date.now();
    const wait = Math.max(0, 80 - (now - seekAt.current));
    const id = setTimeout(() => {
      seekAt.current = Date.now();
      player.currentTime = t;
    }, wait);
    return () => clearTimeout(id);
  }, [t, enableVideo, player]);

  const setFromX = (px: number) => setT(Math.max(0, Math.min(total, (px / stripW) * total)));
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      x.value = Math.max(0, Math.min(stripW, e.x));
      scheduleOnRN(setFromX, x.value);
    })
    .onUpdate((e) => {
      x.value = Math.max(0, Math.min(stripW, e.x));
      scheduleOnRN(setFromX, x.value);
    });
  const handle = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(-14, Math.min(stripW - 30, x.value - 22)) }] }));

  const nudge = (d: number) => {
    tick();
    const next = Math.max(0, Math.min(total, t + d));
    setT(next);
    x.value = (next / total) * stripW;
  };

  const preview = useMemo(() => (frames.length ? frames[Math.min(frames.length - 1, Math.floor((t / total) * frames.length))] : item.thumbSource), [frames, t, total, item.thumbSource]);
  const aspect = item.width && item.height ? item.width / item.height : 16 / 9;
  const boxW = width - 40;
  const boxH = Math.min(boxW / aspect, 420);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <GestureHandlerRootView style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.top}>
          <TouchableOpacity style={styles.round} onPress={onClose} accessibilityLabel="Cancel">
            <Icon name="close" size={16} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.title}>Choose Cover Frame</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {friendlyName(item)}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.stage}>
          <View style={[styles.frame, { width: boxW, height: boxH }]}>
            {enableVideo ? (
              <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} allowsPictureInPicture={false} />
            ) : (
              <Image source={preview} style={StyleSheet.absoluteFill} contentFit="contain" />
            )}
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{fmtDuration(t * 1000) ?? '0:00'}</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          <GestureDetector gesture={pan}>
            <View style={[styles.strip, { width: stripW }]}>
              {(frames.length ? frames : [item.thumbSource]).map((f, i, all) => (
                <Image key={i} source={f} style={{ width: stripW / all.length, height: 54 }} contentFit="cover" />
              ))}
              <Animated.View style={[styles.handle, handle]} pointerEvents="none">
                <View style={styles.handleInner} />
              </Animated.View>
            </View>
          </GestureDetector>

          <View style={styles.nudges}>
            <TouchableOpacity style={styles.nudge} onPress={() => nudge(-1)}>
              <Text style={styles.nudgeText}>−1 s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nudge} onPress={() => nudge(-FRAME)}>
              <Text style={styles.nudgeText}>‹ Frame</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nudge} onPress={() => nudge(FRAME)}>
              <Text style={styles.nudgeText}>Frame ›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nudge} onPress={() => nudge(1)}>
              <Text style={styles.nudgeText}>+1 s</Text>
            </TouchableOpacity>
          </View>

          <PressableScale
            style={[styles.use, saving && { opacity: 0.6 }]}
            disabled={saving}
            onPress={() => {
              setSaving(true);
              onUse(Math.round(t * 1000))
                .then(() => {
                  success();
                  onClose();
                })
                .catch(() => setSaving(false));
            }}
            accessibilityLabel="Use this frame as the cover">
            <Icon name="frame" size={18} color="#000" />
            <Text style={styles.useText}>{saving ? 'Setting…' : 'Use as Cover'}</Text>
          </PressableScale>
          <Text style={styles.hint}>Drag along the strip, then fine-tune a frame at a time.</Text>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#111' },
  badge: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  badgeText: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  strip: { height: 54, borderRadius: 10, overflow: 'visible', flexDirection: 'row', backgroundColor: '#1c1c22' },
  handle: { position: 'absolute', top: -8, width: 44, height: 70, alignItems: 'center', justifyContent: 'center' },
  handleInner: { width: 16, height: 70, borderRadius: 6, borderWidth: 3, borderColor: '#FFD60A', backgroundColor: 'rgba(255,214,10,0.12)' },
  nudges: { flexDirection: 'row', gap: 8 },
  nudge: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)' },
  nudgeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  use: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FFD60A', borderRadius: 999, paddingVertical: 15 },
  useText: { color: '#000', fontSize: 17, fontWeight: '900' },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },
});
