/**
 * FictionBook (.fb2, and .fb2.zip / .fbz): one XML file with the book's
 * details, its text in nested sections and its pictures as base64. Often in
 * Windows-1251 (Russian), so the declared encoding is honoured.
 * Pure: no React, no native modules (tested in Node).
 */

import { findAll, findFirst, parseXml, textOf, type XmlElement, type XmlNode } from '../../audio/xml.ts';
import { ascii, base64Bytes, charsetOf, decode, escapeHtml, imageType } from './bytes.ts';
import { makeBook, type BookFile, type Chapter, type Converted } from './book.ts';

const kids = (el: XmlElement, name: string) => el.children.filter((c): c is XmlElement => typeof c !== 'string' && c.name === name);
const hrefOf = (el: XmlElement) => (el.attrs['l:href'] ?? el.attrs['xlink:href'] ?? el.attrs.href ?? '').replace(/^#/, '');

/** Text of the FB2 file in the encoding it declares. */
export function fb2Text(bytes: Uint8Array): string {
  const head = ascii(bytes, 0, 200);
  return decode(bytes, charsetOf(/encoding=["']([\w-]+)["']/i.exec(head)?.[1]) ?? null);
}

export function fb2ToBook(bytes: Uint8Array): Converted {
  const doc = parseXml(fb2Text(bytes));
  const root = findFirst(doc, 'fictionbook');
  if (!root) throw new Error('This is not a FictionBook (FB2) file');
  const info = findFirst(root, 'title-info');

  // Pictures first, so the text can point at them.
  const images: BookFile[] = [];
  const imageById = new Map<string, string>();
  for (const bin of kids(root, 'binary')) {
    const id = bin.attrs.id;
    if (!id) continue;
    const data = base64Bytes(textOf(bin));
    const type = imageType(data);
    if (!type) continue;
    const path = `images/${String(images.length + 1).padStart(4, '0')}.${type.ext}`;
    images.push({ path, data });
    imageById.set(id, path);
  }

  const inline = (nodes: XmlNode[]): string =>
    nodes
      .map((n) => {
        if (typeof n === 'string') return escapeHtml(n);
        if (n.name === 'strong') return `<b>${inline(n.children)}</b>`;
        if (n.name === 'emphasis') return `<i>${inline(n.children)}</i>`;
        if (n.name === 'image') {
          const path = imageById.get(hrefOf(n));
          return path ? `<img src="../${path}" alt=""/>` : '';
        }
        // a (links, footnote marks), strikethrough, sub, sup, code, style: just their text.
        if (n.name === 'a' && n.attrs.type === 'note') return `<sup>${inline(n.children)}</sup>`;
        return inline(n.children);
      })
      .join('');

  const block = (el: XmlElement, depth: number): string => {
    switch (el.name) {
      case 'title':
        return el.children
          .filter((c): c is XmlElement => typeof c !== 'string' && c.name === 'p')
          .map((p) => `<h${Math.min(4, depth + 1)}>${inline(p.children)}</h${Math.min(4, depth + 1)}>`)
          .join('\n');
      case 'subtitle':
        return `<h4>${inline(el.children)}</h4>`;
      case 'p':
      case 'v':
      case 'text-author':
        return `<p>${inline(el.children)}</p>`;
      case 'empty-line':
        return '';
      case 'image': {
        const path = imageById.get(hrefOf(el));
        return path ? `<p><img src="../${path}" alt=""/></p>` : '';
      }
      case 'epigraph':
      case 'cite':
        return `<blockquote>${el.children.filter((c): c is XmlElement => typeof c !== 'string').map((c) => block(c, depth)).join('\n')}</blockquote>`;
      case 'poem':
      case 'stanza':
        return el.children.filter((c): c is XmlElement => typeof c !== 'string').map((c) => block(c, depth)).join('\n');
      case 'table':
        return findAll(el, 'tr')
          .map((tr) => `<p>${tr.children.filter((c): c is XmlElement => typeof c !== 'string').map((td) => inline(td.children)).join(' · ')}</p>`)
          .join('\n');
      case 'section':
        return el.children.filter((c): c is XmlElement => typeof c !== 'string').map((c) => block(c, depth + 1)).join('\n');
      default:
        return '';
    }
  };

  const chapters: Chapter[] = [];
  const titleText = (s: XmlElement) => {
    const t = findFirst(s, 'title');
    return t && kids(s, 'title').length ? textOf(t).replace(/\s+/g, ' ').trim() || null : null;
  };
  // A section with sections inside is a part: its own text (title, epigraph) opens it, each inner section is a chapter.
  const addSection = (s: XmlElement, depth: number) => {
    const inner = kids(s, 'section');
    if (inner.length && depth < 2) {
      const own = s.children.filter((c): c is XmlElement => typeof c !== 'string' && c.name !== 'section');
      const html = own.map((c) => block(c, depth)).join('\n');
      chapters.push({ title: titleText(s), html, depth });
      for (const c of inner) addSection(c, depth + 1);
      return;
    }
    chapters.push({ title: titleText(s), html: block(s, depth - 1), depth });
  };

  const bodies = kids(root, 'body');
  for (const [i, body] of bodies.entries()) {
    const notes = body.attrs.name === 'notes' || body.attrs.name === 'comments';
    if (i === 0) {
      // The body's own title is the book's title, already on the cover and the shelf.
      const lead = body.children.filter((c): c is XmlElement => typeof c !== 'string' && c.name !== 'section' && c.name !== 'title');
      if (lead.length) chapters.push({ html: lead.map((c) => block(c, 0)).join('\n') });
    }
    if (notes) {
      const html = kids(body, 'section').map((s) => block(s, 0)).join('\n');
      const t = kids(body, 'title')[0];
      chapters.push({ title: (t ? textOf(t).replace(/\s+/g, ' ').trim() : '') || 'Notes', html, depth: 0 });
      continue;
    }
    for (const s of kids(body, 'section')) addSection(s, 0);
  }

  const authors = info
    ? kids(info, 'author')
        .map((a) => ['first-name', 'middle-name', 'last-name'].map((n) => textOf(findFirst(a, n)).trim()).filter(Boolean).join(' ') || textOf(findFirst(a, 'nickname')).trim())
        .filter(Boolean)
    : [];
  const coverImage = info ? findFirst(findFirst(info, 'coverpage') ?? { name: '', attrs: {}, children: [] }, 'image') : null;
  const cover = coverImage ? (imageById.get(hrefOf(coverImage)) ?? null) : null;
  const publish = findFirst(root, 'publish-info');
  return makeBook(
    {
      title: info ? textOf(findFirst(info, 'book-title')) : null,
      authors,
      language: info ? textOf(findFirst(info, 'lang')) || null : null,
      description: info ? textOf(findFirst(info, 'annotation')) || null : null,
      publisher: publish ? textOf(findFirst(publish, 'publisher')) || null : null,
      date: info ? textOf(findFirst(info, 'date')) || null : null,
    },
    chapters,
    images,
    cover
  );
}
