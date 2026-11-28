import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// A game saves its score as it ends, so by the time the end screen shows, `best` already holds this
// game's score: "8 points, your best is 8" instead of "A new best". Every end screen must compare with
// the best from before the game (kept in a ref while playing).
const FILES = ['src/features/vault/ui/gamesKit.tsx', 'src/features/vault/ui/GamesModal.tsx'];

for (const file of FILES) {
  test(`${file.split('/').pop()}: end screens compare with the best from before the game`, () => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const ends = [...src.matchAll(/<(Finished|Done)\b[\s\S]*?\/>/g)].map((m) => m[0]);
    assert.ok(ends.length > 0);
    for (const end of ends) {
      assert.doesNotMatch(end, /best=\{best\}|record=\{score > best\}|best \?/, end.slice(0, 80));
    }
  });
}
