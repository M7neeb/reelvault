/**
 * The video viewer, laid out to match HashPhotos.
 *
 * HashPhotos is NOT a draggable sheet. It is a FIXED stack:
 *
 *   header (back · date+time · info · actions)
 *   media, filling everything above the bottom stack
 *   scrubber bar   (play/pause · track · time · more)
 *   filmstrip      (tap a frame to seek)
 *   toolbar        (flag · flag-off · stars · more · delete)
 *
 * and the metadata lives in a SEPARATE panel opened by the info button. This
 * file follows that structure exactly.
 *
 * Like the rest of `ui/`, this imports no native module except expo-video, which
 * has a real web implementation. `enableVideo=false` (the browser preview) skips
 * mounting the player and shows a placeholder stage instead.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmtDateTime, fmtDuration, fmtSize } from './format';
import { RECENTLY_DELETED_DAYS } from './logic';
import {
  STATUSES,
  statusLabel,
  type ThumbSource,
  type UiStatus,
  type UiTag,
  type VaultItem,
  type VaultScreenProps,
} from './types';

const FRAME_W = 52;
const FRAME_H = 36;
const FRAME_GAP = 3;

/** The vault's own definition of a favourite (see the sidebar). */
const FAVOURITE_RATING = 8;

function confirmDestructive(title: string, message: string | undefined, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // eslint-disable-next-line no-alert
    if (typeof window === 'undefined' || window.confirm(text)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function ViewerModal({
  item,
  actions,
  enableVideo,
  initialInfoOpen = false,
  initialMenuOpen = false,
  onClose,
}: {
  item: VaultItem;
  actions: VaultScreenProps['actions'];
  enableVideo: boolean;
  /** Preview-only: open a panel on first render so it can be screenshotted. */
  initialInfoOpen?: boolean;
  initialMenuOpen?: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const player = useVideoPlayer(enableVideo && item.uri ? item.uri : null, (p) => {
    p.loop = false;
    if (enableVideo) p.play();
    p.timeUpdateEventInterval = 0.2;
  });

  const [rating, setRating] = useState(item.rating);
  const [watch, setWatch] = useState<UiStatus | null>(item.status);
  const [videoTags, setVideoTags] = useState<UiTag[]>([]);
  const [draft, setDraft] = useState('');
  const [frames, setFrames] = useState<ThumbSource[]>([]);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(enableVideo);
  const [trackW, setTrackW] = useState(0);
  const [infoOpen, setInfoOpen] = useState(initialInfoOpen);
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);

  const framesRef = useRef<ThumbSource[]>([]);
  framesRef.current = frames;
  const lastIdx = useRef(-1);
  const stripRef = useRef<ScrollView>(null);

  useEffect(() => {
    actions
      .loadTags(item.id)
      .then(setVideoTags)
      .catch((e) => console.log(`[TAG] load failed: ${String(e)}`));
  }, [item.id, actions]);

  useEffect(() => {
    actions
      .loadFrames(item)
      .then(setFrames)
      .catch((e) => console.log(`[FILM] failed: ${String(e)}`));
  }, [item, actions]);

  // Playhead + auto-scroll the strip.
  useEffect(() => {
    const sub = player.addListener('timeUpdate', (payload) => {
      const total = player.duration || (item.durationMs ?? 0) / 1000;
      if (!total) return;
      const p = Math.min(1, Math.max(0, payload.currentTime / total));
      setProgress(p);
      const count = framesRef.current.length;
      if (count) {
        const idx = Math.min(count - 1, Math.floor(p * count));
        if (idx !== lastIdx.current) {
          lastIdx.current = idx;
          stripRef.current?.scrollTo({
            x: Math.max(0, idx * (FRAME_W + FRAME_GAP) - 60),
            animated: true,
          });
        }
      }
    });
    return () => sub.remove();
  }, [player, item.durationMs]);

  const dt = fmtDateTime(item.importedAt);
  const totalSec = player.duration || (item.durationMs ?? 0) / 1000;
  const elapsed = Math.round(progress * totalSec);

  function togglePlay() {
    if (!enableVideo) return;
    if (player.playing) player.pause();
    else player.play();
    setPlaying(!player.playing);
  }

  function seek(fraction: number) {
    if (!enableVideo) return;
    const d = player.duration || (item.durationMs ?? 0) / 1000;
    if (d > 0) {
      player.currentTime = d * fraction;
      player.play();
      setPlaying(true);
      console.log(`[SEEK] ${(fraction * 100).toFixed(0)}%`);
    }
  }

  async function onRate(n: number) {
    const next = n === rating ? 0 : n;
    setRating(next);
    await actions.onRate(item.id, next);
    console.log(`[RATE] ${item.filename} → ${next}`);
  }

  async function onStatus(next: UiStatus) {
    const value = next === watch ? null : next;
    setWatch(value);
    await actions.onSetStatus([item.id], value);
    console.log(`[STATUS] ${item.filename} → ${value ?? 'none'}`);
  }

  async function onAddTag() {
    const name = draft.trim();
    if (!name) return;
    await actions.onAddTag(item.id, name);
    setDraft('');
    setVideoTags(await actions.loadTags(item.id));
    console.log(`[TAG] +${name} @ ${item.filename}`);
  }

  async function onRemoveTag(tag: UiTag) {
    await actions.onRemoveTag(item.id, tag.id);
    setVideoTags(await actions.loadTags(item.id));
  }

  function confirmDelete() {
    confirmDestructive(
      'Delete video?',
      `It moves to Recently Deleted for ${RECENTLY_DELETED_DAYS} days.`,
      () => {
        actions
          .onDeleteOne(item)
          .then(onClose)
          .catch((e) => console.log(`[DELETE] failed: ${String(e)}`));
      }
    );
  }

  const isFavourite = rating >= FAVOURITE_RATING;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        {/* ── media ─────────────────────────────────────────────────────── */}
        <View style={[styles.stage, { marginBottom: 0 }]}>
          <TouchableOpacity activeOpacity={1} onPress={togglePlay} style={styles.stageTouch}>
            {enableVideo ? (
              <VideoView
                player={player}
                style={styles.video}
                contentFit="contain"
                nativeControls={false}
              />
            ) : (
              <View style={styles.videoPlaceholder}>
                <Text style={styles.videoPlaceholderText}>video</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── header ────────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Back">
            <Text style={styles.circleIcon}>‹</Text>
          </TouchableOpacity>

          <View style={styles.titleWrap}>
            <Text style={styles.titleDate}>{dt.date}</Text>
            <Text style={styles.titleTime}>{dt.time}</Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              style={[styles.circle, infoOpen && styles.circleOn]}
              onPress={() => setInfoOpen((v) => !v)}
              accessibilityLabel="Info">
              <Text style={styles.circleIcon}>ⓘ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.circle, menuOpen && styles.circleOn]}
              onPress={() => setMenuOpen(true)}
              accessibilityLabel="More">
              <Text style={styles.circleIcon}>≡</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── bottom stack ──────────────────────────────────────────────── */}
        <View style={styles.bottom}>
          {/* scrubber */}
          <View style={styles.scrub}>
            <TouchableOpacity onPress={togglePlay} hitSlop={10} accessibilityLabel="Play or pause">
              <Text style={styles.scrubIcon}>{playing ? '❚❚' : '▶'}</Text>
            </TouchableOpacity>

            <View
              style={styles.scrubTrack}
              onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
              <View style={[styles.scrubFill, { width: `${Math.round(progress * 100)}%` }]} />
              <View style={[styles.scrubThumb, { left: progress * Math.max(0, trackW - 3) }]} />
            </View>

            <Text style={styles.scrubTime}>
              {fmtDuration(elapsed * 1000) ?? '0:00'} / {fmtDuration(totalSec * 1000) ?? '--:--'}
            </Text>

            <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={10}>
              <Text style={styles.scrubIcon}>•••</Text>
            </TouchableOpacity>
          </View>

          {/* filmstrip */}
          <ScrollView
            ref={stripRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}>
            {frames.map((src, i) => (
              <TouchableOpacity key={i} onPress={() => seek((i + 0.5) / frames.length)}>
                <Image source={src} style={styles.stripFrame} contentFit="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* toolbar */}
          <View style={[styles.toolbar, { paddingBottom: insets.bottom + 10 }]}>
            <TouchableOpacity
              style={styles.tool}
              onPress={() => onRate(FAVOURITE_RATING)}
              accessibilityLabel="Favourite">
              <Text style={[styles.toolIcon, isFavourite && styles.toolIconOn]}>★</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tool}
              onPress={() => onRate(0)}
              accessibilityLabel="Clear rating">
              <Text style={[styles.toolIcon, !rating && styles.toolIconDim]}>☆</Text>
            </TouchableOpacity>

            <View style={styles.stars}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <TouchableOpacity key={n} onPress={() => onRate(n)} hitSlop={4}>
                  <Text style={[styles.star, n <= rating && styles.starOn]}>
                    {n <= rating ? '★' : '☆'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.tool} onPress={() => setMenuOpen(true)}>
              <Text style={styles.toolIcon}>•••</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tool}
              onPress={confirmDelete}
              accessibilityLabel="Delete">
              <Text style={styles.toolDanger}>⌫</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── info panel ────────────────────────────────────────────────── */}
        {infoOpen && (
          <View style={styles.infoRoot}>
            <TouchableOpacity
              style={styles.infoBackdrop}
              activeOpacity={1}
              onPress={() => setInfoOpen(false)}
            />
            <View style={[styles.infoSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.infoHeader}>
                <TouchableOpacity style={styles.circle} onPress={() => setInfoOpen(false)}>
                  <Text style={styles.circleIcon}>✕</Text>
                </TouchableOpacity>
                <Text style={styles.infoTitle}>Info</Text>
                <View style={styles.circleGhost} />
              </View>

              <ScrollView contentContainerStyle={styles.infoBody} keyboardShouldPersistTaps="handled">
                <View style={styles.thumbWrap}>
                  <Image source={item.thumbSource} style={styles.thumbPreview} contentFit="cover" />
                </View>

                {/* the blue filename bar */}
                <View style={styles.fileBar}>
                  <Text style={styles.fileBarIcon}>▶</Text>
                  <Text style={styles.fileBarText} numberOfLines={1}>
                    {item.filename}
                  </Text>
                </View>

                <Text style={styles.infoPlaceholder}>Tap here to add title</Text>
                <Text style={styles.infoMuted}>No Caption</Text>

                <View style={styles.infoRow}>
                  <Text style={styles.infoValue}>{dt.date} at {dt.time}</Text>
                </View>

                <Text style={styles.infoMuted}>No camera information</Text>
                <Text style={styles.infoMuted}>No lens information</Text>

                <View style={styles.chipRow}>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>
                      {item.width && item.height ? `${item.width} x ${item.height}` : 'Unknown size'}
                    </Text>
                  </View>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{fmtSize(item.sizeBytes)}</Text>
                  </View>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{item.durationMs ? fmtDuration(item.durationMs) : '--:--'}</Text>
                  </View>
                </View>

                <Text style={styles.infoMuted}>No Location Data</Text>

                <Text style={styles.section}>Status</Text>
                <View style={styles.pills}>
                  {STATUSES.map((s) => (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.statusChip, watch === s.key && styles.statusChipOn]}
                      onPress={() => void onStatus(s.key)}>
                      <Text style={[styles.statusChipText, watch === s.key && styles.statusChipTextOn]}>
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.section}>Keywords</Text>
                <View style={styles.pills}>
                  {videoTags.length === 0 && <Text style={styles.infoMuted}>No keywords yet.</Text>}
                  {videoTags.map((t) => (
                    <TouchableOpacity key={t.id} style={styles.pill} onPress={() => onRemoveTag(t)}>
                      <Text style={styles.pillText}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder="add a keyword…"
                    placeholderTextColor="#5b6472"
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={onAddTag}
                    autoCapitalize="none"
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={styles.addBtn} onPress={onAddTag}>
                    <Text style={styles.addBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        )}

        {/* ── actions sheet ─────────────────────────────────────────────── */}
        {menuOpen && (
          <View style={styles.infoRoot}>
            <TouchableOpacity
              style={styles.infoBackdrop}
              activeOpacity={1}
              onPress={() => setMenuOpen(false)}
            />
            <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.grabber} />
              <Text style={styles.menuTitle} numberOfLines={1}>
                {item.filename}
              </Text>

              <MenuRow
                label="Favourite"
                hint={isFavourite ? 'On' : 'Off'}
                onPress={() => {
                  setMenuOpen(false);
                  void onRate(isFavourite ? 0 : FAVOURITE_RATING);
                }}
              />
              <MenuRow
                label="Status"
                hint={statusLabel(watch)}
                onPress={() => {
                  setMenuOpen(false);
                  setInfoOpen(true);
                }}
              />
              <MenuRow
                label="Keyword"
                hint={`${videoTags.length}`}
                onPress={() => {
                  setMenuOpen(false);
                  setInfoOpen(true);
                }}
              />
              <MenuRow
                label="Info"
                hint=""
                onPress={() => {
                  setMenuOpen(false);
                  setInfoOpen(true);
                }}
              />
              <MenuRow
                label="Delete"
                danger
                hint=""
                onPress={() => {
                  setMenuOpen(false);
                  confirmDelete();
                }}
              />
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

function MenuRow({
  label,
  hint,
  danger,
  onPress,
}: {
  label: string;
  hint: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress}>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      {!!hint && <Text style={styles.menuHint}>{hint}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1 },
  stageTouch: { flex: 1, justifyContent: 'center' },
  video: { width: '100%', height: '100%' },
  videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  videoPlaceholderText: { color: '#2a2a2e', fontSize: 13, fontWeight: '700', letterSpacing: 1 },

  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleWrap: { alignItems: 'center' },
  titleDate: { color: '#fff', fontSize: 17, fontWeight: '700' },
  titleTime: { color: '#9aa0a6', fontSize: 13 },
  headerRight: { flexDirection: 'row', gap: 8 },
  circle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,120,128,0.32)',
  },
  circleGhost: { width: 34, height: 34 },
  circleOn: { backgroundColor: '#0A84FF' },
  circleIcon: { color: '#fff', fontSize: 15, fontWeight: '700' },

  bottom: { backgroundColor: '#0b0b0d' },
  scrub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  scrubIcon: { color: '#fff', fontSize: 13, fontWeight: '700' },
  scrubTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
  },
  scrubFill: { height: 3, borderRadius: 2, backgroundColor: '#fff' },
  scrubThumb: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  scrubTime: { color: '#9aa0a6', fontSize: 11, fontVariant: ['tabular-nums'] },

  strip: { gap: FRAME_GAP, paddingHorizontal: 14, paddingBottom: 8, alignItems: 'center' },
  stripFrame: { width: FRAME_W, height: FRAME_H, backgroundColor: '#1a1a1c' },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  tool: { paddingVertical: 4, paddingHorizontal: 2 },
  toolIcon: { color: '#e7e9ec', fontSize: 17, fontWeight: '600' },
  toolIconOn: { color: '#F5A623' },
  toolIconDim: { color: '#5b6472' },
  toolDanger: { color: '#ff6b6b', fontSize: 17, fontWeight: '700' },
  stars: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  star: { color: '#4a4a4e', fontSize: 14 },
  starOn: { color: '#F5A623' },

  infoRoot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  infoBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  infoSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    backgroundColor: '#151517',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
  },
  infoTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  infoBody: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  thumbWrap: { alignItems: 'center' },
  thumbPreview: { width: 120, height: 120, backgroundColor: '#1a1a1c' },
  fileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0A84FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  fileBarIcon: { color: '#fff', fontSize: 11 },
  fileBarText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  infoPlaceholder: { color: '#4aa8ff', fontSize: 14 },
  infoMuted: { color: '#7d838d', fontSize: 13 },
  infoValue: { color: '#e7e9ec', fontSize: 13 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#232326', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  chipText: { color: '#c9ccd1', fontSize: 12 },
  section: { color: '#8e939b', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingTop: 4 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { backgroundColor: '#2f9ee0', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  pillText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  statusChip: {
    borderWidth: 1,
    borderColor: '#2c2c30',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statusChipOn: { backgroundColor: '#0A84FF', borderColor: '#0A84FF' },
  statusChipText: { color: '#e7e9ec', fontSize: 13, fontWeight: '600' },
  statusChipTextOn: { color: '#fff' },
  addRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
  },
  addBtn: { backgroundColor: '#0A84FF', paddingHorizontal: 18, justifyContent: 'center', borderRadius: 10 },
  addBtnText: { color: '#fff', fontWeight: '700' },

  menuSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#151517',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#48484a' },
  menuTitle: { color: '#8e939b', fontSize: 12, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  menuLabel: { color: '#e7e9ec', fontSize: 16 },
  menuLabelDanger: { color: '#ff6b6b' },
  menuHint: { color: '#7d838d', fontSize: 14 },
});
