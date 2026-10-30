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
  /** How a page fits the screen (page modes): all of it, the width, the height, or its own size. */
  fit: 'screen' | 'width' | 'height' | 'original';
  /** A look over the pages: grey (no colour), warm (easier at night) or dimmed. */
  filter: 'none' | 'gray' | 'warm' | 'dim';
  /** Auto-scroll speed in the long strip, 1 (slow) to 10 (fast). */
  autoSpeed: number;
  /** The volume buttons turn pages (press) and scroll (hold) while reading (app build 18 on). */
  volumeKeys: boolean;
  /** Volume up goes forward instead of volume down. */
  volumeInvert: boolean;
  /** How fast holding a volume button scrolls (or turns pages), 1 (slow) to 10 (fast). */
  holdSpeed: number;
  /** Titles you have not set a way of reading for open as one long strip. */
  longStrip: boolean;
  /** Cut plain white or black margins off the pages (app build 17 on). */
  crop: boolean;
  /** Around the page: the colour of its edges instead of black, grey or white (app build 17 on). */
  autoBg: boolean;
};

export const DEFAULT_READER: ReaderPrefs = {
  tapZones: true,
  tapInvert: false,
  page: 'black',
  spreads: true,
  fit: 'screen',
  filter: 'none',
  autoSpeed: 3,
  longStrip: false,
  crop: false,
  autoBg: false,
  volumeKeys: true,
  volumeInvert: false,
  holdSpeed: 5,
};

/** Long-strip auto-scroll, points per second, for speeds 1-10. */
export const AUTO_SCROLL_SPEEDS = [20, 30, 45, 60, 80, 105, 135, 170, 210, 260];
/** Holding a volume button in the long strip, points per second, for speeds 1-10. */
export const HOLD_SCROLL_SPEEDS = [150, 220, 300, 390, 490, 600, 730, 880, 1050, 1250];
/** Holding a volume button with pages: one page every this many ms, for speeds 1-10. */
export const HOLD_PAGE_EVERY = [1400, 1150, 950, 800, 650, 540, 450, 370, 300, 240];

const level = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 1 && v <= 10 ? Math.round(v) : fallback);

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
  /** Free the space of downloaded chapters once you have read them (they stay readable online). */
  removeAfterRead: boolean;
  /** Download only on Wi-Fi (from app build 17). */
  wifiOnly: boolean;
  /** Busy sites: try each page more times, waiting longer in between. */
  patient: boolean;
  /** Pages downloaded at the same time (1, 3 or 5). */
  parallel: 1 | 3 | 5;
  /** Extensions update themselves (checked once a day when the app opens). */
  autoUpdateExt: boolean;
  /** How far you read goes back to your Suwayomi, Komga and Kavita servers. */
  syncProgress: boolean;
  reader: ReaderPrefs;
};

export const DEFAULT_BROWSE: BrowsePrefs = { languages: ['en'], adult: false, servers: [], repos: [], installed: [], smallerPages: false, checkOnOpen: true, autoDownload: false, removeAfterRead: false, wifiOnly: false, patient: false, parallel: 3, autoUpdateExt: true, syncProgress: true, reader: DEFAULT_READER };

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
    removeAfterRead: r.removeAfterRead === true,
    wifiOnly: r.wifiOnly === true,
    patient: r.patient === true,
    parallel: r.parallel === 1 || r.parallel === 5 ? r.parallel : 3,
    autoUpdateExt: r.autoUpdateExt !== false,
    syncProgress: r.syncProgress !== false,
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
    fit: r.fit === 'width' || r.fit === 'height' || r.fit === 'original' ? r.fit : 'screen',
    filter: r.filter === 'gray' || r.filter === 'warm' || r.filter === 'dim' ? r.filter : 'none',
    autoSpeed: level(r.autoSpeed, DEFAULT_READER.autoSpeed),
    longStrip: r.longStrip === true,
    crop: r.crop === true,
    autoBg: r.autoBg === true,
    volumeKeys: r.volumeKeys !== false,
    volumeInvert: r.volumeInvert === true,
    holdSpeed: level(r.holdSpeed, DEFAULT_READER.holdSpeed),
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
