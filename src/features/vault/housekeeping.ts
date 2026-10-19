/**
 * Keeping ReelVault small on the phone.
 *
 * - `appStorage()`: what the app itself takes, by kind (your videos, Recently
 *   Deleted, covers, filmstrips, temporary files, the database).
 * - `tidy()`: runs a little after every start (and from the Storage page):
 *   clears temporary files older than two hours (picker and download copies,
 *   frames made for sharing, finished edits), files left over from imports
 *   that did not finish, covers that were replaced, full-size filmstrip frames
 *   from before 1.9.2, and filmstrips of videos you haven't opened lately
 *   (they are remade, small, when you open the video again).
 * - Once: shrinks every cover made before 1.9.2 to 720 px.
 * Needs the native helper (app 1.9.2+) for sizes, ages and shrinking; without
 * it only the parts that work from JavaScript run.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';

import { getDb } from '@/db';

import { ReelVaultMedia } from '../../../modules/reelvault-media';
import { COVER_SIDE } from './frames';
import { parseCoverName } from './coverNames';
import { getSetting, setSetting } from './library';
import { coverFileName, thumbsDir, videosDir } from './storage';

const HOUR = 3_600_000;
const SHRUNK_KEY = 'vault.coversShrunk';
const LAST_TIDY_KEY = 'vault.lastTidy';
/** Filmstrips kept for the videos opened most recently; the rest are remade when needed. */
export const KEEP_FILMSTRIPS = 60;

export type AppStorage = {
  videos: number;
  deleted: number;
  covers: number;
  filmstrips: number;
  temporary: number;
  database: number;
  /** False when the sizes on disk could not be measured (before 1.9.2): only the videos are known. */
  measured: boolean;
};

export type TidyResult = { freed: number; covers: number; files: number };

type Row = { id: string; size: number; deleted_at: number | null; cover_at: number | null };

async function rows(): Promise<Row[]> {
  const db = await getDb();
  return db.getAllAsync<Row>('SELECT id, size, deleted_at, cover_at FROM videos;');
}

const dirUri = (d: Directory) => d.uri;

/** What ReelVault takes on the phone, by kind. */
export async function appStorage(): Promise<AppStorage> {
  const all = await rows();
  const videos = all.filter((r) => r.deleted_at === null).reduce((a, r) => a + (r.size || 0), 0);
  const deleted = all.filter((r) => r.deleted_at !== null).reduce((a, r) => a + (r.size || 0), 0);
  if (!ReelVaultMedia) return { videos, deleted, covers: 0, filmstrips: 0, temporary: 0, database: 0, measured: false };
  const thumbs = await ReelVaultMedia.entries(dirUri(thumbsDir)).catch(() => []);
  const covers = thumbs.filter((e) => !e.dir || e.name === 'kept' || e.name === 'series').reduce((a, e) => a + e.bytes, 0);
  const filmstrips = thumbs.filter((e) => e.dir && e.name !== 'kept' && e.name !== 'series').reduce((a, e) => a + e.bytes, 0);
  const temporary = await ReelVaultMedia.dirSize(Paths.cache.uri).catch(() => 0);
  const database = await ReelVaultMedia.dirSize(new Directory(Paths.document, 'SQLite').uri).catch(() => 0);
  return { videos, deleted, covers, filmstrips, temporary, database, measured: true };
}

/**
 * Clears what ReelVault no longer needs. `deep` (the Storage page's button)
 * also empties the picture cache and keeps fewer filmstrips.
 */
export async function tidy(deep = false): Promise<TidyResult> {
  const result: TidyResult = { freed: 0, covers: 0, files: 0 };
  const all = await rows();
  const known = new Set(all.map((r) => r.id));
  const coverOf = new Map(all.map((r) => [r.id, r.cover_at]));

  if (ReelVaultMedia) {
    // 1. Temporary files: picker and download copies, frames made for sharing, finished edits.
    const keep = deep ? [] : ['com.hackemist.SDImageCache', 'ExpoImage'];
    result.freed += await ReelVaultMedia.clearOld(Paths.cache.uri, 2 * 3600, keep).catch(() => 0);
    // The picture cache keeps decoded copies of covers; past 150 MB it is cleared (it refills as needed).
    if (!deep) {
      const cacheEntries = await ReelVaultMedia.entries(Paths.cache.uri).catch(() => []);
      const pictures = cacheEntries.filter((e) => keep.includes(e.name)).reduce((a, e) => a + e.bytes, 0);
      if (pictures > 150 * 1024 * 1024) {
        await Image.clearDiskCache().catch(() => false);
        result.freed += pictures;
      }
    }
    // Files other apps sent with "Open in ReelVault" that were already taken in.
    result.freed += await ReelVaultMedia.clearOld(new Directory(Paths.document, 'Inbox').uri, 3600, []).catch(() => 0);
  }

  // 2. Video files no video row points at (an import that stopped half way).
  try {
    if (videosDir.exists && ReelVaultMedia) {
      const ages = new Map((await ReelVaultMedia.entries(dirUri(videosDir)).catch(() => [])).map((e) => [e.name, e.modified]));
      for (const f of videosDir.list()) {
        if (!(f instanceof File)) continue;
        const id = f.name.replace(/\.[^.]+$/, '');
        if (known.has(id)) continue;
        // Only when it is clearly abandoned: an import in progress writes here too.
        if (Date.now() - (ages.get(f.name) ?? Date.now()) < 6 * HOUR) continue;
        result.freed += f.size ?? 0;
        f.delete();
        result.files++;
      }
    }
  } catch (e) {
    console.log(`[TIDY] videos folder: ${String(e)}`);
  }

  // 3. Covers and filmstrips of videos that are gone, and covers that were replaced.
  try {
    if (thumbsDir.exists) {
      const strips: { dir: Directory; modified: number }[] = [];
      const ages = ReelVaultMedia ? await ReelVaultMedia.entries(dirUri(thumbsDir)).catch(() => []) : [];
      const modified = new Map(ages.map((e) => [e.name, e.modified]));
      for (const item of thumbsDir.list()) {
        if (item instanceof Directory) {
          if (item.name === 'kept' || item.name === 'series') continue;
          if (!known.has(item.name)) {
            item.delete();
            result.files++;
            continue;
          }
          strips.push({ dir: item, modified: modified.get(item.name) ?? 0 });
          // Full-size frames from before 1.9.2 (<size>-f<i>.jpg): the small set replaces them.
          for (const f of item.list()) {
            if (f instanceof File && /-f\d+\.jpg$/.test(f.name)) {
              result.freed += f.size ?? 0;
              f.delete();
            }
          }
          continue;
        }
        const parsed = parseCoverName(item.name);
        if (!parsed) continue;
        const { id, at } = parsed;
        const stale = !known.has(id) || (at !== null && coverOf.get(id) !== at);
        if (stale && Date.now() - (modified.get(item.name) ?? 0) > HOUR) {
          result.freed += item.size ?? 0;
          item.delete();
          result.files++;
        }
      }
      // Only the most recently opened videos keep their filmstrip.
      const keepStrips = deep ? 20 : KEEP_FILMSTRIPS;
      for (const s of strips.sort((a, b) => b.modified - a.modified).slice(keepStrips)) {
        result.freed += ReelVaultMedia ? await ReelVaultMedia.dirSize(s.dir.uri).catch(() => 0) : 0;
        s.dir.delete();
      }
    }
  } catch (e) {
    console.log(`[TIDY] thumbs folder: ${String(e)}`);
  }

  // 4. Once (or on a deep clean): covers from before 1.9.2 down to 720 px.
  if (ReelVaultMedia && (deep || (await getSetting(SHRUNK_KEY)) !== '1')) {
    try {
      const entries = await ReelVaultMedia.entries(dirUri(thumbsDir));
      for (const e of entries) {
        if (e.dir || !e.name.endsWith('.jpg') || e.bytes < 140_000) continue;
        const after = await ReelVaultMedia.shrinkImage(new File(thumbsDir, e.name).uri, COVER_SIDE, 0.72);
        if (after >= 0 && after < e.bytes) {
          result.freed += e.bytes - after;
          result.covers++;
        }
      }
      await setSetting(SHRUNK_KEY, '1');
    } catch (e) {
      console.log(`[TIDY] shrinking covers: ${String(e)}`);
    }
  }

  await setSetting(LAST_TIDY_KEY, String(Date.now()));
  if (result.freed || result.files) console.log(`[TIDY] freed ${Math.round(result.freed / 1e6)} MB, ${result.files} files, ${result.covers} covers shrunk`);
  return result;
}

/** The cover a video shows now. */
export const currentCover = (id: string, coverAt: number | null) => coverFileName(id, coverAt);
