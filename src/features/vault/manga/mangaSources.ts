/**
 * Sources on the phone (native wiring): builds every source from your
 * settings (MangaDex, your servers, installed extensions), keeps server
 * passwords in the keychain and extension code in Documents/manga-ext/,
 * adds a title from a source to your library (chapters stay online until
 * downloaded), checks a series for new chapters, and loads a chapter's
 * pages (from the phone when they are on it, else from its source).
 */

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import { getSetting, setSetting } from '../library';
import { ensureMangaRoot, fileIn, fileUri, seriesFolderFor } from './mangaFiles';
import type { MangaChapter, MangaSeries } from './mangaLogic';
import { newTitles, planTachiImport, readTachiBackup, tachiSourceOf, type PlannedTitle } from './mangaBackup';
import { normTitle } from './mangaLogic';
import { addMangaTag, getSeries, insertChapter, insertSeries, listManga, setChapterSource, setSeriesSource, updateSeries } from './mangaStore';
import { loadExtension, parseRepo, type RepoExtension } from './sources/extensions';
import { sourceHttp } from './sources/http';
import { mangadexSource } from './sources/mangadex';
import { opdsSource } from './sources/opds';
import { DEFAULT_BROWSE, normaliseServerUrl, parseBrowsePrefs, type BrowsePrefs, type ServerConfig, type ServerKind } from './sources/prefs';
import { suwayomiSource, suwayomiSources, type GqlSource, type SuwayomiServer } from './sources/suwayomi';
import { basicAuth, infoOf, type ImageRef, type MangaSource, type SourceChapter, type SourceDetails, type SourceInfo } from './sources/types';

const PREFS_KEY = 'manga.browse';
const canUseFs = Platform.OS !== 'web';
const extDir = canUseFs ? new Directory(Paths.document, 'manga-ext') : (undefined as unknown as Directory);
const passwordKey = (serverId: string) => `manga.server.${serverId}`;
const SECURE: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/* ----------------------------------------------------------------- prefs */

export async function loadBrowsePrefs(): Promise<BrowsePrefs> {
  try {
    return parseBrowsePrefs(await getSetting(PREFS_KEY));
  } catch {
    return DEFAULT_BROWSE;
  }
}

export async function saveBrowsePrefs(p: BrowsePrefs): Promise<void> {
  await setSetting(PREFS_KEY, JSON.stringify(p));
}

async function authFor(s: ServerConfig): Promise<Record<string, string>> {
  if (!s.user) return {};
  let pw: string | null = null;
  try {
    pw = await SecureStore.getItemAsync(passwordKey(s.id), SECURE);
  } catch {
    pw = null;
  }
  return basicAuth(s.user, pw);
}

/* --------------------------------------------------------------- sources */

/** A group of sources for the Browse list. */
export type SourceGroup = { title: string; serverId?: string; items: SourceInfo[]; error?: string };

/** Built sources, by id (rebuilt when settings change). */
const cache = new Map<string, MangaSource>();
/** Suwayomi source lists, by server id. */
const suwayomiLists = new Map<string, GqlSource[]>();

function extCode(id: string): string | null {
  try {
    const f = new File(extDir, `${id}.js`);
    return f.exists ? f.textSync() : null;
  } catch {
    return null;
  }
}

/** Every source, grouped; Suwayomi servers are asked which extensions they have. */
export async function loadSources(prefs: BrowsePrefs, refreshServers = false): Promise<SourceGroup[]> {
  cache.clear();
  const groups: SourceGroup[] = [];
  const md = mangadexSource(sourceHttp, { languages: prefs.languages, adult: prefs.adult });
  cache.set(md.id, md);
  groups.push({ title: 'Built in', items: [infoOf(md)] });

  for (const s of prefs.servers) {
    const auth = await authFor(s);
    const server = { id: s.id, name: s.name, url: s.url, auth };
    if (s.kind === 'opds') {
      const src = opdsSource(sourceHttp, server);
      cache.set(src.id, src);
      groups.push({ title: s.name, serverId: s.id, items: [infoOf(src)] });
      continue;
    }
    const lib = suwayomiSource(sourceHttp, server as SuwayomiServer, null);
    cache.set(lib.id, lib);
    const g: SourceGroup = { title: s.name, serverId: s.id, items: [infoOf(lib)] };
    try {
      if (refreshServers || !suwayomiLists.has(s.id)) suwayomiLists.set(s.id, await suwayomiSources(sourceHttp, server));
      for (const gs of suwayomiLists.get(s.id) ?? []) {
        if (gs.isNsfw && !prefs.adult) continue;
        const src = suwayomiSource(sourceHttp, server, gs);
        cache.set(src.id, src);
        g.items.push(infoOf(src));
      }
    } catch (e) {
      g.error = String(e).replace(/^Error:\s*/, '');
    }
    groups.push(g);
  }

  const ext: SourceInfo[] = [];
  for (const i of prefs.installed) {
    if (i.nsfw && !prefs.adult) continue;
    const code = extCode(i.id);
    if (!code) continue;
    try {
      const src = loadExtension(code, i, sourceHttp);
      cache.set(src.id, src);
      ext.push(infoOf(src));
    } catch (e) {
      console.log(`[MANGA] extension ${i.id} did not load: ${String(e)}`);
    }
  }
  if (ext.length) groups.push({ title: 'Extensions', items: ext });
  return groups;
}

/**
 * The source of a series in your library. Library series keep their source
 * id, so this also builds sources Browse has not opened yet (a Suwayomi
 * series only needs its server).
 */
export async function sourceFor(id: string, prefs: BrowsePrefs): Promise<MangaSource | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  if (id === 'mangadex') return mangadexSource(sourceHttp, { languages: prefs.languages, adult: prefs.adult });
  const m = id.match(/^server:([^:]+)(?::(.+))?$/);
  if (m) {
    const s = prefs.servers.find((x) => x.id === m[1]);
    if (!s) return null;
    const server = { id: s.id, name: s.name, url: s.url, auth: await authFor(s) };
    return s.kind === 'opds' ? opdsSource(sourceHttp, server) : suwayomiSource(sourceHttp, server, null);
  }
  if (id.startsWith('ext:')) {
    const i = prefs.installed.find((x) => `ext:${x.id}` === id);
    const code = i ? extCode(i.id) : null;
    return i && code ? loadExtension(code, i, sourceHttp) : null;
  }
  return null;
}

export const cachedSource = (id: string) => cache.get(id) ?? null;

/* --------------------------------------------------------------- servers */

/** Adds a server after checking it answers. */
export async function addServer(prefs: BrowsePrefs, input: { kind: ServerKind; name: string; url: string; user: string; password: string }): Promise<BrowsePrefs> {
  const id = Crypto.randomUUID().slice(0, 8);
  const url = normaliseServerUrl(input.url, input.kind);
  if (!url) throw new Error('Type the server address');
  const auth = basicAuth(input.user.trim() || null, input.password);
  const server = { id, name: input.name.trim() || url.replace(/^https?:\/\//, ''), url, auth };
  // Ask it something small first, so a wrong address shows now and not later.
  if (input.kind === 'opds') await opdsSource(sourceHttp, server).popular(1);
  else await suwayomiSources(sourceHttp, server);
  if (input.user.trim()) await SecureStore.setItemAsync(passwordKey(id), input.password, SECURE);
  const next: BrowsePrefs = { ...prefs, servers: [...prefs.servers, { id, kind: input.kind, name: server.name, url, user: input.user.trim() || null }] };
  await saveBrowsePrefs(next);
  return next;
}

export async function removeServer(prefs: BrowsePrefs, id: string): Promise<BrowsePrefs> {
  try {
    await SecureStore.deleteItemAsync(passwordKey(id), SECURE);
  } catch {
    // none saved
  }
  suwayomiLists.delete(id);
  const next = { ...prefs, servers: prefs.servers.filter((s) => s.id !== id) };
  await saveBrowsePrefs(next);
  return next;
}

/* ----------------------------------------------------- repos, extensions */

function repoIndexUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https:\/\//i.test(u)) {
    if (/^http:\/\//i.test(u)) throw new Error('Repos must use https:// addresses');
    u = `https://${u}`;
  }
  // A GitHub repo page: its index.json on the main branch.
  const gh = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/i);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/main/index.json`;
  return /\.json($|\?)/i.test(u) ? u : `${u.replace(/\/+$/, '')}/index.json`;
}

export async function addRepo(prefs: BrowsePrefs, raw: string): Promise<BrowsePrefs> {
  const url = repoIndexUrl(raw);
  if (prefs.repos.some((r) => r.url === url)) throw new Error('You already added this repo');
  const repo = parseRepo(await sourceHttp.json(url), url);
  const next: BrowsePrefs = { ...prefs, repos: [...prefs.repos, { url, name: repo.name, addedAt: Date.now(), checkedAt: Date.now(), extensions: repo.extensions }] };
  await saveBrowsePrefs(next);
  return next;
}

/** Fetches every repo's list again (new extensions, new versions). Repos that fail keep their old list. */
export async function refreshRepos(prefs: BrowsePrefs): Promise<{ prefs: BrowsePrefs; failed: string[] }> {
  const failed: string[] = [];
  const repos = [];
  for (const r of prefs.repos) {
    try {
      const repo = parseRepo(await sourceHttp.json(r.url), r.url);
      repos.push({ ...r, name: repo.name, checkedAt: Date.now(), extensions: repo.extensions });
    } catch {
      failed.push(r.name);
      repos.push(r);
    }
  }
  const next = { ...prefs, repos };
  await saveBrowsePrefs(next);
  return { prefs: next, failed };
}

export async function removeRepo(prefs: BrowsePrefs, url: string): Promise<BrowsePrefs> {
  for (const i of prefs.installed.filter((x) => x.repoUrl === url)) deleteCode(i.id);
  const next = { ...prefs, repos: prefs.repos.filter((r) => r.url !== url), installed: prefs.installed.filter((x) => x.repoUrl !== url) };
  await saveBrowsePrefs(next);
  return next;
}

function deleteCode(id: string) {
  try {
    const f = new File(extDir, `${id}.js`);
    if (f.exists) f.delete();
  } catch {
    // gone
  }
}

/** Downloads an extension's code, checks it loads, and saves it (install and update). */
export async function installExtension(prefs: BrowsePrefs, repoUrl: string, ext: RepoExtension): Promise<BrowsePrefs> {
  const code = await sourceHttp.text(ext.url);
  if (code.length > 512_000) throw new Error(`${ext.name} is too large to be an extension`);
  loadExtension(code, ext, sourceHttp);
  if (!extDir.exists) extDir.create({ intermediates: true });
  const f = new File(extDir, `${ext.id}.js`);
  if (f.exists) f.delete();
  f.create();
  f.write(code);
  const next: BrowsePrefs = { ...prefs, installed: [...prefs.installed.filter((i) => i.id !== ext.id), { ...ext, repoUrl, installedAt: Date.now() }] };
  await saveBrowsePrefs(next);
  return next;
}

export async function uninstallExtension(prefs: BrowsePrefs, id: string): Promise<BrowsePrefs> {
  deleteCode(id);
  const next = { ...prefs, installed: prefs.installed.filter((i) => i.id !== id) };
  await saveBrowsePrefs(next);
  return next;
}

/* -------------------------------------------------- the library and sources */

/** The cover saved into the series' folder (so it shows offline). Null when it can't be fetched. */
async function saveCover(seriesId: string, folder: string, cover: ImageRef | null): Promise<string | null> {
  if (!cover || !canUseFs) return null;
  try {
    const name = `cover-${Date.now()}.jpg`;
    const dest = fileIn(folder, name);
    if (!dest.parentDirectory.exists) dest.parentDirectory.create({ intermediates: true });
    await File.downloadFileAsync(cover.uri, dest, { headers: cover.headers ?? {} });
    if (ReelVaultMedia) await ReelVaultMedia.shrinkImage(dest.uri, 600, 0.8).catch(() => -1);
    return name;
  } catch (e) {
    console.log(`[MANGA] cover for ${seriesId} not saved: ${String(e)}`);
    return null;
  }
}

function chapterRow(seriesId: string, c: SourceChapter, position: number): MangaChapter {
  return {
    id: Crypto.randomUUID(),
    seriesId,
    folder: null,
    number: c.number,
    volume: c.volume,
    title: c.title,
    filename: null,
    pages: [],
    pageCount: c.pageCount ?? 0,
    size: 0,
    contentKey: null,
    sourceKey: c.key,
    sourceUrl: c.externalUrl,
    scanlator: c.scanlator,
    uploadedAt: c.uploadedAt,
    addedAt: Date.now(),
    readAt: null,
    lastPage: 0,
    downloaded: false,
    position,
  };
}

/** Adds a title from a source to your library, with its chapters (online until downloaded). */
export async function addFromSource(sourceId: string, d: SourceDetails, chapters: SourceChapter[]): Promise<string> {
  ensureMangaRoot();
  const existing = (await listManga()).find((s) => !s.deletedAt && s.sourceId === sourceId && s.sourceKey === d.key);
  if (existing) return existing.id;
  const id = Crypto.randomUUID();
  const folder = seriesFolderFor(id);
  const now = Date.now();
  const series: Omit<MangaSeries, 'tags' | 'chapters'> = {
    id,
    folder,
    title: d.title,
    altTitle: d.altTitles[0] ?? null,
    author: d.author ?? null,
    artist: d.artist,
    description: d.description,
    kind: d.kind,
    pubStatus: d.pubStatus,
    status: 'planned',
    rating: 0,
    notes: null,
    cover: null,
    isPrivate: false,
    readingMode: null,
    sourceId,
    sourceKey: d.key,
    sourceUrl: d.webUrl,
    createdAt: now,
    importedAt: now,
    lastReadAt: null,
    finishedAt: null,
    deletedAt: null,
  };
  await insertSeries(series);
  for (const g of d.genres.slice(0, 12)) await addMangaTag(id, g);
  for (const [i, c] of chapters.entries()) await insertChapter(chapterRow(id, c, i));
  const cover = await saveCover(id, folder, d.cover);
  if (cover) await updateSeries([id], { cover });
  return id;
}

const NOT_LINKED = 'This title came from a Tachimanga backup and is not linked to a source yet. Open it and tap Find on a source.';

/** Asks a series' source for chapters you don't have yet. The ids of the chapters added. */
export async function refreshSeries(seriesId: string, prefs: BrowsePrefs): Promise<string[]> {
  const s = await getSeries(seriesId);
  if (!s?.sourceId || !s.sourceKey) return [];
  if (tachiSourceOf(s.sourceId)) throw new Error(NOT_LINKED);
  const src = await sourceFor(s.sourceId, prefs);
  if (!src) throw new Error(`The source of ${s.title} is not set up on this phone any more`);
  const list = await src.chapters(s.sourceKey);
  const have = new Set(s.chapters.map((c) => c.sourceKey).filter(Boolean));
  // The same chapter from another group (MangaDex keeps one per number) is not new.
  const haveNumber = new Set(s.chapters.filter((c) => c.number !== null).map((c) => `${c.volume ?? ''}:${c.number}`));
  const added: string[] = [];
  for (const c of list) {
    if (have.has(c.key)) continue;
    if (c.number !== null && haveNumber.has(`${c.volume ?? ''}:${c.number}`)) continue;
    if (c.number !== null) haveNumber.add(`${c.volume ?? ''}:${c.number}`);
    const row = chapterRow(seriesId, c, s.chapters.length + added.length);
    await insertChapter(row);
    added.push(row.id);
  }
  if (!s.cover) {
    const d = await src.details(s.sourceKey).catch(() => null);
    const cover = d ? await saveCover(seriesId, s.folder, d.cover) : null;
    if (cover) await updateSeries([seriesId], { cover });
  }
  return added;
}

/** A chapter's pages: the files on the phone, else from its source. */
export async function pagesOf(series: Pick<MangaSeries, 'sourceId'>, c: MangaChapter, prefs: BrowsePrefs): Promise<ImageRef[]> {
  if (c.folder && c.pages.length) return c.pages.map((p) => ({ uri: fileUri(c.folder!, p) }));
  if (!series.sourceId || !c.sourceKey) return [];
  if (tachiSourceOf(series.sourceId)) throw new Error(NOT_LINKED);
  const src = await sourceFor(series.sourceId, prefs);
  if (!src) throw new Error('This chapter’s source is not set up on this phone any more');
  return src.pages(c.sourceKey);
}

/* ------------------------------------------------------ linking, backups */

/**
 * Links a series to a title on a source: its chapters are matched by number
 * (or name), so your read marks and pages stay; chapters the source has and
 * you don't are added. Returns how many matched and how many were added.
 */
export async function linkSeries(seriesId: string, src: MangaSource, key: string): Promise<{ matched: number; added: number }> {
  const s = await getSeries(seriesId);
  if (!s) throw new Error('That title is gone');
  const [d, list] = await Promise.all([src.details(key).catch(() => null), src.chapters(key)]);
  const byNumber = new Map<string, MangaChapter>();
  const byName = new Map<string, MangaChapter>();
  for (const c of s.chapters) {
    if (c.number !== null) {
      byNumber.set(`${c.volume ?? ''}:${c.number}`, c);
      if (!byNumber.has(`:${c.number}`)) byNumber.set(`:${c.number}`, c);
    }
    const n = normTitle(c.title ?? c.filename ?? '');
    if (n) byName.set(n, c);
  }
  const used = new Set<string>();
  let matched = 0;
  const fresh: SourceChapter[] = [];
  for (const c of list) {
    const viaNumber = c.number !== null ? (byNumber.get(`${c.volume ?? ''}:${c.number}`) ?? byNumber.get(`:${c.number}`)) : undefined;
    const hit = viaNumber ?? (c.title ? byName.get(normTitle(c.title)) : undefined);
    if (hit && !used.has(hit.id)) {
      used.add(hit.id);
      await setChapterSource(hit.id, c.key, c.externalUrl, c.pageCount);
      matched++;
    } else fresh.push(c);
  }
  for (const [i, c] of fresh.entries()) await insertChapter(chapterRow(seriesId, c, s.chapters.length + i));
  await setSeriesSource(seriesId, src.id, key, d?.webUrl ?? null);
  if (!s.cover && d?.cover) {
    const cover = await saveCover(seriesId, s.folder, d.cover);
    if (cover) await updateSeries([seriesId], { cover });
  }
  return { matched, added: fresh.length };
}

export type BackupSummary = { titles: number; skipped: number; chapters: number; linked: number; unlinked: number; sources: string[] };

async function insertPlanned(t: PlannedTitle): Promise<string> {
  const id = Crypto.randomUUID();
  const folder = seriesFolderFor(id);
  const now = Date.now();
  await insertSeries({
    id,
    folder,
    title: t.title,
    altTitle: null,
    author: t.author,
    artist: t.artist,
    description: t.description,
    kind: null,
    pubStatus: t.pubStatus,
    status: t.status,
    rating: t.rating,
    notes: t.notes,
    cover: null,
    isPrivate: false,
    readingMode: null,
    sourceId: t.sourceId,
    sourceKey: t.sourceKey,
    sourceUrl: t.sourceId === 'mangadex' ? `https://mangadex.org/title/${t.sourceKey}` : null,
    createdAt: t.addedAt,
    importedAt: now,
    lastReadAt: Math.max(0, ...t.chapters.map((c) => c.readAt ?? 0)) || null,
    finishedAt: t.status === 'completed' ? now : null,
    deletedAt: null,
  });
  for (const g of [...t.categories, ...t.genres].slice(0, 16)) await addMangaTag(id, g);
  for (const [i, c] of t.chapters.entries()) {
    await insertChapter({
      ...chapterRow(id, { key: c.key, number: c.number, volume: null, title: c.name || null, scanlator: c.scanlator, uploadedAt: c.uploadedAt, pageCount: null, externalUrl: null, lang: null }, i),
      readAt: c.readAt,
      lastPage: c.lastPage,
    });
  }
  return id;
}

/**
 * Imports a Tachimanga backup: every title you don't have yet, with its
 * chapters and read marks. Covers are fetched afterwards; titles from other
 * sources are linked through your Suwayomi servers when they have the same
 * extension. `onStep` reports progress.
 */
export async function importTachiBackup(bytes: Uint8Array, prefs: BrowsePrefs, onStep: (t: string) => void): Promise<BackupSummary> {
  ensureMangaRoot();
  const backup = await readTachiBackup(bytes);
  const plan = planTachiImport(backup, Date.now());
  const existing = (await listManga()).filter((x) => !x.deletedAt).map((x) => x.title);
  const todo = newTitles(plan, existing);
  const ids: { id: string; t: PlannedTitle }[] = [];
  for (const [i, t] of todo.entries()) {
    onStep(`Adding your titles… ${i + 1} of ${todo.length}`);
    ids.push({ id: await insertPlanned(t), t });
  }
  // Covers (best effort: some sites only show them to their own app).
  for (const [i, { id, t }] of ids.entries()) {
    if (!t.cover) continue;
    onStep(`Fetching covers… ${i + 1} of ${ids.length}`);
    const s = await getSeries(id);
    if (!s) continue;
    const cover = await saveCover(id, s.folder, { uri: t.cover });
    if (cover) await updateSeries([id], { cover });
  }
  const viaServer = await autoLink(ids.map((x) => x.id), prefs, onStep);
  const mangadex = ids.filter((x) => x.t.sourceId === 'mangadex').length;
  return {
    titles: todo.length,
    skipped: plan.length - todo.length,
    chapters: todo.reduce((a, t) => a + t.chapters.length, 0),
    linked: mangadex + viaServer,
    unlinked: ids.length - mangadex - viaServer,
    sources: [...new Set(todo.map((t) => t.sourceName))],
  };
}

/**
 * Links imported titles to the same extension on your Suwayomi servers
 * (Suwayomi runs Tachiyomi extensions, with the same source ids): it
 * searches the title there and links an exact match. The number linked.
 */
export async function autoLink(seriesIds: string[], prefs: BrowsePrefs, onStep: (t: string) => void): Promise<number> {
  const servers = prefs.servers.filter((s) => s.kind === 'suwayomi');
  if (!servers.length) return 0;
  const lists: { server: SuwayomiServer; sources: GqlSource[] }[] = [];
  for (const s of servers) {
    const server = { id: s.id, name: s.name, url: s.url, auth: await authFor(s) };
    try {
      lists.push({ server, sources: suwayomiLists.get(s.id) ?? (await suwayomiSources(sourceHttp, server)) });
    } catch {
      // that server is off
    }
  }
  if (!lists.length) return 0;
  let linked = 0;
  for (const [i, id] of seriesIds.entries()) {
    const s = await getSeries(id);
    const tachi = tachiSourceOf(s?.sourceId ?? null);
    if (!s || !tachi) continue;
    onStep(`Finding your titles on your server… ${i + 1} of ${seriesIds.length}`);
    for (const { server, sources } of lists) {
      const gs = sources.find((x) => x.id === tachi.id) ?? sources.find((x) => x.name.toLowerCase() === tachi.name.toLowerCase());
      if (!gs) continue;
      try {
        const res = await suwayomiSource(sourceHttp, server, gs).search(s.title, 1);
        const hit = res.items.find((x) => normTitle(x.title) === normTitle(s.title));
        if (!hit) continue;
        // The server's library source needs only the server, so the link survives its source list changing.
        await linkSeries(id, suwayomiSource(sourceHttp, server, null), hit.key);
        linked++;
        break;
      } catch (e) {
        console.log(`[MANGA] autolink ${s.title}: ${String(e)}`);
      }
    }
  }
  return linked;
}
