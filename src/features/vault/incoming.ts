/**
 * Videos sent to ReelVault from another app: "Open in ReelVault" (or the
 * ReelVault icon in a share sheet) for a video file in Files, Safari's
 * downloads, a chat app and so on. iOS copies the file into the app and opens
 * it with a file:// address; the router hands that address here (see
 * app/+native-intent.tsx) and the vault imports it as soon as it is ready.
 * Pure: no React, no native modules.
 */

const VIDEO = /\.(mp4|mov|m4v|3gp|avi|mkv|webm|mts|m2ts|hevc)$/i;

const queue: string[] = [];
const listeners = new Set<(uris: string[]) => void>();

/** True for a file name that looks like a video ("IMG_1234.MOV"). */
export const isVideoName = (name: string) => VIDEO.test(name);

/** True for a file address that looks like a video. */
export function isIncomingVideo(path: string | null | undefined): boolean {
  if (!path || !/^file:\/\//i.test(path)) return false;
  try {
    return VIDEO.test(decodeURIComponent(path.split('?')[0]));
  } catch {
    return VIDEO.test(path.split('?')[0]);
  }
}

/** The file name, for the import list ("IMG_1234.MOV"). */
export function incomingName(path: string): string {
  const last = path.split('?')[0].split('/').pop() ?? 'video.mov';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function pushIncoming(path: string): void {
  if (!isIncomingVideo(path) || queue.includes(path)) return;
  queue.push(path);
  if (listeners.size) {
    const batch = queue.splice(0);
    for (const fn of listeners) fn(batch);
  }
}

/* --------------------------------------------------------- audio */

const AUDIO = /\.(mp3|m4a|m4b|aac|wav|aif|aiff|aifc|caf|flac|alac|opus|oga|ogg|mp2|amr|3ga)$/i;
const audioQueue: string[] = [];
const audioListeners = new Set<(uris: string[]) => void>();

/** True for a file address that looks like audio (for the Audio section). */
export function isIncomingAudio(path: string | null | undefined): boolean {
  if (!path || !/^file:\/\//i.test(path)) return false;
  try {
    return AUDIO.test(decodeURIComponent(path.split('?')[0]));
  } catch {
    return AUDIO.test(path.split('?')[0]);
  }
}

export function pushIncomingAudio(path: string): void {
  if (audioQueue.includes(path)) return;
  audioQueue.push(path);
  if (audioListeners.size) {
    const batch = audioQueue.splice(0);
    for (const fn of audioListeners) fn(batch);
  }
}

/** Get every audio file sent in so far, and the ones that come later. */
export function onIncomingAudio(fn: (uris: string[]) => void): () => void {
  audioListeners.add(fn);
  if (audioQueue.length) fn(audioQueue.splice(0));
  return () => {
    audioListeners.delete(fn);
  };
}

/** Get every video sent in so far, and the ones that come later. */
export function onIncoming(fn: (uris: string[]) => void): () => void {
  listeners.add(fn);
  if (queue.length) fn(queue.splice(0));
  return () => {
    listeners.delete(fn);
  };
}

/* ----------------------------------------------------- EPUB books */

const BOOK = /\.epub$/i;
const bookQueue: string[] = [];
const bookListeners = new Set<(uris: string[]) => void>();

/** True for a file address that looks like an EPUB book (for Books). */
export function isIncomingBook(path: string | null | undefined): boolean {
  if (!path || !/^file:\/\//i.test(path)) return false;
  try {
    return BOOK.test(decodeURIComponent(path.split('?')[0]));
  } catch {
    return BOOK.test(path.split('?')[0]);
  }
}

export function pushIncomingBook(path: string): void {
  if (bookQueue.includes(path)) return;
  bookQueue.push(path);
  if (bookListeners.size) {
    const batch = bookQueue.splice(0);
    for (const fn of bookListeners) fn(batch);
  }
}

/** Get every book sent in so far, and the ones that come later. */
export function onIncomingBook(fn: (uris: string[]) => void): () => void {
  bookListeners.add(fn);
  if (bookQueue.length) fn(bookQueue.splice(0));
  return () => {
    bookListeners.delete(fn);
  };
}
