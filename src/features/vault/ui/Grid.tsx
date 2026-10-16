/**
 * The thumbnail grid for all four layout styles.
 *
 * `layout.ts` decides where every tile goes; this file draws only the tiles
 * near the visible part of the scroll view (one screen above, two below), so
 * thousands of videos cost no more than a few dozen mounted images.
 *
 * Presentational only - no native modules (see the rule in types.ts).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';

import { plural } from './confirm';
import { fmtThumbInfo } from './format';
import { computeLayout, visibleTiles, type Tile } from './layout';
import { daysLeft } from './logic';
import { sheet, useStyles, type Palette } from './theme';
import type { VaultItem, ViewOptions } from './types';

/** Gap between tiles, in px. */
export const GRID_GAP = 3;

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
  /** id -> position inside its duplicate group (0 = the original). */
  dupRank: Map<string, number>;
  onPressTile: (item: VaultItem) => void;
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
  onPressTile,
}: Props) {
  const styles = useStyles(makeStyles);
  const scrollRef = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [headerH, setHeaderH] = useState(0);
  /** Scroll position rounded down to half a screen: the window only moves in steps. */
  const [scrollStep, setScrollStep] = useState(0);
  const stepRef = useRef(0);

  const step = Math.max(200, Math.round(viewport.h / 2));

  const layout = useMemo(
    () =>
      computeLayout(items, {
        style: viewOptions.layout,
        size: viewOptions.size,
        width: viewport.w,
        gap: GRID_GAP,
      }),
    [items, viewOptions.layout, viewOptions.size, viewport.w]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    stepRef.current = 0;
    setScrollStep(0);
  }, [resetKey]);

  const byId = useMemo(() => new Map(items.map((v) => [v.id, v])), [items]);

  const windowTop = scrollStep * step - headerH - viewport.h;
  const windowBottom = scrollStep * step - headerH + viewport.h * 2 + step;
  const visible = useMemo(
    () => visibleTiles(layout, windowTop, windowBottom),
    [layout, windowTop, windowBottom]
  );

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.floor(e.nativeEvent.contentOffset.y / step);
    if (next !== stepRef.current) {
      stepRef.current = next;
      setScrollStep(next);
    }
  }

  const now = Date.now();

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setViewport((v) => (v.w === width && v.h === height ? v : { w: width, h: height }));
      }}
      onScroll={onScroll}
      scrollEventThrottle={32}
      keyboardShouldPersistTaps="handled">
      <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>{header}</View>
      {items.length === 0 ? (
        empty
      ) : (
        <View style={{ height: layout.height }}>
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
                copyRank={mode === 'duplicates' ? dupRank.get(item.id) : undefined}
                now={now}
                styles={styles}
                onPress={onPressTile}
              />
            ) : null;
          })}
        </View>
      )}
    </ScrollView>
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
  now,
  styles,
  onPress,
}: {
  tile: Tile;
  item: VaultItem;
  viewOptions: ViewOptions;
  selectMode: boolean;
  isSelected: boolean;
  mode: GridMode;
  copyRank: number | undefined;
  now: number;
  styles: ReturnType<typeof makeStyles>;
  onPress: (item: VaultItem) => void;
}) {
  const info = fmtThumbInfo(item, viewOptions.info);
  const inTrash = mode === 'trash';
  const bottomLeft =
    inTrash && item.deletedAt !== null
      ? { label: plural(daysLeft(item.deletedAt, now), 'day'), original: false }
      : copyRank !== undefined
        ? { label: copyRank === 0 ? 'Original' : 'Copy', original: copyRank === 0 }
        : null;
  /** Small tiles have no room for long labels next to other badges. */
  const crowded = bottomLeft !== null || selectMode;

  return (
    <TouchableOpacity
      style={[styles.cell, { left: tile.x, top: tile.y, width: tile.w, height: tile.h }]}
      activeOpacity={0.8}
      onPress={() => onPress(item)}>
      <Image
        source={item.thumbSource}
        style={[styles.thumb, inTrash && styles.thumbDimmed]}
        contentFit="cover"
        recyclingKey={item.id}
      />
      {info && (
        <Text
          style={[styles.infoBadge, { maxWidth: tile.w * (crowded ? 0.5 : 0.9) }]}
          numberOfLines={1}>
          {info}
        </Text>
      )}
      {viewOptions.showKeywords && item.tagCount > 0 && (
        <View style={styles.tagBadge}>
          <Text style={styles.tagBadgeText}>#</Text>
        </View>
      )}
      {viewOptions.showRating && item.rating > 0 && (
        <Text style={styles.rateBadge}>{item.rating}/10</Text>
      )}
      {bottomLeft && (
        <Text
          style={[
            styles.leftBadge,
            bottomLeft.original && styles.originalBadge,
            selectMode && styles.badgeBesideCheck,
          ]}>
          {bottomLeft.label}
        </Text>
      )}
      {selectMode && (
        <View style={[styles.check, isSelected && styles.checkOn]}>
          {isSelected && <Text style={styles.checkMark}>✓</Text>}
        </View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
  scroll: { flex: 1 },
  content: { paddingBottom: 110 },
  cell: { position: 'absolute', backgroundColor: p.tile, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  thumbDimmed: { opacity: 0.55 },

  // Badges sit on top of pictures, so they stay dark in both themes.
  infoBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tagBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  tagBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  rateBadge: {
    position: 'absolute',
    top: 3,
    left: 3,
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: p.rating,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
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
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
