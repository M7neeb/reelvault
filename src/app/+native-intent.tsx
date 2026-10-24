/**
 * Addresses the app is opened with. A video sent from another app arrives as
 * a file:// address: it goes to the import queue and the app opens normally on
 * the library (instead of trying to show the file as a page). The quick links
 * Audio files and EPUB books go to the Audio section the same way. The quick links
 * for a Control Center button (reelvault://favourite, memory, random) open
 * the library, which then plays what was asked for. Everything else (the
 * Simkl sign-in) passes through unchanged.
 */

import { pushIncoming, pushIncomingAudio, isIncomingAudio, isIncomingVideo } from '@/features/vault/incoming';
import { pushQuick, quickKind } from '@/features/vault/quickOpen';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (isIncomingVideo(path)) {
    pushIncoming(path);
    return '/';
  }
  // Audio and EPUB books go to the Audio section.
  if (isIncomingAudio(path)) {
    pushIncomingAudio(path);
    return '/';
  }
  // A sign-in page sending you back (AniList, Dropbox, OneDrive): the sign-in itself catches it; open the app normally.
  if (/^(?:reelvault:\/*|\/)auth\/(?:anilist|dropbox|onedrive)/i.test(path)) return '/';
  const quick = quickKind(path);
  if (quick) {
    pushQuick(quick);
    return '/';
  }
  return path;
}
