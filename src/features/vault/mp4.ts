/**
 * Reads what an MP4 / MOV file says about itself: when it was filmed, its real
 * size and rotation, codec, frame rate, the device and the GPS location.
 *
 * Pure byte parsing with no imports, so the tests can feed it hand-made files.
 * `metadata.ts` does the reading from disk.
 *
 * An MP4 is a tree of "boxes": 4 bytes size + 4 bytes type + content. The
 * interesting ones all live under `moov`:
 *
 *   moov/mvhd                     creation time, duration
 *   moov/trak/tkhd                width, height, rotation matrix
 *   moov/trak/mdia/hdlr           track kind ('vide' = video)
 *   moov/trak/mdia/mdhd           track time scale
 *   moov/trak/mdia/minf/stbl/stsd codec (avc1 = H.264, hvc1/hev1 = HEVC)
 *   moov/trak/mdia/minf/stbl/stts frame durations -> frame rate
 *   moov/udta/©xyz ©mak ©mod      location, make, model (older style)
 *   moov/meta/keys + ilst         Apple's com.apple.quicktime.* keys (iPhone)
 */

export type Mp4Meta = {
  /** When the file says it was filmed (ms since epoch). */
  createdAt?: number;
  durationMs?: number;
  /** As displayed, i.e. already swapped for 90° / 270° rotation. */
  width?: number;
  height?: number;
  rotation?: number;
  codec?: string;
  fps?: number;
  make?: string;
  model?: string;
  software?: string;
  location?: { lat: number; lon: number; alt?: number };
};

type Box = { type: string; start: number; content: number; end: number };

/** Seconds between 1904-01-01 (the MP4 epoch) and 1970-01-01. */
const MAC_EPOCH_OFFSET = 2082844800;

function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function u64(b: Uint8Array, o: number): number {
  return u32(b, o) * 2 ** 32 + u32(b, o + 4);
}

function i32(b: Uint8Array, o: number): number {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/** UTF-8 bytes to text, by hand: TextDecoder is not available everywhere React Native runs. */
function utf8(b: Uint8Array, start: number, end: number): string {
  let out = '';
  let i = start;
  while (i < end) {
    const c = b[i++];
    let code = c;
    if (c >= 0xf0 && i + 2 < end) {
      code = ((c & 0x07) << 18) | ((b[i] & 0x3f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
      i += 3;
    } else if (c >= 0xe0 && i + 1 < end) {
      code = ((c & 0x0f) << 12) | ((b[i] & 0x3f) << 6) | (b[i + 1] & 0x3f);
      i += 2;
    } else if (c >= 0xc0 && i < end) {
      code = ((c & 0x1f) << 6) | (b[i] & 0x3f);
      i += 1;
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

/** One box header at `o`, or null when there isn't a sane one. */
export function readBoxHeader(
  b: Uint8Array,
  o: number,
  limit = b.length
): { size: number; type: string; header: number } | null {
  if (o + 8 > limit) return null;
  let size = u32(b, o);
  const type = fourcc(b, o + 4);
  let header = 8;
  if (size === 1) {
    if (o + 16 > limit) return null;
    size = u64(b, o + 8);
    header = 16;
  } else if (size === 0) {
    size = limit - o;
  }
  if (size < header) return null;
  return { size, type, header };
}

function children(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o < end) {
    const h = readBoxHeader(b, o, end);
    if (!h) break;
    out.push({ type: h.type, start: o, content: o + h.header, end: Math.min(end, o + h.size) });
    o += h.size;
  }
  return out;
}

const child = (b: Uint8Array, box: Box, type: string) =>
  children(b, box.content, box.end).find((c) => c.type === type);

/**
 * `meta` is a "full box" (4 bytes version/flags first) in MP4, but a plain
 * container in QuickTime files. Look at the bytes to decide.
 */
function metaContentStart(b: Uint8Array, meta: Box): number {
  if (meta.content + 12 <= meta.end && u32(b, meta.content) === 0) {
    const next = readBoxHeader(b, meta.content + 4, meta.end);
    if (next && next.size >= 8 && next.size <= meta.end - meta.content - 4) return meta.content + 4;
  }
  return meta.content;
}

/** `+52.5200+013.4050+034.000/` -> { lat, lon, alt }. */
export function parseIso6709(text: string): { lat: number; lon: number; alt?: number } | null {
  const m = text.trim().match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const alt = m[3] !== undefined ? Number(m[3]) : undefined;
  return alt !== undefined && Number.isFinite(alt) ? { lat, lon, alt } : { lat, lon };
}

const CODECS: Record<string, string> = {
  avc1: 'H.264',
  avc3: 'H.264',
  hvc1: 'HEVC',
  hev1: 'HEVC',
  mp4v: 'MPEG-4',
  av01: 'AV1',
  vp09: 'VP9',
  ap4h: 'ProRes 4444',
  apch: 'ProRes 422 HQ',
  apcn: 'ProRes 422',
  apcs: 'ProRes 422 LT',
  apco: 'ProRes 422 Proxy',
};

function parseMvhd(b: Uint8Array, box: Box, meta: Mp4Meta) {
  const v = b[box.content];
  const p = box.content + 4;
  const created = v === 1 ? u64(b, p) : u32(b, p);
  const timescale = v === 1 ? u32(b, p + 16) : u32(b, p + 8);
  const duration = v === 1 ? u64(b, p + 20) : u32(b, p + 12);
  if (created > MAC_EPOCH_OFFSET) meta.createdAt = (created - MAC_EPOCH_OFFSET) * 1000;
  if (timescale > 0 && duration > 0) meta.durationMs = Math.round((duration / timescale) * 1000);
}

function parseVideoTrack(b: Uint8Array, trak: Box, meta: Mp4Meta) {
  const tkhd = child(b, trak, 'tkhd');
  if (tkhd) {
    const v = b[tkhd.content];
    const matrix = tkhd.content + 4 + (v === 1 ? 32 : 20) + 8 + 8;
    const a = i32(b, matrix) / 65536;
    const bb = i32(b, matrix + 4) / 65536;
    const w = u32(b, matrix + 36) / 65536;
    const h = u32(b, matrix + 40) / 65536;
    const rotation = ((Math.round((Math.atan2(bb, a) * 180) / Math.PI) % 360) + 360) % 360;
    if (w > 0 && h > 0) {
      const swap = rotation === 90 || rotation === 270;
      meta.width = Math.round(swap ? h : w);
      meta.height = Math.round(swap ? w : h);
      meta.rotation = rotation;
    }
  }

  const mdia = child(b, trak, 'mdia');
  if (!mdia) return;
  const mdhd = child(b, mdia, 'mdhd');
  const timescale = mdhd ? (b[mdhd.content] === 1 ? u32(b, mdhd.content + 20) : u32(b, mdhd.content + 12)) : 0;
  const stbl = (() => {
    const minf = child(b, mdia, 'minf');
    return minf ? child(b, minf, 'stbl') : undefined;
  })();
  if (!stbl) return;

  const stsd = child(b, stbl, 'stsd');
  if (stsd && stsd.content + 16 <= stsd.end) {
    const code = fourcc(b, stsd.content + 12);
    meta.codec = CODECS[code] ?? code;
  }

  const stts = child(b, stbl, 'stts');
  if (stts && timescale > 0) {
    const count = u32(b, stts.content + 4);
    let samples = 0;
    let ticks = 0;
    for (let i = 0; i < count && stts.content + 16 + i * 8 <= stts.end; i++) {
      const n = u32(b, stts.content + 8 + i * 8);
      const delta = u32(b, stts.content + 12 + i * 8);
      samples += n;
      ticks += n * delta;
    }
    if (samples > 0 && ticks > 0) meta.fps = Math.round(((samples * timescale) / ticks) * 100) / 100;
  }
}

function isVideoTrack(b: Uint8Array, trak: Box): boolean {
  const mdia = child(b, trak, 'mdia');
  const hdlr = mdia ? child(b, mdia, 'hdlr') : undefined;
  return !!hdlr && hdlr.content + 12 <= hdlr.end && fourcc(b, hdlr.content + 8) === 'vide';
}

/** Text in an old-style udta item (©xyz, ©mak...): 2 bytes length, 2 bytes language, text. */
function udtaText(b: Uint8Array, box: Box): string | null {
  if (box.content + 4 > box.end) return null;
  const len = u16(b, box.content);
  const start = box.content + 4;
  return utf8(b, start, Math.min(box.end, start + len)).replace(/\0+$/, '');
}

function parseUdta(b: Uint8Array, udta: Box, meta: Mp4Meta) {
  for (const c of children(b, udta.content, udta.end)) {
    const value = c.type.charCodeAt(0) === 0xa9 ? udtaText(b, c) : null;
    if (!value) continue;
    const name = c.type.slice(1);
    if (name === 'xyz' && !meta.location) meta.location = parseIso6709(value) ?? undefined;
    else if (name === 'mak' && !meta.make) meta.make = value;
    else if (name === 'mod' && !meta.model) meta.model = value;
    else if (name === 'swr' && !meta.software) meta.software = value;
  }
}

/** Apple's keyed metadata: `keys` names the entries, `ilst` holds a `data` box per entry. */
function parseKeyedMeta(b: Uint8Array, metaBox: Box, meta: Mp4Meta) {
  const start = metaContentStart(b, metaBox);
  const boxes = children(b, start, metaBox.end);
  const keysBox = boxes.find((c) => c.type === 'keys');
  const ilst = boxes.find((c) => c.type === 'ilst');
  if (!keysBox || !ilst) return;

  const names: string[] = [];
  const count = u32(b, keysBox.content + 4);
  let o = keysBox.content + 8;
  for (let i = 0; i < count && o + 8 <= keysBox.end; i++) {
    const size = u32(b, o);
    if (size < 8) break;
    names.push(utf8(b, o + 8, Math.min(keysBox.end, o + size)));
    o += size;
  }

  for (const item of children(b, ilst.content, ilst.end)) {
    const index = u32(b, item.start + 4);
    const key = names[index - 1];
    const data = children(b, item.content, item.end).find((c) => c.type === 'data');
    if (!key || !data || data.content + 8 > data.end) continue;
    const value = utf8(b, data.content + 8, data.end);
    switch (key) {
      case 'com.apple.quicktime.location.ISO6709':
        meta.location = parseIso6709(value) ?? meta.location;
        break;
      case 'com.apple.quicktime.make':
        meta.make = value;
        break;
      case 'com.apple.quicktime.model':
        meta.model = value;
        break;
      case 'com.apple.quicktime.software':
        meta.software = value;
        break;
      case 'com.apple.quicktime.creationdate': {
        const t = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
        if (Number.isFinite(t)) meta.createdAt = t;
        break;
      }
    }
  }
}

/** Everything readable from a `moov` box (the bytes start at the box header). */
export function parseMoov(b: Uint8Array): Mp4Meta {
  const meta: Mp4Meta = {};
  const h = readBoxHeader(b, 0);
  if (!h || h.type !== 'moov') return meta;
  const moov: Box = { type: 'moov', start: 0, content: h.header, end: Math.min(b.length, h.size) };

  let keyed: Box | undefined;
  for (const c of children(b, moov.content, moov.end)) {
    if (c.type === 'mvhd') parseMvhd(b, c, meta);
    else if (c.type === 'trak' && meta.codec === undefined && isVideoTrack(b, c)) parseVideoTrack(b, c, meta);
    else if (c.type === 'udta') {
      parseUdta(b, c, meta);
      const inner = child(b, c, 'meta');
      if (inner) keyed ??= inner;
    } else if (c.type === 'meta') keyed = c;
  }
  // The keyed metadata wins over the older udta entries, so read it last.
  if (keyed) parseKeyedMeta(b, keyed, meta);
  return meta;
}

/**
 * Where the `moov` box is, found by hopping over the top-level boxes. `read`
 * returns `length` bytes at `offset`; only box headers are read here, so even
 * a 4 GB file costs a handful of tiny reads.
 */
export function locateMoov(
  read: (offset: number, length: number) => Uint8Array,
  fileSize: number
): { offset: number; size: number } | null {
  let o = 0;
  for (let guard = 0; guard < 10000 && o + 8 <= fileSize; guard++) {
    const head = read(o, Math.min(16, fileSize - o));
    const h = readBoxHeader(head, 0, head.length);
    if (!h) return null;
    const size = h.size === head.length && u32(head, 0) === 0 ? fileSize - o : h.size;
    if (h.type === 'moov') return { offset: o, size: Math.min(size, fileSize - o) };
    if (size <= 0) return null;
    o += size;
  }
  return null;
}
