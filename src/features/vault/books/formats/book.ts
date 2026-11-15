/**
 * What every converter hands back: the same shape an unpacked EPUB has, so the
 * reader, search, highlights and stats work the same for every format. A book
 * becomes chapter files (text/0001.html...), its pictures (images/...) and the
 * book's description (BookJson). Pure: no React, no native modules.
 */

import type { BookChapter, BookJson, TocEntry } from '../../audio/epub.ts';
import { decodeEntities } from '../../audio/xml.ts';
import { escapeHtml } from './bytes.ts';

export type BookFile = { path: string; data: string | Uint8Array };
export type Converted = { book: BookJson; files: BookFile[] };

export type Meta = { title?: string | null; authors?: string[]; language?: string | null; description?: string | null; publisher?: string | null; date?: string | null };
export type Chapter = { title?: string | null; html: string; depth?: number };

const clean = (s: string | null | undefined) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t || null;
};

/** The text of the first heading in some HTML (for a chapter's name). */
export function firstHeading(html: string): string | null {
  const m = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(html);
  if (!m) return null;
  const t = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return t && t.length <= 120 ? t : t ? `${t.slice(0, 117)}…` : null;
}

/** Visible text of some HTML, for checks like "is this chapter empty". */
export const plainOf = (html: string) =>
  decodeEntities(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Long stretches of HTML cut where a paragraph ends, so no chapter file is so
 * big that opening it is slow on a phone. Cuts only between top-level blocks.
 */
export function splitHtml(html: string, target = 80_000): string[] {
  if (html.length <= target * 1.5) return [html];
  const out: string[] = [];
  let from = 0;
  while (html.length - from > target * 1.5) {
    let at = -1;
    const re = /<\/(p|div|h[1-6]|blockquote|pre|table|ul|ol|section)>/gi;
    re.lastIndex = from + target;
    const m = re.exec(html);
    if (m && m.index < from + target * 2) at = m.index + m[0].length;
    if (at < 0) break;
    out.push(html.slice(from, at));
    from = at;
  }
  out.push(html.slice(from));
  return out;
}

const page = (title: string, body: string, lang: string | null) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"${lang ? ` lang="${escapeHtml(lang)}"` : ''}><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head><body>\n${body}\n</body></html>\n`;

/**
 * The finished book. Chapters with no words and no pictures are dropped;
 * chapters with no name get the first heading, else "Part N".
 */
export function makeBook(meta: Meta, chapters: Chapter[], images: BookFile[], cover: string | null): Converted {
  const files: BookFile[] = [...images];
  const list: BookChapter[] = [];
  const toc: TocEntry[] = [];
  const lang = clean(meta.language);
  for (const c of chapters) {
    if (!plainOf(c.html) && !/<img\b/i.test(c.html)) continue;
    const pieces = splitHtml(c.html);
    const name = clean(c.title) ?? firstHeading(c.html);
    for (const [k, piece] of pieces.entries()) {
      const href = `text/${String(list.length + 1).padStart(4, '0')}.html`;
      const title = name ? (pieces.length > 1 && k > 0 ? `${name} (${k + 1})` : name) : `Part ${list.length + 1}`;
      files.push({ path: href, data: page(title, piece, lang) });
      if (k === 0 && name) toc.push({ title: name, chapter: list.length, id: null, depth: Math.max(0, c.depth ?? 0) });
      list.push({ href, title, overlay: false });
    }
  }
  if (!list.length) throw new Error('This book has no text that could be read');
  const book: BookJson = {
    v: 1,
    title: clean(meta.title),
    authors: (meta.authors ?? []).map((a) => clean(a)).filter((a): a is string => !!a),
    narrators: [],
    language: lang,
    description: clean(meta.description),
    publisher: clean(meta.publisher),
    date: clean(meta.date),
    cover,
    chapters: list,
    tracks: [],
    clips: [],
    toc,
    durationMs: null,
    activeClass: null,
  };
  return { book, files };
}
