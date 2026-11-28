import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// On the iPhone a Tap's maxDuration timer keeps running after the finger lifts. A single tap that waits
// for a double tap to fail (maxDelay after lifting) is switched off by that timer first, so it never
// fires: "tapping the playing video doesn't hide the controls". A single tap behind a double tap must
// not have a maxDuration (a held finger is the hold gesture's job).
const FILES = ['src/features/vault/ui/ViewerModal.tsx', 'src/features/vault/ui/manga/ZoomStrip.tsx', 'src/features/vault/ui/slideshow.tsx'];

/** The chained calls of `const name = Gesture.Tap()...;` */
function definition(src, name) {
  const start = src.indexOf(`const ${name} = Gesture.`);
  if (start < 0) return '';
  return src.slice(start, src.indexOf(';', start));
}

for (const file of FILES) {
  test(`${file.split('/').pop()}: a single tap behind a double tap has no time limit`, () => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [, first, second] of src.matchAll(/Gesture\.Exclusive\((\w+),\s*(\w+)\)/g)) {
      if (!definition(src, first).includes('numberOfTaps(2)')) continue;
      assert.doesNotMatch(definition(src, second), /maxDuration\(/, `${second} waits for ${first}`);
    }
  });
}
