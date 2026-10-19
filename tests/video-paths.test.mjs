// Run with `npm test`. Video addresses after iOS moves the app's folder, and videos left in the Inbox.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { relocateVideoUri, strandedInbox } from '../src/features/vault/videoPaths.ts';

const OLD = 'file:///var/mobile/Containers/Data/Application/AAAA-1111/Documents/videos/';
const NOW = 'file:///var/mobile/Containers/Data/Application/BBBB-2222/Documents/videos/';

test('an address from before an update points at the videos folder where it is now', () => {
  assert.equal(relocateVideoUri(`${OLD}0b3c-uuid.mov`, NOW), `${NOW}0b3c-uuid.mov`);
  assert.equal(relocateVideoUri(`${OLD}x.mp4`, NOW.slice(0, -1)), `${NOW}x.mp4`);
  // Already right: unchanged.
  assert.equal(relocateVideoUri(`${NOW}x.mp4`, NOW), `${NOW}x.mp4`);
});

test('addresses that are not ReelVault video files are left alone', () => {
  assert.equal(relocateVideoUri('file:///private/var/mobile/Containers/Shared/x.mov', NOW), 'file:///private/var/mobile/Containers/Shared/x.mov');
  assert.equal(relocateVideoUri('https://example.com/Documents/videos/x.mp4/more', NOW), 'https://example.com/Documents/videos/x.mp4/more');
  assert.equal(relocateVideoUri('', NOW), '');
  assert.equal(relocateVideoUri(`${OLD}x.mov`, ''), `${OLD}x.mov`);
});

test('videos left in the Inbox are found, oldest first; new arrivals and other files are not', () => {
  const now = 10_000_000;
  const entries = [
    { name: 'IMG_2.MOV', modified: now - 600_000, dir: false },
    { name: 'IMG_1.mp4', modified: now - 900_000, dir: false },
    { name: 'just-sent.mov', modified: now - 30_000, dir: false },
    { name: 'notes.txt', modified: now - 900_000, dir: false },
    { name: 'folder.mov', modified: now - 900_000, dir: true },
  ];
  assert.deepEqual(strandedInbox(entries, now), ['IMG_1.mp4', 'IMG_2.MOV']);
  assert.deepEqual(strandedInbox([], now), []);
});
