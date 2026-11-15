/**
 * Small helpers the book converters share: big-endian numbers, text in the
 * encodings old books use (UTF-8, UTF-16, Windows-1252 and -1251), base64,
 * and HTML escaping. Pure: no React, no native modules (tested in Node).
 */

export const u8 = (b: Uint8Array, at: number) => b[at] ?? 0;
export const u16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
export const u32 = (b: Uint8Array, at: number) => (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
export const ascii = (b: Uint8Array, at: number, len: number) => {
  let s = '';
  for (let i = at; i < at + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

// The top half of the two single-byte code pages books still turn up in.
const CP1252 =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ';
const CP1251 =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';

export type Charset = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' | 'windows-1251';

export function charsetOf(label: string | null | undefined): Charset | null {
  const l = (label ?? '').trim().toLowerCase();
  if (!l) return null;
  if (l === 'utf-8' || l === 'utf8') return 'utf-8';
  if (l === 'utf-16' || l === 'utf-16le') return 'utf-16le';
  if (l === 'utf-16be') return 'utf-16be';
  if (l === 'windows-1251' || l === 'cp1251') return 'windows-1251';
  if (l === 'windows-1252' || l === 'cp1252' || l === 'iso-8859-1' || l === 'latin1' || l === 'us-ascii' || l === 'ascii') return 'windows-1252';
  return null;
}

function utf8(b: Uint8Array, start: number, end: number): string {
  let out = '';
  let chunk: number[] = [];
  const push = (cp: number) => {
    chunk.push(cp);
    if (chunk.length >= 8192) {
      out += String.fromCodePoint(...chunk);
      chunk = [];
    }
  };
  for (let i = start; i < end; ) {
    const c = b[i];
    if (c < 0x80) {
      push(c);
      i++;
    } else if (c >= 0xc2 && c < 0xe0 && i + 1 < end && (b[i + 1] & 0xc0) === 0x80) {
      push(((c & 0x1f) << 6) | (b[i + 1] & 0x3f));
      i += 2;
    } else if (c >= 0xe0 && c < 0xf0 && i + 2 < end && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80) {
      const cp = ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
      push(cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp);
      i += 3;
    } else if (c >= 0xf0 && c < 0xf5 && i + 3 < end && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80 && (b[i + 3] & 0xc0) === 0x80) {
      const cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
      push(cp > 0x10ffff ? 0xfffd : cp);
      i += 4;
    } else {
      push(0xfffd);
      i++;
    }
  }
  if (chunk.length) out += String.fromCodePoint(...chunk);
  return out;
}

/** True when the bytes are valid UTF-8 (pure ASCII counts). */
export function isUtf8(b: Uint8Array, limit = b.length): boolean {
  const end = Math.min(limit, b.length);
  for (let i = 0; i < end; ) {
    const c = b[i];
    const need = c < 0x80 ? 0 : c >= 0xc2 && c < 0xe0 ? 1 : c >= 0xe0 && c < 0xf0 ? 2 : c >= 0xf0 && c < 0xf5 ? 3 : -1;
    if (need < 0) return false;
    // A character cut off at the limit is fine.
    for (let k = 1; k <= need; k++) if (i + k < end && (b[i + k] & 0xc0) !== 0x80) return false;
    i += need + 1;
  }
  return true;
}

/** Windows-1251 (Cyrillic) or -1252 (Western) for bytes that are not UTF-8: Cyrillic text is mostly in the top quarter. */
export function guessSingleByte(b: Uint8Array): 'windows-1251' | 'windows-1252' {
  let high = 0;
  let cyr = 0;
  for (let i = 0; i < Math.min(b.length, 200_000); i++) {
    if (b[i] < 0x80) continue;
    high++;
    if (b[i] >= 0xc0) cyr++;
  }
  return high > 20 && cyr / high > 0.85 ? 'windows-1251' : 'windows-1252';
}

export function decode(b: Uint8Array, charset?: Charset | null, start = 0, end = b.length): string {
  let cs = charset ?? null;
  if (!cs) {
    if (b[start] === 0xef && b[start + 1] === 0xbb && b[start + 2] === 0xbf) cs = 'utf-8';
    else if (b[start] === 0xff && b[start + 1] === 0xfe) cs = 'utf-16le';
    else if (b[start] === 0xfe && b[start + 1] === 0xff) cs = 'utf-16be';
    else cs = isUtf8(b.subarray(start, end), 400_000) ? 'utf-8' : guessSingleByte(b.subarray(start, end));
  }
  if (cs === 'utf-8') {
    const bom = b[start] === 0xef && b[start + 1] === 0xbb && b[start + 2] === 0xbf ? 3 : 0;
    return utf8(b, start + bom, end);
  }
  if (cs === 'utf-16le' || cs === 'utf-16be') {
    const le = cs === 'utf-16le';
    let s = start;
    if ((le && b[s] === 0xff && b[s + 1] === 0xfe) || (!le && b[s] === 0xfe && b[s + 1] === 0xff)) s += 2;
    const units: number[] = [];
    let out = '';
    for (let i = s; i + 1 < end; i += 2) {
      units.push(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
      if (units.length >= 8192) {
        out += String.fromCharCode(...units);
        units.length = 0;
      }
    }
    return out + String.fromCharCode(...units);
  }
  const table = cs === 'windows-1251' ? CP1251 : CP1252;
  let out = '';
  for (let i = start; i < end; i++) out += b[i] < 0x80 ? String.fromCharCode(b[i]) : table[b[i] - 0x80];
  return out;
}

export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out[n++] = (a << 2) | (b >> 4);
    if (c >= 0) out[n++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[n++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, n);
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The kind of picture, from its first bytes. */
export function imageType(b: Uint8Array): { ext: string; mime: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', mime: 'image/gif' };
  if (b[0] === 0x42 && b[1] === 0x4d) return { ext: 'bmp', mime: 'image/bmp' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
