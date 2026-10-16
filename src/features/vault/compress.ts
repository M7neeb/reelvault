/**
 * "Make Smaller" (native half): re-encode a video, and only if the new file
 * is clearly smaller, swap it in place of the old one. The old file is moved
 * aside first and deleted last, so a crash in the middle never loses both.
 */

import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

import { ReelVaultCompress } from '../../../modules/reelvault-compress';
import { contentKeyOf } from './contentKey';
import { readVideoMeta } from './metadata';
import { recordSmaller } from './repo';
import { mergeMeta, spaceNeeded, worthKeeping, type CompressQuality } from './smaller';
import type { Video } from './types';

export type SmallerResult =
  | { kind: 'done'; before: number; after: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string };

/** False in Expo Go and in app builds from before Make Smaller (needs app 1.1). */
export function canMakeSmaller(): boolean {
  return ReelVaultCompress != null;
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

export async function makeSmaller(
  video: Video,
  quality: CompressQuality,
  onProgress: (fraction: number) => void
): Promise<SmallerResult> {
  const native = ReelVaultCompress;
  if (!native) return { kind: 'failed', reason: 'Needs the new app version (1.1).' };
  if (Paths.availableDiskSpace < spaceNeeded(video.size)) {
    return { kind: 'skipped', reason: 'not enough free space to re-encode it' };
  }
  const supported = await native.supportedQualities(video.uri);
  if (!supported.includes(quality)) return { kind: 'skipped', reason: 'this setting does not fit this video' };

  const jobId = Crypto.randomUUID();
  const ext = extOf(video.uri);
  const output = new File(Paths.cache, `smaller-${jobId}.${ext}`);
  const sub = native.addListener('onProgress', (e) => {
    if (e.jobId === jobId) onProgress(Math.min(1, Math.max(0, e.progress)));
  });
  currentJob = jobId;
  try {
    const { size } = await native.compress(video.uri, output.uri, quality, jobId);
    if (!worthKeeping(video.size, size)) {
      if (output.exists) output.delete();
      return { kind: 'skipped', reason: 'it is already about as small as it gets' };
    }

    // Swap: old file aside, new file in, old file deleted.
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
    await recordSmaller(video.id, {
      size,
      contentKey: key,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      metaJson: meta ? JSON.stringify(meta) : null,
    });
    console.log(`[SMALLER] ${video.filename}: ${video.size} -> ${size} bytes (${quality})`);
    return { kind: 'done', before: video.size, after: size };
  } catch (e) {
    if (output.exists) output.delete();
    const reason = e instanceof Error ? e.message : String(e);
    console.log(`[SMALLER] ${video.filename} failed: ${reason}`);
    return { kind: 'failed', reason };
  } finally {
    sub.remove();
    currentJob = null;
  }
}
