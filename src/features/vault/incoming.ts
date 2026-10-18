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

/** Get every video sent in so far, and the ones that come later. */
export function onIncoming(fn: (uris: string[]) => void): () => void {
  listeners.add(fn);
  if (queue.length) fn(queue.splice(0));
  return () => {
    listeners.delete(fn);
  };
}
