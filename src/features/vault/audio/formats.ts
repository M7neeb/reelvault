/**
 * Which files the Audio section takes: audio the iPhone can play (MP3, M4A /
 * M4B audiobooks, AAC, WAV, AIFF, CAF, FLAC, ALAC, Opus) and EPUB 3 books
 * (with read-along when they have media overlays). Pure: no React, no native
 * modules (tested in Node).
 */

export const AUDIO_EXT = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'aif', 'aiff', 'aifc', 'caf', 'flac', 'alac', 'opus', 'oga', 'ogg', 'mp2', 'amr', '3ga'] as const;
export const BOOK_EXT = ['epub'] as const;

/** What the Files picker is asked for. */
export const AUDIO_PICKER_TYPES = ['audio/*', 'application/epub+zip'];

export type AudioKind = 'audio' | 'book';

export function extOf(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const i = clean.lastIndexOf('.');
  return i > 0 ? clean.slice(i + 1).toLowerCase() : '';
}

export const isAudioName = (name: string) => (AUDIO_EXT as readonly string[]).includes(extOf(name));
export const isBookName = (name: string) => (BOOK_EXT as readonly string[]).includes(extOf(name));

/** 'audio', 'book' or null (not for the Audio section). */
export function audioKindOf(name: string): AudioKind | null {
  if (isAudioName(name)) return 'audio';
  if (isBookName(name)) return 'book';
  return null;
}

/** A readable title from a file name: "03 - The_Long_Way.mp3" → "The Long Way". */
export function titleFromName(name: string): string {
  const last = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '');
  const t = last
    .replace(/[_]+/g, ' ')
    .replace(/^\s*(?:track\s*)?\d{1,3}\s*[-–.)]\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t || last;
}

/** Leading number of a file name ("03 - x" → 3), for putting a book's files in order. */
export function trackNumberOf(name: string): number | null {
  const m = /^\s*(?:track\s*|chapter\s*|ch\s*|part\s*)?(\d{1,4})\b/i.exec((name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, ''));
  return m ? Number(m[1]) : null;
}

/** Files of one book in reading order: by track number, then by name (natural order). */
export function sortTracks<T extends { name: string; track?: number | null }>(files: T[]): T[] {
  const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
  return [...files].sort((a, b) => {
    const ta = a.track ?? trackNumberOf(a.name);
    const tb = b.track ?? trackNumberOf(b.name);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    return collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name);
  });
}
