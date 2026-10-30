// Run with `npm test`. Sending how far you read back to Suwayomi, Komga and Kavita.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { kavitaProgress, komgaProgress, progressTarget, suwayomiProgress } from '../src/features/vault/manga/sources/progressSync.ts';

const pse = (href) => `pse:${JSON.stringify({ href, count: 20 })}`;

test('where a chapter lives: Suwayomi, Komga, Kavita, or nowhere', () => {
  assert.deepEqual(progressTarget('server:ab12:library', '4711'), { kind: 'suwayomi', serverId: 'ab12', chapterId: 4711 });
  assert.deepEqual(progressTarget('server:k1', pse('http://nas:25600/api/v1/books/0ABC123/pages/{pageNumber}?zero_based=true')), {
    kind: 'komga',
    serverId: 'k1',
    url: 'http://nas:25600/api/v1/books/0ABC123/read-progress',
  });
  assert.deepEqual(
    progressTarget('server:kv', pse('https://kavita.home/api/opds/key%2D9/image?libraryId=1&seriesId=22&volumeId=33&chapterId=44&pageNumber={pageNumber}')),
    { kind: 'kavita', serverId: 'kv', base: 'https://kavita.home', apiKey: 'key-9', libraryId: 1, seriesId: 22, volumeId: 33, chapterId: 44 }
  );
  assert.equal(progressTarget('mangadex', 'abc'), null);
  assert.equal(progressTarget('server:x', 'file:/books/1.cbz'), null);
  assert.equal(progressTarget('server:x', 'pse:not json'), null);
  assert.equal(progressTarget(null, '12'), null);
});

test('what is sent: page numbers each server expects', () => {
  assert.deepEqual(suwayomiProgress(9, 4.2, false).variables, { id: 9, read: false, page: 4 });
  assert.deepEqual(JSON.parse(komgaProgress(4, false)), { page: 5, completed: false });
  assert.deepEqual(JSON.parse(komgaProgress(19, true)), { completed: true });
  const t = progressTarget('server:kv', pse('https://k/api/opds/key/image?libraryId=1&seriesId=2&volumeId=3&chapterId=4&pageNumber={pageNumber}'));
  assert.deepEqual(JSON.parse(kavitaProgress(t, 6, 20, false)), { libraryId: 1, seriesId: 2, volumeId: 3, chapterId: 4, pageNum: 6 });
  assert.equal(JSON.parse(kavitaProgress(t, 19, 20, true)).pageNum, 20);
});
