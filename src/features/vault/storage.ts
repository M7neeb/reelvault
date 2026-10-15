import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * expo-file-system has no web implementation, and `Paths.document` is undefined
 * there. Both Directory objects below used to be built at module scope, so
 * importing this file in a browser threw before anything could render - which is
 * why the web bundle was blank and the UI could only ever be checked on a phone.
 *
 * The objects are now only constructed where the filesystem actually exists.
 * On web they are undefined and every function here bails, which is correct:
 * the browser is a design/preview surface, not a vault.
 */
const canUseFs = Platform.OS !== 'web';

/**
 * Where ReelVault keeps its own copies.
 * `document` (not `cache`) so iOS never deletes your videos to free space.
 */
export const videosDir = canUseFs
  ? new Directory(Paths.document, 'videos')
  : (undefined as unknown as Directory);
export const thumbsDir = canUseFs
  ? new Directory(Paths.document, 'thumbs')
  : (undefined as unknown as Directory);

export function ensureDirs(): void {
  if (!canUseFs) return;
  if (!videosDir.exists) videosDir.create({ intermediates: true });
  if (!thumbsDir.exists) thumbsDir.create({ intermediates: true });
}

export function thumbnailUri(videoId: string): string {
  if (!canUseFs) return '';
  return new File(thumbsDir, `${videoId}.jpg`).uri;
}

export function bytesToGb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

/** One sub-folder per video holds its filmstrip frames (thumbs/<id>/f0.jpg …). */
export function filmstripDir(videoId: string): Directory {
  return new Directory(thumbsDir, videoId);
}
