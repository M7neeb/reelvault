/**
 * The native half of "Import HashPhotos info": pick the metadata file
 * HashPhotos exported (Select All → Export Metadata, as CSV, JSON or XML),
 * read it, and later apply the planned changes in one transaction.
 */

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { getDb } from '@/db';

import { parseMetadataFile, type MetaChange, type MetaFile } from './hashphotos';
import { adjustDates, setFlagMany, setTextMany } from './library';
import { setRating } from './repo';
import { addTagToVideo } from './tags';

/** null when cancelled. Throws when the file holds nothing ReelVault can read. */
export async function pickMetadataFile(): Promise<{ name: string; file: MetaFile } | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/json', 'application/xml', 'text/xml', 'text/plain', 'public.comma-separated-values-text'],
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.length) return null;
  const asset = picked.assets[0];
  const file = parseMetadataFile(await new File(asset.uri).text());
  if (!file) throw new Error('No file names were found in it. Export it from HashPhotos with Export Metadata (CSV, JSON or XML).');
  console.log(`[META] ${asset.name}: ${file.format}, ${file.records.length} rows, columns ${file.columns.join(', ')}`);
  return { name: asset.name, file };
}

export async function applyMetadata(changes: MetaChange[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const c of changes) {
      for (const k of c.addKeywords) await addTagToVideo(c.videoId, k);
      if (c.rating !== null) await setRating(c.videoId, c.rating);
      if (c.title) await setTextMany([c.videoId], 'title', c.title);
      if (c.caption) await setTextMany([c.videoId], 'notes', c.caption);
      if (c.flag) await setFlagMany([c.videoId], c.flag);
      if (c.date) await adjustDates([c.videoId], { setTo: c.date });
    }
  });
  console.log(`[META] applied to ${changes.length} videos`);
}
