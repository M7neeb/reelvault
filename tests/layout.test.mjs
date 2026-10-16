// Run with `npm test`. Checks where thumbnails go in each layout style.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  aspectRatio,
  COLUMNS,
  computeLayout,
  computeSectionedLayout,
  nextSize,
  visibleTiles,
} from '../src/features/vault/ui/layout.ts';
import { fmtThumbInfo, fmtThumbInfos } from '../src/features/vault/ui/format.ts';

const W = 393;
const GAP = 3;

const landscape = (id) => ({ id, width: 1920, height: 1080 });
const portrait = (id) => ({ id, width: 1080, height: 1920 });
const square = (id) => ({ id, width: 1080, height: 1080 });
const many = (n, make = landscape) => Array.from({ length: n }, (_, i) => make(`v${i}`));

/** Tiles grouped by their top edge. */
const rows = (tiles) => {
  const byY = new Map();
  for (const t of tiles) byY.set(t.y, [...(byY.get(t.y) ?? []), t]);
  return [...byY.values()];
};

const nonDecreasingY = (tiles) => tiles.every((t, i) => i === 0 || t.y >= tiles[i - 1].y);

test('no width or no videos gives an empty layout', () => {
  assert.equal(computeLayout(many(5), { style: 'grid', size: 'large', width: 0, gap: GAP }).tiles.length, 0);
  assert.equal(computeLayout([], { style: 'grid', size: 'large', width: W, gap: GAP }).height, 0);
});

test('grid: square tiles, columns per size, rows never wider than the screen', () => {
  for (const size of ['small', 'medium', 'large', 'xlarge']) {
    const { tiles } = computeLayout(many(11), { style: 'grid', size, width: W, gap: GAP });
    const cols = COLUMNS[size];
    assert.equal(rows(tiles)[0].length, cols, size);
    for (const t of tiles) {
      assert.equal(t.w, t.h);
      assert.ok(t.x + t.w <= W, `${size}: tile past the right edge`);
    }
  }
});

test('fit to screen: one video per row, full width, its own shape', () => {
  const { tiles } = computeLayout([landscape('a'), portrait('b')], { style: 'grid', size: 'fit', width: W, gap: GAP });
  assert.equal(tiles[0].w, W);
  assert.equal(tiles[0].h, Math.round(W / (16 / 9)));
  assert.equal(tiles[1].h, Math.round(W / (9 / 16)));
  assert.equal(tiles[1].y, tiles[0].h + GAP);
});

test('natural: every full row fills the width exactly and keeps each shape', () => {
  const items = [landscape('a'), portrait('b'), square('c'), landscape('d'), portrait('e'), landscape('f'), square('g')];
  const { tiles } = computeLayout(items, { style: 'natural', size: 'large', width: W, gap: GAP });
  const all = rows(tiles);
  for (const row of all.slice(0, -1)) {
    const right = row[row.length - 1].x + row[row.length - 1].w;
    assert.equal(right, W, 'a full row should end at the right edge');
    for (const t of row) assert.equal(t.h, row[0].h, 'one height per row');
  }
  const last = all[all.length - 1];
  assert.ok(last[last.length - 1].x + last[last.length - 1].w <= W, 'last row is not stretched past the edge');
});

test('waterfall: each video goes into the shortest column', () => {
  const items = [portrait('tall'), landscape('wide1'), landscape('wide2'), landscape('wide3')];
  const { tiles } = computeLayout(items, { style: 'waterfall', size: 'large', width: W, gap: GAP });
  const colW = Math.floor((W - GAP * 2) / 3);
  assert.equal(tiles[0].w, colW);
  // Columns 2 and 3 are empty, so the next two go there, at the top.
  assert.equal(tiles[1].y, 0);
  assert.equal(tiles[2].y, 0);
  // The fourth goes under the shortest column (a landscape one), not under the tall portrait one.
  assert.notEqual(tiles[3].x, tiles[0].x);
  assert.ok(tiles[3].y > 0);
});

test('mosaic: a big 2x2 tile first, then the block is filled with small ones', () => {
  const { tiles } = computeLayout(many(20, square), { style: 'mosaic', size: 'large', width: W, gap: GAP });
  const unit = Math.floor((W - GAP * 2) / 3);
  assert.equal(tiles[0].w, unit * 2 + GAP, 'first tile is big');
  assert.equal(tiles[1].w, unit, 'then small tiles');
  assert.equal(tiles[1].x, unit * 2 + GAP * 2, 'small ones sit to the right of the big one');
  assert.equal(tiles[2].y, unit + GAP, 'second small one is under the first');
});

test('mosaic never leaves a hole when it runs out of videos', () => {
  const { tiles } = computeLayout(many(2, square), { style: 'mosaic', size: 'large', width: W, gap: GAP });
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].y, 0);
  assert.equal(tiles[1].y, 0, 'too few for a big block: one plain row');
});

test('every style lists tiles top to bottom (needed for fast windowing)', () => {
  const items = [...many(9, landscape), ...many(9, portrait).map((v, i) => ({ ...v, id: `p${i}` }))];
  for (const style of ['grid', 'natural', 'waterfall', 'mosaic']) {
    for (const size of ['small', 'medium', 'large', 'xlarge', 'fit']) {
      const { tiles } = computeLayout(items, { style, size, width: W, gap: GAP });
      assert.equal(tiles.length, items.length, `${style}/${size}: every video placed`);
      assert.ok(nonDecreasingY(tiles), `${style}/${size}: tiles out of order`);
    }
  }
});

test('only tiles near the screen are rendered', () => {
  const layout = computeLayout(many(300), { style: 'grid', size: 'large', width: W, gap: GAP });
  const shown = visibleTiles(layout, 1000, 1800);
  assert.ok(shown.length > 0 && shown.length < 40, `expected a screenful, got ${shown.length}`);
  for (const t of shown) assert.ok(t.y < 1800 && t.y + t.h > 1000);
  // Nothing in the band is missed.
  const brute = layout.tiles.filter((t) => t.y < 1800 && t.y + t.h > 1000);
  assert.equal(shown.length, brute.length);
});

test('odd or unknown sizes get a safe shape', () => {
  assert.equal(aspectRatio({ id: 'x', width: null, height: null }), 16 / 9);
  assert.equal(aspectRatio({ id: 'x', width: 10000, height: 10 }), 2.5);
  assert.equal(aspectRatio({ id: 'x', width: 10, height: 10000 }), 0.4);
});

test('the round header button cycles through every size', () => {
  const seen = new Set();
  let size = 'large';
  for (let i = 0; i < 5; i++) {
    seen.add(size);
    size = nextSize(size);
  }
  assert.equal(size, 'large');
  assert.equal(seen.size, 5);
});

test('thumbnail info labels', () => {
  const item = {
    filename: 'clip.mov',
    sizeBytes: 45 * 1024 * 1024,
    durationMs: 192000,
    width: 1920,
    height: 1080,
    createdAt: Date.UTC(2026, 9, 13, 12, 0),
    tagNames: ['holiday', 'nature'],
    albumIds: [1, 2],
    meta: { model: 'iPhone 15' },
  };
  assert.equal(fmtThumbInfo(item, 'duration'), '3:12');
  assert.equal(fmtThumbInfo(item, 'size'), '45 MB');
  assert.equal(fmtThumbInfo(item, 'dimensions'), '1920×1080');
  assert.equal(fmtThumbInfo(item, 'format'), 'MOV');
  assert.equal(fmtThumbInfo(item, 'filename'), 'clip.mov');
  assert.equal(fmtThumbInfo(item, 'keywords'), '#holiday #nature');
  assert.equal(fmtThumbInfo(item, 'device'), 'iPhone 15');
  assert.equal(fmtThumbInfo(item, 'albums', new Map([[1, 'Holiday'], [2, 'Family']])), 'Holiday, Family');
  assert.equal(fmtThumbInfo({ ...item, tagNames: [] }, 'keywords'), null);
  // Several at once, joined; empty ones are skipped.
  assert.equal(fmtThumbInfos({ ...item, tagNames: [] }, ['duration', 'keywords', 'size']), '3:12 · 45 MB');
  assert.equal(fmtThumbInfos(item, []), null);
});

test('grouping adds a title row per period and keeps tiles below it', () => {
  const sections = [
    { key: '2026-10', title: 'October 2026', items: many(4) },
    { key: '2026-09', title: 'September 2026', items: many(2).map((v, i) => ({ ...v, id: `s${i}` })) },
  ];
  const layout = computeSectionedLayout(sections, { style: 'grid', size: 'large', width: W, gap: GAP, headerHeight: 38 });
  assert.equal(layout.headers.length, 2);
  assert.equal(layout.headers[0].y, 0);
  assert.equal(layout.tiles[0].y, 38, 'first row sits under its title');
  const secondHeader = layout.headers[1].y;
  assert.ok(layout.tiles.filter((t) => t.id.startsWith('s')).every((t) => t.y >= secondHeader + 38));
  assert.ok(nonDecreasingY(layout.tiles));
});

test('no grouping means no title rows and the same tiles as a plain layout', () => {
  const plain = computeLayout(many(7), { style: 'grid', size: 'medium', width: W, gap: GAP });
  const one = computeSectionedLayout([{ key: 'all', title: '', items: many(7) }], {
    style: 'grid',
    size: 'medium',
    width: W,
    gap: GAP,
    headerHeight: 38,
  });
  assert.equal(one.headers.length, 0);
  assert.deepEqual(one.tiles, plain.tiles);
});
