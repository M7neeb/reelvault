import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File } from 'expo-file-system';

import { contentKeyOf } from './contentKey';
import { findByContentKey, insertVideo } from './repo';
import { probeDurationMs } from './duration';
import { ensureDirs, thumbsDir, videosDir } from './storage';

export type ImportSummary = {
  imported: number;
  /** Already in the vault (same content key) - skipped, temp copy removed. */
  duplicates: string[];
  /** Imported, but no duration could be read - may not play. */
  unverified: string[];
  failed: string[];
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : 'mp4';
}

function removeQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch (e) {
    console.log(`[IMPORT] could not remove ${file.uri}: ${String(e)}`);
  }
}

/**
 * Bring each picked video into app storage, make a thumbnail, and record it.
 *
 * The picker already hands over a temporary copy, so the file is MOVED into
 * ReelVault's folder, not copied: copying would hold a third copy of every
 * video on a phone with little free space. Videos already in the vault are
 * skipped. One bad file never aborts the batch.
 */
export async function importAssets(
  assets: DocumentPicker.DocumentPickerAsset[],
  onProgress?: (done: number, total: number) => void
): Promise<ImportSummary> {
  ensureDirs();
  const summary: ImportSummary = { imported: 0, duplicates: [], unverified: [], failed: [] };

  for (const [index, asset] of assets.entries()) {
    onProgress?.(index, assets.length);
    const picked = new File(asset.uri);
    try {
      const contentKey = await contentKeyOf(picked.uri);
      if (contentKey && (await findByContentKey(contentKey))) {
        summary.duplicates.push(asset.name);
        removeQuietly(picked);
        console.log(`[IMPORT] duplicate skipped ${asset.name}`);
        continue;
      }

      const id = Crypto.randomUUID();
      const destination = new File(videosDir, `${id}.${extOf(asset.name)}`);
      try {
        await picked.move(destination);
      } catch (e) {
        // A move can fail across volumes; fall back to copy + remove the temp file.
        console.log(`[IMPORT] move failed (${String(e)}), copying ${asset.name}`);
        await new File(asset.uri).copy(destination);
        removeQuietly(new File(asset.uri));
      }

      let width: number | null = null;
      let height: number | null = null;
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(destination.uri, { time: 1000 });
        width = thumb.width;
        height = thumb.height;
        await new File(thumb.uri).copy(new File(thumbsDir, `${id}.jpg`));
      } catch (e) {
        console.log(`[IMPORT] thumbnail skipped for ${asset.name}: ${String(e)}`);
      }

      // A readable duration is the check that the video actually plays.
      const durationMs = await probeDurationMs(destination.uri);
      if (!durationMs) summary.unverified.push(asset.name);

      const now = Date.now();
      const size = destination.size ?? asset.size ?? 0;
      await insertVideo({
        id,
        uri: destination.uri,
        filename: asset.name,
        size,
        durationMs,
        width,
        height,
        rating: 0,
        title: null,
        notes: null,
        createdAt: now,
        importedAt: now,
        status: null,
        deletedAt: null,
        isPrivate: false,
        contentKey,
      });

      summary.imported++;
      console.log(`[IMPORT] ok ${asset.name} -> ${id} (${size} bytes)`);
    } catch (e) {
      summary.failed.push(asset.name);
      console.log(`[IMPORT] FAILED ${asset.name}: ${String(e)}`);
    }
  }
  onProgress?.(assets.length, assets.length);

  console.log(
    `[IMPORT] done - ${summary.imported} imported, ${summary.duplicates.length} duplicates, ` +
      `${summary.unverified.length} unverified, ${summary.failed.length} failed`
  );
  return summary;
}
