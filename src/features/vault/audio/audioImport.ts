/**
 * Bringing audio into the Audio section: single files, several files as one
 * book (chapters), and EPUB 3 books (extracted once, read-along ready).
 *
 * Storage first: picked files are MOVED into the item's folder (the picker
 * hands over a temporary copy; Import Folder copies, as it must not touch
 * yours). An EPUB is unpacked a piece at a time straight into its folder and
 * the temporary .epub is deleted, so a book takes its own size once - never
 * a copy plus an unpacked copy, and nothing grows later while you listen.
 * Covers are shrunk to 720 px. Already have it? The same "replace / keep both
 * / don't import" question as for videos.
 */

import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';

import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import { contentKeyOf } from '../contentKey';
import { probeDurationMs } from '../duration';
import { findLikely, type DupChoice } from '../dupMatch';
import type { AudioChapterRef, AudioItem, AudioTrack } from './audioLogic';
import { readAudioTags, type AudioTags } from './audioTags';
import { audioNearLength, findAudioByKey, getAudio, insertAudio, updateAudio } from './audioStore';
import { BOOK_JSON, ensureAudioRoot, fileIn, folderBytes, folderFor, itemDir, openSink, openSource, readTextIn, removeFolder } from './audioFiles';
import { assembleBook, firstClipOf, parseNav, parseNcx, parsePackage, parseSmil, rootfileOf, type BookJson, type SmilPar } from './epub';
import { audioKindOf, extOf, sortTracks, titleFromName } from './formats';
import { extractEntry, readZipIndex, safeEntryPath } from './zip';

export type PickedAudioFile = { uri: string; name: string; size?: number };

export type AudioImportSummary = { imported: number; duplicates: string[]; replaced: string[]; keptBoth: string[]; unverified: string[]; failed: { name: string; reason: string }[] };

export type AudioDuplicateInfo = { name: string; size: number; durationMs: number | null; existing: AudioItem; exact: boolean; reason: string; remaining: number };

/** Space kept free on the phone while unpacking a book. */
const RESERVE = 400 * 1024 * 1024;

const COVER_SIDE = 720;

/** A file name that is safe inside a folder and keeps its extension. */
function safeName(name: string, index: number | null): string {
  const base = (name.split(/[\\/]/).pop() ?? 'audio').replace(/[^\w.\- ()[\]&',!]+/g, '_').slice(-120) || 'audio';
  return index === null ? base : `${String(index + 1).padStart(3, '0')} ${base}`;
}

function removeQuietly(f: File): void {
  try {
    if (f.exists) f.delete();
  } catch (e) {
    console.log(`[AUDIO] could not remove ${f.uri}: ${String(e)}`);
  }
}

function tagsOf(uri: string): AudioTags {
  try {
    const src = openSource(new File(uri));
    try {
      return readAudioTags(src);
    } finally {
      src.close();
    }
  } catch (e) {
    console.log(`[AUDIO] tags unreadable for ${uri}: ${String(e)}`);
    return {};
  }
}

async function bringIn(from: File, to: File, keepOriginals: boolean): Promise<void> {
  if (keepOriginals) {
    await from.copy(to);
    return;
  }
  try {
    await from.move(to);
  } catch (e) {
    console.log(`[AUDIO] move failed (${String(e)}), copying`);
    await from.copy(to);
    removeQuietly(from);
  }
}

/** Writes the embedded picture as the cover (shrunk), returns its file name or null. */
async function writeCover(folder: string, cover: AudioTags['cover']): Promise<string | null> {
  if (!cover) return null;
  try {
    const name = `cover-${Date.now()}.jpg`;
    const f = fileIn(folder, name);
    f.create({ intermediates: true, overwrite: true });
    f.write(cover.bytes);
    if (ReelVaultMedia) await ReelVaultMedia.shrinkImage(f.uri, COVER_SIDE, 0.8).catch(() => -1);
    return name;
  } catch (e) {
    console.log(`[AUDIO] cover not written: ${String(e)}`);
    return null;
  }
}

/** A small copy of a book's own cover picture (the book's file stays as it is). */
async function bookCover(folder: string, rel: string | null): Promise<string | null> {
  if (!rel) return null;
  const src = fileIn(folder, rel);
  if (!src.exists) return null;
  if (!ReelVaultMedia || (src.size ?? 0) < 200_000) return rel;
  try {
    const name = `cover-${Date.now()}.jpg`;
    const dest = fileIn(folder, name);
    await src.copy(dest);
    const after = await ReelVaultMedia.shrinkImage(dest.uri, COVER_SIDE, 0.8);
    if (after < 0) {
      removeQuietly(dest);
      return rel;
    }
    return name;
  } catch {
    return rel;
  }
}

function blankItem(id: string, kind: 'audio' | 'book', filename: string, now: number): AudioItem {
  return {
    id,
    kind,
    folder: folderFor(id),
    filename,
    size: 0,
    durationMs: null,
    title: null,
    author: null,
    album: null,
    narrator: null,
    year: null,
    genre: null,
    description: null,
    notes: null,
    rating: 0,
    status: null,
    cover: null,
    tracks: [],
    chapters: [],
    contentKey: null,
    isPrivate: false,
    positionTrack: 0,
    positionMs: 0,
    speed: null,
    lastPlayedAt: null,
    finishedAt: null,
    createdAt: now,
    importedAt: now,
    deletedAt: null,
    tags: [],
  };
}

/* ------------------------------------------------------------ EPUB books */

/**
 * Unpacks an EPUB into `folder` (one piece at a time), reads it and writes
 * .book.json. Returns the book. Throws with a readable reason.
 */
async function unpackBook(epub: File, folder: string, onStep?: (text: string) => void): Promise<BookJson> {
  const src = openSource(epub);
  try {
    const entries = readZipIndex(src).filter((e) => !e.isDir);
    const total = entries.reduce((a, e) => a + e.size, 0);
    let free = Infinity;
    try {
      free = Paths.availableDiskSpace;
    } catch {
      // unknown
    }
    if (total + RESERVE > free) throw new Error(`Not enough space: the book needs ${Math.ceil(total / 1e6)} MB`);
    const dir = itemDir(folder);
    if (!dir.exists) dir.create({ intermediates: true });
    let done = 0;
    for (const e of entries) {
      const rel = safeEntryPath(e.name);
      if (!rel || rel === BOOK_JSON) continue;
      const sink = openSink(fileIn(folder, rel));
      try {
        await extractEntry(src, e, (b) => sink.write(b));
      } finally {
        sink.close();
      }
      done += e.size;
      onStep?.(`Unpacking the book… ${Math.round((done / Math.max(1, total)) * 100)}%`);
    }
  } finally {
    src.close();
  }

  const container = readTextIn(folder, 'META-INF/container.xml');
  const opfPath = container ? rootfileOf(container) : null;
  const opf = opfPath ? readTextIn(folder, opfPath) : null;
  if (!opfPath || !opf) throw new Error('Not an EPUB (no package file)');
  const pkg = parsePackage(opf, opfPath);
  const overlays = new Map<string, SmilPar[]>();
  for (const it of pkg.manifest.values()) {
    if (!it.mediaType.includes('smil')) continue;
    const text = readTextIn(folder, it.href);
    if (text) overlays.set(it.href, parseSmil(text, it.href));
  }
  const navText = pkg.nav ? readTextIn(folder, pkg.nav) : null;
  let toc = navText && pkg.nav ? parseNav(navText, pkg.nav) : [];
  if (!toc.length && pkg.ncx) {
    const ncx = readTextIn(folder, pkg.ncx);
    if (ncx) toc = parseNcx(ncx, pkg.ncx);
  }
  const book = assembleBook(pkg, overlays, toc);
  // The length of each narration file (the last clip's end when it can't be read).
  for (const [n, t] of book.tracks.entries()) {
    onStep?.(`Reading the narration… ${n + 1} of ${book.tracks.length}`);
    const f = fileIn(folder, t.file);
    const probed = f.exists ? await probeDurationMs(f.uri) : null;
    const lastEnd = book.clips.filter((c) => c.t === n).reduce((a, c) => Math.max(a, c.e), 0);
    t.durationMs = probed ?? (lastEnd || null);
  }
  const out = fileIn(folder, BOOK_JSON);
  out.create({ intermediates: true, overwrite: true });
  out.write(JSON.stringify(book));
  return book;
}

/** The book's chapters where its narration starts (for the chapter list and the lock screen). */
function bookChapters(book: BookJson): AudioChapterRef[] {
  const out: AudioChapterRef[] = [];
  const seen = new Set<string>();
  const entries = book.toc.length ? book.toc.filter((t) => t.depth === 0) : book.chapters.map((c, i) => ({ title: c.title, chapter: i, id: null as string | null, depth: 0 }));
  for (const t of entries) {
    const clip = t.id ? (book.clips.find((c) => c.c === t.chapter && c.id === t.id) ?? firstClipOf(book.clips, t.chapter)) : firstClipOf(book.clips, t.chapter);
    if (!clip) continue;
    const k = `${clip.t}:${clip.b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title: t.title, track: clip.t, startMs: clip.b });
  }
  return out.sort((a, b) => a.track - b.track || a.startMs - b.startMs);
}

/* --------------------------------------------------------------- import */

type Unit = { kind: 'audio'; files: (PickedAudioFile & { tags: AudioTags })[]; asBook: boolean } | { kind: 'book'; file: PickedAudioFile };

/**
 * Imports the picked files. `units` decides which files form one book
 * (the caller asks you when files share an album). One bad file never stops
 * the rest.
 */
export async function importAudio(
  picked: PickedAudioFile[],
  {
    keepOriginals = false,
    asBooks,
    onStep,
    onDuplicate,
  }: {
    keepOriginals?: boolean;
    /** Given the albums that have several files, returns the ones to add as one book each. */
    asBooks?: (groups: { album: string; artist: string | null; count: number }[]) => Promise<string[]>;
    onStep?: (text: string) => void;
    onDuplicate?: (info: AudioDuplicateInfo) => Promise<DupChoice>;
  } = {}
): Promise<AudioImportSummary> {
  ensureAudioRoot();
  const summary: AudioImportSummary = { imported: 0, duplicates: [], replaced: [], keptBoth: [], unverified: [], failed: [] };
  const audio = picked.filter((p) => audioKindOf(p.name) === 'audio').map((p) => ({ ...p, tags: tagsOf(p.uri) }));
  const books = picked.filter((p) => audioKindOf(p.name) === 'book');
  for (const p of picked) if (!audioKindOf(p.name)) summary.failed.push({ name: p.name, reason: 'not an audio file or EPUB' });

  // Several files of the same album: one book, if you say so.
  const byAlbum = new Map<string, typeof audio>();
  for (const f of audio) {
    const album = f.tags.album?.trim();
    if (!album) continue;
    const k = `${album.toLowerCase()}\u0001${(f.tags.artist ?? '').toLowerCase()}`;
    byAlbum.set(k, [...(byAlbum.get(k) ?? []), f]);
  }
  const multi = [...byAlbum.entries()].filter(([, fs]) => fs.length > 1);
  const chosen = multi.length && asBooks ? new Set(await asBooks(multi.map(([, fs]) => ({ album: fs[0].tags.album!.trim(), artist: fs[0].tags.artist ?? null, count: fs.length })))) : new Set<string>();
  const units: Unit[] = [];
  const grouped = new Set<string>();
  for (const [, fs] of multi) {
    if (!chosen.has(fs[0].tags.album!.trim())) continue;
    units.push({ kind: 'audio', files: sortTracks(fs.map((f) => ({ ...f, track: f.tags.track ?? null }))), asBook: true });
    for (const f of fs) grouped.add(f.uri);
  }
  for (const f of audio) if (!grouped.has(f.uri)) units.push({ kind: 'audio', files: [f], asBook: false });
  for (const b of books) units.push({ kind: 'book', file: b });

  for (const [n, u] of units.entries()) {
    const label = u.kind === 'book' ? u.file.name : u.asBook ? (u.files[0].tags.album ?? u.files[0].name) : u.files[0].name;
    onStep?.(`Adding ${n + 1} of ${units.length}: ${label}`);
    const remaining = units.length - n - 1;
    const id = Crypto.randomUUID();
    const folder = folderFor(id);
    const now = Date.now();
    try {
      const firstUri = u.kind === 'book' ? u.file.uri : u.files[0].uri;
      const key = await contentKeyOf(firstUri);
      const firstSize = new File(firstUri).size ?? 0;
      let keepBoth = false;

      // The very same file is already in the library.
      const same = key ? await findAudioByKey(key) : null;
      if (same) {
        const choice: DupChoice = onDuplicate
          ? await onDuplicate({ name: label, size: firstSize, durationMs: same.durationMs, existing: same, exact: true, reason: 'the very same file', remaining })
          : 'skip';
        if (choice === 'skip') {
          summary.duplicates.push(label);
          if (!keepOriginals) for (const f of u.kind === 'book' ? [u.file] : u.files) removeQuietly(new File(f.uri));
          continue;
        }
        if (choice === 'replace') {
          await importInto(same, u, keepOriginals, onStep);
          summary.replaced.push(label);
          continue;
        }
        keepBoth = true;
      }

      const item = await buildItem(id, folder, u, keepOriginals, now, onStep);
      item.contentKey = key;

      // Looks like one you have (same length and nearly the same size).
      if (!keepBoth && onDuplicate && item.durationMs) {
        const likely = findLikely(
          { name: label, size: item.size, durationMs: item.durationMs },
          (await audioNearLength(item.durationMs)).map((x) => ({ ...x, name: x.filename, size: x.size }))
        );
        if (likely) {
          const choice = await onDuplicate({ name: label, size: item.size, durationMs: item.durationMs, existing: likely.item, exact: false, reason: likely.reason, remaining });
          if (choice === 'skip') {
            removeFolder(folder);
            summary.duplicates.push(label);
            continue;
          }
          if (choice === 'replace') {
            await swapInto(likely.item, item);
            summary.replaced.push(label);
            continue;
          }
          keepBoth = true;
        }
      }

      await insertAudio(item);
      summary.imported++;
      if (keepBoth) summary.keptBoth.push(label);
      if (!item.durationMs && item.kind === 'audio') summary.unverified.push(label);
      console.log(`[AUDIO] added ${label} -> ${id} (${item.size} bytes)`);
    } catch (e) {
      removeFolder(folder);
      const reason = e instanceof Error ? e.message : String(e);
      summary.failed.push({ name: label, reason });
      console.log(`[AUDIO] FAILED ${label}: ${reason}`);
    }
  }
  return summary;
}

/** Builds the item for one unit: files into its folder, tags, lengths, cover, chapters (or the unpacked book). */
async function buildItem(id: string, folder: string, u: Unit, keepOriginals: boolean, now: number, onStep?: (t: string) => void): Promise<AudioItem> {
  if (u.kind === 'book') {
    const item = blankItem(id, 'book', u.file.name, now);
    const epub = new File(u.file.uri);
    // Unpack from wherever it is; the temporary copy is deleted afterwards.
    const book = await unpackBook(epub, folder, onStep);
    if (!keepOriginals) removeQuietly(epub);
    item.title = book.title;
    item.author = book.authors.join(', ') || null;
    item.narrator = book.narrators.join(', ') || null;
    item.description = book.description;
    item.year = book.date ? Number(/\d{4}/.exec(book.date)?.[0]) || null : null;
    item.tracks = book.tracks.map((t, n) => {
      const c = book.clips.find((x) => x.t === n);
      return { file: t.file, title: c ? book.chapters[c.c]?.title ?? `Part ${n + 1}` : `Part ${n + 1}`, durationMs: t.durationMs };
    });
    item.chapters = bookChapters(book);
    const total = item.tracks.reduce((a, t) => a + (t.durationMs ?? 0), 0);
    item.durationMs = total || book.durationMs;
    item.cover = await bookCover(folder, book.cover);
    item.size = folderBytes(folder);
    return item;
  }
  const item = blankItem(id, 'audio', u.files[0].name, now);
  const dir = itemDir(folder);
  if (!dir.exists) dir.create({ intermediates: true });
  const tracks: AudioTrack[] = [];
  for (const [n, f] of u.files.entries()) {
    const name = safeName(f.name, u.files.length > 1 ? n : null);
    const dest = fileIn(folder, name);
    await bringIn(new File(f.uri), dest, keepOriginals);
    const ms = (await probeDurationMs(dest.uri)) ?? f.tags.durationMs ?? null;
    tracks.push({ file: name, title: f.tags.title ?? titleFromName(f.name), durationMs: ms });
  }
  const first = u.files[0].tags;
  item.tracks = tracks;
  item.title = u.asBook ? (first.album ?? null) : (first.title ?? titleFromName(u.files[0].name));
  item.author = first.artist ?? first.albumArtist ?? null;
  item.album = u.asBook ? null : (first.album ?? null);
  item.narrator = first.narrator && first.narrator !== item.author ? first.narrator : null;
  item.year = first.year ?? null;
  item.genre = first.genre ?? null;
  item.description = first.comment ?? null;
  item.chapters = u.files.length === 1 ? (first.chapters ?? []).map((c) => ({ title: c.title, track: 0, startMs: c.startMs })) : [];
  item.durationMs = tracks.reduce((a, t) => a + (t.durationMs ?? 0), 0) || null;
  item.cover = await writeCover(folder, u.files.map((f) => f.tags.cover).find(Boolean));
  item.size = folderBytes(folder);
  if (u.asBook) item.filename = `${first.album ?? 'Book'} (${u.files.length} files)`;
  return item;
}

/** "Replace" for the very same file: a fresh folder with the new file(s), swapped in under the item you have. */
async function importInto(existing: AudioItem, u: Unit, keepOriginals: boolean, onStep?: (t: string) => void): Promise<void> {
  const tempId = `${existing.id}-new-${Date.now()}`;
  const item = await buildItem(tempId, folderFor(tempId), u, keepOriginals, Date.now(), onStep);
  await swapInto(existing, item);
}

/**
 * The item you have takes the new files: its rating, keywords, notes,
 * progress and listens stay. It simply points at the new folder; the old
 * folder is removed once the database says so (nothing is moved around).
 */
async function swapInto(existing: AudioItem, fresh: AudioItem): Promise<void> {
  const stillThere = await getAudio(existing.id);
  await updateAudio([existing.id], {
    folder: fresh.folder,
    kind: fresh.kind,
    filename: fresh.filename,
    size: fresh.size,
    durationMs: fresh.durationMs,
    tracks: fresh.tracks,
    chapters: fresh.chapters,
    cover: fresh.cover,
    contentKey: fresh.contentKey,
    title: stillThere?.title ?? fresh.title,
    author: stillThere?.author ?? fresh.author,
    positionTrack: 0,
    positionMs: Math.min(stillThere ? stillThere.positionMs : 0, fresh.tracks[0]?.durationMs ?? 0),
  });
  if (existing.folder !== fresh.folder) removeFolder(existing.folder);
}

/**
 * More files for a book you have: they go on the end, in the order picked
 * (sorted by name), each a new chapter. Your place, rating and notes stay.
 */
export async function addTracks(itemId: string, picked: PickedAudioFile[]): Promise<number> {
  const item = await getAudio(itemId);
  if (!item || item.kind !== 'audio') throw new Error('Files can only be added to an audio item (not an EPUB).');
  const files = sortTracks(picked.filter((f) => audioKindOf(f.name) === 'audio'));
  if (!files.length) return 0;
  const dir = itemDir(item.folder);
  if (!dir.exists) dir.create({ intermediates: true });
  const taken = new Set(item.tracks.map((t) => t.file));
  const tracks = [...item.tracks];
  const chapters = [...item.chapters];
  for (const f of files) {
    let name = safeName(f.name, tracks.length);
    while (taken.has(name)) name = safeName(f.name, tracks.length + taken.size);
    taken.add(name);
    const dest = fileIn(item.folder, name);
    await bringIn(new File(f.uri), dest, false);
    const tags = tagsOf(dest.uri);
    const ms = (await probeDurationMs(dest.uri)) ?? tags.durationMs ?? null;
    tracks.push({ file: name, title: tags.title ?? titleFromName(f.name), durationMs: ms });
  }
  const total = tracks.reduce((a, t) => a + (t.durationMs ?? 0), 0) || null;
  await updateAudio([item.id], {
    tracks,
    chapters,
    durationMs: total,
    size: folderBytes(item.folder),
    filename: `${/ \(\d+ files\)$/.test(item.filename) ? item.filename.replace(/ \(\d+ files\)$/, '') : (item.title ?? titleFromName(item.filename))} (${tracks.length} files)`,
  });
  return files.length;
}

/* ------------------------------------------------------------------ extras */

/** Things that come with a book: a PDF, an ebook, pictures (kept in the item's "extras" folder). */
export type AudioExtra = { name: string; uri: string; size: number; kind: 'pdf' | 'image' | 'book' | 'other' };

const EXTRAS = 'extras';

export function extraKindOf(name: string): AudioExtra['kind'] {
  const e = extOf(name);
  return e === 'pdf' ? 'pdf' : ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif'].includes(e) ? 'image' : ['epub', 'mobi', 'azw3', 'txt', 'cbz'].includes(e) ? 'book' : 'other';
}

export function listExtras(folder: string): AudioExtra[] {
  const dir = itemDir(`${folder}/${EXTRAS}`);
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((f): f is File => f instanceof File)
    .map((f) => ({ name: f.name, uri: f.uri, size: f.size ?? 0, kind: extraKindOf(f.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function addExtras(itemId: string, picked: PickedAudioFile[]): Promise<number> {
  const item = await getAudio(itemId);
  if (!item) throw new Error('That item is gone.');
  const folder = `${item.folder}/${EXTRAS}`;
  const dir = itemDir(folder);
  if (!dir.exists) dir.create({ intermediates: true });
  for (const f of picked) {
    let name = safeName(f.name, null);
    if (fileIn(folder, name).exists) name = `${Date.now() % 100000} ${name}`;
    await bringIn(new File(f.uri), fileIn(folder, name), false);
  }
  await updateAudio([item.id], { size: folderBytes(item.folder) });
  return picked.length;
}

export async function removeExtra(itemId: string, name: string): Promise<void> {
  const item = await getAudio(itemId);
  if (!item) return;
  removeQuietly(fileIn(`${item.folder}/${EXTRAS}`, name));
  await updateAudio([item.id], { size: folderBytes(item.folder) });
}

/** For Share / Save to Files: the item's main file (an EPUB is shared as its extracted folder's audio). */
export function mainFileUri(item: AudioItem): string | null {
  const t = item.tracks[0];
  return t ? fileIn(item.folder, t.file).uri : null;
}

export const extOfFile = extOf;
