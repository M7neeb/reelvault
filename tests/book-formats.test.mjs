import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';

import { chapterBlocks } from '../src/features/vault/audio/epub.ts';
import { base64Bytes, decode, utf8Bytes } from '../src/features/vault/books/formats/bytes.ts';
import { splitHtml } from '../src/features/vault/books/formats/book.ts';
import { bookFormat, comicPages, convertBook, pagesToBook, pdfInfo } from '../src/features/vault/books/formats/index.ts';
import { cutAtHeadings, htmlToBook } from '../src/features/vault/books/formats/html.ts';
import { huffCdic, mobiToBook, palmDoc, trailingSize } from '../src/features/vault/books/formats/mobi.ts';
import { rtfParagraphs } from '../src/features/vault/books/formats/office.ts';
import { gutenberg, isHeading, paragraphsOf, textToBook } from '../src/features/vault/books/formats/plainText.ts';

/** The words of every chapter, as the reader would show them. */
function read(conv) {
  return conv.book.chapters.map((c) => {
    const file = conv.files.find((f) => f.path === c.href);
    const { blocks } = chapterBlocks(String(file.data), c.href);
    return blocks.map((b) => (b.k === 'img' ? `[img ${b.src}]` : 'runs' in b ? `${b.k}:${b.runs.map((r) => (r.b ? `*${r.t}*` : r.i ? `_${r.t}_` : r.t)).join('')}` : b.k));
  });
}

/* ------------------------------------------------------------------ bytes */

test('text is decoded in the encoding it is in', () => {
  assert.equal(decode(utf8Bytes('Преступление — Crime')), 'Преступление — Crime');
  assert.equal(decode(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), 'A');
  assert.equal(decode(Uint8Array.from([0xff, 0xfe, 0x41, 0x00, 0x16, 0x04])), 'AЖ');
  // Windows-1251 Russian and Windows-1252 Western, told apart by their bytes.
  const cyr = Uint8Array.from([0xcf, 0xf0, 0xe5, 0xf1, 0xf2, 0xf3, 0xef, 0xeb, 0xe5, 0xed, 0xe8, 0xe5, 0x20, 0xe8, 0x20, 0xed, 0xe0, 0xea, 0xe0, 0xe7, 0xe0, 0xed, 0xe8, 0xe5]);
  assert.equal(decode(cyr), 'Преступление и наказание');
  assert.equal(decode(Uint8Array.from([0x93, 0x43, 0x61, 0x66, 0xe9, 0x94])), '“Café”');
  assert.deepEqual([...base64Bytes('SGk=')], [72, 105]);
});

/* -------------------------------------------------------------- plain text */

test('plain text: Gutenberg licence cut off, wrapped lines joined, chapters found', () => {
  const txt = [
    'The Project Gutenberg eBook of Test',
    'Title: The Test Book',
    'Author: Ann Writer',
    '*** START OF THE PROJECT GUTENBERG EBOOK THE TEST BOOK ***',
    '',
    'PART ONE',
    '',
    'CHAPTER I',
    '',
    'It was a _dark_ and',
    'stormy night.',
    '',
    'Second paragraph.',
    '',
    'CHAPTER II',
    '',
    'Morning came.',
    '',
    '*** END OF THE PROJECT GUTENBERG EBOOK THE TEST BOOK ***',
    'Licence text that must not show.',
  ].join('\n');
  const conv = textToBook(txt);
  assert.equal(conv.book.title, 'The Test Book');
  assert.deepEqual(conv.book.authors, ['Ann Writer']);
  assert.deepEqual(conv.book.toc.map((t) => t.title), ['PART ONE · CHAPTER I', 'CHAPTER II']);
  assert.deepEqual(read(conv), [['h2:PART ONE', 'h2:CHAPTER I', 'p:It was a _dark_ and stormy night.', 'p:Second paragraph.'], ['h2:CHAPTER II', 'p:Morning came.']]);
  assert.ok(!JSON.stringify(conv.files).includes('Licence text'));
});

test('plain text: headings in several languages, numerals, and one paragraph a line', () => {
  for (const h of ['Chapter 12', 'CHAPTER XII. The End', 'Глава 3', 'Часть первая', 'IV', '12.', 'Epilogue']) assert.ok(isHeading(h), h);
  for (const h of ['Chapter and verse were quoted at length by the old man in the corner of the room today', 'I went home.', 'Partly cloudy']) assert.ok(!isHeading(h), h);
  const lines = Array.from({ length: 30 }, (_, i) => `Line ${i} is its own paragraph.`).join('\n');
  assert.equal(paragraphsOf(lines).length, 30);
  assert.equal(gutenberg('no markers').body, 'no markers');
});

test('markdown: headings, bold, italic, lists and quotes', () => {
  const conv = textToBook('# My Notes\n\nSome **bold** and *italic*.\n\n## Part two\n\n- one\n- two\n\n> quoted', true);
  assert.equal(conv.book.title, 'My Notes');
  assert.deepEqual(read(conv)[0].slice(0, 2), ['h1:My Notes', 'p:Some *bold* and _italic_.']);
});

/* -------------------------------------------------------------------- html */

test('html: body only, cut at headings, charset honoured, inline pictures kept', () => {
  const page = `<html lang="de"><head><meta charset="windows-1252"><title>Ein Buch</title><meta name="author" content="Max M"><style>p{}</style></head><body><h1>Eins</h1><p>Gr\xfc\xdfe</p><h1>Zwei</h1><p>Bild <img src="data:image/png;base64,iVBORw0KGgo="> und <img src="missing.png"></p><script>x()</script></body></html>`;
  const bytes = Uint8Array.from([...page].map((c) => c.charCodeAt(0)));
  const conv = htmlToBook(bytes);
  assert.equal(conv.book.title, 'Ein Buch');
  assert.deepEqual(conv.book.authors, ['Max M']);
  assert.equal(conv.book.language, 'de');
  const r = read(conv);
  assert.deepEqual(r[0], ['h1:Eins', 'p:Grüße']);
  assert.equal(r[1][0], 'h1:Zwei');
  assert.ok(r[1].some((x) => x === '[img images/web1.png]'));
  assert.ok(conv.files.some((f) => f.path === 'images/web1.png'));
  assert.equal(cutAtHeadings('<p>a</p>').length, 1);
});

test('very long chapters are cut where a paragraph ends', () => {
  const html = Array.from({ length: 3000 }, (_, i) => `<p>Paragraph number ${i} with some words in it.</p>`).join('');
  const parts = splitHtml(html, 20_000);
  assert.ok(parts.length > 3);
  assert.equal(parts.join(''), html);
  for (const p of parts) assert.ok(p.endsWith('</p>'));
});

/* -------------------------------------------------------------------- mobi */

/** A small PalmDOC compressor (literals and back-references), to round-trip through the reader. */
function palmCompress(src) {
  const out = [];
  for (let i = 0; i < src.length; ) {
    let best = 0;
    let dist = 0;
    for (let d = 1; d <= Math.min(i, 2047); d++) {
      let n = 0;
      while (n < 10 && i + n < src.length && src[i + n - d] === src[i + n]) n++;
      if (n > best) [best, dist] = [n, d];
    }
    if (best >= 3) {
      const pair = 0x8000 | (dist << 3) | (best - 3);
      out.push(pair >> 8, pair & 0xff);
      i += best;
    } else {
      const c = src[i++];
      if (c === 0 || (c >= 9 && c <= 0x7f)) out.push(c);
      else out.push(1, c);
    }
  }
  return Uint8Array.from(out);
}

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n) => [(n >> 8) & 255, n & 255];

function buildPdb(kind, records) {
  const head = new Array(78).fill(0);
  [...'Test_Book'].forEach((c, i) => (head[i] = c.charCodeAt(0)));
  [...kind].forEach((c, i) => (head[60 + i] = c.charCodeAt(0)));
  head[76] = records.length >> 8;
  head[77] = records.length & 255;
  let at = 78 + records.length * 8 + 2;
  const list = [];
  for (const r of records) {
    list.push(...be32(at), 0, 0, 0, 0);
    at += r.length;
  }
  return Uint8Array.from([...head, ...list, 0, 0, ...records.flatMap((r) => [...r])]);
}

function buildMobi({ text, encryption = 0, compression = 2 }) {
  const raw = utf8Bytes(text);
  const body = compression === 2 ? palmCompress(raw) : raw;
  // Text record + one multibyte byte + one 3-byte trailing entry.
  const rec1 = Uint8Array.from([...body, 0x00, 0xaa, 0xbb, 0x83]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const exthRecs = [
    [100, utf8Bytes('Ann Writer')],
    [524, utf8Bytes('en')],
    [201, Uint8Array.from(be32(0))],
  ];
  const exthBody = exthRecs.flatMap(([t, d]) => [...be32(t), ...be32(d.length + 8), ...d]);
  const exth = [...strToU8('EXTH'), ...be32(12 + exthBody.length), ...be32(exthRecs.length), ...exthBody];
  const mobiLen = 0xe8;
  const r0 = new Array(16 + mobiLen).fill(0);
  r0.splice(0, 16, ...be16(compression), 0, 0, ...be32(raw.length), ...be16(1), ...be16(4096), ...be16(encryption), 0, 0);
  const put32 = (at, v) => r0.splice(at, 4, ...be32(v));
  r0.splice(16, 4, ...strToU8('MOBI'));
  put32(20, mobiLen);
  put32(24, 2);
  put32(28, 65001);
  put32(36, 6);
  put32(0x6c, 2); // first picture: record 2
  put32(0x70, 0xffffffff);
  put32(0x80, 0x40);
  put32(0xf4, 0xffffffff);
  r0.splice(0xf2, 2, 0, 0b11);
  const name = utf8Bytes('The Full Name');
  put32(0x54, r0.length + exth.length);
  put32(0x58, name.length);
  const rec0 = Uint8Array.from([...r0, ...exth, ...name, 0, 0]);
  return buildPdb('BOOKMOBI', [rec0, rec1, png]);
}

test('PalmDOC decompression undoes the compression', () => {
  const src = utf8Bytes('the cat and the hat and the bat sat on the mat — the end ünïcode');
  assert.deepEqual([...palmDoc(palmCompress(src))], [...src]);
});

test('trailing bytes at the end of a text record are dropped', () => {
  const rec = Uint8Array.from([65, 66, 67, 0x00, 0xaa, 0xbb, 0x83]);
  assert.equal(trailingSize(rec, 0b11), 4);
  assert.equal(trailingSize(rec, 0), 0);
});

test('a MOBI book: details, chapters at page breaks, pictures and cover', () => {
  const conv = mobiToBook(buildMobi({ text: '<html><head><title>x</title></head><body><h1>One</h1><p>Hello <b>world</b></p><mbp:pagebreak/><h2>Two</h2><p>See <img recindex="00001"> here</p></body></html>' }));
  assert.equal(conv.book.title, 'The Full Name');
  assert.deepEqual(conv.book.authors, ['Ann Writer']);
  assert.equal(conv.book.language, 'en');
  assert.equal(conv.book.cover, 'images/0001.png');
  assert.deepEqual(read(conv), [['h1:One', 'p:Hello *world*'], ['h2:Two', 'p:See', '[img images/0001.png]', 'p:here']]);
  assert.deepEqual(conv.book.toc.map((t) => t.title), ['One', 'Two']);
});

test('Kindle books with DRM, and KFX files, are refused with the reason', () => {
  assert.throws(() => mobiToBook(buildMobi({ text: '<p>x</p>', encryption: 2 })), /DRM/);
  assert.throws(() => mobiToBook(strToU8('CONT\u0002\u0000xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')), /KFX/);
});

test('HUFF/CDIC: codes are looked up in the phrase table, and packed phrases unpacked', () => {
  // Every code is 8 bits, so byte b stands for phrase 255 - b.
  const huff = new Uint8Array(24 + 1024 + 256);
  huff.set(strToU8('HUFF'));
  huff.set(be32(24), 8);
  huff.set(be32(24 + 1024), 12);
  for (let i = 0; i < 256; i++) huff.set(be32((255 << 8) | 0x80 | 8), 24 + i * 4);
  const phrases = [strToU8('Hello '), strToU8('world'), Uint8Array.from([255 - 0, 255 - 1])];
  const flags = [true, true, false];
  const table = [];
  const data = [];
  for (const [i, p] of phrases.entries()) {
    table.push(...be16(phrases.length * 2 + data.length));
    data.push(...be16(p.length | (flags[i] ? 0x8000 : 0)), ...p);
  }
  const cdic = Uint8Array.from([...strToU8('CDIC'), ...be32(16), ...be32(phrases.length), ...be32(8), ...table, ...data]);
  const unpack = huffCdic(huff, [cdic]);
  assert.equal(new TextDecoder().decode(unpack(Uint8Array.from([255 - 2, 255 - 0, 255 - 1]))), 'Hello worldHello world');
});

/* --------------------------------------------------------------------- fb2 */

test('FB2 in Windows-1251: details, nested sections as chapters, pictures, notes', () => {
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><author><first-name>Fyodor</first-name><last-name>Dostoevsky</last-name></author><book-title>Book</book-title><lang>ru</lang>
<coverpage><image l:href="#cover.jpg"/></coverpage></title-info></description>
<body><title><p>Book</p></title>
<section><title><p>PART ONE</p></title><epigraph><p>Motto</p></epigraph>
<section><title><p>I</p></title><p>Text with <emphasis>stress</emphasis> and <strong>weight</strong>.</p><empty-line/><p>Next.</p></section>
<section><title><p>II</p></title><image l:href="#cover.jpg"/><poem><stanza><v>Line one</v></stanza></poem></section>
</section></body>
<body name="notes"><section id="n1"><title><p>1</p></title><p>A note.</p></section></body>
<binary id="cover.jpg" content-type="image/jpeg">/9j/4AAQSkZJRgABAQ==</binary>
</FictionBook>`;
  const bytes = Uint8Array.from([...xml].map((c) => c.charCodeAt(0)));
  const conv = convertBook('fb2', bytes);
  assert.equal(conv.book.title, 'Book');
  assert.deepEqual(conv.book.authors, ['Fyodor Dostoevsky']);
  assert.equal(conv.book.language, 'ru');
  assert.equal(conv.book.cover, 'images/0001.jpg');
  assert.deepEqual(conv.book.toc.map((t) => `${t.depth}:${t.title}`), ['0:PART ONE', '1:I', '1:II', '0:Notes']);
  const r = read(conv);
  assert.deepEqual(r[0], ['h1:PART ONE', 'p:Motto']);
  assert.deepEqual(r[1], ['h2:I', 'p:Text with _stress_ and *weight*.', 'p:Next.']);
  assert.deepEqual(r[2], ['h2:II', '[img images/0001.jpg]', 'p:Line one']);
  assert.deepEqual(r[3], ['h2:1', 'p:A note.']);
  // The same book zipped (.fb2.zip).
  const zipped = zipSync({ 'book.fb2': bytes });
  assert.equal(convertBook('fb2zip', zipped).book.title, 'Book');
});

/* ------------------------------------------------------------ office files */

test('Word: headings cut chapters, bold and italic kept, pictures taken from the package', () => {
  const w = 'xmlns:w="w" xmlns:r="r"';
  const p = (style, ...runs) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs.join('')}</w:p>`;
  const r = (t, fmt = '') => `<w:r>${fmt ? `<w:rPr>${fmt}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
  const doc = `<w:document ${w}><w:body>${p('Heading1', r('First'))}${p('', r('Plain '), r('bold', '<w:b/>'), r(' and '), r('not', '<w:b w:val="0"/>'), r(' and '), r('slanted', '<w:i/>'))}${p('Heading1', r('Second'))}${p('', '<w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r>')}${p('ListParagraph', r('item'))}</w:body></w:document>`;
  const files = {
    'word/document.xml': strToU8(doc),
    'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="rId5" Target="media/image1.png"/></Relationships>'),
    'word/media/image1.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1]),
    'docProps/core.xml': strToU8('<cp:coreProperties xmlns:dc="dc"><dc:title>Report</dc:title><dc:creator>Sam</dc:creator></cp:coreProperties>'),
  };
  const conv = convertBook('docx', zipSync(files));
  assert.equal(conv.book.title, 'Report');
  assert.deepEqual(conv.book.authors, ['Sam']);
  assert.deepEqual(read(conv), [['h1:First', 'p:Plain *bold* and not and _slanted_'], ['h1:Second', '[img images/0001.png]', 'p:item']]);
});

test('OpenDocument: outline headings, spans, lists and pictures', () => {
  const content = `<office:document-content><office:body><office:text><text:h text:outline-level="1">Intro</text:h><text:p>Hello<text:s text:c="2"/>there</text:p><text:list><text:list-item><text:p>one</text:p></text:list-item></text:list><text:h text:outline-level="1">Next</text:h><text:p><draw:frame><draw:image xlink:href="Pictures/a.jpg"/></draw:frame></text:p></office:text></office:body></office:document-content>`;
  const conv = convertBook('odt', zipSync({ 'content.xml': strToU8(content), 'Pictures/a.jpg': Uint8Array.from([0xff, 0xd8, 0xff]), 'meta.xml': strToU8('<meta><dc:title>Doc</dc:title></meta>') }));
  assert.equal(conv.book.title, 'Doc');
  assert.deepEqual(read(conv), [['h1:Intro', 'p:Hello there', 'li:one'], ['h1:Next', '[img images/0001.jpg]']]);
});

test('RTF: paragraphs, bold and italic, special characters, skipped tables of fonts', () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Times;}}{\info{\title My Story}{\author Kim}}\pard Hello {\b bold} and {\i lean}\par Caf\'e9 \u8212? done\emdash end\par}`;
  const { paras, title, author } = rtfParagraphs(rtf);
  assert.equal(title, 'My Story');
  assert.equal(author, 'Kim');
  assert.deepEqual(paras, ['Hello <b>bold</b> and <i>lean</i>', 'Café — done—end']);
});

/* --------------------------------------------------------- formats, pages */

test('the format comes from the first bytes, a wrong name does not matter, and unreadable kinds say why', () => {
  const mobi = buildMobi({ text: '<p>x</p>' });
  assert.equal(bookFormat('book.epub', mobi.subarray(0, 512)), 'mobi');
  assert.equal(bookFormat('x.azw3', mobi.subarray(0, 512)), 'mobi');
  assert.equal(bookFormat('x.pdf', strToU8('%PDF-1.7 ...')), 'pdf');
  assert.equal(bookFormat('x.txt', strToU8('{\\rtf1 hi}')), 'rtf');
  assert.equal(bookFormat('x', strToU8('<?xml version="1.0"?><FictionBook>')), 'fb2');
  assert.equal(bookFormat('notes.md', strToU8('# hi')), 'md');
  assert.equal(bookFormat('page.htm', strToU8('<p>hi')), 'html');
  assert.equal(bookFormat('a.txt', strToU8('hello')), 'txt');
  assert.equal(bookFormat('a.docx', zipSync({ 'word/document.xml': strToU8('<x/>') })), 'docx');
  assert.equal(bookFormat('a.cbz', zipSync({ '1.jpg': Uint8Array.of(1) })), 'cbz');
  const epubHead = zipSync({ mimetype: strToU8('application/epub+zip') }, { level: 0 });
  assert.equal(bookFormat('whatever.zip', epubHead), 'epub');
  assert.throws(() => bookFormat('a.kfx', strToU8('xx')), /KFX/);
  assert.throws(() => bookFormat('a.cbr', strToU8('Rar!')), /\.cbr/);
  assert.throws(() => bookFormat('a.doc', strToU8('xx')), /\.docx/);
  assert.throws(() => bookFormat('a.azw3', strToU8('not a kindle book at all')), /damaged/);
  assert.throws(() => bookFormat('a.xyz', strToU8('xx')), /can’t be read/);
});

test('page pictures become chapters of ten pages, comics in reading order, PDF title and author read', () => {
  const pages = Array.from({ length: 23 }, (_, i) => `pages/${String(i + 1).padStart(4, '0')}.jpg`);
  const conv = pagesToBook(pages, { title: 'Scan' });
  assert.deepEqual(conv.book.chapters.map((c) => c.title), ['Pages 1–10', 'Pages 11–20', 'Pages 21–23']);
  assert.equal(conv.book.cover, 'pages/0001.jpg');
  assert.equal(read(conv)[2][0], '[img pages/0021.jpg]');
  assert.deepEqual(comicPages(['p10.jpg', 'p2.jpg', '__MACOSX/p1.jpg', 'info.txt', 'p1.PNG']), ['p1.PNG', 'p2.jpg', 'p10.jpg']);
  assert.deepEqual(pdfInfo('<< /Title (Crime \\(and\\) Punishment) /Author <FEFF0414043E0441> >>'), { title: 'Crime (and) Punishment', authors: ['Дос'] });
  assert.deepEqual(pdfInfo('<< /Title (Microsoft Word - draft.docx) >>'), { title: null, authors: [] });
});
