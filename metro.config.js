// Metro configuration for ReelVault.
//
// WHY THIS FILE EXISTS
// expo-sqlite's web build imports `wa-sqlite.wasm`:
//
//   node_modules/expo-sqlite/web/worker.ts
//    └─ import "./wa-sqlite/wa-sqlite.wasm"
//
// Metro does not treat `.wasm` as an asset by default, so every WEB bundle died
// with "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm" and the app could
// only ever be run on a real device.
//
// That mattered more than it looked. On iOS the app can only be checked by
// loading it on a phone - meaning no render loop, and UI work done blind. With
// web working, the same components render in a browser where they can be
// screenshotted and compared against the design at phone dimensions, and only
// the genuinely native parts (video, file system) need a device.
//
// `.wasm` is an ASSET: a file to copy and serve, not a module to transform.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
