/**
 * Saving chapters as .cbz files: the pages plus a ComicInfo.xml (series,
 * number, people, summary, reading direction) and, for the first chapter,
 * the cover. They go to Documents/Exports/<series>/, which shows in the
 * Files app under On My iPhone › ReelVault, one file per chapter. Written a
 * piece at a time, so a big chapter never sits in memory.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { strToU8 } from 'fflate';

import { openSink, openSource } from '../audio/audioFiles';
import { zipWriter } from '../audio/zip';
import { fileIn } from './mangaFiles';
import { cbzName, comicInfoXml, safeFileName, type MangaChapter, type MangaSeries } from './mangaLogic';

export const exportsRoot = () => new Directory(Paths.document, 'Exports');

async function* chunksOf(file: File): AsyncIterable<Uint8Array> {
  const src = openSource(file);
  try {
    for (let o = 0; o < src.size; o += 512 * 1024) {
      yield src.read(o, 512 * 1024);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    src.close();
  }
}

/** One chapter as a .cbz in `dir`. The file. */
export async function writeCbz(series: MangaSeries, c: MangaChapter, dir: Directory): Promise<File> {
  if (!c.folder || !c.pages.length) throw new Error('This chapter is not on the phone (download it first)');
  if (!dir.exists) dir.create({ intermediates: true });
  const out = new File(dir, cbzName(series.title, c));
  const sink = openSink(out);
  try {
    const w = zipWriter((b) => sink.write(b));
    w.addStored('ComicInfo.xml', strToU8(comicInfoXml(series, c)));
    for (const p of c.pages) {
      const f = fileIn(c.folder, p);
      if (f.exists) await w.add(p, () => chunksOf(f));
    }
    w.finish();
  } catch (e) {
    sink.close();
    if (out.exists) out.delete();
    throw e;
  }
  sink.close();
  return out;
}

/** Chapters of a series as .cbz files in Exports/<series>/. How many, and where. */
export async function exportSeries(series: MangaSeries, chapters: MangaChapter[], onStep?: (t: string) => void): Promise<{ count: number; folder: string; skipped: number }> {
  const dir = new Directory(exportsRoot(), safeFileName(series.title, 60));
  const ready = chapters.filter((c) => c.folder && c.pages.length);
  for (const [i, c] of ready.entries()) {
    onStep?.(`Saving .cbz ${i + 1} of ${ready.length}…`);
    await writeCbz(series, c, dir);
  }
  if (series.cover && ready.length) {
    try {
      const cover = fileIn(series.folder, series.cover);
      const dest = new File(dir, 'cover.jpg');
      if (dest.exists) dest.delete();
      if (cover.exists) cover.copy(dest);
    } catch {
      // the cover is a nice extra
    }
  }
  return { count: ready.length, folder: `Exports/${safeFileName(series.title, 60)}`, skipped: chapters.length - ready.length };
}
