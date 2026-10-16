// Run with `npm test`. Builds tiny MP4 files by hand and reads them back.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { locateMoov, parseIso6709, parseMoov } from '../src/features/vault/mp4.ts';

/* ---------------------------------------------------------- tiny file maker */

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const i32 = (n) => u32(n >>> 0);
const u16 = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);
const zeros = (n) => new Uint8Array(n);
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const utf8 = (s) => new TextEncoder().encode(s);
const box = (type, ...parts) => {
  const body = concat(...parts);
  const typeBytes = typeof type === 'string' ? new Uint8Array([...type].map((c) => c.charCodeAt(0) & 255)) : type;
  return concat(u32(8 + body.length), typeBytes, body);
};

/** Seconds since 1904 for a JS date. */
const mac = (ms) => Math.round(ms / 1000) + 2082844800;
const FILMED = Date.UTC(2026, 8, 20, 18, 45, 10);

function mvhd() {
  return box('mvhd', zeros(4), u32(mac(FILMED)), u32(mac(FILMED)), u32(1000), u32(192_000), zeros(80));
}

function tkhd(width, height, rotate90) {
  const matrix = rotate90
    ? [0, 65536, 0, -65536, 0, 0, 0, 0, 1 << 30]
    : [65536, 0, 0, 0, 65536, 0, 0, 0, 1 << 30];
  return box(
    'tkhd',
    zeros(4),
    u32(0),
    u32(0),
    u32(1),
    zeros(4),
    u32(0),
    zeros(8),
    zeros(8),
    concat(...matrix.map(i32)),
    u32(width * 65536),
    u32(height * 65536)
  );
}

function videoTrak({ rotate90 = false, codec = 'hvc1' } = {}) {
  const hdlr = box('hdlr', zeros(4), zeros(4), ascii('vide'), zeros(12), ascii('Video\0'));
  const mdhd = box('mdhd', zeros(4), u32(0), u32(0), u32(30000), u32(9_009_000), zeros(4));
  const stsd = box('stsd', zeros(4), u32(1), box(codec, zeros(70)));
  const stts = box('stts', zeros(4), u32(1), u32(300), u32(1001));
  const stbl = box('stbl', stsd, stts);
  const minf = box('minf', stbl);
  return box('trak', tkhd(1920, 1080, rotate90), box('mdia', mdhd, hdlr, minf));
}

function audioTrak() {
  const hdlr = box('hdlr', zeros(4), zeros(4), ascii('soun'), zeros(12));
  const stsd = box('stsd', zeros(4), u32(1), box('mp4a', zeros(20)));
  return box('trak', tkhd(0, 0, false), box('mdia', hdlr, box('minf', box('stbl', stsd))));
}

/** Apple's keyed metadata (moov/meta with keys + ilst), as an iPhone writes it. */
function appleMeta(entries) {
  const keys = box(
    'keys',
    zeros(4),
    u32(entries.length),
    ...entries.map(([k]) => concat(u32(8 + utf8(k).length), ascii('mdta'), utf8(k)))
  );
  const items = entries.map(([, v], i) => box(u32(i + 1), box('data', u32(1), u32(0), utf8(v))));
  const hdlr = box('hdlr', zeros(4), zeros(4), ascii('mdta'), zeros(12));
  return box('meta', hdlr, keys, box('ilst', ...items));
}

/** The older udta/©xyz style (Android phones, cameras). */
function udtaLocation(text) {
  const xyz = concat(new Uint8Array([0xa9]), ascii('xyz'));
  return box('udta', box(xyz, u16(utf8(text).length), u16(0x15c7), utf8(text)));
}

/* -------------------------------------------------------------------- tests */

test('an iPhone-style file: date, rotation, codec, frame rate, device, location', () => {
  const moov = box(
    'moov',
    mvhd(),
    audioTrak(),
    videoTrak({ rotate90: true }),
    appleMeta([
      ['com.apple.quicktime.make', 'Apple'],
      ['com.apple.quicktime.model', 'iPhone 15'],
      ['com.apple.quicktime.software', '26.0'],
      ['com.apple.quicktime.location.ISO6709', '+51.6611+007.3489+050.000/'],
      ['com.apple.quicktime.creationdate', '2026-09-20T20:45:10+0200'],
    ])
  );
  const meta = parseMoov(moov);
  assert.equal(meta.createdAt, FILMED);
  assert.equal(meta.durationMs, 192_000);
  assert.equal(meta.rotation, 90);
  assert.equal(meta.width, 1080, 'portrait after rotation');
  assert.equal(meta.height, 1920);
  assert.equal(meta.codec, 'HEVC');
  assert.equal(meta.fps, 29.97);
  assert.equal(meta.make, 'Apple');
  assert.equal(meta.model, 'iPhone 15');
  assert.equal(meta.software, '26.0');
  assert.deepEqual(meta.location, { lat: 51.6611, lon: 7.3489, alt: 50 });
});

test('older udta location and H.264 without Apple keys', () => {
  const moov = box('moov', mvhd(), videoTrak({ codec: 'avc1' }), udtaLocation('+52.5200+013.4050/'));
  const meta = parseMoov(moov);
  assert.equal(meta.codec, 'H.264');
  assert.equal(meta.width, 1920);
  assert.equal(meta.rotation, 0);
  assert.deepEqual(meta.location, { lat: 52.52, lon: 13.405 });
  assert.equal(meta.model, undefined);
});

test('the moov box is found behind a big mdat without reading it', () => {
  const ftyp = box('ftyp', ascii('qt  '), u32(0), ascii('qt  '));
  const mdat = box('mdat', zeros(5000));
  const moov = box('moov', mvhd());
  const file = concat(ftyp, mdat, moov);
  const reads = [];
  const read = (offset, length) => {
    reads.push(length);
    return file.subarray(offset, offset + length);
  };
  const found = locateMoov(read, file.length);
  assert.deepEqual(found, { offset: ftyp.length + mdat.length, size: moov.length });
  assert.ok(reads.every((n) => n <= 16), 'only box headers were read');
});

test('garbage never throws', () => {
  assert.deepEqual(parseMoov(new Uint8Array([1, 2, 3])), {});
  assert.deepEqual(parseMoov(box('free', zeros(10))), {});
  assert.equal(locateMoov((o, n) => new Uint8Array(n), 100), null);
});

test('ISO 6709 locations', () => {
  assert.deepEqual(parseIso6709('-33.8688+151.2093/'), { lat: -33.8688, lon: 151.2093 });
  assert.equal(parseIso6709('not a place'), null);
  assert.equal(parseIso6709('+95.0+010.0/'), null, 'latitude past the pole');
});
