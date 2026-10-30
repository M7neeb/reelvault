/**
 * The native half of Make Smaller and the video editor (trim, crop,
 * resolution, frame rate). The result either replaces the video or becomes
 * a new video next to it. When replacing, the old file is moved aside first
 * and deleted last, so a crash in the middle never loses both.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

import { ReelVaultCompress } from '../../../modules/reelvault-compress';
import { contentKeyOf } from './contentKey';
import { isTrimmed, nativeOptions, type EditPlan } from './edit';
import { keepAwake } from './awake';
import { readVideoMeta } from './metadata';
import { copyLinks, insertVideo, recordReplaced, setCoverAt } from './repo';
import { mergeMeta, spaceNeeded, worthKeeping } from './smaller';
import { coverFileName, filmstripDir, thumbsDir, videosDir } from './storage';
import { COVER_SIDE, frameTo } from './frames';
import type { Video } from './types';

export type EditResult =
  | { kind: 'done'; before: number; after: number; newId?: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string };

/** False in Expo Go and in app builds from before the encoder (needs app 1.1). */
export function canMakeSmaller(): boolean {
  return ReelVaultCompress != null;
}

/** The "How much smaller" strengths need the encoder from app build 18 (it takes a target bitrate). */
export function canChooseStrength(): boolean {
  try {
    return typeof ReelVaultCompress?.features === 'function' && ReelVaultCompress.features().includes('bitrateShare');
  } catch {
    return false;
  }
}

let currentJob: string | null = null;

/** Stops the export that is running now, if any. */
export function cancelMakeSmaller(): void {
  if (currentJob && ReelVaultCompress) ReelVaultCompress.cancel(currentJob);
}

function extOf(uri: string): string {
  const name = uri.split('/').pop() ?? '';
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : 'mp4';
}

function editedName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? `${filename.slice(0, dot)} (edited)${filename.slice(dot)}` : `${filename} (edited)`;
}

/** A fresh cover from the new file (the old one may show a part that was cut away). */
async function freshCover(videoId: string, uri: string): Promise<number | null> {
  try {
    const coverAt = Date.now();
    await frameTo(uri, 500, new File(thumbsDir, coverFileName(videoId, coverAt)), COVER_SIDE);
    return coverAt;
  } catch (e) {
    console.log(`[EDIT] new cover failed: ${String(e)}`);
    return null;
  }
}

function forgetFilmstrip(videoId: string): void {
  try {
    const dir: Directory = filmstripDir(videoId);
    if (dir.exists) dir.delete();
  } catch (e) {
    console.log(`[EDIT] old filmstrip not removed: ${String(e)}`);
  }
}

/**
 * Re-encode (or losslessly trim) one video.
 * - `replace`: the new file takes the old one's place; `onlyIfSmaller` skips
 *   results that do not save at least 10% (Make Smaller).
 * - `copy`: a new video with the same rating, keywords and albums.
 */
export async function editVideo(
  video: Video,
  plan: EditPlan,
  opts: { mode: 'replace' | 'copy'; onlyIfSmaller?: boolean },
  onProgress: (fraction: number) => void
): Promise<EditResult> {
  const native = ReelVaultCompress;
  if (!native) return { kind: 'failed', reason: 'Needs the new app version (1.1).' };
  if (Paths.availableDiskSpace < spaceNeeded(video.size)) {
    return { kind: 'skipped', reason: 'not enough free space to re-encode it' };
  }

  const jobId = Crypto.randomUUID();
  const ext = extOf(video.uri);
  const output = new File(Paths.cache, `edit-${jobId}.${ext}`);
  const sub = native.addListener('onProgress', (e) => {
    if (e.jobId === jobId) onProgress(Math.min(1, Math.max(0, e.progress)));
  });
  currentJob = jobId;
  // A batch of long episodes takes a while: don't let the phone lock and stop it.
  keepAwake('edit', true);
  try {
    const { size } = await native.edit(video.uri, output.uri, nativeOptions(plan), jobId);
    if (opts.onlyIfSmaller && !worthKeeping(video.size, size)) {
      if (output.exists) output.delete();
      return { kind: 'skipped', reason: 'it is already about as small as it gets' };
    }
    const changedPicture = isTrimmed(plan, video.durationMs) || plan.crop !== null;

    if (opts.mode === 'copy') {
      const id = Crypto.randomUUID();
      const destination = new File(videosDir, `${id}.${ext}`);
      await output.move(destination);
      const meta = mergeMeta(video.meta, await readVideoMeta(destination.uri));
      await insertVideo({
        ...video,
        id,
        uri: destination.uri,
        filename: editedName(video.filename),
        size,
        durationMs: meta?.durationMs ?? video.durationMs,
        width: meta?.width ?? video.width,
        height: meta?.height ?? video.height,
        importedAt: Date.now(),
        deletedAt: null,
        inTray: false,
        contentKey: await contentKeyOf(destination.uri),
        meta,
        coverAt: await freshCover(id, destination.uri),
        originalSize: null,
        originalKey: null,
      });
      await copyLinks(video.id, id);
      console.log(`[EDIT] ${video.filename}: new copy ${id} (${size} bytes)`);
      return { kind: 'done', before: video.size, after: size, newId: id };
    }

    // Replace: old file aside, new file in, old file deleted.
    const current = new File(video.uri);
    const aside = new File(Paths.cache, `before-${jobId}.${ext}`);
    await current.move(aside);
    try {
      await output.move(new File(video.uri));
    } catch (e) {
      await aside.move(new File(video.uri));
      throw e;
    }
    aside.delete();

    const key = (await contentKeyOf(video.uri)) ?? `${size}:${jobId}`;
    const meta = mergeMeta(video.meta, await readVideoMeta(video.uri));
    await recordReplaced(video.id, {
      size,
      contentKey: key,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      durationMs: meta?.durationMs ?? null,
      metaJson: meta ? JSON.stringify(meta) : null,
    });
    if (changedPicture) {
      forgetFilmstrip(video.id);
      // A hand-picked cover stays; the automatic one is made again from the new file.
      if (!video.coverAt) {
        const coverAt = await freshCover(video.id, video.uri);
        if (coverAt) await setCoverAt(video.id, coverAt);
      }
    }
    console.log(`[EDIT] ${video.filename}: ${video.size} -> ${size} bytes (replaced)`);
    return { kind: 'done', before: video.size, after: size };
  } catch (e) {
    if (output.exists) output.delete();
    const raw = e instanceof Error ? e.message : String(e);
    console.log(`[EDIT] ${video.filename} failed: ${raw}`);
    // Expo adds where in its own code the error passed through; that means nothing to people.
    const reason = raw.replace(/\s*\(at ExpoModulesCore[\s\S]*$/, '').trim() || raw;
    return { kind: 'failed', reason };
  } finally {
    keepAwake('edit', false);
    sub.remove();
    currentJob = null;
  }
}

/** Make Smaller: replace the file, but only when it saves at least 10%. */
export function makeSmaller(video: Video, plan: EditPlan, onProgress: (fraction: number) => void): Promise<EditResult> {
  return editVideo(video, plan, { mode: 'replace', onlyIfSmaller: true }, onProgress);
}
