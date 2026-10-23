/**
 * Where the Manga section keeps files: Documents/manga/<series>/, with the
 * series' cover and one folder per chapter holding its pages (0001.jpg,
 * 0002.png...). Paths are always rebuilt from the relative folder name,
 * never stored whole (iOS moves the app's folder on updates).
 */

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

const canUseFs = Platform.OS !== 'web';
const split = (p: string) => p.split('/').filter(Boolean);

export const mangaRoot = canUseFs ? new Directory(Paths.document, 'manga') : (undefined as unknown as Directory);

export function ensureMangaRoot(): void {
  if (canUseFs && !mangaRoot.exists) mangaRoot.create({ intermediates: true });
}

export const seriesFolderFor = (seriesId: string) => `manga/${seriesId}`;
export const chapterFolderFor = (seriesId: string, chapterId: string) => `manga/${seriesId}/${chapterId}`;

export function dirOf(folder: string): Directory {
  return new Directory(Paths.document, ...split(folder));
}

export function fileIn(folder: string, rel: string): File {
  return new File(dirOf(folder), ...split(rel));
}

export function fileUri(folder: string, rel: string): string {
  if (!canUseFs) return '';
  return fileIn(folder, rel).uri;
}

export function removeDir(folder: string): void {
  try {
    const d = dirOf(folder);
    if (d.exists) d.delete();
  } catch (e) {
    console.log(`[MANGA] could not remove ${folder}: ${String(e)}`);
  }
}

/** Bytes a folder takes (walks it). */
export function dirBytes(folder: string): number {
  const walk = (d: Directory): number => {
    let n = 0;
    for (const x of d.list()) n += x instanceof Directory ? walk(x) : (x.size ?? 0);
    return n;
  };
  try {
    const d = dirOf(folder);
    return d.exists ? walk(d) : 0;
  } catch {
    return 0;
  }
}
