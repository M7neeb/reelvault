/**
 * Extensions: sources written for ReelVault, listed in repos you add by link.
 *
 * A repo is an index.json:
 *   { "name": "…", "extensions": [ { "id", "name", "version", "lang", "nsfw", "file", "domains": [], "description" } ] }
 * `file` (next to the index) is the extension: the body of a function that
 * returns { search, popular, latest?, details, chapters, pages } (see extensions/README.md).
 *
 * An extension only gets what ReelVault hands it: web requests to the domains
 * it declares (https only), and helpers to read JSON, XML and HTML. It is
 * given no way to reach your library, your files or the rest of the app.
 * That is not a full sandbox, which is why adding a repo asks you first.
 */

import { findAll, findFirst, parseXml, textOf, type XmlElement, type XmlNode } from '../../audio/xml.ts';
import { parseChapterName } from '../mangaLogic.ts';
import type { Http, HttpInit, ImageRef, ListPage, MangaSource, SourceChapter, SourceDetails, SourceSeries } from './types.ts';
import { num, resolveUrl, str, time } from './types.ts';

export type RepoExtension = {
  id: string;
  name: string;
  version: number;
  lang: string;
  nsfw: boolean;
  /** Absolute address of the code. */
  url: string;
  domains: string[];
  description: string | null;
};

export type Repo = { url: string; name: string; extensions: RepoExtension[] };

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Reads a repo's index.json; entries that don't follow the format are left out. */
export function parseRepo(json: unknown, url: string): Repo {
  if (!json || typeof json !== 'object') throw new Error('This link is not a ReelVault extension repo (no index)');
  const o = json as Record<string, unknown>;
  const list = Array.isArray(o.extensions) ? o.extensions : null;
  if (!list) throw new Error('This link is not a ReelVault extension repo (no "extensions" list)');
  const extensions: RepoExtension[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const id = str(e.id)?.toLowerCase();
    const file = str(e.file);
    const name = str(e.name);
    if (!id || !ID.test(id) || !file || !name || seen.has(id)) continue;
    const abs = resolveUrl(url, file);
    if (!/^https:\/\//i.test(abs)) continue;
    const domains = Array.isArray(e.domains) ? e.domains.map((d) => str(d)?.toLowerCase()).filter((d): d is string => !!d && /^[a-z0-9.*-]+$/.test(d)) : [];
    seen.add(id);
    extensions.push({ id, name: name.slice(0, 60), version: num(e.version) ?? 1, lang: str(e.lang)?.slice(0, 10) ?? 'en', nsfw: e.nsfw === true, url: abs, domains, description: str(e.description)?.slice(0, 300) ?? null });
  }
  return { url, name: str(o.name)?.slice(0, 60) ?? (url.match(/^https?:\/\/([^/:?#]+)/i)?.[1] ?? 'Repo'), extensions };
}

/** A host an extension declared ("api.site.org", "*.site.org" or "site.org" for the host and its sub-domains). */
export function domainAllowed(url: string, domains: string[]): boolean {
  const m = url.match(/^https:\/\/([^/:?#]+)/i);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return domains.some((d) => {
    const base = d.replace(/^\*\./, '');
    return host === base || host.endsWith(`.${base}`);
  });
}

/* ------------------------------------------------- HTML: a small selector */

type Step = { tag: string | null; id: string | null; classes: string[]; attrs: { name: string; value: string | null }[] };
type Combinator = ' ' | '>';

function parseCompound(s: string): Step {
  const step: Step = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w:-]+)(?:\s*=\s*["']?([^"'\]]*)["']?)?\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) step.tag = m[1].toLowerCase();
    else if (m[2]) step.id = m[2];
    else if (m[3]) step.classes.push(m[3]);
    else if (m[4]) step.attrs.push({ name: m[4].toLowerCase(), value: m[5] ?? null });
  }
  return step;
}

function matches(el: XmlElement, s: Step): boolean {
  if (s.tag && el.name !== s.tag) return false;
  if (s.id && el.attrs.id !== s.id) return false;
  if (s.classes.length) {
    const cls = (el.attrs.class ?? '').split(/\s+/);
    if (!s.classes.every((c) => cls.includes(c))) return false;
  }
  return s.attrs.every((a) => (a.value === null ? a.name in el.attrs : el.attrs[a.name] === a.value));
}

/** Elements matching a CSS selector (tag, #id, .class, [attr], [attr=value], descendant and ">" child; commas for several). */
export function select(root: XmlElement, selector: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const part of selector.split(',')) {
    const tokens = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    const steps: Step[] = [];
    const combs: Combinator[] = [];
    for (const t of tokens) {
      if (t === '>') combs[steps.length - 1] = '>';
      else {
        if (steps.length && combs[steps.length - 1] === undefined) combs[steps.length - 1] = ' ';
        steps.push(parseCompound(t));
      }
    }
    if (!steps.length) continue;
    const walk = (el: XmlElement, ancestors: XmlElement[]) => {
      for (const c of el.children) {
        if (typeof c === 'string') continue;
        if (matches(c, steps[steps.length - 1]) && fits(ancestors.concat(el), steps.length - 2) && !out.includes(c)) out.push(c);
        walk(c, ancestors.concat(el));
      }
    };
    // Do the earlier steps match up the chain of ancestors (right to left)?
    const fits = (chain: XmlElement[], i: number): boolean => {
      if (i < 0) return true;
      const comb = combs[i];
      if (comb === '>') {
        const parent = chain[chain.length - 1];
        return !!parent && matches(parent, steps[i]) && fits(chain.slice(0, -1), i - 1);
      }
      for (let k = chain.length - 1; k >= 0; k--) if (matches(chain[k], steps[i]) && fits(chain.slice(0, k), i - 1)) return true;
      return false;
    };
    walk(root, []);
  }
  return out;
}

/* ------------------------------------------------------------- running */

/** Names an extension's code never sees (the function's own parameters hide them). */
const HIDDEN = ['fetch', 'XMLHttpRequest', 'WebSocket', 'globalThis', 'global', 'window', 'self', 'require', 'nativeModuleProxy', '__turboModuleProxy', 'expo', 'process'];

export type ExtensionApi = {
  http: Http;
  xml: { parse: (text: string) => XmlElement; findAll: typeof findAll; findFirst: typeof findFirst; text: (el: XmlNode | XmlElement | null) => string };
  html: { parse: (text: string) => XmlElement; select: typeof select; attr: (el: XmlElement | null | undefined, name: string) => string | null; text: (el: XmlElement | null | undefined) => string };
  util: { resolveUrl: typeof resolveUrl; parseChapterName: typeof parseChapterName };
};

export function extensionApi(http: Http, ext: Pick<RepoExtension, 'domains' | 'name'>): ExtensionApi {
  const guard = (url: string) => {
    if (!domainAllowed(url, ext.domains)) throw new Error(`${ext.name} may only reach ${ext.domains.join(', ') || 'no sites'} (asked for ${url.slice(0, 80)})`);
  };
  const text = (el: XmlNode | XmlElement | null | undefined) => (!el ? '' : typeof el === 'string' ? el.trim() : textOf(el));
  return {
    http: {
      json: (url: string, init?: HttpInit) => {
        guard(url);
        return http.json(url, init);
      },
      text: (url: string, init?: HttpInit) => {
        guard(url);
        return http.text(url, init);
      },
    },
    xml: { parse: parseXml, findAll, findFirst, text },
    html: { parse: parseXml, select, attr: (el, name) => (el ? (el.attrs[name.toLowerCase()] ?? null) : null), text },
    util: { resolveUrl, parseChapterName },
  };
}

const image = (v: unknown): ImageRef | null => {
  if (typeof v === 'string' && /^https?:\/\//.test(v)) return { uri: v };
  if (v && typeof v === 'object' && typeof (v as ImageRef).uri === 'string' && /^https?:\/\//.test((v as ImageRef).uri)) {
    const h = (v as ImageRef).headers;
    const headers = h && typeof h === 'object' ? Object.fromEntries(Object.entries(h).filter(([k, x]) => typeof k === 'string' && typeof x === 'string').slice(0, 10)) : undefined;
    return { uri: (v as ImageRef).uri, ...(headers ? { headers } : {}) };
  }
  return null;
};

const series = (v: unknown): SourceSeries | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const key = str(o.key);
  const title = str(o.title);
  if (!key || !title) return null;
  return { key: key.slice(0, 2000), title: title.slice(0, 300), cover: image(o.cover), author: str(o.author)?.slice(0, 200) ?? null };
};

/** What an extension returned, checked and trimmed: whatever it gives, the app gets the shapes it expects. */
export function cleanList(v: unknown): ListPage {
  const o = (v ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(o.items) ? o.items : Array.isArray(v) ? v : []).map(series).filter((x): x is SourceSeries => !!x).slice(0, 200);
  return { items, hasMore: o.hasMore === true };
}

export function cleanDetails(v: unknown, key: string): SourceDetails {
  const base = series({ key, title: 'Untitled', ...(v as object) }) ?? { key, title: 'Untitled', cover: null, author: null };
  const o = (v ?? {}) as Record<string, unknown>;
  const kind = o.kind === 'manga' || o.kind === 'manhwa' || o.kind === 'comic' ? o.kind : null;
  const list = (x: unknown) => (Array.isArray(x) ? x.map((g) => str(g)).filter((g): g is string => !!g).slice(0, 30) : []);
  return {
    ...base,
    key,
    altTitles: list(o.altTitles),
    artist: str(o.artist),
    description: str(o.description)?.slice(0, 5000) ?? null,
    genres: list(o.genres),
    pubStatus: str(o.pubStatus),
    kind,
    webUrl: str(o.webUrl) && /^https?:\/\//.test(String(o.webUrl)) ? String(o.webUrl) : null,
  };
}

export function cleanChapters(v: unknown): SourceChapter[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c): SourceChapter | null => {
      if (!c || typeof c !== 'object') return null;
      const o = c as Record<string, unknown>;
      const key = str(o.key);
      if (!key) return null;
      const ext = str(o.externalUrl);
      return {
        key: key.slice(0, 2000),
        number: num(o.number),
        volume: num(o.volume),
        title: str(o.title)?.slice(0, 300) ?? null,
        scanlator: str(o.scanlator)?.slice(0, 120) ?? null,
        uploadedAt: time(o.uploadedAt),
        pageCount: num(o.pageCount),
        externalUrl: ext && /^https?:\/\//.test(ext) ? ext : null,
        lang: str(o.lang)?.slice(0, 10) ?? null,
      };
    })
    .filter((x): x is SourceChapter => !!x)
    .slice(0, 5000);
}

export function cleanPages(v: unknown): ImageRef[] {
  return (Array.isArray(v) ? v : []).map(image).filter((x): x is ImageRef => !!x).slice(0, 2000);
}

type ExtensionCode = {
  search?: (q: string, page: number) => unknown;
  popular?: (page: number) => unknown;
  latest?: (page: number) => unknown;
  details?: (key: string) => unknown;
  chapters?: (key: string) => unknown;
  pages?: (key: string) => unknown;
};

/** Turns an extension's code into a source. Throws when the code doesn't load. */
export function loadExtension(code: string, ext: RepoExtension, http: Http): MangaSource {
  const api = extensionApi(http, ext);
  // eslint-disable-next-line no-new-func
  const factory = new Function('api', ...HIDDEN, `"use strict";\n${code}\n`) as (...args: unknown[]) => unknown;
  const made = factory(api, ...HIDDEN.map(() => undefined)) as ExtensionCode | undefined;
  if (!made || typeof made !== 'object' || typeof made.details !== 'function' || typeof made.chapters !== 'function' || typeof made.pages !== 'function') {
    throw new Error(`${ext.name} is not a ReelVault extension (it must return details, chapters and pages)`);
  }
  const call = async <T>(what: string, fn: (() => unknown) | undefined, clean: (v: unknown) => T): Promise<T> => {
    if (!fn) throw new Error(`${ext.name} cannot ${what}`);
    return clean(await fn());
  };
  return {
    id: `ext:${ext.id}`,
    name: ext.name,
    lang: ext.lang,
    kind: 'extension',
    nsfw: ext.nsfw,
    hint: ext.description ?? `Extension, version ${ext.version}`,
    canLatest: typeof made.latest === 'function',
    search: (q, page) => call('search', made.search && (() => made.search!(q, page)), cleanList),
    popular: (page) => call('list titles', made.popular && (() => made.popular!(page)), cleanList),
    latest: (page) => call('list the latest', made.latest && (() => made.latest!(page)), cleanList),
    details: (key) => call('show details', () => made.details!(key), (v) => cleanDetails(v, key)),
    chapters: (key) => call('list chapters', () => made.chapters!(key), cleanChapters),
    pages: (key) => call('load pages', () => made.pages!(key), cleanPages),
  };
}
