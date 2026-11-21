import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Screens under a ui/ folder must render in the browser preview, so they never import a native
// module. expo-video is the one exception, and VideoMap.tsx is the one allowed native view.
// (expo-clipboard and expo-image work in the browser too, so they are fine.)
const NATIVE = /from '(expo-sqlite|expo-file-system|expo-document-picker|expo-local-authentication|expo-secure-store|expo-media-library|expo-image-picker|expo-crypto|expo-notifications|expo-sharing)[^']*'/;
const ALLOWED = new Set(['VideoMap.tsx']);

function uiFiles(dir, inUi = false) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...uiFiles(path, inUi || name === 'ui'));
    else if (inUi && /\.tsx?$/.test(name) && !ALLOWED.has(name)) out.push(path);
  }
  return out;
}

test('no screen under a ui/ folder imports a native module', () => {
  const files = uiFiles('src/features');
  assert.ok(files.length > 50);
  const bad = files.filter((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .some((line) => NATIVE.test(line) && !/^import type /.test(line.trim()))
  );
  assert.deepEqual(bad, []);
});
