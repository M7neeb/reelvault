import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { contentKeyOf } from './contentKey';
import { findLikely, type DupChoice } from './dupMatch';
import { readVideoMeta } from './metadata';
import type { Mp4Meta } from './mp4';
import { findByContentKey, insertVideo, replaceVideoFile, setCoverAt, videosNearLength } from './repo';
import { probeDurationMs } from './duration';
import { coverFileName, ensureDirs, filmstripDir, thumbsDir, videosDir } from './storage';
import { COVER_SIDE, frameTo } from './frames';
import { addTagToVideo } from './tags';
import type { Video } from './types';

export type ImportSummary = {
  imported: number;
  /** Already in the vault and not imported (you chose "Don't import", or there was no one to ask). */
  duplicates: string[];
  /** Already in the vault: the one you had now uses the new file, keeping its info. */
  replaced: string[];
  /** Already in the vault, imported anyway as a second copy. */
  keptBoth: string[];
  /** Imported, but no duration could be read - may not play. */
  unverified: string[];
  failed: string[];
};

/** What the "already in your library" question is about. */
export type DuplicateInfo = {
  /** The file being imported. */
  name: string;
  size: number;
  durationMs: number | null;
  /** The video you already have. */
  existing: Video;
  /** True: the very same file. False: looks like the same video (see `reason`). */
  exact: boolean;
  reason: string;
  /** How many files of this import are still to come after this one. */
  remaining: number;
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
 * "Replace": the video you have gets the new file. Its id, rating, keywords,
 * plays, bookmarks and albums all stay. The old file is put aside first and
 * only deleted once the new one is in place, so a failure loses nothing.
 */
async function replaceExisting(existing: Video, incoming: File, name: string, contentKey: string | null): Promise<void> {
  const target = new File(videosDir, `${existing.id}.${extOf(name)}`);
  const old = new File(existing.uri);
  const aside = new File(Paths.cache, `replaced-${existing.id}-${Date.now()}.${extOf(existing.uri)}`);
  if (old.exists) await old.move(aside);
  try {
    await incoming.move(target);
  } catch (e) {
    if (aside.exists) await aside.move(new File(existing.uri));
    throw e;
  }
  const durationMs = await probeDurationMs(target.uri);
  const meta: Mp4Meta = (await readVideoMeta(target.uri)) ?? {};
  await replaceVideoFile(existing.id, {
    uri: target.uri,
    filename: name,
    size: target.size ?? 0,
    contentKey: contentKey ?? (await contentKeyOf(target.uri)),
    durationMs: durationMs ?? meta.durationMs ?? null,
    width: meta.width ?? null,
    height: meta.height ?? null,
    metaJson: Object.keys(meta).length ? JSON.stringify(meta) : null,
  });
  removeQuietly(aside);
  // The old filmstrip shows the old file; it is made again when the video is opened.
  try {
    const strip: Directory = filmstripDir(existing.id);
    if (strip.exists) strip.delete();
  } catch (e) {
    console.log(`[IMPORT] old filmstrip not removed: ${String(e)}`);
  }
  // A hand-picked cover stays; the automatic one is made again from the new file (a new name, so no stale picture).
  if (!existing.coverAt) {
    try {
      const at = Date.now();
      await frameTo(target.uri, 1000, new File(thumbsDir, coverFileName(existing.id, at)), COVER_SIDE);
      await setCoverAt(existing.id, at);
    } catch (e) {
      console.log(`[IMPORT] new cover skipped: ${String(e)}`);
    }
  }
}

/**
 * Bring each picked video into app storage, make a thumbnail, and record it.
 *
 * The picker already hands over a temporary copy, so the file is MOVED into
 * ReelVault's folder, not copied: copying would hold a third copy of every
 * video on a phone with little free space. One bad file never aborts the batch.
 *
 * A video that is already in the vault - the very same file, or one that looks
 * like the same video (same length and picture size, or same name and length) -
 * is asked about through `onDuplicate`: replace, keep both, or don't import.
 * Without `onDuplicate` an exact copy is skipped and a likely one imported.
 *
 * `keepOriginals` is for files that belong to the user (Import Folder): they
 * are copied and never touched.
 */
export async function importAssets(
  assets: Pick<DocumentPicker.DocumentPickerAsset, 'uri' | 'name' | 'size'>[],
  onProgress?: (done: number, total: number) => void,
  {
    keepOriginals = false,
    afterEach,
    onDuplicate,
  }: {
    keepOriginals?: boolean;
    /** Runs on each video right after it is in (Make Smaller on import), before the next one. */
    afterEach?: (video: Video, index: number, total: number) => Promise<void>;
    /** Asks what to do with a video that is already in the vault. */
    onDuplicate?: (info: DuplicateInfo) => Promise<DupChoice>;
  } = {}
): Promise<ImportSummary> {
  ensureDirs();
  const summary: ImportSummary = { imported: 0, duplicates: [], replaced: [], keptBoth: [], unverified: [], failed: [] };

  for (const [index, asset] of assets.entries()) {
    onProgress?.(index, assets.length);
    const picked = new File(asset.uri);
    const remaining = assets.length - index - 1;
    try {
      const contentKey = await contentKeyOf(picked.uri);
      let keepBoth = false;

      // 1. The very same file.
      const same = contentKey ? await findByContentKey(contentKey) : null;
      if (same) {
        const choice: DupChoice = onDuplicate
          ? await onDuplicate({ name: asset.name, size: picked.size ?? asset.size ?? 0, durationMs: same.durationMs, existing: same, exact: true, reason: 'the very same file', remaining })
          : 'skip';
        if (choice === 'skip') {
          summary.duplicates.push(asset.name);
          if (!keepOriginals) removeQuietly(picked);
          console.log(`[IMPORT] duplicate skipped ${asset.name}`);
          continue;
        }
        if (choice === 'replace') {
          const incoming = keepOriginals ? new File(Paths.cache, `import-${Crypto.randomUUID()}.${extOf(asset.name)}`) : picked;
          if (keepOriginals) await picked.copy(incoming);
          await replaceExisting(same, incoming, asset.name, contentKey);
          summary.replaced.push(asset.name);
          console.log(`[IMPORT] ${asset.name} replaced the file of ${same.id}`);
          continue;
        }
        keepBoth = true;
      }

      const id = Crypto.randomUUID();
      const destination = new File(videosDir, `${id}.${extOf(asset.name)}`);
      if (keepOriginals) {
        await picked.copy(destination);
      } else {
        try {
          await picked.move(destination);
        } catch (e) {
          // A move can fail across volumes; fall back to copy + remove the temp file.
          console.log(`[IMPORT] move failed (${String(e)}), copying ${asset.name}`);
          await new File(asset.uri).copy(destination);
          removeQuietly(new File(asset.uri));
        }
      }

      let width: number | null = null;
      let height: number | null = null;
      try {
        // A small cover (720 px), written in place: nothing left over in the cache.
        const size = await frameTo(destination.uri, 1000, new File(thumbsDir, `${id}.jpg`), COVER_SIDE);
        width = size?.width ?? null;
        height = size?.height ?? null;
      } catch (e) {
        console.log(`[IMPORT] thumbnail skipped for ${asset.name}: ${String(e)}`);
      }

      // A readable duration is the check that the video actually plays.
      const durationMs = await probeDurationMs(destination.uri);
      if (!durationMs) summary.unverified.push(asset.name);

      // The file's own record of when it was filmed, its real size, device...
      const meta = (await readVideoMeta(destination.uri)) ?? {};
      const size = destination.size ?? asset.size ?? 0;
      const length = durationMs ?? meta.durationMs ?? null;

      // 2. Not the same file, but it looks like the same video.
      if (!keepBoth && onDuplicate && length) {
        const likely = findLikely(
          { name: asset.name, size, durationMs: length, width: meta.width ?? width, height: meta.height ?? height },
          (await videosNearLength(length)).map((v) => ({ ...v, name: v.filename }))
        );
        if (likely) {
          const choice = await onDuplicate({ name: asset.name, size, durationMs: length, existing: likely.item, exact: false, reason: likely.reason, remaining });
          if (choice === 'skip') {
            summary.duplicates.push(asset.name);
            removeQuietly(destination);
            removeQuietly(new File(thumbsDir, `${id}.jpg`));
            if (!durationMs) summary.unverified.pop();
            console.log(`[IMPORT] likely duplicate skipped ${asset.name}`);
            continue;
          }
          if (choice === 'replace') {
            removeQuietly(new File(thumbsDir, `${id}.jpg`));
            await replaceExisting(likely.item, destination, asset.name, contentKey);
            summary.replaced.push(asset.name);
            if (!durationMs) summary.unverified.pop();
            console.log(`[IMPORT] ${asset.name} replaced the file of ${likely.item.id}`);
            continue;
          }
          keepBoth = true;
        }
      }

      const now = Date.now();
      const video: Video = {
        id,
        uri: destination.uri,
        filename: asset.name,
        size,
        durationMs: length,
        width: meta.width ?? width,
        height: meta.height ?? height,
        rating: 0,
        title: null,
        notes: null,
        createdAt: meta.createdAt ?? now,
        importedAt: now,
        status: null,
        deletedAt: null,
        isPrivate: false,
        contentKey,
        flag: 0,
        inTray: false,
        meta,
        coverAt: null,
        originalSize: null,
        originalKey: null,
      };
      await insertVideo(video);
      // Keywords another app saved inside the file (Photos, HashPhotos...) become tags.
      for (const k of meta.keywords ?? []) {
        await addTagToVideo(id, k).catch((e) => console.log(`[IMPORT] keyword ${k} skipped: ${String(e)}`));
      }

      summary.imported++;
      if (keepBoth) summary.keptBoth.push(asset.name);
      console.log(`[IMPORT] ok ${asset.name} -> ${id} (${size} bytes)`);
      if (afterEach) {
        try {
          await afterEach(video, index, assets.length);
        } catch (e) {
          console.log(`[IMPORT] after-import step failed for ${asset.name}: ${String(e)}`);
        }
      }
    } catch (e) {
      summary.failed.push(asset.name);
      console.log(`[IMPORT] FAILED ${asset.name}: ${String(e)}`);
    }
  }
  onProgress?.(assets.length, assets.length);

  console.log(
    `[IMPORT] done - ${summary.imported} imported, ${summary.duplicates.length} duplicates skipped, ${summary.replaced.length} replaced, ` +
      `${summary.unverified.length} unverified, ${summary.failed.length} failed`
  );
  return summary;
}
