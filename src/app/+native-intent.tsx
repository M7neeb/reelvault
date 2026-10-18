/**
 * Addresses the app is opened with. A video sent from another app arrives as
 * a file:// address: it goes to the import queue and the app opens normally on
 * the library (instead of trying to show the file as a page). Everything else
 * (reelvault:// links, the Simkl sign-in) passes through unchanged.
 */

import { pushIncoming, isIncomingVideo } from '@/features/vault/incoming';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (isIncomingVideo(path)) {
    pushIncoming(path);
    return '/';
  }
  return path;
}
