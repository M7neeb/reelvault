import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File } from 'expo-file-system';

import { insertVideo } from './repo';
import { probeDurationMs } from './duration';
import { ensureDirs, thumbsDir, videosDir } from './storage';

export type ImportSummary = {
  imported: number;
  failed: string[];
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : 'mp4';
}

/**
 * Copy each picked video into app storage, make a thumbnail, and record it.
 * One bad file never aborts the batch — failures are collected and logged.
 */
export async function importAssets(
  assets: DocumentPicker.DocumentPickerAsset[]
): Promise<ImportSummary> {
  ensureDirs();
  const failed: string[] = [];
  let imported = 0;

  for (const asset of assets) {
    try {
      const id = Crypto.randomUUID();
      const destination = new File(videosDir, `${id}.${extOf(asset.name)}`);
      await new File(asset.uri).copy(destination);

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

      const durationMs = await probeDurationMs(destination.uri);

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
      });

      imported++;
      console.log(`[IMPORT] ok ${asset.name} → ${id} (${size} bytes)`);
    } catch (e) {
      failed.push(asset.name);
      console.log(`[IMPORT] FAILED ${asset.name}: ${String(e)}`);
    }
  }

  console.log(`[IMPORT] done — ${imported} imported, ${failed.length} failed`);
  return { imported, failed };
}
