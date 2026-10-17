/**
 * Import from IMDb or Letterboxd (native half): pick the CSV in Files, read
 * it, and send it to Simkl in batches of 100 (Simkl allows one write a
 * second; api.ts spaces them). The parsing lives in imports.ts.
 */

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { simklRequest } from './api';
import { chunk, planImport, readWriteResponse, type Bucket, type ImportEntry, type ImportResult } from './imports';

export async function pickImportFile(): Promise<{ name: string; text: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'public.comma-separated-values-text', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { name: a.name ?? 'import.csv', text: await new File(a.uri).text() };
}

async function send(path: string, groups: Record<Bucket, ImportEntry[]>, onBatch: () => void) {
  let added = 0;
  const notFound: string[] = [];
  for (const bucket of ['movies', 'shows'] as const) {
    for (const part of chunk(groups[bucket])) {
      const json = await simklRequest<any>(path, { method: 'POST', auth: true, body: { [bucket]: part } });
      const r = readWriteResponse(json);
      added += r.added || part.length - r.notFound.length;
      notFound.push(...r.notFound);
      onBatch();
    }
  }
  return { added, notFound };
}

/** null = the file is not an IMDb or Letterboxd export. */
export async function runImport(
  file: { name: string; text: string },
  onProgress: (done: number, total: number) => void
): Promise<ImportResult | null> {
  const plan = planImport(file.text, file.name);
  if (!plan) return null;
  const batches = (g: Record<Bucket, ImportEntry[]>) => chunk(g.movies).length + chunk(g.shows).length;
  const total = batches(plan.history) + batches(plan.ratings) + batches(plan.plan);
  let done = 0;
  const step = () => onProgress(++done, total);
  onProgress(0, total);

  const planned = await send('/sync/add-to-list', plan.plan, step);
  const watched = await send('/sync/history', plan.history, step);
  const rated = await send('/sync/ratings', plan.ratings, step);
  const notFound = [...new Set([...watched.notFound, ...rated.notFound, ...planned.notFound])];
  return {
    source: plan.source,
    watched: watched.added,
    rated: rated.added,
    planned: planned.added,
    skipped: plan.skipped,
    notFound,
  };
}
