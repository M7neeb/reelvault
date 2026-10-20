// Run with `npm test`. HashPhotos' metadata export read back into ReelVault.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dateOf, parseCsv, parseMetadataFile, planMetadata } from '../src/features/vault/hashphotos.ts';

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

test('finding the video when Files or Windows changed its name, and counting pictures apart', async () => {
  const { looseName } = await import('../src/features/vault/hashphotos.ts');
  assert.equal(looseName('Clip: the "best" one?.mp4'), looseName('Clip the best one.mp4'));
  assert.equal(looseName('IMG_0001 2.MOV'), looseName('IMG_0001.MOV'));
  const t = (id, filename, extra = {}) => ({ id, filename, title: null, notes: null, rating: 0, tagNames: [], flag: 0, ...extra });
  const library = [
    t('a', 'IMG_0001.MOV'),
    t('b', 'IMG_0001 2.MOV'),
    t('c', 'What_ a day.mp4'),
    t('d', 'renamed.mp4', { sizeBytes: 5000 }),
    t('e', 'Part 1.mp4'),
    t('f', 'Part 2.mp4'),
  ];
  const f = parseMetadataFile(
    'Filename,Keywords,File Size\nIMG_0001.MOV,one,\nIMG_0001.MOV,two,\nWhat? a day.mp4,x,\noriginal.mp4,y,5000\nPart 1.mp4,,\nPart 2.mp4,,\nphoto.JPG,z,\nnot-here.mp4,,\n'
  );
  const plan = planMetadata(f, library);
  assert.equal(plan.matched, 6);
  assert.deepEqual(plan.unmatched, ['not-here.mp4']);
  assert.deepEqual(plan.pictures, ['photo.JPG']);
  // The two rows called IMG_0001.MOV went to the two videos, one each.
  assert.deepEqual(plan.changes.find((c) => c.videoId === 'a').addKeywords, ['one']);
  assert.deepEqual(plan.changes.find((c) => c.videoId === 'b').addKeywords, ['two']);
  assert.deepEqual(plan.changes.find((c) => c.videoId === 'd').addKeywords, ['y']);
  // A loose name shared by two videos is never guessed.
  const g = parseMetadataFile('Filename\nPart 3.mp4\n');
  assert.deepEqual(planMetadata(g, library).unmatched, ['Part 3.mp4']);
});

test('HashPhotos dates: read in every common way, and set so the library is in the same order', () => {
  const local = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
  assert.equal(dateOf('2021-05-03 14:22:11'), local(2021, 5, 3, 14, 22, 11));
  assert.equal(dateOf('2021:05:03 14:22:11'), local(2021, 5, 3, 14, 22, 11));
  assert.equal(dateOf('2021-05-03T14:22:11Z'), Date.UTC(2021, 4, 3, 14, 22, 11));
  assert.equal(dateOf('2021-05-03T14:22:11+02:00'), Date.UTC(2021, 4, 3, 12, 22, 11));
  assert.equal(dateOf('5/3/2021, 2:22 PM'), local(2021, 5, 3, 14, 22));
  assert.equal(dateOf('25/3/2021 09:05'), local(2021, 3, 25, 9, 5));
  assert.equal(dateOf('03.05.2021 14:22'), local(2021, 5, 3, 14, 22));
  assert.equal(dateOf('1620051731'), 1620051731000);
  assert.equal(dateOf('1620051731000'), 1620051731000);
  assert.equal(dateOf('soon'), null);
  assert.equal(dateOf('2021-13-40'), null);

  // The filming date wins over the date it was added, whatever the column order.
  const f = parseMetadataFile('Filename,Date Added,Creation Date\na.mov,2024-01-01 10:00,2019-07-04 18:30\nb.mov,2024-01-01 10:00,\n');
  assert.ok(f.recognised.includes('takenAt'));
  assert.equal(f.records[0].takenAt, local(2019, 7, 4, 18, 30));
  assert.equal(f.records[1].takenAt, local(2024, 1, 1, 10, 0));
  const lib = [
    { id: 'a', filename: 'a.mov', title: null, notes: null, rating: 0, tagNames: [], flag: 0, createdAt: Date.now() },
    { id: 'b', filename: 'b.mov', title: null, notes: null, rating: 0, tagNames: [], flag: 0, createdAt: local(2024, 1, 1, 10, 0) },
  ];
  const plan = planMetadata(f, lib);
  assert.equal(plan.dates, 1);
  assert.deepEqual(plan.changes.map((c) => [c.videoId, c.date]), [['a', local(2019, 7, 4, 18, 30)]]);
});

test('column names with a standard in front, nested JSON and XMP lists are read', () => {
  const t = (id, filename, extra = {}) => ({ id, filename, title: null, notes: null, rating: 0, tagNames: [], flag: 0, ...extra });
  const library = [t('a', 'IMG_0001.MOV'), t('b', 'IMG_0002.mp4', { tagNames: ['dog'] })];
  const c = parseMetadataFile('File Name,IPTC:Keywords,XMP:Rating,Caption-Abstract\nIMG_0001.MOV,Beach;Sun,★★★,Hi\nIMG_0002.mp4,Dog,,\n');
  assert.deepEqual(c.recognised.sort(), ['caption', 'filename', 'keywords', 'rating']);
  assert.equal(c.records[0].rating, 6);
  const plan = planMetadata(c, library);
  assert.equal(plan.keywords, 2);
  assert.equal(plan.withKeywords, 2);
  assert.equal(plan.keywordsAlreadyThere, 1);
  const j = parseMetadataFile(JSON.stringify([{ file: { name: 'IMG_0001.MOV' }, metadata: { 'Keyword List': [{ name: 'Holiday' }], 'Star Rating': '4 stars' } }]));
  assert.deepEqual(j.records[0].keywords, ['Holiday']);
  assert.equal(j.records[0].filename, 'IMG_0001.MOV');
  assert.equal(j.records[0].rating, 8);
  const x = parseMetadataFile('<x:xmpmeta><rdf:RDF><rdf:Description rdf:about="IMG_0001.MOV" xmp:Rating="5"><dc:subject><rdf:Bag><rdf:li>Sea</rdf:li><rdf:li>Boat</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>');
  assert.deepEqual(x.records[0].keywords, ['Sea', 'Boat']);
  assert.equal(x.records[0].rating, 10);
});

test("HashPhotos' own export: IPTC.Keywords, IPTC.StarRating, IPTC.ObjectName and Memo (CSV and nested JSON)", () => {
  const csv = parseMetadataFile('FileName,CreationDate,ModificationDate,Memo,IPTC.Byline,IPTC.Keywords,IPTC.ObjectName,IPTC.StarRating,Exif.DateTimeOriginal\nIMG_0001.MOV,2026-10-04T21:43:52Z,2026-10-08T17:57:32Z,A memo,Me,"Irl, Reddit/X",My title,4,2026:10:04 23:43:52\n');
  const json = parseMetadataFile(JSON.stringify([{ CreationDate: '2026-10-04T21:43:52Z', Exif: { DateTimeOriginal: '2026:10:04 23:43:52' }, FileName: 'IMG_0001.MOV', IPTC: { Keywords: ['Irl', 'Reddit/X'], ObjectName: 'My title', StarRating: 4 }, Memo: 'A memo' }]));
  for (const f of [csv, json]) {
    const r = f.records[0];
    assert.deepEqual(r.keywords, ['Irl', 'Reddit/X']);
    assert.equal(r.rating, 8);
    assert.equal(r.title, 'My title');
    assert.equal(r.caption, 'A memo');
    // CreationDate (the moment it was filmed) wins over the modified date and the camera's local clock.
    assert.equal(r.takenAt, Date.UTC(2026, 9, 4, 21, 43, 52));
  }
});
