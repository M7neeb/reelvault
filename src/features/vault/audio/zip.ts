/**
 * Reading and writing ZIP files (an EPUB is one) a piece at a time.
 *
 * Why not unzip into memory: an EPUB with its narration can be hundreds of
 * MB. Here the central directory is read from the end of the file, and each
 * entry is copied out in small chunks (stored entries as they are, deflated
 * ones through a streaming inflater), so memory stays flat whatever the size.
 * The book is extracted once, at import; nothing is ever unpacked again while
 * you read or listen (other EPUB players re-extract into caches that keep
 * growing - that is the storage problem this avoids).
 *
 * Works on a `ByteSource` (read bytes at an offset), so it is tested in Node
 * with a buffer and runs on the phone over a file handle. Pure otherwise.
 */

import { Inflate, strFromU8, strToU8 } from 'fflate';

export type ByteSource = { size: number; read(offset: number, length: number): Uint8Array };

export type ZipEntry = {
  name: string;
  /** 0 = stored, 8 = deflated. */
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  localOffset: number;
  isDir: boolean;
};

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;
const FULL32 = 0xffffffff;

/* ---------------------------------------------------------------- crc-32 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Running CRC-32: start with 0, feed chunks, the result is the file's CRC. */
export function crc32(chunk: Uint8Array, prev = 0): number {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------- reading */

/** The list of files in a ZIP, from its central directory. */
export function readZipIndex(src: ByteSource): ZipEntry[] {
  // The end-of-central-directory record is in the last 22 bytes + up to 64 KB of comment.
  const tail = Math.min(src.size, 22 + 65_535);
  const end = src.read(src.size - tail, tail);
  let eocd = -1;
  for (let i = end.length - 22; i >= 0; i--) {
    if (end[i] === 0x50 && end[i + 1] === 0x4b && end[i + 2] === 0x05 && end[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end record)');
  let count = u16(end, eocd + 10);
  let cdSize = u32(end, eocd + 12);
  let cdOffset = u32(end, eocd + 16);
  // ZIP64 (big files, or tools that always write it, like Tachimanga's backups):
  // the real numbers are in the ZIP64 end record, found through the locator just before.
  const loc = eocd - 20;
  if (loc >= 0 && u32(end, loc) === 0x07064b50) {
    const at = u64(end, loc + 8);
    const z = src.read(at, 56);
    if (u32(z, 0) === 0x06064b50) {
      count = u64(z, 32);
      cdSize = u64(z, 40);
      cdOffset = u64(z, 48);
    }
  } else if (cdOffset === FULL32 || count === 0xffff) throw new Error('Broken ZIP (its ZIP64 record is missing)');
  const cd = src.read(cdOffset, cdSize);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (u32(cd, p) !== 0x02014b50) throw new Error('Broken ZIP directory');
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const crc = u32(cd, p + 16);
    let compressedSize = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let localOffset = u32(cd, p + 42);
    const rawName = cd.subarray(p + 46, p + 46 + nameLen);
    // ZIP64 extra field: 8-byte values for whichever of the three were too big (in this order).
    if (size === FULL32 || compressedSize === FULL32 || localOffset === FULL32) {
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = u16(cd, x);
        const len = u16(cd, x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (size === FULL32) (size = u64(cd, q)), (q += 8);
          if (compressedSize === FULL32) (compressedSize = u64(cd, q)), (q += 8);
          if (localOffset === FULL32) localOffset = u64(cd, q);
          break;
        }
        x += 4 + len;
      }
    }
    // Bit 11 = UTF-8 names; older tools wrote Latin-1 (EPUB names are ASCII in practice).
    const name = flags & 0x800 ? strFromU8(rawName) : Array.from(rawName, (c) => String.fromCharCode(c)).join('');
    out.push({ name, method, compressedSize, size, crc, localOffset, isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Where an entry's bytes start (after its local header). */
export function dataOffset(src: ByteSource, e: ZipEntry): number {
  const h = src.read(e.localOffset, 30);
  if (u32(h, 0) !== 0x04034b50) throw new Error(`Broken ZIP entry ${e.name}`);
  return e.localOffset + 30 + u16(h, 26) + u16(h, 28);
}

const pause = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Copies one entry out, `chunk` bytes at a time, into `write`. Checks the
 * CRC at the end. Yields between chunks so the screen stays responsive.
 */
export async function extractEntry(src: ByteSource, e: ZipEntry, write: (bytes: Uint8Array) => void, chunk = 512 * 1024): Promise<void> {
  if (e.method !== 0 && e.method !== 8) throw new Error(`${e.name}: unsupported compression (${e.method})`);
  const start = dataOffset(src, e);
  let crc = 0;
  let produced = 0;
  const out = (b: Uint8Array) => {
    if (!b.length) return;
    crc = crc32(b, crc);
    produced += b.length;
    write(b);
  };
  if (e.method === 0) {
    for (let o = 0; o < e.compressedSize; o += chunk) {
      out(src.read(start + o, Math.min(chunk, e.compressedSize - o)));
      await pause();
    }
  } else {
    const inflater = new Inflate((data) => out(data));
    for (let o = 0; o < e.compressedSize; o += chunk) {
      const last = o + chunk >= e.compressedSize;
      inflater.push(src.read(start + o, Math.min(chunk, e.compressedSize - o)), last);
      await pause();
    }
    if (e.compressedSize === 0) inflater.push(new Uint8Array(0), true);
  }
  if (produced !== e.size) throw new Error(`${e.name}: size mismatch (${produced} of ${e.size})`);
  if (crc !== e.crc) throw new Error(`${e.name}: damaged (checksum)`);
}

/** A small entry (XML, XHTML) as bytes. */
export async function readEntry(src: ByteSource, e: ZipEntry): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  await extractEntry(src, e, (b) => parts.push(b.slice()));
  const all = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return all;
}

export async function readEntryText(src: ByteSource, e: ZipEntry): Promise<string> {
  return strFromU8(await readEntry(src, e));
}

/** A path inside a ZIP that is safe to write under a folder: no "..", no absolute paths. */
export function safeEntryPath(name: string): string | null {
  const parts = name.replace(/\\/g, '/').split('/').filter((x) => x !== '' && x !== '.');
  if (!parts.length || parts.some((x) => x === '..') || /^[a-z]:$/i.test(parts[0])) return null;
  return parts.join('/');
}

/* --------------------------------------------------------------- writing */

export type ZipWriter = {
  /** Adds a file. `chunks` yields its bytes; `stored` for the EPUB mimetype (needs `crc` and `size` known). */
  add(name: string, chunks: () => AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<void>;
  addStored(name: string, bytes: Uint8Array): void;
  finish(): void;
};

/**
 * Writes a ZIP with every file stored (not compressed - the narration is
 * already compressed audio), streaming: each file's size and CRC go in a
 * data descriptor after it, so nothing is held in memory.
 */
export function zipWriter(write: (bytes: Uint8Array) => void): ZipWriter {
  let offset = 0;
  const central: Uint8Array[] = [];
  const emit = (b: Uint8Array) => {
    write(b);
    offset += b.length;
  };
  const header = (sig: number, fields: [number, number][]) => {
    const size = 4 + fields.reduce((a, [, n]) => a + n, 0);
    const b = new Uint8Array(size);
    const put = (v: number, n: number, at: number) => {
      for (let i = 0; i < n; i++) b[at + i] = (v / 2 ** (8 * i)) & 0xff;
    };
    put(sig, 4, 0);
    let at = 4;
    for (const [v, n] of fields) {
      put(v, n, at);
      at += n;
    }
    return b;
  };
  const record = (nameBytes: Uint8Array, flags: number, crc: number, size: number, local: number) => {
    const h = header(0x02014b50, [
      [20, 2], [20, 2], [flags, 2], [0, 2], [0, 2], [0x21, 2], [crc, 4], [size, 4], [size, 4], [nameBytes.length, 2], [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [local, 4],
    ]);
    const c = new Uint8Array(h.length + nameBytes.length);
    c.set(h);
    c.set(nameBytes, h.length);
    central.push(c);
  };
  return {
    addStored(name, bytes) {
      const nameBytes = strToU8(name);
      const crc = crc32(bytes);
      const local = offset;
      emit(header(0x04034b50, [[20, 2], [0x800, 2], [0, 2], [0, 2], [0x21, 2], [crc, 4], [bytes.length, 4], [bytes.length, 4], [nameBytes.length, 2], [0, 2]]));
      emit(nameBytes);
      emit(bytes);
      record(nameBytes, 0x800, crc, bytes.length, local);
    },
    async add(name, chunks) {
      const nameBytes = strToU8(name);
      const local = offset;
      const flags = 0x808; // UTF-8 name + sizes in a data descriptor
      emit(header(0x04034b50, [[20, 2], [flags, 2], [0, 2], [0, 2], [0x21, 2], [0, 4], [0, 4], [0, 4], [nameBytes.length, 2], [0, 2]]));
      emit(nameBytes);
      let crc = 0;
      let size = 0;
      for await (const c of chunks()) {
        crc = crc32(c, crc);
        size += c.length;
        emit(c);
      }
      if (size >= 0xffffffff) throw new Error(`${name} is larger than 4 GB`);
      emit(header(0x08074b50, [[crc, 4], [size, 4], [size, 4]]));
      record(nameBytes, flags, crc, size, local);
    },
    finish() {
      const start = offset;
      for (const c of central) emit(c);
      emit(header(0x06054b50, [[0, 2], [0, 2], [central.length, 2], [central.length, 2], [offset - start, 4], [start, 4], [0, 2]]));
    },
  };
}
