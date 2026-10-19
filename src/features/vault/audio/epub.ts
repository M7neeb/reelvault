/**
 * EPUB 3 books: reading the package (title, authors, cover, chapters in
 * reading order, the table of contents) and the media overlays (SMIL) that
 * tie each sentence of the text to a stretch of the narration - that is what
 * makes read-along work: as the audio plays, the sentence being read lights
 * up, and tapping a sentence plays from there.
 *
 * The result (`BookJson`) is small and is written once, at import, next to
 * the extracted files; chapters are turned into blocks of text only when you
 * open them. Pure: no React, no native modules (tested in Node).
 */

import { findAll, findFirst, parseXml, textOf, type XmlElement } from './xml.ts';

export type BookChapter = { href: string; title: string; overlay: boolean };
export type BookTrack = { file: string; durationMs: number | null };
/** One stretch of narration: chapter `c`, element `id` in it, audio track `t` from `b` to `e` ms. */
export type BookClip = { c: number; id: string; t: number; b: number; e: number };
export type TocEntry = { title: string; chapter: number; id: string | null; depth: number };

export type BookJson = {
  v: 1;
  title: string | null;
  authors: string[];
  narrators: string[];
  language: string | null;
  description: string | null;
  publisher: string | null;
  date: string | null;
  cover: string | null;
  chapters: BookChapter[];
  tracks: BookTrack[];
  clips: BookClip[];
  toc: TocEntry[];
  /** From the package (media:duration), when it says. */
  durationMs: number | null;
  /** The CSS class the book uses for "the part being read" (media:active-class). */
  activeClass: string | null;
};

/* ---------------------------------------------------------------- paths */

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

/** `href` (relative to the file at `base`), as a clean path inside the book. */
export function resolveHref(base: string, href: string): string {
  let h = href.split('#')[0].split('?')[0];
  try {
    h = decodeURIComponent(h);
  } catch {
    // keep as is
  }
  const parts = (h.startsWith('/') ? h.slice(1) : dirOf(base) + h).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

export const fragmentOf = (href: string) => {
  const i = href.indexOf('#');
  if (i < 0) return null;
  try {
    return decodeURIComponent(href.slice(i + 1)) || null;
  } catch {
    return href.slice(i + 1) || null;
  }
};

/* --------------------------------------------------------------- clock */

/** SMIL clock values: "0:00:01.200", "01:02.5", "12.5s", "500ms", "1.5min", "2h", "3.2". In ms, or null. */
export function parseClock(v: string | undefined | null): number | null {
  if (!v) return null;
  const s = v.trim();
  let m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (m) return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (m) return Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000);
  m = /^(\d+(?:\.\d+)?)\s*(h|min|s|ms)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  return Math.round(unit === 'h' ? n * 3_600_000 : unit === 'min' ? n * 60_000 : unit === 'ms' ? n : n * 1000);
}

/* ------------------------------------------------------------- package */

/** container.xml → the package file's path. */
export function rootfileOf(containerXml: string): string | null {
  const rf = findFirst(parseXml(containerXml), 'rootfile');
  return rf?.attrs['full-path'] ?? null;
}

export type ManifestItem = { id: string; href: string; mediaType: string; properties: string[]; overlay: string | null };

export type Package = {
  meta: Pick<BookJson, 'title' | 'authors' | 'narrators' | 'language' | 'description' | 'publisher' | 'date' | 'durationMs' | 'activeClass'>;
  manifest: Map<string, ManifestItem>;
  spine: ManifestItem[];
  cover: string | null;
  nav: string | null;
  ncx: string | null;
};

export function parsePackage(opfXml: string, opfPath: string): Package {
  const doc = parseXml(opfXml);
  const metadata = findFirst(doc, 'metadata') ?? doc;
  const dc = (n: string) => findAll(metadata, n).map((e) => textOf(e)).filter(Boolean);
  const metas = findAll(metadata, 'meta');
  const prop = (p: string) => metas.find((m) => m.attrs.property === p && !m.attrs.refines);
  const manifest = new Map<string, ManifestItem>();
  for (const it of findAll(findFirst(doc, 'manifest') ?? doc, 'item')) {
    if (!it.attrs.id || !it.attrs.href) continue;
    manifest.set(it.attrs.id, {
      id: it.attrs.id,
      href: resolveHref(opfPath, it.attrs.href),
      mediaType: (it.attrs['media-type'] ?? '').toLowerCase(),
      properties: (it.attrs.properties ?? '').split(/\s+/).filter(Boolean),
      overlay: it.attrs['media-overlay'] ?? null,
    });
  }
  const spineEl = findFirst(doc, 'spine');
  const spine = (spineEl ? findAll(spineEl, 'itemref') : [])
    .map((r) => manifest.get(r.attrs.idref ?? ''))
    .filter((x): x is ManifestItem => !!x && (x.mediaType.includes('html') || x.mediaType.includes('xml')));
  const items = [...manifest.values()];
  // EPUB 3 marks the cover image; EPUB 2 points at it with <meta name="cover">.
  const coverId = metas.find((m) => m.attrs.name === 'cover')?.attrs.content;
  const cover =
    items.find((i) => i.properties.includes('cover-image'))?.href ??
    (coverId ? manifest.get(coverId)?.href : undefined) ??
    items.find((i) => i.mediaType.startsWith('image/') && /cover/i.test(i.id + i.href))?.href ??
    null;
  const narrators = [...metas.filter((m) => m.attrs.property === 'media:narrator').map((m) => textOf(m)), ...findAll(metadata, 'contributor').filter((c) => (c.attrs['opf:role'] ?? '') === 'nrt').map((c) => textOf(c))].filter(Boolean);
  const durationMs = parseClock(prop('media:duration') ? textOf(prop('media:duration')!) : null);
  const activeClass = prop('media:active-class') ? textOf(prop('media:active-class')!) || null : null;
  return {
    meta: {
      title: dc('title')[0] ?? null,
      authors: dc('creator'),
      narrators,
      language: dc('language')[0] ?? null,
      description: dc('description')[0]?.replace(/<[^>]+>/g, '') ?? null,
      publisher: dc('publisher')[0] ?? null,
      date: dc('date')[0] ?? null,
      durationMs,
      activeClass,
    },
    manifest,
    spine,
    cover,
    nav: items.find((i) => i.properties.includes('nav'))?.href ?? null,
    ncx: items.find((i) => i.mediaType === 'application/x-dtbncx+xml')?.href ?? null,
  };
}

/* ----------------------------------------------------------------- toc */

/** The table of contents from the EPUB 3 nav document (or the EPUB 2 NCX). Hrefs are book paths with #fragments. */
export function parseNav(navXml: string, navPath: string): { title: string; href: string; depth: number }[] {
  const doc = parseXml(navXml);
  const navs = findAll(doc, 'nav');
  const toc = navs.find((n) => (n.attrs['epub:type'] ?? n.attrs.type ?? '').includes('toc')) ?? navs[0];
  if (!toc) return [];
  const out: { title: string; href: string; depth: number }[] = [];
  const list = (ol: XmlElement, depth: number) => {
    for (const li of ol.children) {
      if (typeof li === 'string' || li.name !== 'li') continue;
      const a = li.children.find((c): c is XmlElement => typeof c !== 'string' && (c.name === 'a' || c.name === 'span'));
      if (a && a.attrs.href) {
        const frag = fragmentOf(a.attrs.href);
        out.push({ title: textOf(a), href: resolveHref(navPath, a.attrs.href) + (frag ? `#${frag}` : ''), depth });
      }
      const sub = li.children.find((c): c is XmlElement => typeof c !== 'string' && c.name === 'ol');
      if (sub) list(sub, depth + 1);
    }
  };
  const ol = findFirst(toc, 'ol');
  if (ol) list(ol, 0);
  return out;
}

export function parseNcx(ncxXml: string, ncxPath: string): { title: string; href: string; depth: number }[] {
  const doc = parseXml(ncxXml);
  const out: { title: string; href: string; depth: number }[] = [];
  const go = (el: XmlElement, depth: number) => {
    for (const c of el.children) {
      if (typeof c === 'string' || c.name !== 'navpoint') continue;
      const src = findFirst(c, 'content')?.attrs.src;
      if (src) {
        const frag = fragmentOf(src);
        out.push({ title: textOf(findFirst(c, 'navlabel')), href: resolveHref(ncxPath, src) + (frag ? `#${frag}` : ''), depth });
      }
      go(c, depth + 1);
    }
  };
  const map = findFirst(doc, 'navmap');
  if (map) go(map, 0);
  return out;
}

/* -------------------------------------------------------- media overlay */

export type SmilPar = { text: string; id: string; audio: string; begin: number; end: number | null };

/** Every sentence of one SMIL file, in order: which element (text file + id) and which part of which audio file. */
export function parseSmil(smilXml: string, smilPath: string): SmilPar[] {
  const doc = parseXml(smilXml);
  const out: SmilPar[] = [];
  for (const par of findAll(doc, 'par')) {
    const text = findFirst(par, 'text');
    const audio = findFirst(par, 'audio');
    if (!text?.attrs.src || !audio?.attrs.src) continue;
    const id = fragmentOf(text.attrs.src);
    if (!id) continue;
    out.push({
      text: resolveHref(smilPath, text.attrs.src),
      id,
      audio: resolveHref(smilPath, audio.attrs.src),
      begin: parseClock(audio.attrs.clipbegin ?? audio.attrs['clip-begin']) ?? 0,
      end: parseClock(audio.attrs.clipend ?? audio.attrs['clip-end']),
    });
  }
  return out;
}

/**
 * Puts the book together: chapters in reading order, the audio files in the
 * order they are first used, every sentence clip (sorted by track and time),
 * and the table of contents pointed at chapters. Clip ends that the SMIL
 * leaves open are closed at the next clip's start in the same track.
 */
export function assembleBook(
  pkg: Package,
  overlays: Map<string, SmilPar[]>,
  toc: { title: string; href: string; depth: number }[]
): BookJson {
  const chapters: BookChapter[] = pkg.spine.map((s) => ({ href: s.href, title: '', overlay: !!(s.overlay && overlays.get(pkg.manifest.get(s.overlay)?.href ?? '')) }));
  const chapterOf = new Map(chapters.map((c, i) => [c.href, i]));
  const trackOf = new Map<string, number>();
  const tracks: BookTrack[] = [];
  const clips: BookClip[] = [];
  for (const s of pkg.spine) {
    const smil = s.overlay ? overlays.get(pkg.manifest.get(s.overlay)?.href ?? '') : undefined;
    for (const p of smil ?? []) {
      const c = chapterOf.get(p.text) ?? chapterOf.get(s.href);
      if (c === undefined) continue;
      let t = trackOf.get(p.audio);
      if (t === undefined) {
        t = tracks.length;
        trackOf.set(p.audio, t);
        tracks.push({ file: p.audio, durationMs: null });
      }
      clips.push({ c, id: p.id, t, b: p.begin, e: p.end ?? -1 });
    }
  }
  clips.sort((a, b) => a.t - b.t || a.b - b.b);
  for (let i = 0; i < clips.length; i++) {
    if (clips[i].e >= 0) continue;
    const next = clips[i + 1];
    clips[i].e = next && next.t === clips[i].t ? next.b : clips[i].b + 10_000;
  }
  const tocOut: TocEntry[] = [];
  for (const t of toc) {
    const c = chapterOf.get(t.href.split('#')[0]);
    if (c === undefined) continue;
    tocOut.push({ title: t.title || `Chapter ${c + 1}`, chapter: c, id: fragmentOf(t.href), depth: t.depth });
    if (!chapters[c].title && t.title) chapters[c].title = t.title;
  }
  chapters.forEach((ch, i) => {
    if (!ch.title) ch.title = `Part ${i + 1}`;
  });
  return { v: 1, ...pkg.meta, cover: pkg.cover, chapters, tracks, clips, toc: tocOut };
}

/* ------------------------------------------------------- read-along view */

export type Run = { t: string; id?: string; b?: 1; i?: 1 };
export type Block =
  | { k: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'pre' | 'cap'; id?: string; runs: Run[] }
  | { k: 'img'; id?: string; src: string; alt: string }
  | { k: 'hr' };

const BLOCKS = new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre', 'figure', 'figcaption', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'dl', 'dt', 'dd', 'body', 'hgroup', 'address', 'caption']);
const KIND: Record<string, 'h1' | 'h2' | 'h3' | 'h4' | 'li' | 'quote' | 'pre' | 'cap'> = {
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h4', h6: 'h4', li: 'li', blockquote: 'quote', pre: 'pre', figcaption: 'cap', caption: 'cap', dt: 'h4',
};

/**
 * A chapter (XHTML) as blocks of text with the element ids kept on each run,
 * so the sentence being read can be found and lit up. Images point at their
 * path inside the book. `ids` maps every id to the block it is in.
 */
export function chapterBlocks(xhtml: string, chapterPath: string): { blocks: Block[]; ids: Record<string, number> } {
  const doc = parseXml(xhtml);
  const body = findFirst(doc, 'body') ?? doc;
  const blocks: Block[] = [];
  const ids: Record<string, number> = {};
  let cur: { k: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'pre' | 'cap'; id?: string; runs: Run[] } | null = null;
  let pendingIds: string[] = [];

  const flush = () => {
    if (!cur) return;
    // Trim the edges; drop blocks that are only spaces.
    const runs = cur.runs;
    if (cur.k !== 'pre') {
      while (runs.length && !runs[0].t.trim()) runs.shift();
      while (runs.length && !runs[runs.length - 1].t.trim()) runs.pop();
      if (runs.length) {
        runs[0].t = runs[0].t.replace(/^\s+/, '');
        runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, '');
      }
    }
    if (runs.length) {
      const index = blocks.length;
      for (const id of pendingIds) if (ids[id] === undefined) ids[id] = index;
      if (cur.id && ids[cur.id] === undefined) ids[cur.id] = index;
      for (const r of runs) if (r.id && ids[r.id] === undefined) ids[r.id] = index;
      blocks.push(cur);
      pendingIds = [];
    }
    cur = null;
  };
  const open = (k: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'pre' | 'cap', id: string | undefined) => {
    flush();
    cur = { k, ...(id ? { id } : {}), runs: [] };
  };

  type Ctx = { id?: string; b?: 1; i?: 1; pre: boolean; kind: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'pre' | 'cap' };
  const text = (s: string, ctx: Ctx) => {
    const t = ctx.pre ? s : s.replace(/\s+/g, ' ');
    if (!t) return;
    if (!cur) open(ctx.kind, undefined);
    const last = cur!.runs[cur!.runs.length - 1];
    if (last && last.id === ctx.id && last.b === ctx.b && last.i === ctx.i) last.t += t;
    else cur!.runs.push({ t, ...(ctx.id ? { id: ctx.id } : {}), ...(ctx.b ? { b: 1 as const } : {}), ...(ctx.i ? { i: 1 as const } : {}) });
  };

  const go = (el: XmlElement, ctx: Ctx) => {
    for (const c of el.children) {
      if (typeof c === 'string') {
        text(c, ctx);
        continue;
      }
      const n = c.name;
      if (n === 'head' || n === 'script' || n === 'style' || n === 'svg' && !findFirst(c, 'image')) continue;
      const id = c.attrs.id || c.attrs['xml:id'] || undefined;
      if (n === 'br') {
        text('\n', { ...ctx, pre: true });
        continue;
      }
      if (n === 'hr') {
        flush();
        blocks.push({ k: 'hr' });
        continue;
      }
      if (n === 'img' || n === 'image') {
        const src = c.attrs.src ?? c.attrs['xlink:href'] ?? c.attrs.href;
        if (src) {
          flush();
          if (id) ids[id] = blocks.length;
          blocks.push({ k: 'img', ...(id ? { id } : {}), src: resolveHref(chapterPath, src), alt: c.attrs.alt ?? '' });
        }
        continue;
      }
      if (n === 'svg') {
        go(c, ctx);
        continue;
      }
      if (BLOCKS.has(n)) {
        const kind = KIND[n] ?? (n === 'p' || n === 'div' || n === 'dd' || n === 'td' || n === 'th' ? 'p' : ctx.kind);
        const isLeafy = !c.children.some((x) => typeof x !== 'string' && BLOCKS.has(x.name) && x.name !== 'body');
        flush();
        if (id) pendingIds.push(id);
        if (isLeafy || KIND[n]) open(kind, id);
        go(c, { ...ctx, id: id ?? ctx.id, kind: KIND[n] ?? 'p', pre: ctx.pre || n === 'pre' });
        flush();
        continue;
      }
      // Inline: em, strong, span, a...
      const bold = n === 'b' || n === 'strong' || /bold/.test(c.attrs.class ?? '') ? 1 : ctx.b;
      const italic = n === 'i' || n === 'em' || n === 'cite' || /italic/.test(c.attrs.class ?? '') ? 1 : ctx.i;
      go(c, { ...ctx, id: id ?? ctx.id, b: bold, i: italic });
    }
  };
  go(body, { kind: 'p', pre: false });
  flush();
  return { blocks, ids };
}

/* ---------------------------------------------------------- the timeline */

/** The clip playing at `ms` in track `t` (binary search; clips are sorted by track then start). */
export function clipAt(clips: BookClip[], t: number, ms: number): number {
  let lo = 0;
  let hi = clips.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = clips[mid];
    if (c.t < t || (c.t === t && c.b <= ms)) {
      if (c.t === t) found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  // Past its end and before the next one starts: nothing is being read (a pause between sentences counts as the last one).
  return ms <= clips[found].e + 1500 ? found : -1;
}

/** Where to start the audio for element `id` of chapter `c` (the first clip of it), or null. */
export function clipFor(clips: BookClip[], c: number, id: string): BookClip | null {
  return clips.find((x) => x.c === c && x.id === id) ?? null;
}

/** The first clip of a chapter (to start its narration), or null when it has none. */
export function firstClipOf(clips: BookClip[], c: number): BookClip | null {
  let best: BookClip | null = null;
  for (const x of clips) if (x.c === c && (!best || x.t < best.t || (x.t === best.t && x.b < best.b))) best = x;
  return best;
}
