/**
 * Kindle books without DRM: MOBI, AZW, AZW3 (KF8), PRC and PalmDOC (.pdb).
 *
 * The file is a Palm database: record 0 says how the text is stored, the next
 * records hold the text (PalmDOC or HUFF/CDIC compressed, each with a few
 * trailing bytes to drop), and later records hold the pictures. Old MOBI text
 * is one HTML page cut by <mbp:pagebreak/>; KF8 (AZW3) text is stored as page
 * skeletons and fragments that go back into them, listed in two indexes.
 * A file can carry both; then the KF8 half is used.
 * Pure: no React, no native modules (tested in Node).
 */

import { ascii, decode, imageType, u16, u32, type Charset } from './bytes.ts';
import { makeBook, type BookFile, type Chapter, type Converted } from './book.ts';
import { bodyOf, cutAtHeadings } from './html.ts';

const NONE = 0xffffffff;

type Pdb = { name: string; kind: string; records: Uint8Array[] };

export function readPdb(b: Uint8Array): Pdb {
  if (b.length < 86) throw new Error('This file is too short to be a Kindle book');
  const n = u16(b, 76);
  const starts: number[] = [];
  for (let i = 0; i < n; i++) starts.push(u32(b, 78 + i * 8));
  const records = starts.map((s, i) => b.subarray(Math.min(s, b.length), Math.min(i + 1 < n ? starts[i + 1] : b.length, b.length)));
  return { name: ascii(b, 0, 32).replace(/\0[\s\S]*$/, ''), kind: ascii(b, 60, 8), records };
}

/* ------------------------------------------------------------ decompression */

export function palmDoc(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(8192, src.length * 6));
  let o = 0;
  for (let i = 0; i < src.length && o < out.length - 10; ) {
    const c = src[i++];
    if (c === 0 || (c >= 0x09 && c <= 0x7f)) out[o++] = c;
    else if (c <= 0x08) for (let k = 0; k < c && i < src.length; k++) out[o++] = src[i++];
    else if (c <= 0xbf) {
      const pair = (c << 8) | (src[i++] ?? 0);
      const dist = (pair >> 3) & 0x7ff;
      const len = (pair & 7) + 3;
      if (dist === 0 || dist > o) continue;
      for (let k = 0; k < len; k++, o++) out[o] = out[o - dist];
    } else {
      out[o++] = 0x20;
      out[o++] = c ^ 0x80;
    }
  }
  return out.subarray(0, o);
}

/** The HUFF/CDIC decoder: a Huffman code over a dictionary of phrases (which may be compressed themselves). */
export function huffCdic(huff: Uint8Array, cdics: Uint8Array[]): (data: Uint8Array) => Uint8Array {
  if (ascii(huff, 0, 4) !== 'HUFF') throw new Error('This Kindle book is damaged (no HUFF record)');
  const p32 = (k: number) => 2 ** (32 - k);
  const off1 = u32(huff, 8);
  const off2 = u32(huff, 12);
  const dict1: { len: number; term: boolean; max: number }[] = [];
  for (let i = 0; i < 256; i++) {
    const v = u32(huff, off1 + i * 4);
    const len = v & 0x1f;
    dict1.push({ len, term: (v & 0x80) !== 0, max: ((v >>> 8) + 1) * p32(len) - 1 });
  }
  const minCode = [0];
  const maxCode = [2 ** 32 - 1];
  for (let k = 1; k <= 32; k++) {
    minCode.push(u32(huff, off2 + (k - 1) * 8) * p32(k));
    maxCode.push((u32(huff, off2 + (k - 1) * 8 + 4) + 1) * p32(k) - 1);
  }
  type Phrase = { bytes: Uint8Array; done: boolean };
  const dict: Phrase[] = [];
  for (const c of cdics) {
    if (ascii(c, 0, 4) !== 'CDIC') continue;
    const phrases = u32(c, 8);
    const bits = u32(c, 12);
    const n = Math.min(2 ** bits, phrases - dict.length);
    for (let j = 0; j < n; j++) {
      const off = u16(c, 16 + j * 2);
      const blen = u16(c, 16 + off);
      dict.push({ bytes: c.subarray(18 + off, 18 + off + (blen & 0x7fff)), done: (blen & 0x8000) !== 0 });
    }
  }

  const unpack = (data: Uint8Array, depth: number): Uint8Array => {
    const d = new Uint8Array(data.length + 8);
    d.set(data);
    const read32 = (bit: number) => {
      const at = bit >> 3;
      const sh = bit & 7;
      const v = ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0;
      return sh ? (((v << sh) | (d[at + 4] >>> (8 - sh))) >>> 0) : v;
    };
    const parts: Uint8Array[] = [];
    let size = 0;
    let bit = 0;
    let left = data.length * 8;
    for (;;) {
      const code = read32(bit);
      let { len, max } = dict1[code >>> 24];
      if (!dict1[code >>> 24].term) {
        while (len < 32 && code < minCode[len]) len++;
        max = maxCode[len];
      }
      if (len === 0) break;
      bit += len;
      left -= len;
      if (left < 0) break;
      const r = Math.floor((max - code) / p32(len));
      const ph = dict[r];
      if (!ph) break;
      if (!ph.done) {
        if (depth > 32) throw new Error('This Kindle book is damaged (phrase loop)');
        ph.bytes = unpack(ph.bytes, depth + 1);
        ph.done = true;
      }
      parts.push(ph.bytes);
      size += ph.bytes.length;
    }
    const out = new Uint8Array(size);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  return (data) => unpack(data, 0);
}

/** How many bytes at the end of a text record are not text (the "trailing entries"). */
export function trailingSize(rec: Uint8Array, flags: number): number {
  let size = 0;
  for (let f = flags >> 1; f; f >>= 1) {
    if (!(f & 1)) continue;
    // A number written backwards from the end: 7 bits a byte, the high bit marks its first byte.
    let value = 0;
    let shift = 0;
    for (let i = 0; i < 4; i++) {
      const byte = rec[rec.length - size - 1 - i];
      if (byte === undefined) break;
      value |= (byte & 0x7f) << shift;
      shift += 7;
      if (byte & 0x80) break;
    }
    size += value;
  }
  if (flags & 1) size += ((rec[rec.length - size - 1] ?? 0) & 0x3) + 1;
  return Math.min(size, rec.length);
}

/* --------------------------------------------------------------- headers */

type Header = {
  compression: number;
  textLength: number;
  textRecords: number;
  encryption: number;
  encoding: Charset;
  version: number;
  title: string | null;
  firstResource: number;
  huffStart: number;
  huffCount: number;
  extraFlags: number;
  fdst: number;
  ncx: number;
  frag: number;
  skel: number;
  exth: Map<number, Uint8Array[]>;
};

function readHeader(r0: Uint8Array, palmOnly: boolean): Header {
  const h: Header = {
    compression: u16(r0, 0),
    textLength: u32(r0, 4),
    textRecords: u16(r0, 8),
    encryption: u16(r0, 12),
    encoding: 'windows-1252',
    version: 0,
    title: null,
    firstResource: NONE,
    huffStart: NONE,
    huffCount: 0,
    extraFlags: 0,
    fdst: NONE,
    ncx: NONE,
    frag: NONE,
    skel: NONE,
    exth: new Map(),
  };
  if (palmOnly || ascii(r0, 16, 4) !== 'MOBI') return h;
  const len = u32(r0, 20);
  h.encoding = u32(r0, 28) === 65001 ? 'utf-8' : 'windows-1252';
  h.version = u32(r0, 36);
  h.firstResource = u32(r0, 0x6c);
  h.huffStart = u32(r0, 0x70);
  h.huffCount = u32(r0, 0x74);
  if (len >= 0xe4 && h.version >= 5) h.extraFlags = u16(r0, 0xf2);
  if (len >= 0xe8) h.ncx = u32(r0, 0xf4);
  if (h.version >= 8 && len >= 0xe4) {
    h.fdst = u32(r0, 0xc0);
    h.frag = u32(r0, 0xf8);
    h.skel = u32(r0, 0xfc);
  }
  const nameOff = u32(r0, 0x54);
  const nameLen = u32(r0, 0x58);
  if (nameLen && nameOff + nameLen <= r0.length) h.title = decode(r0, h.encoding, nameOff, nameOff + nameLen).trim() || null;
  if (u32(r0, 0x80) & 0x40) {
    const at = 16 + len;
    if (ascii(r0, at, 4) === 'EXTH') {
      const count = u32(r0, at + 8);
      let p = at + 12;
      for (let i = 0; i < count && p + 8 <= r0.length; i++) {
        const type = u32(r0, p);
        const size = u32(r0, p + 4);
        if (size < 8) break;
        const list = h.exth.get(type) ?? [];
        list.push(r0.subarray(p + 8, p + size));
        h.exth.set(type, list);
        p += size;
      }
    }
  }
  return h;
}

const exthText = (h: Header, type: number) => (h.exth.get(type) ?? []).map((b) => decode(b, h.encoding).trim()).filter(Boolean);
const exthNumber = (h: Header, type: number) => {
  const b = h.exth.get(type)?.[0];
  return b && b.length >= 4 ? u32(b, 0) : NONE;
};

/* ----------------------------------------------------------------- indexes */

function forwardVarint(d: Uint8Array, at: number): [value: number, consumed: number] {
  let value = 0;
  for (let i = 0; i < 5 && at + i < d.length; i++) {
    const b = d[at + i];
    value = value * 128 + (b & 0x7f);
    if (b & 0x80) return [value, i + 1];
  }
  return [value, 5];
}

type TagDef = { tag: number; per: number; mask: number; end: number };
export type IndexEntry = { key: string; tags: Map<number, number[]> };

function tagMap(cbCount: number, defs: TagDef[], d: Uint8Array): Map<number, number[]> {
  let cb = 0;
  let pos = cbCount;
  const planned: { tag: number; count: number | null; bytes: number | null; per: number }[] = [];
  for (const t of defs) {
    if (t.end === 1) {
      cb++;
      continue;
    }
    let value = (d[cb] ?? 0) & t.mask;
    if (!value) continue;
    if (value === t.mask) {
      let bits = 0;
      for (let m = t.mask; m; m >>= 1) bits += m & 1;
      if (bits > 1) {
        const [v, used] = forwardVarint(d, pos);
        pos += used;
        planned.push({ tag: t.tag, count: null, bytes: v, per: t.per });
      } else planned.push({ tag: t.tag, count: 1, bytes: null, per: t.per });
    } else {
      let mask = t.mask;
      while (!(mask & 1)) {
        mask >>= 1;
        value >>= 1;
      }
      planned.push({ tag: t.tag, count: value, bytes: null, per: t.per });
    }
  }
  const out = new Map<number, number[]>();
  for (const p of planned) {
    const values: number[] = [];
    if (p.count !== null) {
      for (let i = 0; i < p.count * p.per; i++) {
        const [v, used] = forwardVarint(d, pos);
        pos += used;
        values.push(v);
      }
    } else {
      let used = 0;
      while (used < (p.bytes ?? 0) && pos < d.length) {
        const [v, n] = forwardVarint(d, pos);
        pos += n;
        used += n;
        values.push(v);
      }
    }
    out.set(p.tag, values);
  }
  return out;
}

/** A KF8 index (skeletons, fragments, contents): its entries and its string table (CNCX). */
export function readIndex(rec: (i: number) => Uint8Array | undefined, first: number): { entries: IndexEntry[]; cncx: Map<number, string> } {
  const empty = { entries: [], cncx: new Map<number, string>() };
  const r = first === NONE ? undefined : rec(first);
  if (!r || ascii(r, 0, 4) !== 'INDX') return empty;
  const records = u32(r, 24);
  const cncxCount = u32(r, 52);
  let tagx = -1;
  for (let i = 0; i + 4 <= r.length; i++)
    if (r[i] === 0x54 && ascii(r, i, 4) === 'TAGX') {
      tagx = i;
      break;
    }
  if (tagx < 0) return empty;
  const tagxLen = u32(r, tagx + 4);
  const cbCount = u32(r, tagx + 8);
  const defs: TagDef[] = [];
  for (let p = tagx + 12; p + 4 <= tagx + tagxLen; p += 4) defs.push({ tag: r[p], per: r[p + 1], mask: r[p + 2], end: r[p + 3] });

  const cncx = new Map<number, string>();
  for (let c = 0; c < cncxCount; c++) {
    const d = rec(first + records + 1 + c);
    if (!d) continue;
    for (let p = 0; p < d.length; ) {
      const [len, used] = forwardVarint(d, p);
      if (!len && used === 1 && d[p] === 0) break;
      cncx.set(c * 0x10000 + p, decode(d, 'utf-8', p + used, Math.min(d.length, p + used + len)));
      p += used + len;
    }
  }

  const entries: IndexEntry[] = [];
  for (let i = 1; i <= records; i++) {
    const d = rec(first + i);
    if (!d || ascii(d, 0, 4) !== 'INDX') continue;
    const idxt = u32(d, 20);
    const count = u32(d, 24);
    const offs: number[] = [];
    for (let j = 0; j < count; j++) offs.push(u16(d, idxt + 4 + j * 2));
    for (let j = 0; j < count; j++) {
      const s = offs[j];
      const e = j + 1 < count ? offs[j + 1] : idxt;
      const keyLen = d[s];
      const key = ascii(d, s + 1, keyLen);
      entries.push({ key, tags: tagMap(cbCount, defs, d.subarray(s + 1 + keyLen, e)) });
    }
  }
  return { entries, cncx };
}

/* ------------------------------------------------------------------ the book */

/** True for Amazon's newest format (KFX), which needs converting first. */
export const isKfx = (b: Uint8Array) => ascii(b, 0, 4) === 'CONT' || ascii(b, 0, 8) === '\xeaDRMION\xee';

export function mobiToBook(bytes: Uint8Array): Converted {
  if (isKfx(bytes)) throw new Error('This is a KFX file, Amazon’s newest format. Convert it to AZW3 or EPUB with Calibre first, then import that.');
  const pdb = readPdb(bytes);
  const palmOnly = pdb.kind === 'TEXtREAd';
  if (!palmOnly && pdb.kind !== 'BOOKMOBI') throw new Error('This is not a Kindle book that can be read here');
  let start = 0;
  const rec = (i: number) => pdb.records[start + i];
  const first = readHeader(pdb.records[0], palmOnly);
  let h = first;
  // A file with both kinds: the newer KF8 half starts at the boundary record.
  const boundary = exthNumber(first, 121);
  if (first.version < 8 && boundary !== NONE && boundary < pdb.records.length) {
    const kf8 = readHeader(pdb.records[boundary], false);
    if (kf8.version >= 8) {
      h = kf8;
      start = boundary;
    }
  }
  if (h.encryption !== 0 || first.encryption !== 0) throw new Error('This book is locked with Kindle DRM. Only books without DRM can be opened (books you converted yourself, or from shops that sell them DRM-free).');

  let unhuff: ((d: Uint8Array) => Uint8Array) | null = null;
  if (h.compression === 17480) {
    const cdics: Uint8Array[] = [];
    for (let i = 1; i < h.huffCount; i++) cdics.push(rec(h.huffStart + i) ?? new Uint8Array());
    unhuff = huffCdic(rec(h.huffStart) ?? new Uint8Array(), cdics);
  } else if (h.compression !== 1 && h.compression !== 2) throw new Error(`This Kindle book uses a compression that can’t be read (${h.compression})`);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 1; i <= h.textRecords; i++) {
    const r = rec(i);
    if (!r) break;
    const body = r.subarray(0, r.length - trailingSize(r, h.extraFlags));
    const plain = unhuff ? unhuff(body) : h.compression === 2 ? palmDoc(body) : body;
    chunks.push(plain);
    total += plain.length;
  }
  const raw = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    raw.set(c, o);
    o += c.length;
  }
  const text = raw.subarray(0, h.textLength && h.textLength < raw.length ? h.textLength : raw.length);

  // Pictures: numbered from the first resource record of the file's first header.
  const images: BookFile[] = [];
  const written = new Map<number, string>();
  const resource = (n: number): string | null => {
    if (first.firstResource === NONE || n < 0) return null;
    if (written.has(n)) return written.get(n)!;
    const r = pdb.records[first.firstResource + n];
    const type = r ? imageType(r) : null;
    if (!r || !type) return null;
    const path = `images/${String(n + 1).padStart(4, '0')}.${type.ext}`;
    images.push({ path, data: r });
    written.set(n, path);
    return path;
  };
  const coverIndex = exthNumber(first, 201) !== NONE ? exthNumber(first, 201) : exthNumber(h, 201);
  const cover = coverIndex !== NONE ? resource(coverIndex) : null;

  let chapters: Chapter[];
  if (h.version >= 8) chapters = kf8Chapters(text, h, rec, resource);
  else {
    let html = palmOnly ? null : decode(text, h.encoding);
    if (html === null) {
      // PalmDOC: plain text.
      const plain = decode(text, 'windows-1252');
      html = plain
        .split(/\n\s*\n/)
        .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').trim()}</p>`)
        .join('\n');
    }
    const fix = (part: string) =>
      bodyOf(part)
        .replace(/<\/?mbp:[^>]*>/gi, '')
        .replace(/<img\b[^>]*\brecindex=["']?(\d+)["']?[^>]*>/gi, (_m, n: string) => {
          const path = resource(parseInt(n, 10) - 1);
          return path ? `<img src="../${path}" alt=""/>` : '';
        });
    // Cut at the page breaks in the bytes, so the contents (byte positions) can name each page.
    const cuts = palmOnly ? [] : pageBreaks(text);
    if (cuts.length) {
      const bounds = [0, ...cuts, text.length];
      const parts = bounds.slice(0, -1).map((from, i) => ({ html: fix(decode(text, h.encoding, from, bounds[i + 1])), from, to: bounds[i + 1] }));
      const names = contentsNames(readIndex(rec, h.ncx), parts);
      chapters = parts.map((p, i) => ({ html: p.html, title: names.get(i)?.title ?? null, depth: names.get(i)?.depth ?? 0 }));
    } else chapters = cutAtHeadings(fix(html)).map((p) => ({ html: p }));
  }

  const authors = exthText(first, 100);
  const title = exthText(h, 503)[0] ?? exthText(first, 503)[0] ?? h.title ?? first.title ?? (pdb.name.replace(/_/g, ' ') || null);
  return makeBook(
    {
      title,
      authors: authors.length ? authors : exthText(h, 100),
      language: exthText(first, 524)[0] ?? null,
      description: (exthText(first, 103)[0] ?? '').replace(/<[^>]+>/g, ' ') || null,
      publisher: exthText(first, 101)[0] ?? null,
      date: exthText(first, 106)[0] ?? null,
    },
    chapters,
    images,
    cover
  );
}

/** Where `<mbp:pagebreak` starts in the text (byte positions). */
function pageBreaks(text: Uint8Array): number[] {
  const out: number[] = [];
  const needle = '<mbp:pagebreak';
  for (let i = 0; i + needle.length <= text.length; i++) {
    if (text[i] !== 0x3c) continue;
    let k = 1;
    while (k < needle.length && (text[i + k] | 0x20) === (needle.charCodeAt(k) | 0x20)) k++;
    if (k === needle.length && i > 0) out.push(i);
  }
  return out;
}

/** The book's own contents (its NCX index): the first entry pointing into each page names that page. */
function contentsNames(ncx: { entries: IndexEntry[]; cncx: Map<number, string> }, parts: { from: number; to: number }[]) {
  const names = new Map<number, { title: string; depth: number }>();
  for (const e of ncx.entries) {
    const pos = e.tags.get(1)?.[0];
    const label = ncx.cncx.get(e.tags.get(3)?.[0] ?? -1)?.trim();
    if (pos === undefined || !label) continue;
    const at = parts.findIndex((p) => pos >= p.from && pos < p.to);
    if (at >= 0 && !names.has(at)) names.set(at, { title: label, depth: e.tags.get(4)?.[0] ?? 0 });
  }
  return names;
}

/** KF8: each page rebuilt from its skeleton and fragments, named from the book's contents. */
function kf8Chapters(text: Uint8Array, h: Header, rec: (i: number) => Uint8Array | undefined, resource: (n: number) => string | null): Chapter[] {
  let flow = text;
  const fdst = h.fdst !== NONE ? rec(h.fdst) : undefined;
  if (fdst && ascii(fdst, 0, 4) === 'FDST' && u32(fdst, 8) > 0) flow = text.subarray(u32(fdst, 12), Math.min(text.length, u32(fdst, 16)));

  const skel = readIndex(rec, h.skel).entries.map((e) => ({ count: e.tags.get(1)?.[0] ?? 0, pos: e.tags.get(6)?.[0] ?? 0, len: e.tags.get(6)?.[1] ?? 0 }));
  const frag = readIndex(rec, h.frag).entries.map((e) => ({ insert: parseInt(e.key, 10), len: e.tags.get(6)?.[1] ?? 0 }));

  const parts: { html: string; from: number; to: number }[] = [];
  if (!skel.length) parts.push({ html: decode(flow, 'utf-8'), from: 0, to: flow.length });
  let f = 0;
  for (const s of skel) {
    let page = flow.subarray(s.pos, s.pos + s.len);
    let base = s.pos + s.len;
    for (let j = 0; j < s.count && f < frag.length; j++, f++) {
      const piece = flow.subarray(base, base + frag[f].len);
      const at = Math.max(0, Math.min(page.length, frag[f].insert - s.pos));
      const next = new Uint8Array(page.length + piece.length);
      next.set(page.subarray(0, at), 0);
      next.set(piece, at);
      next.set(page.subarray(at), at + piece.length);
      page = next;
      base += frag[f].len;
    }
    parts.push({ html: decode(page, 'utf-8'), from: s.pos, to: base });
  }

  const names = contentsNames(readIndex(rec, h.ncx), parts);

  const embed = (src: string) => {
    const m = /kindle:embed:([0-9A-V]+)/i.exec(src);
    return m ? resource(parseInt(m[1], 32) - 1) : null;
  };
  return parts.map((p, i) => {
    const html = bodyOf(p.html).replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\ssrc=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
      const path = embed(src);
      return path ? `<img src="../${path}" alt=""/>` : '';
    });
    const n = names.get(i);
    return { html, title: n?.title ?? null, depth: n?.depth ?? 0 };
  });
}
