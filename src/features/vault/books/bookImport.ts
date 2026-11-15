/**
 * Turns any book file into the folder the reader opens (native wiring for the
 * pure converters in ./formats): EPUBs are unpacked as they are, PDFs become
 * page pictures drawn by the phone, comics (.cbz) have their pictures taken
 * out, and everything else (Kindle, FB2, Word, RTF, HTML, text) is converted
 * to chapters here. Each ends with the same .book.json.
 */

import { Directory, File } from 'expo-file-system';

import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import { BOOK_JSON, fileIn, itemDir, openSink, openSource } from '../audio/audioFiles';
import { unpackBook } from '../audio/audioImport';
import type { BookJson } from '../audio/epub';
import { extractEntry, readZipIndex } from '../audio/zip';
import { bookFormat, comicPages, convertBook, pagesToBook, pdfInfo, type Converted } from './formats';
import { decode } from './formats/bytes';

// Give the screen a moment to show the latest message before a long, blocking step.
const breathe = () => new Promise((r) => setTimeout(r, 40));

function writeConverted(folder: string, conv: Converted): BookJson {
  for (const f of conv.files) {
    const out = fileIn(folder, f.path);
    if (typeof f.data === 'string') {
      out.create({ intermediates: true, overwrite: true });
      out.write(f.data);
    } else {
      const sink = openSink(out);
      try {
        sink.write(f.data);
      } finally {
        sink.close();
      }
    }
  }
  const json = fileIn(folder, BOOK_JSON);
  json.create({ intermediates: true, overwrite: true });
  json.write(JSON.stringify(conv.book));
  return conv.book;
}

/** Title and author from the start and end of a PDF (where its Info dictionary usually is). */
function pdfMeta(file: File, name: string) {
  const src = openSource(file);
  try {
    const head = decode(src.read(0, 65_536), 'windows-1252');
    const tail = decode(src.read(Math.max(0, src.size - 131_072), 131_072), 'windows-1252');
    const meta = pdfInfo(tail + head);
    return { ...meta, title: meta.title ?? name.replace(/\.pdf$/i, '') };
  } finally {
    src.close();
  }
}

async function pdfBook(file: File, name: string, folder: string, onStep: (t: string) => void): Promise<BookJson> {
  const media = ReelVaultMedia;
  if (!media?.pdfPages) throw new Error('PDFs open after the next app update (a new install from SideStore). EPUB, Kindle and the other formats work now.');
  onStep('Drawing the pages… this takes a while for a long PDF');
  const dir = new Directory(itemDir(folder), 'pages');
  dir.create({ intermediates: true, idempotent: true });
  const count = await media.pdfPages(file.uri, dir.uri, 1600, 0.8);
  if (count <= 0) throw new Error('This PDF has no pages that could be read');
  const pages = Array.from({ length: count }, (_, i) => `pages/${String(i + 1).padStart(4, '0')}.jpg`);
  return writeConverted(folder, pagesToBook(pages, pdfMeta(file, name)));
}

async function comicBook(file: File, name: string, folder: string, onStep: (t: string) => void): Promise<BookJson> {
  const src = openSource(file);
  const pages: string[] = [];
  try {
    const entries = readZipIndex(src).filter((e) => !e.isDir);
    const order = comicPages(entries.map((e) => e.name));
    for (const [i, entryName] of order.entries()) {
      const e = entries.find((x) => x.name === entryName)!;
      const ext = /\.([a-z]+)$/i.exec(entryName)?.[1]?.toLowerCase() ?? 'jpg';
      const rel = `pages/${String(i + 1).padStart(4, '0')}.${ext === 'jpeg' ? 'jpg' : ext}`;
      const sink = openSink(fileIn(folder, rel));
      try {
        await extractEntry(src, e, (b) => sink.write(b));
      } finally {
        sink.close();
      }
      pages.push(rel);
      if (i % 5 === 0) onStep(`Taking out the pages… ${i + 1} of ${order.length}`);
    }
  } finally {
    src.close();
  }
  return writeConverted(folder, pagesToBook(pages, { title: name.replace(/\.cbz$/i, '') }));
}

/** Reads the book at `file` into `folder` (Documents/books/<id>) and returns its description. */
export async function importBookFile(file: File, name: string, folder: string, onStep: (t: string) => void): Promise<BookJson> {
  const src = openSource(file);
  let head: Uint8Array;
  try {
    head = src.read(0, 512);
  } finally {
    src.close();
  }
  const format = bookFormat(name, head);
  if (format === 'epub') return unpackBook(file, folder, onStep);
  if (format === 'pdf') return pdfBook(file, name, folder, onStep);
  if (format === 'cbz') return comicBook(file, name, folder, onStep);

  onStep('Reading the book…');
  await breathe();
  const all = openSource(file);
  let bytes: Uint8Array;
  try {
    bytes = all.read(0, all.size);
  } finally {
    all.close();
  }
  onStep('Turning it into pages…');
  await breathe();
  return writeConverted(folder, convertBook(format, bytes));
}
