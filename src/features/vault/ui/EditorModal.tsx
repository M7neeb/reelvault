/**
 * Trim, crop and size for one video. Full screen: the video on top with the
 * crop frame drawn over it, then Trim / Crop / Size, then the result line.
 * Saving asks whether to replace the video or keep it and add an edited copy.
 * Presentational only (see the rule in types.ts).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { Modal } from './screen';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ASPECTS,
  freeCropOrNull,
  moveCrop,
  type Crop,
  type CropHandle,
  cropFor,
  EMPTY_PLAN,
  estimateBytes,
  fmtFormatLine,
  FRAME_RATES,
  isNoop,
  needsReencode,
  outputOf,
  RESOLUTIONS,
  type EditPlan,
  type SourceInfo,
} from '../edit';
import { confirmAction } from './confirm';
import { RangeTrack, Slider } from './controls';
import { fmtBitrate, fmtDuration, fmtSize } from './format';
import { OptionsSheet } from './prompts';
import { Chip, Segment, ToggleRow, Wrap } from './sheets';
import { sheet, useStyles, type Palette } from './theme';
import type { ThumbSource, UiSmallerResult, VaultItem, VaultScreenProps } from './types';

type Tab = 'trim' | 'crop' | 'size';
const TABS: { key: Tab; label: string }[] = [
  { key: 'trim', label: 'Trim' },
  { key: 'crop', label: 'Crop' },
  { key: 'size', label: 'Size' },
];

const fmtTime = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
};

export default function EditorModal({
  item,
  actions,
  enableVideo,
  initialTab = 'trim',
  onDone,
  onClose,
}: {
  item: VaultItem;
  actions: VaultScreenProps['actions'];
  enableVideo: boolean;
  initialTab?: Tab;
  /** After saving: the message to show, and the id of a new copy if one was made. */
  onDone: (message: string, newId?: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const available = actions.canMakeSmaller();

  const src: SourceInfo = {
    width: item.width,
    height: item.height,
    fps: item.meta?.fps ?? null,
    durationMs: item.durationMs,
    sizeBytes: item.sizeBytes,
  };
  const total = item.durationMs ?? 0;

  const [tab, setTab] = useState<Tab>(initialTab);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(1);
  const [aspect, setAspect] = useState('original');
  const [free, setFree] = useState<Crop>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [zoom, setZoom] = useState(0);
  const [posX, setPosX] = useState(0.5);
  const [posY, setPosY] = useState(0.5);
  const [maxShortSide, setMaxShortSide] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [lossless, setLossless] = useState(true);
  const [frames, setFrames] = useState<ThumbSource[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [saveMenu, setSaveMenu] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [error, setError] = useState('');

  const player = useVideoPlayer(enableVideo && item.uri ? item.uri : null, (pl) => {
    pl.loop = false;
    pl.timeUpdateEventInterval = 0.1;
  });
  const range = useRef({ start, end });
  range.current = { start, end };

  useEffect(() => {
    actions
      .loadFrames(item)
      .then(setFrames)
      .catch((e) => console.log(`[EDIT] frames failed: ${String(e)}`));
  }, [item, actions]);

  // Play only the kept part, over and over.
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (!total) return;
      const at = (currentTime * 1000) / total;
      setPlayhead(at);
      if (at >= range.current.end) {
        player.currentTime = (range.current.start * total) / 1000;
      }
    });
    return () => sub.remove();
  }, [player, total]);

  const ratio = ASPECTS.find((a) => a.key === aspect)?.ratio ?? null;
  const zoomFactor = 1 + zoom * 2;
  const crop =
    aspect === 'free'
      ? freeCropOrNull(free)
      : item.width && item.height
        ? cropFor(ratio, item.width, item.height, zoomFactor, posX, posY)
        : null;

  const plan: EditPlan = useMemo(
    () => ({
      ...EMPTY_PLAN,
      startMs: Math.round(start * total),
      endMs: end >= 0.999 ? null : Math.round(end * total),
      crop,
      maxShortSide,
      fps,
      lossless,
    }),
    [start, end, total, crop, maxShortSide, fps, lossless]
  );
  const out = outputOf(plan, src);
  const reencode = needsReencode(plan, src);
  const estimate = estimateBytes(plan, src);
  const noop = isNoop(plan, src);

  // Where the video sits inside the stage (contain), for drawing the crop frame.
  const videoRatio = item.width && item.height ? item.width / item.height : 16 / 9;
  const box = (() => {
    if (!stage.w || !stage.h) return { x: 0, y: 0, w: 0, h: 0 };
    const w = Math.min(stage.w, stage.h * videoRatio);
    const h = w / videoRatio;
    return { x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h };
  })();

  function seekTo(fraction: number) {
    if (!enableVideo || !total) return;
    player.currentTime = (fraction * total) / 1000;
  }

  function togglePlay() {
    if (!enableVideo) return;
    if (player.playing) player.pause();
    else {
      if (playhead < start || playhead >= end) seekTo(start);
      player.play();
    }
  }

  async function save(mode: 'replace' | 'copy') {
    setSaveMenu(false);
    setError('');
    if (enableVideo) player.pause();
    setRunning(0);
    let result: UiSmallerResult;
    try {
      result = await actions.onEditVideo(item, plan, mode, (f) => setRunning(f));
    } catch (e) {
      result = { kind: 'failed', reason: String(e) };
    }
    setRunning(null);
    if (result.kind === 'done') {
      const size = `${fmtSize(result.before)} → ${fmtSize(result.after)}`;
      onDone(mode === 'copy' ? `Saved as a new video (${fmtSize(result.after)})` : `Video changed · ${size}`, result.newId);
    } else {
      setError(result.reason);
    }
  }

  function askReplace() {
    setSaveMenu(false);
    confirmAction(
      'Replace the original?',
      'The video is changed for good - the cut-away parts cannot be brought back. Ratings, keywords and albums stay.',
      () => void save('replace'),
      { label: 'Replace', destructive: true }
    );
  }

  const freeAxis = crop ? (crop.w < 0.999 && crop.h < 0.999 ? 'both' : crop.w < 0.999 ? 'x' : crop.h < 0.999 ? 'y' : 'none') : 'none';

  return (
    <Modal visible edgeBack={false} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} disabled={running !== null} style={styles.headerBtn}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            Edit
          </Text>
          <TouchableOpacity
            onPress={() => setSaveMenu(true)}
            disabled={noop || running !== null || !available}
            style={[styles.save, (noop || running !== null || !available) && styles.disabled]}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={1}
          style={styles.stage}
          onPress={togglePlay}
          onLayout={(e: LayoutChangeEvent) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {enableVideo ? (
            <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />
          ) : (
            <Image source={item.thumbSource} style={styles.video} contentFit="contain" />
          )}
          {aspect === 'free' && tab === 'crop' && box.w > 0 && <FreeFrame box={box} crop={free} onChange={setFree} />}
          {crop && box.w > 0 && aspect !== 'free' && (
            <View pointerEvents="none" style={StyleFill}>
              {/* Dim everything outside the crop. */}
              <View style={[styles.dim, { left: box.x, top: box.y, width: box.w, height: crop.y * box.h }]} />
              <View
                style={[
                  styles.dim,
                  { left: box.x, top: box.y + (crop.y + crop.h) * box.h, width: box.w, height: (1 - crop.y - crop.h) * box.h },
                ]}
              />
              <View
                style={[styles.dim, { left: box.x, top: box.y + crop.y * box.h, width: crop.x * box.w, height: crop.h * box.h }]}
              />
              <View
                style={[
                  styles.dim,
                  {
                    left: box.x + (crop.x + crop.w) * box.w,
                    top: box.y + crop.y * box.h,
                    width: (1 - crop.x - crop.w) * box.w,
                    height: crop.h * box.h,
                  },
                ]}
              />
              <View
                style={[
                  styles.cropFrame,
                  { left: box.x + crop.x * box.w, top: box.y + crop.y * box.h, width: crop.w * box.w, height: crop.h * box.h },
                ]}
              />
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.tabs}>
          <Segment options={TABS} value={tab} onChange={setTab} />
        </View>

        <ScrollView style={styles.panel} contentContainerStyle={styles.panelBody}>
          {!available && (
            <Text style={styles.warn}>Saving needs the new app version (1.1). You can look around, but not save yet.</Text>
          )}

          {tab === 'trim' && (
            <>
              <RangeTrack
                frames={frames}
                start={start}
                end={end}
                playhead={playhead}
                minGap={total ? Math.min(0.5, 500 / total) : 0.02}
                onChange={(s, e, moved) => {
                  setStart(s);
                  setEnd(e);
                  seekTo(moved === 'start' ? s : e);
                }}
                onDone={() => seekTo(range.current.start)}
              />
              <View style={styles.timeRow}>
                <Text style={styles.time}>{fmtTime(start * total)}</Text>
                <Text style={styles.timeStrong}>{fmtDuration((end - start) * total) ?? '0:00'} kept</Text>
                <Text style={styles.time}>{fmtTime(end * total)}</Text>
              </View>
              <Wrap>
                <Chip label="Start here" onPress={() => setStart(Math.min(playhead, end - 0.01))} />
                <Chip label="End here" onPress={() => setEnd(Math.max(playhead, start + 0.01))} />
                <Chip
                  label="Reset"
                  onPress={() => {
                    setStart(0);
                    setEnd(1);
                  }}
                />
              </Wrap>
              <ToggleRow label="Keep full quality (no re-encode)" value={lossless} onChange={setLossless} />
              <Text style={styles.hint}>
                {lossless
                  ? 'A plain trim copies the frames as they are: instant, nothing lost. Cropping or a new size always re-encodes.'
                  : 'Re-encoded as HEVC - smaller, takes a moment.'}
              </Text>
            </>
          )}

          {tab === 'crop' && (
            <>
              <Wrap>
                <Chip label="Free" on={aspect === 'free'} onPress={() => setAspect('free')} />
                {ASPECTS.map((a) => (
                  <Chip key={a.key} label={a.label} on={aspect === a.key} onPress={() => setAspect(a.key)} />
                ))}
              </Wrap>
              {aspect === 'free' ? (
                <Text style={styles.hint}>
                  Drag the corners or edges of the frame to crop exactly what you want; drag inside it to move it.
                  {item.width && item.height && crop ? ` ${Math.round(crop.w * item.width)} × ${Math.round(crop.h * item.height)}` : ''}
                </Text>
              ) : (
                <>
                  <Text style={styles.label}>Zoom {zoomFactor.toFixed(1)}×</Text>
                  <Slider value={zoom} onChange={setZoom} />
                </>
              )}
              {aspect !== 'free' && (freeAxis === 'x' || freeAxis === 'both') && (
                <>
                  <Text style={styles.label}>Left ↔ right</Text>
                  <Slider value={posX} onChange={setPosX} />
                </>
              )}
              {aspect !== 'free' && (freeAxis === 'y' || freeAxis === 'both') && (
                <>
                  <Text style={styles.label}>Up ↕ down</Text>
                  <Slider value={posY} onChange={setPosY} />
                </>
              )}
              <Chip
                label="No crop"
                onPress={() => {
                  setAspect('original');
                  setFree({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
                  setZoom(0);
                  setPosX(0.5);
                  setPosY(0.5);
                }}
              />
            </>
          )}

          {tab === 'size' && (
            <>
              <Text style={styles.label}>Now</Text>
              <Text style={styles.body}>
                {[fmtFormatLine(item.width, item.height, src.fps), item.meta?.codec, fmtBitrate(item.sizeBytes, item.durationMs)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <Text style={styles.label}>Resolution (short side)</Text>
              <Wrap>
                {RESOLUTIONS.map((r) => {
                  const short = item.width && item.height ? Math.min(item.width, item.height) : null;
                  const bigger = r.key !== null && short !== null && r.key >= short;
                  return bigger ? null : (
                    <Chip key={r.label} label={r.label} on={maxShortSide === r.key} onPress={() => setMaxShortSide(r.key)} />
                  );
                })}
              </Wrap>
              <Text style={styles.label}>Frame rate</Text>
              <Wrap>
                {FRAME_RATES.map((r) =>
                  r.key !== null && src.fps !== null && r.key >= src.fps - 0.5 ? null : (
                    <Chip key={r.label} label={r.key ? `${r.label} fps` : r.label} on={fps === r.key} onPress={() => setFps(r.key)} />
                  )
                )}
              </Wrap>
              <Text style={styles.hint}>Only sizes and frame rates below the video's own are offered.</Text>
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
          {running !== null ? (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(running * 100)}%` }]} />
              </View>
              <View style={styles.footerRow}>
                <Text style={styles.body}>Working… {Math.round(running * 100)}%</Text>
                <TouchableOpacity onPress={actions.onCancelMakeSmaller}>
                  <Text style={styles.stop}>Stop</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.resultLine}>
                {noop
                  ? 'No changes yet'
                  : `${fmtFormatLine(out.width, out.height, out.fps)} · ${fmtDuration(out.durationMs) ?? '?'}${
                      estimate !== null ? ` · about ${fmtSize(estimate)}` : ''
                    }`}
              </Text>
              <Text style={styles.hint}>
                {noop ? `${fmtSize(item.sizeBytes)} now` : `${fmtSize(item.sizeBytes)} now · ${reencode ? 're-encoded' : 'no re-encode'}`}
              </Text>
            </>
          )}
          {!!error && <Text style={styles.warn}>{error}</Text>}
        </View>

        {saveMenu && (
          <OptionsSheet
            title="Save"
            options={[
              { label: 'Save as New Video', hint: 'Keeps the original', onPress: () => void save('copy') },
              { label: 'Replace Original', danger: true, onPress: askReplace },
            ]}
            onClose={() => setSaveMenu(false)}
          />
        )}
      </View>
    </Modal>
  );
}

/**
 * The free crop frame: drag a corner or an edge to resize, drag inside to
 * move. Everything outside is dimmed; thirds lines help line things up.
 */
function FreeFrame({
  box,
  crop,
  onChange,
}: {
  box: { x: number; y: number; w: number; h: number };
  crop: Crop;
  onChange: (c: Crop) => void;
}) {
  const styles = useStyles(makeStyles);
  const startRef = useRef(crop);
  const latest = useRef({ crop, box, onChange });
  latest.current = { crop, box, onChange };

  const responders = useMemo(() => {
    const make = (h: CropHandle) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startRef.current = latest.current.crop;
        },
        onPanResponderMove: (_, g) => {
          const b = latest.current.box;
          latest.current.onChange(moveCrop(startRef.current, h, g.dx / b.w, g.dy / b.h));
        },
      });
    const all = ['move', 'tl', 'tr', 'bl', 'br', 'l', 'r', 't', 'b'] as CropHandle[];
    return Object.fromEntries(all.map((h) => [h, make(h)])) as Record<CropHandle, ReturnType<typeof PanResponder.create>>;
  }, []);

  const L = box.x + crop.x * box.w;
  const T = box.y + crop.y * box.h;
  const W = crop.w * box.w;
  const H = crop.h * box.h;
  const HS = 30; // touch size of a handle
  const corner = (h: CropHandle, left: number, top: number) => (
    <View {...responders[h].panHandlers} style={[styles.handleHit, { left: left - HS / 2, top: top - HS / 2, width: HS, height: HS }]}>
      <View style={styles.handleDot} />
    </View>
  );
  const edge = (h: CropHandle, left: number, top: number, w: number, hh: number) => (
    <View {...responders[h].panHandlers} style={{ position: 'absolute', left, top, width: w, height: hh }} />
  );
  return (
    <View style={StyleFill} pointerEvents="box-none">
      <View pointerEvents="none" style={[styles.dim, { left: box.x, top: box.y, width: box.w, height: T - box.y }]} />
      <View pointerEvents="none" style={[styles.dim, { left: box.x, top: T + H, width: box.w, height: box.y + box.h - T - H }]} />
      <View pointerEvents="none" style={[styles.dim, { left: box.x, top: T, width: L - box.x, height: H }]} />
      <View pointerEvents="none" style={[styles.dim, { left: L + W, top: T, width: box.x + box.w - L - W, height: H }]} />
      <View {...responders.move.panHandlers} style={[styles.cropFrame, { left: L, top: T, width: W, height: H }]}>
        <View pointerEvents="none" style={[styles.third, { left: '33.3%', top: 0, bottom: 0, width: 1 }]} />
        <View pointerEvents="none" style={[styles.third, { left: '66.6%', top: 0, bottom: 0, width: 1 }]} />
        <View pointerEvents="none" style={[styles.third, { top: '33.3%', left: 0, right: 0, height: 1 }]} />
        <View pointerEvents="none" style={[styles.third, { top: '66.6%', left: 0, right: 0, height: 1 }]} />
      </View>
      {edge('t', L + HS / 2, T - 12, Math.max(0, W - HS), 24)}
      {edge('b', L + HS / 2, T + H - 12, Math.max(0, W - HS), 24)}
      {edge('l', L - 12, T + HS / 2, 24, Math.max(0, H - HS))}
      {edge('r', L + W - 12, T + HS / 2, 24, Math.max(0, H - HS))}
      {corner('tl', L, T)}
      {corner('tr', L + W, T)}
      {corner('bl', L, T + H)}
      {corner('br', L + W, T + H)}
    </View>
  );
}

const StyleFill = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
    headerBtn: { padding: 6 },
    cancel: { color: p.link, fontSize: 17 },
    title: { flex: 1, textAlign: 'center', color: p.text, fontSize: 17, fontWeight: '700' },
    save: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
    saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    disabled: { opacity: 0.4 },

    stage: { height: '42%', backgroundColor: '#000' },
    video: { width: '100%', height: '100%' },
    dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
    cropFrame: { position: 'absolute', borderWidth: 2, borderColor: '#fff' },
    third: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
    handleHit: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
    handleDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', borderWidth: 2, borderColor: 'rgba(0,0,0,0.35)' },

    tabs: { paddingHorizontal: 16, paddingTop: 12 },
    panel: { flex: 1 },
    panelBody: { padding: 16, gap: 12 },
    label: { color: p.textSecondary, fontSize: 12, fontWeight: '700', paddingTop: 4 },
    body: { color: p.textSoft, fontSize: 14 },
    hint: { color: p.textSecondary, fontSize: 12 },
    warn: { color: p.dangerText, fontSize: 13 },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
    time: { color: p.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
    timeStrong: { color: p.text, fontSize: 13, fontWeight: '700' },

    footer: { borderTopWidth: 1, borderTopColor: p.border, paddingHorizontal: 16, paddingTop: 10, gap: 4 },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    resultLine: { color: p.text, fontSize: 15, fontWeight: '600' },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: p.card, overflow: 'hidden' },
    progressFill: { height: 6, backgroundColor: p.accent },
    stop: { color: p.dangerText, fontSize: 15, fontWeight: '700' },
  });
