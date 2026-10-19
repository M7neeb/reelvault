/**
 * What an audio file says about itself: title, artist / author, album, year,
 * genre, narrator, the cover picture and the chapter marks. Reads ID3 tags
 * (MP3: v2.2, v2.3, v2.4 with CHAP chapters, and v1 at the end), MP4 atoms
 * (M4A / M4B audiobooks: ©nam, ©ART, ©alb, covr and Nero "chpl" chapters) and
 * FLAC (Vorbis comments, PICTURE, and the length from STREAMINFO).
 *
 * Works on a `ByteSource` and only reads the parts it needs (a tag at the
 * start, boxes walked by their headers), so a 500 MB audiobook costs a few KB
 * of reading. Pure: no React, no native modules (tested in Node).
 */

import { strFromU8 } from 'fflate';

import type { ByteSource } from './zip.ts';

export type AudioChapter = { title: string; startMs: number };
export type AudioTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  narrator?: string;
  year?: number;
  genre?: string;
  comment?: string;
  track?: number;
  cover?: { mime: string; bytes: Uint8Array };
  chapters?: AudioChapter[];
  /** When the file says (FLAC, MP4 mvhd). */
  durationMs?: number;
};

const be32 = (b: Uint8Array, o: number) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const be24 = (b: Uint8Array, o: number) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const syncsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const clean = (s: string | undefined) => {
  const t = s?.replace(/\0+$/g, '').replace(/\0/g, ' / ').trim();
  return t ? t : undefined;
};
const yearOf = (s: string | undefined) => {
  const m = /\b(1[89]\d\d|2\d\d\d)\b/.exec(s ?? '');
  return m ? Number(m[1]) : undefined;
};

/* -------------------------------------------------------------- ID3 */

function decodeText(enc: number, b: Uint8Array): string {
  if (enc === 3) return strFromU8(b);
  if (enc === 1 || enc === 2) {
    // UTF-16 with BOM (1) or big-endian (2).
    let o = 0;
    let little = enc === 1;
    if (enc === 1 && b.length >= 2) {
      if (b[0] === 0xff && b[1] === 0xfe) o = 2;
      else if (b[0] === 0xfe && b[1] === 0xff) {
        little = false;
        o = 2;
      }
    }
    let s = '';
    for (; o + 1 < b.length; o += 2) {
      const c = little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
      s += String.fromCharCode(c);
    }
    return s;
  }
  return String.fromCharCode(...b);
}

/** Splits at the first terminator for the encoding (1 zero byte, or 2 for UTF-16). */
function splitTerm(enc: number, b: Uint8Array, from = 0): [Uint8Array, Uint8Array] {
  const wide = enc === 1 || enc === 2;
  for (let i = from; i < b.length; i += wide ? 2 : 1) {
    if (b[i] === 0 && (!wide || b[i + 1] === 0)) return [b.subarray(from, i), b.subarray(i + (wide ? 2 : 1))];
  }
  return [b.subarray(from), new Uint8Array(0)];
}

function unsync(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

type Frame = { id: string; data: Uint8Array };

function id3Frames(tag: Uint8Array, version: number): Frame[] {
  const frames: Frame[] = [];
  let p = 0;
  const idLen = version === 2 ? 3 : 4;
  const head = version === 2 ? 6 : 10;
  while (p + head <= tag.length) {
    const id = ascii(tag, p, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size = version === 2 ? be24(tag, p + 3) : version === 4 ? syncsafe(tag, p + 4) : be32(tag, p + 4);
    if (size <= 0 || p + head + size > tag.length) break;
    let data = tag.subarray(p + head, p + head + size);
    if (version === 4 && tag[p + 9] & 0x02) data = unsync(data);
    frames.push({ id, data });
    p += head + size;
  }
  return frames;
}

function textFrame(f: Frame): string | undefined {
  return clean(decodeText(f.data[0], f.data.subarray(1)));
}

function readId3(tag: Uint8Array, version: number, out: AudioTags): void {
  const frames = id3Frames(tag, version);
  const pick = (...ids: string[]) => {
    const f = frames.find((x) => ids.includes(x.id));
    return f ? textFrame(f) : undefined;
  };
  out.title ??= pick('TIT2', 'TT2');
  out.artist ??= pick('TPE1', 'TP1');
  out.albumArtist ??= pick('TPE2', 'TP2');
  out.album ??= pick('TALB', 'TAL');
  out.narrator ??= pick('TPE3', 'TCOM', 'TP3');
  out.year ??= yearOf(pick('TDRC', 'TYER', 'TYE', 'TDOR'));
  const genre = pick('TCON', 'TCO');
  out.genre ??= genre?.replace(/^\((\d+)\)/, '').trim() || undefined;
  const track = pick('TRCK', 'TRK');
  if (track && !out.track) out.track = Number(track.split('/')[0]) || undefined;
  const comm = frames.find((x) => x.id === 'COMM' || x.id === 'COM');
  if (comm && !out.comment) {
    const enc = comm.data[0];
    const [, rest] = splitTerm(enc, comm.data, 4);
    out.comment = clean(decodeText(enc, rest));
  }
  const pic = frames.find((x) => x.id === 'APIC' || x.id === 'PIC');
  if (pic && !out.cover) {
    const enc = pic.data[0];
    let mime: string;
    let rest: Uint8Array;
    if (pic.id === 'PIC') {
      const fmt = ascii(pic.data, 1, 3).toLowerCase();
      mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      rest = pic.data.subarray(5);
    } else {
      const [m, after] = splitTerm(0, pic.data, 1);
      mime = String.fromCharCode(...m).toLowerCase() || 'image/jpeg';
      rest = after.subarray(1); // picture type
    }
    const [, bytes] = splitTerm(enc, rest);
    if (bytes.length > 100) out.cover = { mime: mime.includes('png') ? 'image/png' : 'image/jpeg', bytes };
  }
  // CHAP frames (ID3v2.3+ chapters): start time in ms, with a TIT2 inside.
  const chaps: AudioChapter[] = [];
  for (const f of frames.filter((x) => x.id === 'CHAP')) {
    const [, rest] = splitTerm(0, f.data);
    if (rest.length < 16) continue;
    const start = be32(rest, 0);
    const sub = id3Frames(rest.subarray(16), version === 2 ? 3 : version);
    const t = sub.find((x) => x.id === 'TIT2');
    chaps.push({ title: (t && textFrame(t)) || `Chapter ${chaps.length + 1}`, startMs: start });
  }
  if (chaps.length && !out.chapters) out.chapters = chaps.sort((a, b) => a.startMs - b.startMs);
}

function readId3v1(b: Uint8Array, out: AudioTags): void {
  if (b.length < 128 || ascii(b, 0, 3) !== 'TAG') return;
  const s = (o: number, n: number) => clean(String.fromCharCode(...b.subarray(o, o + n)));
  out.title ??= s(3, 30);
  out.artist ??= s(33, 30);
  out.album ??= s(63, 30);
  out.year ??= yearOf(s(93, 4));
}

/* -------------------------------------------------------------- MP4 */

type Box = { type: string; start: number; size: number; header: number };

function boxes(src: ByteSource, from: number, to: number): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    const h = src.read(p, 16);
    let size = be32(h, 0);
    const type = ascii(h, 4, 4);
    let header = 8;
    if (size === 1) {
      size = be32(h, 8) * 0x100000000 + be32(h, 12);
      header = 16;
    } else if (size === 0) size = to - p;
    if (size < header || p + size > to + 8) break;
    out.push({ type, start: p, size, header });
    p += size;
  }
  return out;
}

const CONTAINERS = new Set(['moov', 'udta', 'ilst', 'trak', 'mdia', 'minf', 'stbl']);

function readMp4(src: ByteSource, out: AudioTags): void {
  const top = boxes(src, 0, src.size);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) return;
  const inside = (b: Box) => boxes(src, b.start + b.header, b.start + b.size);
  const kids = inside(moov);
  const mvhd = kids.find((b) => b.type === 'mvhd');
  if (mvhd) {
    const d = src.read(mvhd.start + mvhd.header, 32);
    const v1 = d[0] === 1;
    const scale = v1 ? be32(d, 20) : be32(d, 12);
    const dur = v1 ? be32(d, 24) * 0x100000000 + be32(d, 28) : be32(d, 16);
    if (scale > 0 && dur > 0) out.durationMs = Math.round((dur / scale) * 1000);
  }
  const udta = kids.find((b) => b.type === 'udta');
  if (!udta) return;
  const u = inside(udta);
  // Nero chapters: udta/chpl.
  const chpl = u.find((b) => b.type === 'chpl');
  if (chpl && chpl.size < 2_000_000) {
    const d = src.read(chpl.start + chpl.header, chpl.size - chpl.header);
    // Version 1 (what ffmpeg writes) has 4 more bytes before the count.
    const count = d[0] >= 1 ? d[8] : d[4];
    let p = d[0] >= 1 ? 9 : 5;
    const chaps: AudioChapter[] = [];
    for (let i = 0; i < count && p + 9 <= d.length; i++) {
      const t100ns = be32(d, p) * 0x100000000 + be32(d, p + 4);
      const len = d[p + 8];
      chaps.push({ title: strFromU8(d.subarray(p + 9, p + 9 + len)) || `Chapter ${i + 1}`, startMs: Math.round(t100ns / 10_000) });
      p += 9 + len;
    }
    if (chaps.length) out.chapters = chaps.sort((a, b) => a.startMs - b.startMs);
  }
  const meta = u.find((b) => b.type === 'meta');
  if (!meta) return;
  // meta is a full box: 4 bytes of version/flags before its children.
  const ilst = boxes(src, meta.start + meta.header + 4, meta.start + meta.size).find((b) => b.type === 'ilst');
  if (!ilst) return;
  for (const item of inside(ilst)) {
    if (item.size > 20_000_000) continue;
    const data = inside(item).find((b) => b.type === 'data');
    if (!data) continue;
    const d = src.read(data.start + data.header, data.size - data.header);
    const kind = be32(d, 0) & 0xffffff;
    const value = d.subarray(8);
    const str = () => clean(strFromU8(value));
    switch (item.type) {
      case '©nam':
        out.title ??= str();
        break;
      case '©ART':
        out.artist ??= str();
        break;
      case 'aART':
        out.albumArtist ??= str();
        break;
      case '©alb':
        out.album ??= str();
        break;
      case '©wrt':
      case '©nrt':
        out.narrator ??= str();
        break;
      case '©day':
        out.year ??= yearOf(str());
        break;
      case '©gen':
        out.genre ??= str();
        break;
      case '©cmt':
      case 'desc':
        out.comment ??= str();
        break;
      case 'trkn':
        if (value.length >= 4) out.track ??= (value[2] << 8) | value[3] || undefined;
        break;
      case 'covr':
        if (!out.cover && value.length > 100) out.cover = { mime: kind === 14 ? 'image/png' : 'image/jpeg', bytes: value.slice() };
        break;
    }
  }
}

/* ------------------------------------------------------------- FLAC */

function readFlac(src: ByteSource, out: AudioTags): void {
  let p = 4;
  for (let n = 0; n < 64 && p + 4 <= src.size; n++) {
    const h = src.read(p, 4);
    const last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const len = be24(h, 1);
    if (type === 0 && len >= 18) {
      const s = src.read(p + 4, 18);
      const rate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
      const samples = (s[13] & 0x0f) * 0x100000000 + be32(s, 14);
      if (rate > 0 && samples > 0) out.durationMs = Math.round((samples / rate) * 1000);
    } else if (type === 4 && len < 2_000_000) {
      const d = src.read(p + 4, len);
      const le = (o: number) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
      let q = 4 + le(0);
      const count = le(q);
      q += 4;
      for (let i = 0; i < count && q + 4 <= d.length; i++) {
        const l = le(q);
        const kv = strFromU8(d.subarray(q + 4, q + 4 + l));
        q += 4 + l;
        const eq = kv.indexOf('=');
        if (eq < 0) continue;
        const k = kv.slice(0, eq).toUpperCase();
        const v = clean(kv.slice(eq + 1));
        if (k === 'TITLE') out.title ??= v;
        else if (k === 'ARTIST') out.artist ??= v;
        else if (k === 'ALBUMARTIST') out.albumArtist ??= v;
        else if (k === 'ALBUM') out.album ??= v;
        else if (k === 'PERFORMER' || k === 'NARRATOR') out.narrator ??= v;
        else if (k === 'DATE' || k === 'YEAR') out.year ??= yearOf(v);
        else if (k === 'GENRE') out.genre ??= v;
        else if (k === 'TRACKNUMBER') out.track ??= Number(v?.split('/')[0]) || undefined;
        else if (k === 'COMMENT' || k === 'DESCRIPTION') out.comment ??= v;
      }
    } else if (type === 6 && len < 20_000_000 && !out.cover) {
      const d = src.read(p + 4, len);
      let q = 4;
      const ml = be32(d, q);
      const mime = ascii(d, q + 4, ml);
      q += 4 + ml;
      const dl = be32(d, q);
      q += 4 + dl + 16;
      const pl = be32(d, q);
      if (pl > 100) out.cover = { mime: mime.includes('png') ? 'image/png' : 'image/jpeg', bytes: d.slice(q + 4, q + 4 + pl) };
    }
    p += 4 + len;
    if (last) break;
  }
}

/* ------------------------------------------------------------- entry */

/** Everything the file says. Never throws: a damaged tag gives what could be read. */
export function readAudioTags(src: ByteSource): AudioTags {
  const out: AudioTags = {};
  if (src.size < 16) return out;
  try {
    const head = src.read(0, 12);
    if (ascii(head, 0, 3) === 'ID3') {
      const version = head[3];
      const size = syncsafe(head, 6);
      if (size > 0 && size < 64_000_000 && version >= 2 && version <= 4) {
        let tag = src.read(10, Math.min(size, src.size - 10));
        if (head[5] & 0x80 && version < 4) tag = unsync(tag);
        // An extended header (flag 0x40) comes first.
        if (head[5] & 0x40) {
          const ext = version === 4 ? syncsafe(tag, 0) : be32(tag, 0) + 4;
          tag = tag.subarray(ext);
        }
        readId3(tag, version, out);
      }
    } else if (ascii(head, 0, 4) === 'fLaC') {
      readFlac(src, out);
    } else if (ascii(head, 4, 4) === 'ftyp') {
      readMp4(src, out);
    }
    if ((!out.title || !out.artist) && src.size > 128) readId3v1(src.read(src.size - 128, 128), out);
  } catch {
    // Keep what was read.
  }
  return out;
}
