// Run with `npm test`. The Audio section's file reading: ZIP (EPUB) streaming, XML, EPUB 3 + media overlays, audio tags.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8, strFromU8 } from 'fflate';

import { crc32, extractEntry, readEntryText, readZipIndex, safeEntryPath, zipWriter } from '../src/features/vault/audio/zip.ts';
import { decodeEntities, findAll, parseXml, textOf } from '../src/features/vault/audio/xml.ts';
import { assembleBook, chapterBlocks, clipAt, clipFor, firstClipOf, parseClock, parseNav, parseNcx, parsePackage, parseSmil, resolveHref, rootfileOf } from '../src/features/vault/audio/epub.ts';
import { readAudioTags } from '../src/features/vault/audio/audioTags.ts';
import { audioKindOf, sortTracks, titleFromName, trackNumberOf } from '../src/features/vault/audio/formats.ts';

const source = (bytes) => ({ size: bytes.length, read: (o, n) => bytes.subarray(o, o + n) });

test('crc32 matches the standard value', () => {
  assert.equal(crc32(strToU8('123456789')), 0xcbf43926);
  // Running CRC over chunks equals one pass.
  assert.equal(crc32(strToU8('6789'), crc32(strToU8('12345'))), 0xcbf43926);
});

test('a ZIP is read from its directory and each entry streamed out in small chunks (stored and deflated)', async () => {
  const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
  const zip = zipSync({ mimetype: [strToU8('application/epub+zip'), { level: 0 }], 'OEBPS/text.xhtml': strToU8('<p>hello '.repeat(5000)), 'audio/a.mp3': [big, { level: 0 }], 'deflated.bin': [big, { level: 9 }] });
  const src = source(zip);
  const entries = readZipIndex(src);
  assert.deepEqual(entries.map((e) => e.name).sort(), ['OEBPS/text.xhtml', 'audio/a.mp3', 'deflated.bin', 'mimetype']);
  assert.equal(await readEntryText(src, entries.find((e) => e.name === 'mimetype')), 'application/epub+zip');
  for (const name of ['audio/a.mp3', 'deflated.bin']) {
    const e = entries.find((x) => x.name === name);
    const parts = [];
    await extractEntry(src, e, (b) => parts.push(b.slice()), 4096);
    // Stored data comes out chunk by chunk (memory stays flat whatever the size).
    if (e.method === 0) assert.ok(parts.length > 5, 'came out in many chunks');
    const all = Buffer.concat(parts.map((p) => Buffer.from(p)));
    assert.equal(all.length, big.length);
    assert.ok(all.equals(Buffer.from(big)));
  }
  assert.ok((await readEntryText(src, entries.find((e) => e.name === 'OEBPS/text.xhtml'))).startsWith('<p>hello <p>hello'));
});

test('a damaged entry is refused (checksum)', async () => {
  const zip = zipSync({ 'a.txt': [strToU8('some text that will be damaged'), { level: 0 }] });
  const e = readZipIndex(source(zip))[0];
  const bad = zip.slice();
  bad[e.localOffset + 30 + 5 + 3] ^= 0xff;
  await assert.rejects(() => extractEntry(source(bad), e, () => undefined), /damaged/);
});

test('our ZIP writer makes files any reader (and ours) can open', async () => {
  const chunks = [];
  const w = zipWriter((b) => chunks.push(b.slice()));
  w.addStored('mimetype', strToU8('application/epub+zip'));
  await w.add('OEBPS/ch1.xhtml', function* () {
    yield strToU8('<html>');
    yield strToU8('<body>Hi</body></html>');
  });
  await w.add('audio/big.bin', async function* () {
    for (let i = 0; i < 10; i++) yield new Uint8Array(50_000).fill(i);
  });
  w.finish();
  const zip = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const entries = readZipIndex(source(zip));
  assert.deepEqual(entries.map((e) => e.name), ['mimetype', 'OEBPS/ch1.xhtml', 'audio/big.bin']);
  assert.equal(await readEntryText(source(zip), entries[1]), '<html><body>Hi</body></html>');
  const out = [];
  await extractEntry(source(zip), entries[2], (b) => out.push(b.slice()));
  assert.equal(out.reduce((a, b) => a + b.length, 0), 500_000);
  // The mimetype is first, stored, right after a 30-byte header and its name (what EPUB requires).
  assert.equal(strFromU8(zip.subarray(38, 58)), 'application/epub+zip');
});

test('paths inside a ZIP never escape the book folder', () => {
  assert.equal(safeEntryPath('OEBPS/./text/ch1.xhtml'), 'OEBPS/text/ch1.xhtml');
  assert.equal(safeEntryPath('../../etc/passwd'), null);
  assert.equal(safeEntryPath('/abs/x'), 'abs/x');
  assert.equal(safeEntryPath('C:/x'), null);
  assert.equal(safeEntryPath(''), null);
});

test('XML: entities, comments, CDATA, sloppy closing tags, namespaces', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#233; &#x263A; &nbsp;'), 'a & b <c> é ☺ \u00a0');
  const doc = parseXml('<?xml version="1.0"?><!-- c --><smil:par a="1" b=\'2\'><x/><p>one <b>two</b><br>three</p><![CDATA[<raw>]]></smil:par>');
  const par = findAll(doc, 'par')[0];
  assert.deepEqual(par.attrs, { a: '1', b: '2' });
  assert.equal(textOf(par), 'one twothree<raw>');
  // A missing </li> does not swallow the rest.
  const list = parseXml('<ul><li>a<li>b</ul><p>after</p>');
  assert.equal(findAll(list, 'p').length, 1);
});

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>My Own Book</dc:title><dc:creator>Muneeb</dc:creator><dc:language>en</dc:language>
    <meta property="media:duration">0:01:30.500</meta>
    <meta property="media:duration" refines="#ch1-smil">0:00:45</meta>
    <meta property="media:narrator">Muneeb</meta>
    <meta property="media:active-class">-epub-media-overlay-active</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cov" href="images/cover%20art.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml" media-overlay="ch1-smil"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml" media-overlay="ch2-smil"/>
    <item id="ch1-smil" href="smil/ch1.smil" media-type="application/smil+xml"/>
    <item id="ch2-smil" href="smil/ch2.smil" media-type="application/smil+xml"/>
    <item id="a1" href="audio/ch1.mp3" media-type="audio/mpeg"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`;
const SMIL1 = `<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq>
  <par id="p1"><text src="../text/ch1.xhtml#s1"/><audio src="../audio/ch1.mp3" clipBegin="0s" clipEnd="2.5s"/></par>
  <par id="p2"><text src="../text/ch1.xhtml#s2"/><audio src="../audio/ch1.mp3" clipBegin="0:00:02.500" clipEnd="0:00:06"/></par>
  <seq><par><text src="../text/ch1.xhtml#s3"/><audio src="../audio/ch1.mp3" clipBegin="6s"/></par></seq>
</seq></body></smil>`;
const SMIL2 = `<smil><body><par><text src="../text/ch2.xhtml#t1"/><audio src="../audio/ch2.mp3" clipBegin="1:02.5" clipEnd="1:05"/></par></body></smil>`;
const NAV = `<html><body><nav epub:type="toc"><ol><li><a href="text/ch1.xhtml">One</a><ol><li><a href="text/ch1.xhtml#s3">One, part two</a></li></ol></li><li><a href="text/ch2.xhtml">Two</a></li></ol></nav></body></html>`;
const CH1 = `<html><head><title>x</title><style>p{}</style></head><body>
  <section id="sec"><h1 id="h">Chapter <em>One</em></h1>
  <p><span id="s1">The first   sentence.</span> <span id="s2">The <b>second</b> one.</span></p>
  <p id="s3">A whole paragraph &amp; more.</p>
  <img src="../images/pic.png" alt="A picture"/>
  <hr/><div>Loose text in a div</div></section></body></html>`;

test('EPUB 3: package, cover, nav, media overlays and read-along blocks', () => {
  assert.equal(rootfileOf('<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), 'OEBPS/content.opf');
  assert.equal(resolveHref('OEBPS/smil/ch1.smil', '../text/ch1.xhtml#s1'), 'OEBPS/text/ch1.xhtml');
  assert.equal(parseClock('0:00:02.500'), 2500);
  assert.equal(parseClock('1:02.5'), 62500);
  assert.equal(parseClock('500ms'), 500);
  assert.equal(parseClock('1.5min'), 90000);
  assert.equal(parseClock('3'), 3000);
  assert.equal(parseClock('nonsense'), null);

  const pkg = parsePackage(OPF, 'OEBPS/content.opf');
  assert.equal(pkg.meta.title, 'My Own Book');
  assert.deepEqual(pkg.meta.authors, ['Muneeb']);
  assert.deepEqual(pkg.meta.narrators, ['Muneeb']);
  assert.equal(pkg.meta.durationMs, 90500);
  assert.equal(pkg.meta.activeClass, '-epub-media-overlay-active');
  assert.equal(pkg.cover, 'OEBPS/images/cover art.jpg');
  assert.equal(pkg.nav, 'OEBPS/nav.xhtml');
  assert.deepEqual(pkg.spine.map((s) => s.href), ['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml']);

  const s1 = parseSmil(SMIL1, 'OEBPS/smil/ch1.smil');
  assert.deepEqual(s1.map((p) => [p.id, p.begin, p.end]), [['s1', 0, 2500], ['s2', 2500, 6000], ['s3', 6000, null]]);
  const overlays = new Map([['OEBPS/smil/ch1.smil', s1], ['OEBPS/smil/ch2.smil', parseSmil(SMIL2, 'OEBPS/smil/ch2.smil')]]);
  const toc = parseNav(NAV, 'OEBPS/nav.xhtml');
  assert.deepEqual(toc.map((t) => [t.title, t.depth]), [['One', 0], ['One, part two', 1], ['Two', 0]]);

  const book = assembleBook(pkg, overlays, toc);
  assert.deepEqual(book.tracks.map((t) => t.file), ['OEBPS/audio/ch1.mp3', 'OEBPS/audio/ch2.mp3']);
  assert.deepEqual(book.chapters.map((c) => [c.title, c.overlay]), [['One', true], ['Two', true]]);
  assert.equal(book.clips.length, 4);
  // The open end of s3 is closed after 10 s.
  assert.equal(book.clips[2].e, 16000);
  assert.equal(book.toc[1].id, 's3');

  // The clip being read at a time, a little after it ends (a pause), and in another track.
  assert.equal(book.clips[clipAt(book.clips, 0, 3000)].id, 's2');
  assert.equal(book.clips[clipAt(book.clips, 0, 0)].id, 's1');
  assert.equal(clipAt(book.clips, 0, 40000), -1);
  assert.equal(book.clips[clipAt(book.clips, 1, 63000)].id, 't1');
  assert.equal(clipAt(book.clips, 1, 100), -1);
  assert.equal(clipFor(book.clips, 0, 's2').b, 2500);
  assert.equal(firstClipOf(book.clips, 1).id, 't1');

  const { blocks, ids } = chapterBlocks(CH1, 'OEBPS/text/ch1.xhtml');
  assert.deepEqual(blocks.map((b) => b.k), ['h1', 'p', 'p', 'img', 'hr', 'p']);
  assert.deepEqual(blocks[0].runs, [{ t: 'Chapter ', id: 'h' }, { t: 'One', id: 'h', i: 1 }]);
  assert.deepEqual(blocks[1].runs, [{ t: 'The first sentence.', id: 's1' }, { t: ' ', id: 'sec' }, { t: 'The ', id: 's2' }, { t: 'second', id: 's2', b: 1 }, { t: ' one.', id: 's2' }]);
  assert.equal(blocks[2].runs[0].t, 'A whole paragraph & more.');
  assert.equal(blocks[3].src, 'OEBPS/images/pic.png');
  assert.equal(blocks[5].runs[0].t, 'Loose text in a div');
  assert.equal(ids.s1, 1);
  assert.equal(ids.s2, 1);
  assert.equal(ids.s3, 2);
  assert.equal(ids.sec, 0);
});

test('EPUB 2 table of contents (NCX)', () => {
  const ncx = `<ncx><navMap><navPoint><navLabel><text>Start</text></navLabel><content src="text/ch1.xhtml"/><navPoint><navLabel><text>Inner</text></navLabel><content src="text/ch1.xhtml#x"/></navPoint></navPoint></navMap></ncx>`;
  assert.deepEqual(parseNcx(ncx, 'OEBPS/toc.ncx'), [
    { title: 'Start', href: 'OEBPS/text/ch1.xhtml', depth: 0 },
    { title: 'Inner', href: 'OEBPS/text/ch1.xhtml#x', depth: 1 },
  ]);
});

/* ------------------------------------------------------------ audio tags */

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ss = (n) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const frame23 = (id, body) => [...strToU8(id), ...be32(body.length), 0, 0, ...body];
const text23 = (id, s) => frame23(id, [3, ...strToU8(s)]);

test('MP3 ID3v2.3: title, artist, album, year, cover and CHAP chapters', () => {
  const jpeg = new Array(200).fill(0xab);
  const apic = frame23('APIC', [0, ...strToU8('image/jpeg'), 0, 3, ...strToU8('cover'), 0, ...jpeg]);
  const chap = (id, start, title) => frame23('CHAP', [...strToU8(id), 0, ...be32(start), ...be32(start + 1000), ...be32(0xffffffff), ...be32(0xffffffff), ...text23('TIT2', title)]);
  const frames = [...text23('TIT2', 'Book One'), ...text23('TPE1', 'Muneeb'), ...text23('TALB', 'My Series'), ...text23('TYER', '2026'), ...text23('TRCK', '3/12'), ...apic, ...chap('c2', 60000, 'Second'), ...chap('c1', 0, 'First')];
  // UTF-16 with BOM for one frame.
  const utf16 = frame23('TCON', [1, 0xff, 0xfe, ...Array.from('Spoken').flatMap((c) => [c.charCodeAt(0), 0])]);
  const all = [...frames, ...utf16];
  const file = Uint8Array.from([...strToU8('ID3'), 3, 0, 0, ...ss(all.length), ...all, ...new Array(500).fill(0)]);
  const t = readAudioTags(source(file));
  assert.equal(t.title, 'Book One');
  assert.equal(t.artist, 'Muneeb');
  assert.equal(t.album, 'My Series');
  assert.equal(t.year, 2026);
  assert.equal(t.track, 3);
  assert.equal(t.genre, 'Spoken');
  assert.equal(t.cover.mime, 'image/jpeg');
  assert.equal(t.cover.bytes.length, 200);
  assert.deepEqual(t.chapters, [{ title: 'First', startMs: 0 }, { title: 'Second', startMs: 60000 }]);
});

test('MP3 with only an ID3v1 tag at the end', () => {
  const tag = new Uint8Array(128);
  tag.set(strToU8('TAG'), 0);
  tag.set(strToU8('Old Title'), 3);
  tag.set(strToU8('Old Artist'), 33);
  tag.set(strToU8('1999'), 93);
  const file = Uint8Array.from([0xff, 0xfb, ...new Array(1000).fill(0), ...tag]);
  const t = readAudioTags(source(file));
  assert.equal(t.title, 'Old Title');
  assert.equal(t.artist, 'Old Artist');
  assert.equal(t.year, 1999);
});

const box = (type, body) => [...be32(8 + body.length), ...strToU8(type), ...body];
test('M4B audiobook: ilst tags, cover, length and Nero chapters', () => {
  const data = (s) => box('data', [0, 0, 0, 1, 0, 0, 0, 0, ...strToU8(s)]);
  const covr = box('covr', box('data', [0, 0, 0, 13, 0, 0, 0, 0, ...new Array(300).fill(7)]));
  const ilst = box('ilst', [...box('\u00a9nam'.replace('\u00a9', '\u00a9'), []).slice(0, 0), ...[0xa9, 0x6e, 0x61, 0x6d].reduce(() => [], []), ...boxRaw([0xa9, 0x6e, 0x61, 0x6d], data('The Audiobook')), ...boxRaw([0xa9, 0x41, 0x52, 0x54], data('Author Name')), ...box('aART', data('Narr')), ...covr]);
  const meta = box('meta', [0, 0, 0, 0, ...ilst]);
  const title = (s) => [...strToU8(s)];
  const ch = (t100, s) => [...be32(Math.floor(t100 / 2 ** 32)), ...be32(t100 % 2 ** 32), s.length, ...title(s)];
  const chpl = box('chpl', [1, 0, 0, 0, 0, 0, 0, 0, 2, ...ch(0, 'Intro'), ...ch(600_000_000, 'Chapter 1')]);
  const udta = box('udta', [...chpl, ...meta]);
  const mvhd = box('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(3_600_000), ...new Array(80).fill(0)]);
  const moov = box('moov', [...mvhd, ...udta]);
  const file = Uint8Array.from([...box('ftyp', [...strToU8('M4B '), 0, 0, 0, 0]), ...box('mdat', new Array(2000).fill(0)), ...moov]);
  const t = readAudioTags(source(file));
  assert.equal(t.title, 'The Audiobook');
  assert.equal(t.artist, 'Author Name');
  assert.equal(t.albumArtist, 'Narr');
  assert.equal(t.durationMs, 3_600_000);
  assert.equal(t.cover.mime, 'image/jpeg');
  assert.deepEqual(t.chapters, [{ title: 'Intro', startMs: 0 }, { title: 'Chapter 1', startMs: 60_000 }]);
});
function boxRaw(typeBytes, body) {
  return [...be32(8 + body.length), ...typeBytes, ...body];
}

test('FLAC: Vorbis comments and the length from STREAMINFO', () => {
  const le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  const c = (s) => [...le(s.length), ...strToU8(s)];
  const vorbis = [...c('reference'), ...le(2), ...c('TITLE=Flac Title'), ...c('ARTIST=Flac Artist')];
  // 44100 Hz, 441000 samples = 10 s.
  const rate = 44100;
  const samples = 441000;
  const si = new Array(18).fill(0);
  si[10] = (rate >> 12) & 255;
  si[11] = (rate >> 4) & 255;
  si[12] = (rate & 15) << 4;
  si[14] = (samples >>> 24) & 255;
  si[15] = (samples >>> 16) & 255;
  si[16] = (samples >>> 8) & 255;
  si[17] = samples & 255;
  const block = (type, last, body) => [(last ? 0x80 : 0) | type, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];
  const file = Uint8Array.from([...strToU8('fLaC'), ...block(0, false, si), ...block(4, true, vorbis), ...new Array(100).fill(0)]);
  const t = readAudioTags(source(file));
  assert.equal(t.title, 'Flac Title');
  assert.equal(t.artist, 'Flac Artist');
  assert.equal(t.durationMs, 10_000);
});

test('file names: kinds, titles and track order', () => {
  assert.equal(audioKindOf('Book.M4B'), 'audio');
  assert.equal(audioKindOf('book.epub'), 'book');
  assert.equal(audioKindOf('clip.mov'), null);
  assert.equal(titleFromName('03 - The_Long_Way.mp3'), 'The Long Way');
  assert.equal(titleFromName('Track 12. Ending.m4a'), 'Ending');
  assert.equal(trackNumberOf('Chapter 7 - x.mp3'), 7);
  assert.equal(trackNumberOf('Intro.mp3'), null);
  assert.deepEqual(sortTracks([{ name: '10 b.mp3' }, { name: '2 a.mp3' }, { name: 'Intro.mp3' }, { name: '1 z.mp3' }]).map((f) => f.name), ['1 z.mp3', '2 a.mp3', '10 b.mp3', 'Intro.mp3']);
});
