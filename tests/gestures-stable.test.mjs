import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Screens that re-render many times a second while something plays (progress bars, timers). Gestures
// created on every render there are replaced mid-touch, and a tap that spans a re-render is dropped:
// "tapping the playing video doesn't hide the controls". Each must build its gestures once, in useMemo.
const PLAYING_SCREENS = ['src/features/vault/ui/ViewerModal.tsx', 'src/features/vault/ui/MemoriesUI.tsx', 'src/features/vault/ui/slideshow.tsx', 'src/features/vault/ui/Grid.tsx'];

/** The source of `const gestures = useMemo(...)`, up to its dependency list. */
function memoBlock(src) {
  const start = src.indexOf('const gestures = useMemo(');
  if (start < 0) return null;
  const end = src.indexOf('}, [', start);
  return end < 0 ? null : src.slice(start, end);
}

for (const file of PLAYING_SCREENS) {
  test(`${file.split('/').pop()}: the player's taps and swipes are built once, not on every render`, () => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const block = memoBlock(src);
    assert.ok(block, 'gestures are made inside useMemo');
    const all = src.match(/Gesture\.(Tap|Pan|LongPress|Pinch)\(\)/g) ?? [];
    const inside = block.match(/Gesture\.(Tap|Pan|LongPress|Pinch)\(\)/g) ?? [];
    assert.equal(inside.length, all.length, 'no player gesture is created outside the memo');
  });
}

test('FilmScrubber: the scrub drag is built once, so a drag survives the player redrawing', () => {
  const src = readFileSync(new URL('../src/features/vault/ui/FilmScrubber.tsx', import.meta.url), 'utf8');
  const start = src.indexOf('const pan = useMemo(');
  assert.ok(start >= 0, 'the pan gesture is made inside useMemo');
  const all = src.match(/Gesture\.Pan\(\)/g) ?? [];
  const inside = src.slice(start, src.indexOf('}, []);', start)).match(/Gesture\.Pan\(\)/g) ?? [];
  assert.equal(inside.length, all.length);
});
