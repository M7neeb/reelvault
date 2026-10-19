/**
 * Where the Audio section keeps files: Documents/audio/<id>/, one folder per
 * item (its audio file or files, its cover, and for an EPUB the extracted
 * book plus a small .book.json). Paths are always rebuilt from the folder's
 * relative name, never stored whole (iOS moves the app's folder on updates).
 *
 * Nothing here writes while you listen or read: a book is extracted once at
 * import, and the only files ever added later are a new cover.
 */

import { Platform } from 'react-native';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import type { BookJson } from './epub';
import type { ByteSource } from './zip';

const canUseFs = Platform.OS !== 'web';
const split = (p: string) => p.split('/').filter(Boolean);

export const audioRoot = canUseFs ? new Directory(Paths.document, 'audio') : (undefined as unknown as Directory);
export const BOOK_JSON = '.book.json';

export function ensureAudioRoot(): void {
  if (canUseFs && !audioRoot.exists) audioRoot.create({ intermediates: true });
}

export const folderFor = (id: string) => `audio/${id}`;

export function itemDir(folder: string): Directory {
  return new Directory(Paths.document, ...split(folder));
}

export function fileIn(folder: string, rel: string): File {
  return new File(itemDir(folder), ...split(rel));
}

export function fileUri(folder: string, rel: string): string {
  if (!canUseFs) return '';
  return fileIn(folder, rel).uri;
}

export function removeFolder(folder: string): void {
  try {
    const d = itemDir(folder);
    if (d.exists) d.delete();
  } catch (e) {
    console.log(`[AUDIO] could not remove ${folder}: ${String(e)}`);
  }
}

/** Bytes the folder takes (walks it; small folders, so cheap). */
export function folderBytes(folder: string): number {
  const walk = (d: Directory): number => {
    let n = 0;
    for (const x of d.list()) n += x instanceof Directory ? walk(x) : (x.size ?? 0);
    return n;
  };
  try {
    const d = itemDir(folder);
    return d.exists ? walk(d) : 0;
  } catch {
    return 0;
  }
}

/** A file you can read at any offset, a piece at a time. Close it when done. */
export function openSource(file: File): ByteSource & { close(): void } {
  const h = file.open(FileMode.ReadOnly);
  const size = h.size ?? file.size ?? 0;
  return {
    size,
    read(offset: number, length: number) {
      const n = Math.max(0, Math.min(length, size - offset));
      if (!n) return new Uint8Array(0);
      h.offset = offset;
      return h.readBytes(n);
    },
    close() {
      try {
        h.close();
      } catch {
        // already closed
      }
    },
  };
}

/** A new file written a piece at a time. */
export function openSink(file: File): { write(bytes: Uint8Array): void; close(): void } {
  if (file.exists) file.delete();
  file.create({ intermediates: true });
  const h = file.open(FileMode.ReadWrite);
  return {
    write(bytes) {
      if (bytes.length) h.writeBytes(bytes);
    },
    close() {
      try {
        h.close();
      } catch {
        // already closed
      }
    },
  };
}

export function readBookJson(folder: string): BookJson | null {
  try {
    const f = fileIn(folder, BOOK_JSON);
    if (!f.exists) return null;
    const v = JSON.parse(f.textSync());
    return v && v.v === 1 ? (v as BookJson) : null;
  } catch (e) {
    console.log(`[AUDIO] book info unreadable in ${folder}: ${String(e)}`);
    return null;
  }
}

export function readTextIn(folder: string, rel: string): string | null {
  try {
    const f = fileIn(folder, rel);
    return f.exists ? f.textSync() : null;
  } catch {
    return null;
  }
}
