// Run with `npm test`. HashPhotos' metadata export read back into ReelVault.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCsv, parseMetadataFile, planMetadata } from '../src/features/vault/hashphotos.ts';

const lib = [
  { id: 'a', filename: 'IMG_0001.MOV', title: null, notes: null, rating: 0, tagNames: ['beach'], flag: 0 },
  { id: 'b', filename: 'IMG_0002.mp4', title: 'Mine', notes: null, rating: 6, tagNames: [], flag: 0 },
];

test('CSV with quotes, keywords and 5-star ratings', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  const f = parseMetadataFile('File Name,Keywords,Rating,Caption\nIMG_0001.mov,"Beach; Summer",4,Sunny day\n/x/IMG_0002.MP4,Family,5,\nmissing.mov,x,1,\n');
  assert.equal(f.format, 'csv');
  assert.deepEqual(f.recognised.sort(), ['caption', 'filename', 'keywords', 'rating']);
  assert.equal(f.records[0].rating, 8);
  assert.deepEqual(f.records[0].keywords, ['Beach', 'Summer']);
  const plan = planMetadata(f, lib);
  assert.equal(plan.matched, 2);
  assert.deepEqual(plan.unmatched, ['missing.mov']);
  const a = plan.changes.find((c) => c.videoId === 'a');
  assert.deepEqual(a.addKeywords, ['Summer']);
  assert.equal(a.rating, 8);
  assert.equal(a.caption, 'Sunny day');
  // b already has a rating: kept unless overwrite.
  assert.equal(plan.changes.find((c) => c.videoId === 'b').rating, null);
  assert.equal(planMetadata(f, lib, true).changes.find((c) => c.videoId === 'b').rating, 10);
});

test('JSON and XML exports', () => {
  const j = parseMetadataFile(JSON.stringify({ items: [{ filename: 'IMG_0001', tags: ['Holiday', 'Sea'], rating: 9, title: 'Sea' }] }));
  assert.equal(j.format, 'json');
  assert.equal(j.records[0].rating, 9);
  assert.equal(planMetadata(j, lib).changes[0].title, 'Sea');
  const x = parseMetadataFile('<?xml version="1.0"?><items><item><filename>IMG_0002.mp4</filename><keywords><string>Dog</string><string>Park</string></keywords><rating>3</rating></item><item filename="IMG_0001.MOV"><description>Waves &amp; sand</description></item></items>');
  assert.equal(x.format, 'xml');
  assert.equal(x.records.length, 2);
  assert.deepEqual(x.records[0].keywords, ['Dog', 'Park']);
  assert.equal(x.records[1].caption, 'Waves & sand');
  assert.equal(parseMetadataFile('nothing useful'), null);
});
