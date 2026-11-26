import assert from 'node:assert/strict';
import { test } from 'node:test';

import { autoJoin } from '../src/features/vault/overview.ts';

const vid = (id, filename, over = {}) => ({
  id, title: null, filename, durationMs: 600000, sizeBytes: 1, rating: 0, status: null, notes: null, tagNames: [], thumb: null,
  createdAt: 1, importedAt: 1, where: 'library', removedAt: null, isPrivate: false, ...over,
});
const member = (videoId, seriesId, position) => ({ videoId, seriesId, position, label: null });

test('a new episode joins the series its name belongs to', () => {
  const videos = [vid('a', 'series beries 1.mp4'), vid('b', 'series beries 2.mp4'), vid('c', 'series beries 3.mp4'), vid('d', 'Holiday.mp4')];
  const out = autoJoin(videos, [member('a', 's1', 1), member('b', 's1', 2)]);
  assert.deepEqual(out, [{ seriesId: 's1', videoIds: ['c'] }]);
});

test('names you never grouped stay alone (sd 1, sd 2 are separate videos)', () => {
  const videos = [vid('a', 'sd 1.mp4'), vid('b', 'sd 2.mp4'), vid('c', 'sd 3.mp4')];
  assert.deepEqual(autoJoin(videos, []), []);
});

test('several new episodes go in name order; private and deleted ones stay out', () => {
  const videos = [
    vid('a', 'Show_01.mp4'),
    vid('c', 'Show_10.mp4'),
    vid('b', 'Show_02.mp4'),
    vid('p', 'Show_03.mp4', { isPrivate: true }),
    vid('t', 'Show_04.mp4', { where: 'trash' }),
  ];
  assert.deepEqual(autoJoin(videos, [member('a', 's', 1)]), [{ seriesId: 's', videoIds: ['b', 'c'] }]);
});

test('a name that matches two series is left for you to choose', () => {
  const videos = [vid('a', 'clip 1.mp4'), vid('b', 'clip 2.mp4'), vid('c', 'clip 3.mp4')];
  assert.deepEqual(autoJoin(videos, [member('a', 's1', 1), member('b', 's2', 1)]), []);
});

test('a series of names without numbers (a plain "Holiday") pulls nothing in', () => {
  const videos = [vid('a', 'Holiday.mp4'), vid('b', 'Holiday.mp4')];
  assert.deepEqual(autoJoin(videos, [member('a', 's', 1)]), []);
});
