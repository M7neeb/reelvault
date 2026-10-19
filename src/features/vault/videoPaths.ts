/**
 * Where a video's file is now.
 *
 * Each video row stores the full address of its file
 * (file:///var/mobile/Containers/Data/Application/<id>/Documents/videos/<name>).
 * iOS can move the app's folder when the app is updated or reinstalled, which
 * changes the <id> part: the file is still there, under the new folder, but
 * the stored address points at the old one and the video won't play. So the
 * address is always rebuilt from the file's name and the current videos folder.
 *
 * Also: which files in Documents/Inbox are videos another app sent ("Open in
 * ReelVault") that never got imported, because the app closed part way
 * through a big batch. Pure: no React, no native modules.
 */

import { isVideoName } from './incoming.ts';

/** The stored address, moved to where the videos folder is now (unchanged when it isn't one of ReelVault's own files). */
export function relocateVideoUri(stored: string, videosDirUri: string): string {
  if (!stored || !videosDirUri) return stored;
  const m = /\/Documents\/videos\/([^/?#]+)$/.exec(stored);
  if (!m) return stored;
  const base = videosDirUri.endsWith('/') ? videosDirUri : `${videosDirUri}/`;
  return base + m[1];
}

export type InboxEntry = { name: string; modified: number; dir: boolean };

/**
 * Videos left in the Inbox: sent to ReelVault but not taken in (an import
 * moves each file out). Ones that arrived in the last `minAgeMs` are left
 * alone, because the import for them may still be on its way.
 */
export function strandedInbox(entries: InboxEntry[], now: number, minAgeMs = 2 * 60_000): string[] {
  return entries
    .filter((e) => !e.dir && isVideoName(e.name) && now - e.modified >= minAgeMs)
    .sort((a, b) => a.modified - b.modified)
    .map((e) => e.name);
}
