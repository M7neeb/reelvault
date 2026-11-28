/**
 * The rounds of Rank your favourites: two at a time on black, tap the one you
 * like more. Videos are stacked and play muted from their cover moment (the
 * speaker button gives one of them sound); posters sit side by side. Either video opens big, with sound and the
 * normal controls, and can be picked from there.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmtDuration } from '../format';
import Icon from '../Icon';
import { Modal, useWindowDimensions } from '../screen';
import { sheet, useStyles, type Palette } from '../theme';
import type { RankCandidate } from './rankTypes';
import { fmtRating } from './rankTypes';

type Side = 'a' | 'b';

function useLoopingPlayer(uri: string | null | undefined, startMs: number | null | undefined, muted: boolean, play: boolean) {
  // Start in the setup, like the grid's previews: waiting for "ready" first left
  // the round on its covers when that event had already gone by.
  const player = useVideoPlayer(uri ?? null, (pl) => {
    pl.loop = true;
    pl.muted = muted;
    // Two clips at once, and the grid's previews: share the sound instead of stopping each other.
    pl.audioMixingMode = 'mixWithOthers';
    if (startMs && startMs > 0) pl.currentTime = startMs / 1000;
    if (play) pl.play();
  });
  useEffect(() => {
    if (!uri) return;
    if (play) player.play();
    else player.pause();
  }, [play, player, uri]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  return player;
}

/** A clip playing silently in a loop from its start moment, over its cover (also used by the Knockout cup). */
export function VideoPane({ item, play, muted }: { item: Pick<RankCandidate, 'uri' | 'startMs' | 'thumb'>; play: boolean; muted: boolean }) {
  const styles = useStyles(makeStyles);
  const player = useLoopingPlayer(item.uri, item.startMs, muted, play);
  return (
    <>
      {item.thumb ? <Image source={item.thumb} style={styles.fill} contentFit="cover" /> : null}
      {item.uri ? <VideoView pointerEvents="none" player={player} style={[styles.fill, !play && styles.hidden]} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} /> : null}
    </>
  );
}

function Pane({
  item,
  side,
  state,
  videos,
  play,
  width,
  height,
  renderArt,
  sound,
  onSound,
  onPick,
  onOpen,
}: {
  item: RankCandidate;
  side: Side;
  /** 'won' / 'lost' while the pick animates. */
  state: 'idle' | 'won' | 'lost';
  videos: boolean;
  play: boolean;
  width: number;
  height: number;
  renderArt?: (c: RankCandidate, w: number, h: number) => ReactNode;
  /** This one plays with sound (only one at a time). */
  sound: boolean;
  onSound?: () => void;
  onPick: () => void;
  onOpen?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const scale = useRef(new Animated.Value(1)).current;
  const dim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const ease = Easing.out(Easing.exp);
    Animated.parallel([
      Animated.timing(scale, { toValue: state === 'won' ? 1.025 : state === 'lost' ? 0.97 : 1, duration: 240, easing: ease, useNativeDriver: true }),
      Animated.timing(dim, { toValue: state === 'lost' ? 0.3 : 1, duration: 240, easing: ease, useNativeDriver: true }),
    ]).start();
  }, [state, scale, dim]);
  const meta = [item.sub, item.durationMs ? fmtDuration(item.durationMs) : null].filter(Boolean).join(' · ');
  const label = `${item.title}${item.rating ? `, rated ${fmtRating(item.rating)}` : ', not rated'}`;
  return (
    <Animated.View style={{ width, height, transform: [{ scale }], opacity: dim }}>
      <TouchableOpacity activeOpacity={0.85} onPress={onPick} style={videos ? styles.videoPane : styles.posterPane} accessibilityRole="button" accessibilityLabel={`Pick ${label}`}>
        {videos ? (
          <>
            <VideoPane item={item} play={play} muted={!sound} />
            <View style={styles.videoInfo} pointerEvents="none">
              <Text style={styles.videoTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.videoMeta} numberOfLines={1}>
                {meta}
              </Text>
            </View>
            <View style={[styles.score, !item.rating && styles.scoreNone]} pointerEvents="none">
              <Text style={[styles.scoreText, !item.rating && styles.scoreNoneText]}>{item.rating ? fmtRating(item.rating) : 'New'}</Text>
            </View>
            {onSound && (
              <TouchableOpacity
                style={[styles.expand, styles.soundBtn, sound && styles.soundOn]}
                onPress={onSound}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={sound ? `Mute ${item.title}` : `Sound on for ${item.title}`}>
                <Icon name={sound ? 'sound' : 'muted'} size={16} color={sound ? '#000' : '#fff'} />
              </TouchableOpacity>
            )}
            {onOpen && (
              <TouchableOpacity style={styles.expand} onPress={onOpen} hitSlop={10} accessibilityLabel={`Open ${item.title} big, with sound`}>
                <Icon name="fullScreen" size={15} color="#fff" weight="bold" />
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <View style={styles.posterBox}>
              {renderArt ? renderArt(item, width, width * 1.5) : item.thumb ? <Image source={item.thumb} style={{ width, height: width * 1.5 }} contentFit="cover" /> : null}
              <View style={[styles.score, styles.scoreOnPoster, !item.rating && styles.scoreNone]} pointerEvents="none">
                <Text style={[styles.scoreText, !item.rating && styles.scoreNoneText]}>{item.rating ? fmtRating(item.rating) : 'New'}</Text>
              </View>
            </View>
            <Text style={styles.posterTitle} numberOfLines={2}>
              {item.title}
            </Text>
            {!!item.sub && (
              <Text style={styles.posterMeta} numberOfLines={1}>
                {item.sub}
              </Text>
            )}
          </>
        )}
        {state === 'won' && <View style={styles.ring} pointerEvents="none" />}
      </TouchableOpacity>
    </Animated.View>
  );
}

/** One video big, with sound and the normal controls. */
function BigView({ item, onPick, onClose }: { item: RankCandidate; onPick: () => void; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const player = useLoopingPlayer(item.uri, item.startMs, false, true);
  return (
    <View style={[styles.big, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.close} onPress={onClose} accessibilityLabel="Back to the two videos" hitSlop={8}>
          <Icon name="back" size={15} color="#fff" weight="bold" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {item.title}
        </Text>
      </View>
      <View style={styles.bigVideo}>
        {item.uri ? (
          <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} allowsPictureInPicture={false} />
        ) : item.thumb ? (
          <Image source={item.thumb} style={styles.fill} contentFit="contain" />
        ) : null}
      </View>
      <View style={[styles.bar, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity style={styles.white} onPress={onPick} accessibilityRole="button">
          <Text style={styles.whiteText}>I like this one more</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function RankStage({
  pair,
  videos,
  playVideos,
  enableVideo,
  done,
  total,
  canUndo,
  renderArt,
  onPick,
  onSkip,
  onUndo,
  onEnd,
}: {
  pair: [RankCandidate, RankCandidate];
  videos: boolean;
  playVideos: boolean;
  /** False in the browser preview: covers only. */
  enableVideo: boolean;
  done: number;
  /** 0 = until you stop. */
  total: number;
  canUndo: boolean;
  renderArt?: (c: RankCandidate, w: number, h: number) => ReactNode;
  onPick: (winner: Side | 'tie') => void;
  onSkip: () => void;
  onUndo: () => void;
  onEnd: () => void;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [picked, setPicked] = useState<Side | null>(null);
  const [big, setBig] = useState<Side | null>(null);
  const [sound, setSound] = useState<Side | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [a, b] = pair;

  useEffect(() => {
    setPicked(null);
    setBig(null);
    setSound(null);
  }, [a.id, b.id]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const choose = (side: Side) => {
    if (picked) return;
    setBig(null);
    setPicked(side);
    timer.current = setTimeout(() => {
      timer.current = null;
      onPick(side);
    }, 320);
  };

  const gap = 10;
  const side = 14;
  const headerH = 96;
  const barH = 84 + insets.bottom;
  const room = height - insets.top - headerH - barH;
  const paneW = videos ? width - side * 2 : (width - side * 2 - gap) / 2;
  const paneH = videos ? Math.max(120, (room - gap) / 2) : room;
  const play = videos && enableVideo && playVideos && big === null;
  const progress = total ? Math.min(1, done / total) : 0;

  return (
    <Modal fullBleed visible animationType="fade" onRequestClose={onEnd} statusBarTranslucent>
      <View style={[styles.stage, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.close} onPress={onEnd} accessibilityLabel="Stop and see your ranking" hitSlop={8}>
            <Icon name="close" size={14} color="#fff" weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            Which do you like more?
          </Text>
          <TouchableOpacity onPress={onEnd} hitSlop={8} accessibilityRole="button">
            <Text style={styles.done}>Done</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.progressRow}>
          {total > 0 ? (
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
            </View>
          ) : (
            <View style={styles.trackGhost} />
          )}
          <Text style={styles.count}>{total ? `${Math.min(done + 1, total)} of ${total}` : `${done} done`}</Text>
        </View>
        <View style={[styles.panes, { flexDirection: videos ? 'column' : 'row', gap, paddingHorizontal: side }]}>
          {(['a', 'b'] as const).map((s) => {
            const item = s === 'a' ? a : b;
            return (
              <Pane
                key={`${s}-${item.id}`}
                item={item}
                side={s}
                state={picked === null ? 'idle' : picked === s ? 'won' : 'lost'}
                videos={videos}
                play={play}
                width={paneW}
                height={paneH}
                renderArt={renderArt}
                sound={play && sound === s}
                onSound={play && item.uri ? () => setSound((now) => (now === s ? null : s)) : undefined}
                onPick={() => choose(s)}
                onOpen={videos && enableVideo && item.uri ? () => setBig(s) : undefined}
              />
            );
          })}
        </View>
        <View style={[styles.bar, { paddingBottom: insets.bottom + 14 }]}>
          <TouchableOpacity
            style={[styles.round, !canUndo && styles.disabled]}
            disabled={!canUndo || picked !== null}
            onPress={onUndo}
            accessibilityLabel="Undo the last pick">
            <Icon name="back" size={16} color="#fff" weight="bold" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.grey} onPress={() => !picked && onPick('tie')} accessibilityRole="button">
            <Text style={styles.greyText}>Can't decide</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.grey} onPress={() => !picked && onSkip()} accessibilityRole="button" accessibilityHint="Shows two others; nothing is counted">
            <Text style={styles.greyText}>Skip</Text>
          </TouchableOpacity>
        </View>
        {big && <BigView item={big === 'a' ? a : b} onPick={() => choose(big)} onClose={() => setBig(null)} />}
      </View>
    </Modal>
  );
}

// The stage is always on black, whatever the theme, like the players.
const makeStyles = (_p: Palette) =>
  sheet({
    stage: { flex: 1, backgroundColor: '#000' },
    fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 56 },
    close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(120,120,128,0.36)' },
    headerTitle: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    done: { color: '#fff', fontSize: 16, fontWeight: '700' },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 40 },
    track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
    trackFill: { height: 4, borderRadius: 2, backgroundColor: '#fff' },
    trackGhost: { flex: 1 },
    count: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    panes: { flex: 1, justifyContent: 'center' },
    videoPane: { flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: '#161618' },
    posterPane: { flex: 1, justifyContent: 'center', gap: 8 },
    posterBox: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#161618' },
    posterTitle: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
    posterMeta: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
    videoInfo: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 28, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
    videoTitle: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
    videoMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontVariant: ['tabular-nums'] },
    score: { position: 'absolute', top: 10, left: 10, minWidth: 34, height: 28, paddingHorizontal: 8, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    scoreOnPoster: { top: 8, left: 8 },
    scoreText: { color: '#000', fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
    scoreNone: { backgroundColor: 'rgba(0,0,0,0.6)' },
    scoreNoneText: { color: '#fff', fontWeight: '700' },
    hidden: { opacity: 0 },
    soundBtn: { right: 52 },
    soundOn: { backgroundColor: '#fff' },
    expand: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
    ring: { ...{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, borderRadius: 20, borderWidth: 3, borderColor: '#fff' },
    bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 14 },
    round: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(120,120,128,0.36)' },
    disabled: { opacity: 0.35 },
    grey: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(120,120,128,0.36)' },
    greyText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    white: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    whiteText: { color: '#000', fontSize: 17, fontWeight: '800' },
    big: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#000' },
    bigVideo: { flex: 1 },
  });
