/**
 * Web pages saved as books (.html, .htm, .xhtml) and the HTML inside Kindle
 * files: the body only, pictures kept when they are inside the file, and long
 * pages cut into chapters at their main headings.
 * Pure: no React, no native modules (tested in Node).
 */

import { decodeEntities } from '../../audio/xml.ts';
import { base64Bytes, charsetOf, decode, imageType } from './bytes.ts';
import { makeBook, type BookFile, type Chapter, type Converted } from './book.ts';

/** The charset a page says it is in (<meta charset> or the XML declaration). */
export function declaredCharset(head: string): string | null {
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1] ?? null;
}

const metaContent = (html: string, name: string) => {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  const v = tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : null;
  return v ? decodeEntities(v).trim() || null : null;
};

/** What is between <body> and </body> (the whole text when there is no body tag), without scripts and styles. */
export function bodyOf(html: string): string {
  const open = /<body\b[^>]*>/i.exec(html);
  const from = open ? open.index + open[0].length : 0;
  const close = html.toLowerCase().lastIndexOf('</body>');
  return html
    .slice(from, close > from ? close : undefined)
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
}

/** HTML cut before each of its main headings (h1, or h2 when there is at most one h1). */
export function cutAtHeadings(body: string): string[] {
  const count = (n: number) => (body.match(new RegExp(`<h${n}\\b`, 'gi')) ?? []).length;
  const level = count(1) >= 2 ? 1 : count(2) >= 2 ? 2 : 0;
  if (!level) return [body];
  const re = new RegExp(`<h${level}\\b`, 'gi');
  const at: number[] = [];
  for (let m = re.exec(body); m; m = re.exec(body)) at.push(m.index);
  const pieces: string[] = [];
  if (at[0] > 0) pieces.push(body.slice(0, at[0]));
  at.forEach((p, i) => pieces.push(body.slice(p, at[i + 1])));
  return pieces;
}

/** Pictures written into the page (data: addresses) become files; others are dropped (they are not in the file). */
export function keepInlineImages(body: string, images: BookFile[], prefix = 'images/web'): string {
  return body.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    const m = /^data:image\/[\w+.-]+;base64,(.+)$/i.exec(src);
    if (!m) return '';
    const bytes = base64Bytes(m[1]);
    const type = imageType(bytes);
    if (!type) return '';
    const path = `${prefix}${images.length + 1}.${type.ext}`;
    images.push({ path, data: bytes });
    return `<img src="../${path}" alt=""/>`;
  });
}

export function htmlToBook(bytes: Uint8Array): Converted {
  const head = decode(bytes, 'windows-1252', 0, Math.min(bytes.length, 4096));
  const html = decode(bytes, charsetOf(declaredCharset(head)));
  const images: BookFile[] = [];
  const body = keepInlineImages(bodyOf(html), images);
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim() || null;
  const author = metaContent(html, 'author') ?? metaContent(html, 'dc.creator');
  const chapters: Chapter[] = cutAtHeadings(body).map((h) => ({ html: h }));
  return makeBook({ title, authors: author ? [author] : [], language: /<html[^>]+lang=["']([\w-]+)/i.exec(html)?.[1] ?? null, description: metaContent(html, 'description') }, chapters, images, null);
}
