/**
 * Books made of page pictures: PDFs (the phone draws each page) and comics
 * in .cbz. Ten pages to a chapter, so the reader keeps your place by page.
 * Also the title and author a PDF carries in its Info dictionary.
 * Pure: no React, no native modules (tested in Node).
 */

import { decode } from './bytes.ts';
import { makeBook, type Converted, type Meta } from './book.ts';

export const PAGES_PER_CHAPTER = 10;

/** The book for page pictures already on disk (paths inside the book's folder, in order). */
export function pagesToBook(pages: string[], meta: Meta): Converted {
  if (!pages.length) throw new Error('No pages could be read from this file');
  const chapters = [];
  for (let i = 0; i < pages.length; i += PAGES_PER_CHAPTER) {
    const slice = pages.slice(i, i + PAGES_PER_CHAPTER);
    const last = i + slice.length;
    chapters.push({
      title: slice.length === 1 ? `Page ${i + 1}` : `Pages ${i + 1}–${last}`,
      html: slice.map((p, k) => `<p id="page-${i + k + 1}"><img src="../${p}" alt="Page ${i + k + 1}"/></p>`).join('\n'),
    });
  }
  return makeBook(meta, chapters, [], pages[0]);
}

/** Pictures in a comic archive, in reading order ("page 2" before "page 10"). */
export function comicPages(names: string[]): string[] {
  return names
    .filter((n) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** A PDF string, written literally "(...)" or in hex "<...>", as text (PDFDocEncoding or UTF-16). */
export function pdfString(raw: string): string {
  let bytes: number[] = [];
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/\s+/g, '');
    for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  } else {
    const s = raw.slice(1, -1);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== '\\') {
        bytes.push(c.charCodeAt(0) & 0xff);
        continue;
      }
      const n = s[++i];
      const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (n in map) bytes.push(map[n]);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) oct += s[++i];
        bytes.push(parseInt(oct, 8) & 0xff);
      }
    }
  }
  const b = Uint8Array.from(bytes);
  if (b[0] === 0xfe && b[1] === 0xff) return decode(b, 'utf-16be').trim();
  return decode(b, 'windows-1252').trim();
}

/** Title and author from a PDF's Info dictionary, when it is written plainly (not packed into an object stream). */
export function pdfInfo(text: string): Meta {
  const field = (name: string) => {
    const m = new RegExp(`/${name}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)`).exec(text);
    const v = m ? pdfString(m[1]) : '';
    return v && !/^(untitled|microsoft word|unknown)/i.test(v) ? v : null;
  };
  const author = field('Author');
  return { title: field('Title'), authors: author ? [author] : [] };
}
