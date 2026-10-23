/**
 * What Browse remembers (setting "manga.browse"): your languages, whether
 * adult titles show, your servers, the repos you added (with the list of
 * extensions they had when last checked) and the extensions you installed.
 * Passwords are not here: they are in the keychain. Pure (tested).
 */

import type { RepoExtension } from './extensions.ts';

export type ServerKind = 'opds' | 'suwayomi';
export type ServerConfig = { id: string; kind: ServerKind; name: string; url: string; user: string | null };
export type RepoConfig = { url: string; name: string; addedAt: number; checkedAt: number; extensions: RepoExtension[] };
export type InstalledExtension = RepoExtension & { repoUrl: string; installedAt: number };

/** How the reader behaves (the reader's menu changes these). */
export type ReaderPrefs = {
  /** Tapping the left or right side turns the page (off: every tap shows the controls). */
  tapZones: boolean;
  /** The other way round: the right side goes back in manga, forward in comics stays left. */
  tapInvert: boolean;
  /** What is around the pages. */
  page: 'black' | 'grey' | 'white';
  /** Two pages side by side when the phone is sideways (page modes only). */
  spreads: boolean;
};

export const DEFAULT_READER: ReaderPrefs = { tapZones: true, tapInvert: false, page: 'black', spreads: true };

export type BrowsePrefs = {
  languages: string[];
  adult: boolean;
  servers: ServerConfig[];
  repos: RepoConfig[];
  installed: InstalledExtension[];
  /** Save downloaded pages smaller (about half the space; still sharp on a phone). */
  smallerPages: boolean;
  /** Ask sources for new chapters when the app opens (at most every 6 hours). */
  checkOnOpen: boolean;
  /** Download new chapters by themselves (of titles you are reading or plan to read). */
  autoDownload: boolean;
  reader: ReaderPrefs;
};

export const DEFAULT_BROWSE: BrowsePrefs = { languages: ['en'], adult: false, servers: [], repos: [], installed: [], smallerPages: false, checkOnOpen: true, autoDownload: false, reader: DEFAULT_READER };

/** Languages MangaDex offers that the picker lists (code, name). */
export const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['es-la', 'Spanish (Latin America)'],
  ['pt-br', 'Portuguese (Brazil)'],
  ['it', 'Italian'],
  ['ru', 'Russian'],
  ['tr', 'Turkish'],
  ['ar', 'Arabic'],
  ['id', 'Indonesian'],
  ['vi', 'Vietnamese'],
  ['pl', 'Polish'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
];

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function parseBrowsePrefs(json: string | null): BrowsePrefs {
  let r: Record<string, unknown> = {};
  try {
    r = json ? JSON.parse(json) : {};
  } catch {
    r = {};
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const languages = arr(r.languages).filter(isStr).slice(0, 10);
  const servers = arr(r.servers)
    .filter((s): s is ServerConfig => !!s && isStr(s.id) && (s.kind === 'opds' || s.kind === 'suwayomi') && isStr(s.url))
    .map((s) => ({ id: s.id, kind: s.kind, name: isStr(s.name) ? s.name : s.url, url: s.url, user: isStr(s.user) ? s.user : null }));
  const repos = arr(r.repos)
    .filter((x): x is RepoConfig => !!x && isStr(x.url))
    .map((x) => ({ url: x.url, name: isStr(x.name) ? x.name : x.url, addedAt: Number(x.addedAt) || 0, checkedAt: Number(x.checkedAt) || 0, extensions: arr(x.extensions) as RepoExtension[] }));
  const installed = arr(r.installed).filter((x): x is InstalledExtension => !!x && isStr(x.id) && isStr(x.url) && isStr(x.repoUrl));
  return {
    languages: languages.length ? languages : DEFAULT_BROWSE.languages,
    adult: r.adult === true,
    servers,
    repos,
    installed,
    smallerPages: r.smallerPages === true,
    checkOnOpen: r.checkOnOpen !== false,
    autoDownload: r.autoDownload === true,
    reader: parseReader(r.reader),
  };
}

function parseReader(v: unknown): ReaderPrefs {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    tapZones: r.tapZones !== false,
    tapInvert: r.tapInvert === true,
    page: r.page === 'grey' || r.page === 'white' ? r.page : 'black',
    spreads: r.spreads !== false,
  };
}

/** A server address as typed ("192.168.1.5:4567", "komga.local/opds/v1.2/catalog") made into a full one. */
export function normaliseServerUrl(raw: string, kind: ServerKind): string {
  let u = raw.trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/\/+$/, '');
  if (kind === 'opds' && !/opds|\.xml$|catalog/i.test(u)) u = `${u}/opds/v1.2/catalog`;
  return u;
}

/** Extensions with a newer version in their repo. */
export function updatesFor(prefs: BrowsePrefs): InstalledExtension[] {
  return prefs.installed.filter((i) => {
    const repo = prefs.repos.find((r) => r.url === i.repoUrl);
    const latest = repo?.extensions.find((e) => e.id === i.id);
    return !!latest && latest.version > i.version;
  });
}
