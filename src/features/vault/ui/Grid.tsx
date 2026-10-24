/**
 * The thumbnail grid for all four layout styles, with optional date groups.
 *
 * `layout.ts` decides where every tile and group title goes; this file draws
 * only what is near the visible part of the scroll view (one screen above, two
 * below), so thousands of videos cost no more than a few dozen mounted images.
 *
 * Pinch the grid to make the tiles bigger or smaller (like the Photos app).
 * When grouped, a row of chips under the header jumps to any group.
 *
 * Presentational only - no native modules (see the rule in types.ts).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView as RNScrollView, Text, TouchableOpacity, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

import { plural } from './confirm';
import { fmtThumbInfos } from './format';
import { computeSectionedLayout, visibleTiles, type Tile } from './layout';
import { daysLeft, groupItems } from './logic';
import { useTabBarSpace } from './chrome';
import Icon from './Icon';
import { sheet, useStyles, type Palette } from './theme';
import type { VaultItem, ViewOptions } from './types';

/** Gap between tiles, in px. */
export const GRID_GAP = 3;
/** Height of a group title row ("October 2026"). */
const GROUP_HEADER = 38;

export type GridMode = 'normal' | 'trash' | 'duplicates';

type Props = {
  items: VaultItem[];
  viewOptions: ViewOptions;
  /** Scrolls with the grid, above the first row. */
  header: ReactNode;
  /** Shown instead of the grid when `items` is empty. */
  empty: ReactNode;
  /** A new value scrolls back to the top (another filter was picked). */
  resetKey: string;
  selectMode: boolean;
  selected: string[];
  /** 'trash': dimmed tiles + days left. 'duplicates': Original / Copy badges. */
  mode: GridMode;
  /** id -> position inside its duplicate / similar group (0 = the original). */
  dupRank: Map<string, number>;
  /** For the "Album names" thumbnail info. */
  albumNames: Map<number, string>;
  /** Scroll to the group with this key (Timeline). A new `nonce` repeats the jump. */
  jumpTo?: { key: string; nonce: number } | null;
  onPressTile: (item: VaultItem) => void;
  onLongPressTile?: (item: VaultItem) => void;
  /** Video id -> its series name, for "Group by series". */
  seriesOf?: Map<string, string>;
  /** Pinched: 1 = bigger tiles, -1 = smaller. */
  onPinchSize?: (dir: 1 | -1) => void;
  /** Also told about scrolling (the live cards on the home rows). */
  onScrollExtra?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Videos linked to a Simkl movie or episode (a small TV mark). */
  linked?: Set<string>;
  /** "Continue another time" points: a thin bar where you stopped. */
  resume?: Map<string, number>;
  /** Play the tile in the middle of the screen, silently (a setting; off while something is open on top). */
  livePreview?: boolean;
};

export default function Grid({
  items,
  viewOptions,
  header,
  empty,
  resetKey,
  selectMode,
  selected,
  mode,
  dupRank,
  albumNames,
  jumpTo,
  onPressTile,
  onLongPressTile,
  linked,
  resume,
  seriesOf,
  onPinchSize,
  onScrollExtra,
  livePreview = false,
}: Props) {
  const styles = useStyles(makeStyles);
  const tabSpace = useTabBarSpace();
  const scrollRef = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [headerH, setHeaderH] = useState(0);
  /** Scroll position rounded down to half a screen: the window only moves in steps. */
  const [scrollStep, setScrollStep] = useState(0);
  const stepRef = useRef(0);

  const step = Math.max(200, Math.round(viewport.h / 2));

  // Group titles only make sense for the normal library views.
  const groupBy = mode === 'normal' ? viewOptions.groupBy : 'none';
  const sections = useMemo(() => groupItems(items, groupBy, seriesOf), [items, groupBy, seriesOf]);

  const layout = useMemo(
    () =>
      computeSectionedLayout(sections, {
        style: viewOptions.layout,
        size: viewOptions.size,
        width: viewport.w,
        gap: GRID_GAP,
        headerHeight: GROUP_HEADER,
      }),
    [sections, viewOptions.layout, viewOptions.size, viewport.w]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    stepRef.current = 0;
    setScrollStep(0);
  }, [resetKey]);

  useEffect(() => {
    if (!jumpTo) return;
    const target = layout.headers.find((h) => h.key === jumpTo.key);
    if (target) scrollRef.current?.scrollTo({ y: Math.max(0, headerH + target.y - 60), animated: true });
    // Only a new jump request should scroll, not every layout change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.nonce]);

  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);

  const windowTop = scrollStep * step - headerH - viewport.h;
  const windowBottom = scrollStep * step - headerH + viewport.h * 2 + step;
  const visible = useMemo(
    () => visibleTiles(layout, windowTop, windowBottom),
    [layout, windowTop, windowBottom]
  );
  // The silent preview: the tile nearest the middle of the screen, once scrolling settles.
  const scrollY = useRef(0);
  const [settledY, setSettledY] = useState(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);
  const liveId = useMemo(() => {
    if (!livePreview || selectMode || mode !== 'normal' || !viewport.h) return null;
    const mid = settledY - headerH + viewport.h / 2;
    let best: { id: string; d: number } | null = null;
    for (const t of visible) {
      const d = Math.abs(t.y + t.h / 2 - mid) + Math.abs(t.x + t.w / 2 - viewport.w / 2) * 0.3;
      if (t.y + t.h < settledY - headerH || t.y > settledY - headerH + viewport.h) continue;
      if (!best || d < best.d) best = { id: t.id, d };
    }
    return best?.id ?? null;
  }, [livePreview, selectMode, mode, visible, settledY, headerH, viewport.h, viewport.w]);

  const visibleHeaders = layout.headers.filter((h) => h.y < windowBottom && h.y + GROUP_HEADER > windowTop);

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onEnd((e) => {
      if (!onPinchSize) return;
      if (e.scale > 1.18) onPinchSize(1);
      else if (e.scale < 0.85) onPinchSize(-1);
    });
  const gestures = Gesture.Simultaneous(pinch, Gesture.Native());

  function jumpToSection(key: string) {
    const target = layout.headers.find((h) => h.key === key);
    if (target) scrollRef.current?.scrollTo({ y: Math.max(0, headerH + target.y - 60), animated: true });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    onScrollExtra?.(e);
    scrollY.current = e.nativeEvent.contentOffset.y;
    if (livePreview) {
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => setSettledY(scrollY.current), 260);
    }
    const next = Math.floor(e.nativeEvent.contentOffset.y / step);
    if (next !== stepRef.current) {
      stepRef.current = next;
      setScrollStep(next);
    }
  }

  const now = Date.now();

  return (
    <GestureDetector gesture={gestures}>
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={{ paddingBottom: Math.max(40, tabSpace + 24) }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setViewport((v) => (v.w === width && v.h === height ? v : { w: width, h: height }));
      }}
      onScroll={onScroll}
      scrollEventThrottle={32}
      keyboardShouldPersistTaps="handled">
      <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
        {header}
        {groupBy !== 'none' && sections.length > 1 && (
          <RNScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.jumpRow}>
            {sections.slice(0, 40).map((sec) => (
              <TouchableOpacity key={sec.key} style={styles.jumpChip} onPress={() => jumpToSection(sec.key)} accessibilityLabel={`Jump to ${sec.title}`}>
                <Text style={styles.jumpText} numberOfLines={1}>
                  {sec.title}
                </Text>
                <Text style={styles.jumpCount}>{sec.items.length}</Text>
              </TouchableOpacity>
            ))}
          </RNScrollView>
        )}
      </View>
      {items.length === 0 ? (
        empty
      ) : (
        <View style={{ height: layout.height }}>
          {visibleHeaders.map((h) => (
            <View key={`h-${h.key}`} style={[styles.groupHeader, { top: h.y, height: GROUP_HEADER }]}>
              <Text style={styles.groupTitle}>{h.title}</Text>
            </View>
          ))}
          {visible.map((tile) => {
            const item = byId.get(tile.id);
            return item ? (
              <TileView
                key={tile.id}
                tile={tile}
                item={item}
                viewOptions={viewOptions}
                selectMode={selectMode}
                isSelected={selected.includes(item.id)}
                mode={mode}
                copyRank={dupRank.get(item.id)}
                albumNames={albumNames}
                linked={linked?.has(item.id) ?? false}
                resumeAt={resume?.get(item.id)}
                live={liveId === item.id && !!item.uri && (item.durationMs ?? 1) > 0}
                now={now}
                styles={styles}
                onPress={onPressTile}
                onLongPress={onLongPressTile}
              />
            ) : null;
          })}
        </View>
      )}
    </ScrollView>
    </GestureDetector>
  );
}

/** A tile's video, playing silently in a loop from a tenth of the way in; it fades in once it plays. */
function TilePreview({ uri, durationMs }: { uri: string; durationMs: number | null }) {
  const [ready, setReady] = useState(false);
  const player = useVideoPlayer(uri, (pl) => {
    pl.muted = true;
    pl.loop = true;
    pl.audioMixingMode = 'mixWithOthers';
    if (durationMs && durationMs > 20_000) pl.currentTime = durationMs / 10000;
    pl.play();
  });
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') setReady(true);
    });
    return () => sub.remove();
  }, [player]);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: ready ? 1 : 0 }} pointerEvents="none">
      <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} />
    </View>
  );
}

function TileView({
  tile,
  item,
  viewOptions,
  selectMode,
  isSelected,
  mode,
  copyRank,
  albumNames,
  linked,
  resumeAt,
  live,
  now,
  styles,
  onPress,
  onLongPress,
}: {
  tile: Tile;
  item: VaultItem;
  viewOptions: ViewOptions;
  selectMode: boolean;
  isSelected: boolean;
  mode: GridMode;
  copyRank: number | undefined;
  albumNames: Map<number, string>;
  linked: boolean;
  resumeAt?: number;
  live?: boolean;
  now: number;
  styles: ReturnType<typeof makeStyles>;
  onPress: (item: VaultItem) => void;
  onLongPress?: (item: VaultItem) => void;
}) {
  const info = fmtThumbInfos(item, viewOptions.infos, albumNames);
  const inTrash = mode === 'trash';
  const bottomLeft =
    inTrash && item.deletedAt !== null
      ? { label: plural(daysLeft(item.deletedAt, now), 'day'), original: false }
      : mode === 'duplicates' && copyRank !== undefined
        ? { label: copyRank === 0 ? 'Original' : 'Copy', original: copyRank === 0 }
        : null;
  /** Small tiles have no room for long labels next to other badges. */
  const crowded = bottomLeft !== null || selectMode;
  const hasTagMark = viewOptions.showKeywords && item.tagCount > 0;

  return (
    <TouchableOpacity
      style={[styles.cell, { left: tile.x, top: tile.y, width: tile.w, height: tile.h }]}
      activeOpacity={0.8}
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={350}>
      <Image
        source={item.thumbSource}
        style={[styles.thumb, inTrash && styles.thumbDimmed]}
        contentFit="cover"
        recyclingKey={item.id}
      />
      {live && <TilePreview uri={item.uri} durationMs={item.durationMs} />}
      {item.inTray && <View style={styles.trayOutline} pointerEvents="none" />}
      {resumeAt !== undefined && !!item.durationMs && (
        <View style={styles.resumeTrack} pointerEvents="none">
          <View style={[styles.resumeFill, { width: `${Math.min(100, (resumeAt / item.durationMs) * 100)}%` }]} />
        </View>
      )}
      {info && (
        <Text style={[styles.infoBadge, { maxWidth: tile.w * (crowded ? 0.5 : 0.9) }]} numberOfLines={1}>
          {info}
        </Text>
      )}
      <View style={styles.topRight} pointerEvents="none">
        {linked && (
          <View style={styles.mark}>
            <Icon name="tv" size={10} color="#fff" />
          </View>
        )}
        {viewOptions.showRating && item.flag !== 0 && (
          <View style={[styles.mark, item.flag === 1 ? styles.flagPick : styles.flagReject]}>
            <Icon name={item.flag === 1 ? 'flag' : 'close'} size={9} color="#fff" weight="bold" />
          </View>
        )}
        {hasTagMark && (
          <View style={styles.mark}>
            <Icon name="tag" size={9} color="#fff" />
          </View>
        )}
      </View>
      {viewOptions.showRating && item.rating > 0 && (
        <View style={styles.rateBadge} pointerEvents="none">
          <Icon name="star" size={9} color={styles.rateText.color as string} />
          <Text style={styles.rateText}>{item.rating}</Text>
        </View>
      )}
      {bottomLeft && (
        <Text
          style={[styles.leftBadge, bottomLeft.original && styles.originalBadge, selectMode && styles.badgeBesideCheck]}>
          {bottomLeft.label}
        </Text>
      )}
      {selectMode && (
        <View style={[styles.check, isSelected && styles.checkOn]}>
          {isSelected && <Icon name="check" size={12} color="#fff" weight="bold" />}
        </View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    scroll: { flex: 1 },
    groupHeader: { position: 'absolute', left: 0, right: 0, justifyContent: 'flex-end', paddingHorizontal: 8, paddingBottom: 6 },
    groupTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    cell: { position: 'absolute', backgroundColor: p.tile, overflow: 'hidden' },
    thumb: { width: '100%', height: '100%' },
    thumbDimmed: { opacity: 0.55 },
    resumeTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(0,0,0,0.5)' },
    resumeFill: { height: 3, backgroundColor: p.accent },
    trayOutline: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderWidth: 3,
      borderColor: p.accent,
    },

    // Badges sit on top of pictures, so they stay dark in both themes.
    infoBadge: {
      position: 'absolute',
      bottom: 4,
      right: 4,
      color: '#fff',
      fontSize: 10,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 5,
      paddingVertical: 1.5,
      borderRadius: 6,
      overflow: 'hidden',
    },
    topRight: { position: 'absolute', top: 4, right: 4, flexDirection: 'row', gap: 3 },
    mark: {
      width: 17,
      height: 17,
      borderRadius: 9,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    flagPick: { backgroundColor: '#30d158' },
    flagReject: { backgroundColor: '#ff453a' },
    rateBadge: {
      position: 'absolute',
      top: 4,
      left: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 5,
      paddingVertical: 1.5,
      borderRadius: 6,
    },
    rateText: { color: p.rating, fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
    leftBadge: {
      position: 'absolute',
      bottom: 3,
      left: 3,
      color: '#fff',
      fontSize: 10,
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.65)',
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    originalBadge: { backgroundColor: p.accent },
    /** Select mode puts its circle in the bottom-left corner; sit next to it. */
    badgeBesideCheck: { left: 28, bottom: 5 },
    check: {
      position: 'absolute',
      bottom: 4,
      left: 4,
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: '#fff',
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: p.accent, borderColor: p.accent },
    jumpRow: { gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
    jumpChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 220, borderRadius: 999, backgroundColor: p.card, paddingHorizontal: 12, paddingVertical: 6 },
    jumpText: { color: p.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
    jumpCount: { color: p.textSecondary, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  });
