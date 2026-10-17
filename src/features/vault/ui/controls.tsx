/**
 * Touch controls React Native does not ship: a plain slider and the trim
 * range (two handles over the filmstrip). Values are fractions 0..1.
 * Presentational only (see the rule in types.ts).
 */

import { useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';

import { sheet, useStyles, type Palette } from './theme';
import type { ThumbSource } from './types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** One knob on a line. `onChange` fires while dragging, `onDone` when let go. */
export function Slider({
  value,
  onChange,
  onDone,
}: {
  value: number;
  onChange: (v: number) => void;
  onDone?: (v: number) => void;
}) {
  const styles = useStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const latest = useRef(value);
  const pageX0 = useRef(0);
  // The responder is made once, so it reads the latest callbacks through a ref.
  const cb = useRef({ onChange, onDone });
  cb.current = { onChange, onDone };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        pageX0.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        const v = clamp01(e.nativeEvent.locationX / (widthRef.current || 1));
        latest.current = v;
        cb.current.onChange(v);
      },
      onPanResponderMove: (e) => {
        const v = clamp01((e.nativeEvent.pageX - pageX0.current) / (widthRef.current || 1));
        latest.current = v;
        cb.current.onChange(v);
      },
      onPanResponderRelease: () => cb.current.onDone?.(latest.current),
      onPanResponderTerminate: () => cb.current.onDone?.(latest.current),
    })
  ).current;

  function onLayout(e: LayoutChangeEvent) {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  }

  return (
    <View style={styles.sliderHit} onLayout={onLayout} {...responder.panHandlers}>
      <View style={styles.sliderLine} pointerEvents="none">
        <View style={[styles.sliderFill, { width: clamp01(value) * width }]} />
      </View>
      <View pointerEvents="none" style={[styles.knob, { left: clamp01(value) * width - 13 }]} />
    </View>
  );
}

/**
 * The trim bar: the filmstrip with a yellow frame whose two ends are dragged.
 * `playhead` (0..1) draws the current position.
 */
export function RangeTrack({
  frames,
  start,
  end,
  playhead,
  minGap = 0.02,
  onChange,
  onDone,
}: {
  frames: ThumbSource[];
  start: number;
  end: number;
  playhead: number;
  /** Smallest selection, as a fraction. */
  minGap?: number;
  onChange: (start: number, end: number, moved: 'start' | 'end') => void;
  onDone?: (moved: 'start' | 'end') => void;
}) {
  const styles = useStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const range = useRef({ start, end });
  range.current = { start, end };
  const handle = useRef<'start' | 'end'>('start');
  const pageX0 = useRef(0);
  const cb = useRef({ onChange, onDone, minGap });
  cb.current = { onChange, onDone, minGap };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        pageX0.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        const at = clamp01(e.nativeEvent.locationX / (widthRef.current || 1));
        const { start: s, end: en } = range.current;
        // Whichever end is nearer to the finger moves.
        handle.current = Math.abs(at - s) <= Math.abs(at - en) ? 'start' : 'end';
        move(at);
      },
      onPanResponderMove: (e) => move(clamp01((e.nativeEvent.pageX - pageX0.current) / (widthRef.current || 1))),
      onPanResponderRelease: () => cb.current.onDone?.(handle.current),
      onPanResponderTerminate: () => cb.current.onDone?.(handle.current),
    })
  ).current;

  function move(at: number) {
    const { start: s, end: en } = range.current;
    const { onChange: change, minGap: gap } = cb.current;
    if (handle.current === 'start') change(Math.max(0, Math.min(at, en - gap)), en, 'start');
    else change(s, Math.min(1, Math.max(at, s + gap)), 'end');
  }

  function onLayout(e: LayoutChangeEvent) {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  }

  return (
    <View style={styles.track} onLayout={onLayout} {...responder.panHandlers}>
      <View style={styles.strip} pointerEvents="none">
        {frames.map((src, i) => (
          <Image key={i} source={src} style={styles.frame} contentFit="cover" />
        ))}
      </View>
      <View pointerEvents="none" style={[styles.shade, { left: 0, width: start * width }]} />
      <View pointerEvents="none" style={[styles.shade, { left: end * width, right: 0 }]} />
      <View pointerEvents="none" style={[styles.selection, { left: start * width, width: (end - start) * width }]}>
        <View style={[styles.grip, styles.gripLeft]} />
        <View style={[styles.grip, styles.gripRight]} />
      </View>
      <View pointerEvents="none" style={[styles.playhead, { left: clamp01(playhead) * width - 1 }]} />
    </View>
  );
}

const TRACK_H = 54;
const TRIM_YELLOW = '#F5C518';

const makeStyles = (p: Palette) =>
  sheet({
    sliderHit: { height: 36, justifyContent: 'center' },
    sliderLine: { height: 4, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden' },
    sliderFill: { height: 4, backgroundColor: p.accent },
    knob: {
      position: 'absolute',
      top: 5,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: p.border,
    },

    track: { height: TRACK_H, borderRadius: 8, overflow: 'hidden', backgroundColor: p.card },
    strip: { flexDirection: 'row', height: TRACK_H },
    frame: { flex: 1, height: TRACK_H },
    shade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
    selection: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      borderColor: TRIM_YELLOW,
      borderTopWidth: 3,
      borderBottomWidth: 3,
      borderLeftWidth: 12,
      borderRightWidth: 12,
      borderRadius: 6,
    },
    grip: { position: 'absolute', top: TRACK_H / 2 - 12, width: 3, height: 18, borderRadius: 2, backgroundColor: '#000' },
    gripLeft: { left: -8 },
    gripRight: { right: -8 },
    playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
  });
