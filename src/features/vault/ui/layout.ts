/**
 * Where every thumbnail goes, for HashPhotos' four layout styles.
 *
 * Pure maths, no runtime imports: the browser preview, the app and the tests
 * all use it. The screen only renders the tiles this returns, and only the ones
 * near the visible part of the list (`visibleTiles`), so a library of thousands
 * of videos stays fast.
 *
 *   grid       square tiles in fixed columns
 *   natural    justified rows: each video keeps its shape, rows fill the width
 *   waterfall  fixed columns, each video keeps its shape, stacked like bricks
 *   mosaic     square tiles, every other block has one big 2x2 tile
 *   fit        (a size, not a style) one video per row, full width, its own shape
 */

import type { LayoutStyle, ThumbSize } from './types';

/** Columns per thumbnail size (grid, waterfall and mosaic). */
export const COLUMNS: Record<ThumbSize, number> = {
  small: 5,
  medium: 4,
  large: 3,
  xlarge: 2,
  fit: 1,
};

/** Target row height for the Natural layout, per size (px). */
const NATURAL_ROW: Record<ThumbSize, number> = {
  small: 78,
  medium: 104,
  large: 140,
  xlarge: 210,
  fit: 0,
};

/** The size cycle of the round button in the header (HashPhotos' layout circle). */
export const SIZE_CYCLE: ThumbSize[] = ['large', 'medium', 'small', 'xlarge', 'fit'];

export function nextSize(size: ThumbSize): ThumbSize {
  return SIZE_CYCLE[(SIZE_CYCLE.indexOf(size) + 1) % SIZE_CYCLE.length];
}

export type Sized = { id: string; width: number | null; height: number | null };

export type Tile = { id: string; x: number; y: number; w: number; h: number };

export type Layout = {
  /** In list order; `y` never decreases from one tile to the next. */
  tiles: Tile[];
  height: number;
  /** Tallest tile - lets `visibleTiles` search by top edge only. */
  maxTileHeight: number;
};

/** Shape used when a video's size is unknown: a landscape phone video. */
const DEFAULT_RATIO = 16 / 9;

/** Width / height, kept inside sane bounds so one odd file can't break a row. */
export function aspectRatio(item: Sized): number {
  const { width, height } = item;
  if (!width || !height || width <= 0 || height <= 0) return DEFAULT_RATIO;
  return Math.min(2.5, Math.max(0.4, width / height));
}

function finish(tiles: Tile[], height: number): Layout {
  let maxTileHeight = 0;
  for (const t of tiles) if (t.h > maxTileHeight) maxTileHeight = t.h;
  return { tiles, height: Math.max(0, height), maxTileHeight };
}

/** One video per row, full width, its own shape. */
function fitLayout(items: Sized[], width: number, gap: number): Layout {
  const tiles: Tile[] = [];
  let y = 0;
  for (const item of items) {
    const h = Math.round(width / aspectRatio(item));
    tiles.push({ id: item.id, x: 0, y, w: width, h });
    y += h + gap;
  }
  return finish(tiles, y - (tiles.length ? gap : 0));
}

function gridLayout(items: Sized[], width: number, gap: number, cols: number): Layout {
  const cell = Math.floor((width - gap * (cols - 1)) / cols);
  const tiles = items.map((item, i) => ({
    id: item.id,
    x: (i % cols) * (cell + gap),
    y: Math.floor(i / cols) * (cell + gap),
    w: cell,
    h: cell,
  }));
  const rows = Math.ceil(items.length / cols);
  return finish(tiles, rows * cell + Math.max(0, rows - 1) * gap);
}

/**
 * Justified rows. Videos are added to a row until it would be wider than the
 * screen at the target height; then the row is scaled down so it fills the
 * width exactly. The last row keeps the target height and is not stretched.
 */
function naturalLayout(items: Sized[], width: number, gap: number, targetH: number): Layout {
  const tiles: Tile[] = [];
  let y = 0;
  let row: Sized[] = [];
  let ratioSum = 0;

  const placeRow = (h: number, stretch: boolean) => {
    let x = 0;
    row.forEach((item, i) => {
      const last = i === row.length - 1;
      const w = stretch && last ? width - x : Math.round(aspectRatio(item) * h);
      tiles.push({ id: item.id, x, y, w, h });
      x += w + gap;
    });
    y += h + gap;
    row = [];
    ratioSum = 0;
  };

  for (const item of items) {
    row.push(item);
    ratioSum += aspectRatio(item);
    const widthAtTarget = ratioSum * targetH + gap * (row.length - 1);
    if (widthAtTarget >= width) {
      const h = Math.round((width - gap * (row.length - 1)) / ratioSum);
      placeRow(h, true);
    }
  }
  if (row.length) placeRow(targetH, false);

  return finish(tiles, y - (tiles.length ? gap : 0));
}

/** Masonry: each video goes into the column that is currently shortest. */
function waterfallLayout(items: Sized[], width: number, gap: number, cols: number): Layout {
  const colW = (width - gap * (cols - 1)) / cols;
  const heights = new Array<number>(cols).fill(0);
  const tiles: Tile[] = [];
  for (const item of items) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[c]) c = i;
    const h = Math.round(colW / aspectRatio(item));
    tiles.push({ id: item.id, x: Math.round(c * (colW + gap)), y: heights[c], w: Math.floor(colW), h });
    heights[c] += h + gap;
  }
  const tallest = Math.max(0, ...heights);
  return finish(tiles, tallest - (tiles.length ? gap : 0));
}

/**
 * Square tiles in blocks. A "big" block holds one 2x2 tile plus small tiles
 * filling the other columns two rows deep; big blocks alternate left and right,
 * with a plain row of small tiles between them. Leftovers at the end become
 * plain rows, so no gap is ever left in the middle. With 2 columns the big tile
 * is simply the full width.
 */
function mosaicLayout(items: Sized[], width: number, gap: number, cols: number): Layout {
  const unit = Math.floor((width - gap * (cols - 1)) / cols);
  const big = unit * 2 + gap;
  const smallsPerBig = (cols - 2) * 2;
  const tiles: Tile[] = [];
  let y = 0;
  let i = 0;
  let bigLeft = true;

  const plainRow = () => {
    const n = Math.min(cols, items.length - i);
    for (let c = 0; c < n; c++) {
      tiles.push({ id: items[i].id, x: c * (unit + gap), y, w: unit, h: unit });
      i++;
    }
    y += unit + gap;
  };

  while (i < items.length) {
    if (items.length - i >= 1 + smallsPerBig) {
      const bigX = bigLeft ? 0 : (cols - 2) * (unit + gap);
      const smallStart = bigLeft ? 2 : 0;
      tiles.push({ id: items[i].id, x: bigX, y, w: big, h: big });
      i++;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols - 2; c++) {
          tiles.push({
            id: items[i].id,
            x: (smallStart + c) * (unit + gap),
            y: y + r * (unit + gap),
            w: unit,
            h: unit,
          });
          i++;
        }
      }
      y += big + gap;
      bigLeft = !bigLeft;
    }
    if (i < items.length) plainRow();
  }

  return finish(tiles, y - (tiles.length ? gap : 0));
}

/** Where every tile goes for the chosen style and size, `width` px wide. */
export function computeLayout(
  items: Sized[],
  options: { style: LayoutStyle; size: ThumbSize; width: number; gap: number }
): Layout {
  const { style, size, gap } = options;
  const width = Math.floor(options.width);
  if (width <= 0 || items.length === 0) return { tiles: [], height: 0, maxTileHeight: 0 };
  if (size === 'fit') return fitLayout(items, width, gap);

  const cols = COLUMNS[size];
  switch (style) {
    case 'natural':
      return naturalLayout(items, width, gap, NATURAL_ROW[size]);
    case 'waterfall':
      return waterfallLayout(items, width, gap, Math.max(2, cols));
    case 'mosaic':
      return mosaicLayout(items, width, gap, Math.max(2, cols));
    default:
      return gridLayout(items, width, gap, cols);
  }
}

export type SectionHeader = { key: string; title: string; y: number };

export type SectionedLayout = Layout & { headers: SectionHeader[] };

/**
 * HashPhotos' Grouping: each section gets a title row, then its own tiles laid
 * out with the chosen style. Sections without a title (grouping off) add no row.
 */
export function computeSectionedLayout(
  sections: { key: string; title: string; items: Sized[] }[],
  options: { style: LayoutStyle; size: ThumbSize; width: number; gap: number; headerHeight: number }
): SectionedLayout {
  const tiles: Tile[] = [];
  const headers: SectionHeader[] = [];
  let y = 0;
  let maxTileHeight = 0;
  for (const section of sections) {
    if (section.title) {
      headers.push({ key: section.key, title: section.title, y });
      y += options.headerHeight;
    }
    const sub = computeLayout(section.items, options);
    for (const t of sub.tiles) tiles.push({ ...t, y: t.y + y });
    if (sub.maxTileHeight > maxTileHeight) maxTileHeight = sub.maxTileHeight;
    y += sub.height + (section.title ? options.gap * 3 : options.gap);
  }
  if (tiles.length || headers.length) y -= sections[sections.length - 1]?.title ? options.gap * 3 : options.gap;
  return { tiles, headers, height: Math.max(0, y), maxTileHeight };
}

/** First index whose tile top is >= `y` (tiles are sorted by top edge). */
function firstAtOrBelow(tiles: Tile[], y: number): number {
  let lo = 0;
  let hi = tiles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tiles[mid].y < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The tiles that overlap the band [top, bottom) - the only ones worth rendering. */
export function visibleTiles(layout: Layout, top: number, bottom: number): Tile[] {
  const { tiles, maxTileHeight } = layout;
  const start = firstAtOrBelow(tiles, top - maxTileHeight);
  const end = firstAtOrBelow(tiles, bottom);
  const out: Tile[] = [];
  for (let i = start; i < end; i++) {
    const t = tiles[i];
    if (t.y + t.h > top) out.push(t);
  }
  return out;
}
