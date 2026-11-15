/**
 * Every book format the shelf takes, by name and by its first bytes: which
 * converter reads it, or why it can't be read. EPUB and PDF are not here: an
 * EPUB is unpacked as it is, and a PDF's pages are drawn by the phone.
 * Pure: no React, no native modules (tested in Node).
 */

import { unzipSync } from 'fflate';

import { ascii } from './bytes.ts';
import type { Converted } from './book.ts';
import { fb2ToBook } from './fb2.ts';
import { htmlToBook } from './html.ts';
import { isKfx, mobiToBook } from './mobi.ts';
import { docxToBook, odtToBook, rtfToBook } from './office.ts';
import { textToBook } from './plainText.ts';
import { decode } from './bytes.ts';

export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'fb2' | 'fb2zip' | 'docx' | 'odt' | 'rtf' | 'html' | 'txt' | 'md' | 'cbz';

/** What the file picker lets through (iOS knows no type for most of these, so it is "any file" and checked here). */
export const BOOK_EXTENSIONS = ['epub', 'kepub', 'pdf', 'mobi', 'azw', 'azw3', 'kf8', 'prc', 'pdb', 'fb2', 'fbz', 'docx', 'odt', 'rtf', 'html', 'htm', 'xhtml', 'txt', 'text', 'md', 'markdown', 'cbz'];

const NOT_SUPPORTED: Record<string, string> = {
  kfx: 'KFX is Amazon’s newest format and can’t be read here. Convert it to AZW3 or EPUB with Calibre first.',
  azw4: 'AZW4 is a PDF inside a Kindle file. Get the PDF instead.',
  cbr: 'RAR comics (.cbr) can’t be opened. Use the .cbz version, or add comics in Manga.',
  cb7: '7-Zip comics (.cb7) can’t be opened. Use the .cbz version.',
  djvu: 'DjVu files can’t be opened here. A PDF or EPUB of the same book will work.',
  doc: 'Old Word files (.doc) can’t be opened. Save it as .docx in Word or Pages first.',
  pages: 'Pages documents can’t be opened. Export it as EPUB or Word (.docx) from Pages first.',
  lit: 'Microsoft Reader (.lit) books can’t be opened. Convert them to EPUB with Calibre first.',
  lrf: 'Sony Reader (.lrf) books can’t be opened. Convert them to EPUB with Calibre first.',
  ibooks: 'iBooks files can’t be opened. Export an EPUB instead.',
};

const extOf = (name: string) => {
  const n = name.toLowerCase();
  if (n.endsWith('.fb2.zip')) return 'fbz';
  if (n.endsWith('.kepub.epub')) return 'epub';
  return /\.([a-z0-9]+)$/.exec(n)?.[1] ?? '';
};

/** The format of a file, from its name and its first bytes (a wrong name is common). Throws with the reason when it can't be read. */
export function bookFormat(name: string, head: Uint8Array): BookFormat {
  const ext = extOf(name);
  if (NOT_SUPPORTED[ext]) throw new Error(NOT_SUPPORTED[ext]);
  if (isKfx(head)) throw new Error(NOT_SUPPORTED.kfx);
  if (ascii(head, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(head, 60, 8) === 'BOOKMOBI' || ascii(head, 60, 8) === 'TEXtREAd') return 'mobi';
  if (ascii(head, 0, 5) === '{\\rtf') return 'rtf';
  const zip = head[0] === 0x50 && head[1] === 0x4b;
  if (zip) {
    if (ascii(head, 30, 8) === 'mimetype') {
      const mt = ascii(head, 38, 60);
      if (mt.startsWith('application/epub+zip')) return 'epub';
      if (mt.startsWith('application/vnd.oasis.opendocument.text')) return 'odt';
    }
    if (ext === 'docx') return 'docx';
    if (ext === 'odt') return 'odt';
    if (ext === 'fbz' || ext === 'zip') return 'fb2zip';
    if (ext === 'cbz') return 'cbz';
    return 'epub';
  }
  const text = ascii(head, 0, 400).toLowerCase();
  if (text.includes('<fictionbook')) return 'fb2';
  if (ext === 'fb2') return 'fb2';
  if (['html', 'htm', 'xhtml'].includes(ext) || /<(!doctype html|html)\b/.test(text)) return 'html';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'txt' || ext === 'text' || !ext) return 'txt';
  if (['mobi', 'azw', 'azw3', 'kf8', 'prc', 'pdb'].includes(ext)) throw new Error('This Kindle file is damaged or not really a Kindle book');
  if (ext === 'epub' || ext === 'kepub') throw new Error('This EPUB is damaged (it is not a zip file)');
  throw new Error(`.${ext} files can’t be read as books. EPUB, PDF, AZW3, MOBI, FB2, Word, RTF, HTML and text work.`);
}

/** A book from a format that is read in JavaScript (everything but EPUB, PDF and CBZ, which are unpacked by the phone). */
export function convertBook(format: BookFormat, bytes: Uint8Array): Converted {
  switch (format) {
    case 'mobi':
      return mobiToBook(bytes);
    case 'fb2':
      return fb2ToBook(bytes);
    case 'fb2zip': {
      const files = unzipSync(bytes);
      const inner = Object.keys(files).find((k) => k.toLowerCase().endsWith('.fb2'));
      if (!inner) throw new Error('This zip has no .fb2 book inside');
      return fb2ToBook(files[inner]);
    }
    case 'docx':
      return docxToBook(bytes);
    case 'odt':
      return odtToBook(bytes);
    case 'rtf':
      return rtfToBook(bytes);
    case 'html':
      return htmlToBook(bytes);
    case 'md':
      return textToBook(decode(bytes), true);
    case 'txt':
      return textToBook(decode(bytes));
    default:
      throw new Error(`${format} is not read here`);
  }
}


export { comicPages, pagesToBook, pdfInfo } from './pages.ts';
export type { Converted } from './book.ts';
