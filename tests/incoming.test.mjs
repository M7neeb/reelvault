// Run with `npm test`. Videos sent from another app ("Open in ReelVault").
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { incomingName, isIncomingVideo, onIncoming, pushIncoming } from '../src/features/vault/incoming.ts';

test('only video files count', () => {
  assert.equal(isIncomingVideo('file:///var/mobile/Containers/Data/Application/X/Documents/Inbox/IMG_1234.MOV'), true);
  assert.equal(isIncomingVideo('file:///x/My%20trip.mp4'), true);
  assert.equal(isIncomingVideo('file:///x/notes.pdf'), false);
  assert.equal(isIncomingVideo('reelvault://simkl?code=1'), false);
  assert.equal(incomingName('file:///x/My%20trip.mp4'), 'My trip.mp4');
});

test('videos sent before anyone listens wait in the queue', () => {
  pushIncoming('file:///x/a.mov');
  pushIncoming('file:///x/a.mov');
  const got = [];
  const off = onIncoming((uris) => got.push(...uris));
  pushIncoming('file:///x/b.mp4');
  off();
  assert.deepEqual(got, ['file:///x/a.mov', 'file:///x/b.mp4']);
});
