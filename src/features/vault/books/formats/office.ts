/**
 * Documents as books: Word (.docx), OpenDocument (.odt) and Rich Text (.rtf).
 * Headings, paragraphs, bold and italic, lists and pictures are kept; page
 * layout, fonts and colours are not. Chapters are cut at the main headings.
 * Pure: no React, no native modules (tested in Node).
 */

import { strFromU8, unzipSync } from 'fflate';

import { findAll, findFirst, parseXml, textOf, type XmlElement, type XmlNode } from '../../audio/xml.ts';
import { decode, escapeHtml, imageType, type Charset } from './bytes.ts';
import { makeBook, type BookFile, type Converted } from './book.ts';
import { cutAtHeadings } from './html.ts';

const isEl = (c: XmlNode): c is XmlElement => typeof c !== 'string';

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error('This document could not be opened (the file is damaged)');
  }
}

/** Title and author from a Dublin Core block (docProps/core.xml or meta.xml). */
function dcMeta(xml: string | null): { title: string | null; author: string | null } {
  if (!xml) return { title: null, author: null };
  const doc = parseXml(xml);
  const title = textOf(findFirst(doc, 'title')).trim() || null;
  const author = textOf(findFirst(doc, 'creator')).trim() || textOf(findFirst(doc, 'initial-creator')).trim() || null;
  return { title, author };
}

function keepImage(files: Record<string, Uint8Array>, path: string, images: BookFile[], seen: Map<string, string>): string | null {
  if (seen.has(path)) return seen.get(path)!;
  const data = files[path];
  const type = data ? imageType(data) : null;
  if (!data || !type) return null;
  const out = `images/${String(images.length + 1).padStart(4, '0')}.${type.ext}`;
  images.push({ path: out, data });
  seen.set(path, out);
  return out;
}

/* ----------------------------------------------------------------- Word */

export function docxToBook(bytes: Uint8Array): Converted {
  const files = unzip(bytes);
  const main = files['word/document.xml'];
  if (!main) throw new Error('This is not a Word document (.docx)');
  const rels = new Map<string, string>();
  const relXml = files['word/_rels/document.xml.rels'];
  if (relXml) for (const r of findAll(parseXml(strFromU8(relXml)), 'relationship')) if (r.attrs.id && r.attrs.target) rels.set(r.attrs.id, r.attrs.target.replace(/^\/?(word\/)?/, 'word/'));
  const images: BookFile[] = [];
  const seen = new Map<string, string>();

  const on = (el: XmlElement | null) => !!el && !['0', 'false', 'off'].includes((el.attrs['w:val'] ?? '').toLowerCase());
  const runs = (nodes: XmlNode[]): string =>
    nodes
      .filter(isEl)
      .map((n) => {
        if (n.name === 'r') {
          const pr = n.children.filter(isEl).find((c) => c.name === 'rpr') ?? null;
          const bold = pr ? on(pr.children.filter(isEl).find((c) => c.name === 'b') ?? null) : false;
          const italic = pr ? on(pr.children.filter(isEl).find((c) => c.name === 'i') ?? null) : false;
          let h = n.children
            .filter(isEl)
            .map((c) => {
              if (c.name === 't') return escapeHtml(c.children.filter((x): x is string => typeof x === 'string').join(''));
              if (c.name === 'tab') return ' ';
              if (c.name === 'br' || c.name === 'cr') return '<br/>';
              if (c.name === 'drawing' || c.name === 'pict') {
                const blip = findFirst(c, 'blip') ?? findFirst(c, 'imagedata');
                const id = blip?.attrs['r:embed'] ?? blip?.attrs['r:id'];
                const target = id ? rels.get(id) : undefined;
                const path = target ? keepImage(files, target, images, seen) : null;
                return path ? `<img src="../${path}" alt=""/>` : '';
              }
              return '';
            })
            .join('');
          if (bold && h) h = `<b>${h}</b>`;
          if (italic && h) h = `<i>${h}</i>`;
          return h;
        }
        if (n.name === 'hyperlink' || n.name === 'smarttag' || n.name === 'ins' || n.name === 'sdtcontent' || n.name === 'sdt' || n.name === 'fldsimple') return runs(n.children);
        return '';
      })
      .join('');

  const paragraph = (p: XmlElement): string => {
    const pr = p.children.filter(isEl).find((c) => c.name === 'ppr');
    const style = (pr ? findFirst(pr, 'pstyle')?.attrs['w:val'] : '') ?? '';
    const inner = runs(p.children);
    if (!inner.replace(/<br\/>/g, '').trim() && !inner.includes('<img')) return '';
    if (/^title$/i.test(style)) return `<h1>${inner}</h1>`;
    const level = /(heading|berschrift|titre|titolo|t[ií]tulo|заголовок)\s*(\d)/i.exec(style)?.[2];
    if (level) return `<h${Math.min(4, Number(level))}>${inner}</h${Math.min(4, Number(level))}>`;
    if (pr && findFirst(pr, 'numpr')) return `<ul><li>${inner}</li></ul>`;
    if (/quote/i.test(style)) return `<blockquote><p>${inner}</p></blockquote>`;
    return `<p>${inner}</p>`;
  };

  const blocks = (nodes: XmlNode[]): string[] =>
    nodes.filter(isEl).flatMap((n) => {
      if (n.name === 'p') return [paragraph(n)];
      if (n.name === 'tbl') return findAll(n, 'tr').map((tr) => `<p>${tr.children.filter(isEl).filter((c) => c.name === 'tc').map((tc) => findAll(tc, 'p').map((p) => runs(p.children)).join(' ')).join(' · ')}</p>`);
      if (n.name === 'sdt' || n.name === 'sdtcontent') return blocks(n.children);
      return [];
    });

  const body = findFirst(parseXml(strFromU8(main)), 'body');
  const html = blocks(body?.children ?? []).filter(Boolean).join('\n').replace(/<\/ul>\n<ul>/g, '\n');
  const meta = dcMeta(files['docProps/core.xml'] ? strFromU8(files['docProps/core.xml']) : null);
  return makeBook({ title: meta.title, authors: meta.author ? [meta.author] : [] }, cutAtHeadings(html).map((h) => ({ html: h })), images, null);
}

/* -------------------------------------------------------- OpenDocument */

export function odtToBook(bytes: Uint8Array): Converted {
  const files = unzip(bytes);
  const content = files['content.xml'];
  if (!content) throw new Error('This is not an OpenDocument text file (.odt)');
  const images: BookFile[] = [];
  const seen = new Map<string, string>();

  const inline = (nodes: XmlNode[]): string =>
    nodes
      .map((n) => {
        if (typeof n === 'string') return escapeHtml(n);
        if (n.name === 's') return ' '.repeat(Math.max(1, Number(n.attrs['text:c'] ?? 1)));
        if (n.name === 'tab') return ' ';
        if (n.name === 'line-break') return '<br/>';
        if (n.name === 'note') return '';
        if (n.name === 'frame') {
          const img = findFirst(n, 'image');
          const path = img?.attrs['xlink:href'] ? keepImage(files, img.attrs['xlink:href'], images, seen) : null;
          return path ? `<img src="../${path}" alt=""/>` : '';
        }
        return inline(n.children);
      })
      .join('');

  const blocks = (nodes: XmlNode[]): string[] =>
    nodes.filter(isEl).flatMap((n) => {
      if (n.name === 'h') {
        const level = Math.min(4, Math.max(1, Number(n.attrs['text:outline-level'] ?? 1)));
        return [`<h${level}>${inline(n.children)}</h${level}>`];
      }
      if (n.name === 'p') {
        const inner = inline(n.children);
        return inner.replace(/<br\/>/g, '').trim() || inner.includes('<img') ? [`<p>${inner}</p>`] : [];
      }
      if (n.name === 'list') return [`<ul>${findAll(n, 'list-item').map((li) => `<li>${li.children.filter(isEl).map((c) => inline(c.children)).join(' ')}</li>`).join('')}</ul>`];
      if (n.name === 'section' || n.name === 'text' || n.name === 'body') return blocks(n.children);
      if (n.name === 'table') return findAll(n, 'table-row').map((tr) => `<p>${tr.children.filter(isEl).map((td) => td.children.filter(isEl).map((c) => inline(c.children)).join(' ')).join(' · ')}</p>`);
      return [];
    });

  const doc = parseXml(strFromU8(content));
  const text = findFirst(doc, 'text');
  const html = blocks(text?.children ?? []).join('\n');
  const meta = dcMeta(files['meta.xml'] ? strFromU8(files['meta.xml']) : null);
  return makeBook({ title: meta.title, authors: meta.author ? [meta.author] : [] }, cutAtHeadings(html).map((h) => ({ html: h })), images, null);
}

/* ------------------------------------------------------------ Rich Text */

const SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'pict', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'generator', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore',
  'mmathpr', 'pgdsctbl', 'filetbl', 'revtbl', 'object', 'fldinst', 'bkmkstart', 'bkmkend', 'nonshppict', 'shppict', 'footnote', 'annotation',
]);

/** Paragraphs of an RTF document, with bold and italic, plus its title and author. */
export function rtfParagraphs(src: string): { paras: string[]; title: string | null; author: string | null } {
  type State = { b: boolean; i: boolean; skip: boolean; uc: number; dest: 'title' | 'author' | null };
  let st: State = { b: false, i: false, skip: false, uc: 1, dest: null };
  const stack: State[] = [];
  let cs: Charset = 'windows-1252';
  const paras: string[] = [];
  let cur = '';
  let open: { b: boolean; i: boolean } = { b: false, i: false };
  let skipChars = 0;
  let title = '';
  let author = '';
  let groupStart = false;

  const emit = (t: string) => {
    if (st.dest === 'title') return void (title += t);
    if (st.dest === 'author') return void (author += t);
    if (st.skip) return;
    if (st.b !== open.b || st.i !== open.i) {
      if (open.i) cur += '</i>';
      if (open.b) cur += '</b>';
      if (st.b) cur += '<b>';
      if (st.i) cur += '<i>';
      open = { b: st.b, i: st.i };
    }
    cur += t;
  };
  const endPara = () => {
    if (open.i) cur += '</i>';
    if (open.b) cur += '</b>';
    open = { b: false, i: false };
    if (cur.replace(/<[^>]+>/g, '').trim()) paras.push(cur.trim());
    cur = '';
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      stack.push(st);
      st = { ...st };
      groupStart = true;
      continue;
    }
    if (c === '}') {
      st = stack.pop() ?? st;
      groupStart = false;
      continue;
    }
    if (c === '\r' || c === '\n') continue;
    if (c !== '\\') {
      if (skipChars > 0) {
        skipChars--;
        continue;
      }
      groupStart = false;
      emit(escapeHtml(c));
      continue;
    }
    const n = src[i + 1];
    if (n === undefined) break;
    if (n === '\\' || n === '{' || n === '}') {
      i++;
      emit(escapeHtml(n));
      continue;
    }
    if (n === '~') {
      i++;
      emit(' ');
      continue;
    }
    if (n === '-') {
      i++;
      continue;
    }
    if (n === '_') {
      i++;
      emit('-');
      continue;
    }
    if (n === '*') {
      i++;
      if (groupStart) st.skip = true;
      continue;
    }
    if (n === "'") {
      const byte = parseInt(src.slice(i + 2, i + 4), 16);
      i += 3;
      if (skipChars > 0) {
        skipChars--;
        continue;
      }
      if (Number.isFinite(byte)) emit(escapeHtml(decode(Uint8Array.of(byte), cs)));
      continue;
    }
    const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40));
    if (!m) {
      i++;
      continue;
    }
    i += m[0].length;
    const word = m[1].toLowerCase();
    const param = m[2] !== undefined ? Number(m[2]) : null;
    const wasStart = groupStart;
    groupStart = false;
    if (SKIP.has(word) && wasStart) st.skip = true;
    else if (word === 'title' && wasStart) st.dest = 'title';
    else if (word === 'author' && wasStart) st.dest = 'author';
    else if (word === 'info' && wasStart) st.skip = true;
    else if (word === 'ansicpg') cs = param === 1251 ? 'windows-1251' : 'windows-1252';
    else if (word === 'par' || word === 'sect' || word === 'page') endPara();
    else if (word === 'line') emit('<br/>');
    else if (word === 'tab') emit(' ');
    else if (word === 'b') st.b = param !== 0;
    else if (word === 'i') st.i = param !== 0;
    else if (word === 'plain') st.b = st.i = false;
    else if (word === 'uc') st.uc = param ?? 1;
    else if (word === 'u' && param !== null) {
      emit(escapeHtml(String.fromCharCode(param < 0 ? param + 65536 : param)));
      skipChars = st.uc;
    } else if (word === 'emdash') emit('—');
    else if (word === 'endash') emit('–');
    else if (word === 'lquote') emit('‘');
    else if (word === 'rquote') emit('’');
    else if (word === 'ldblquote') emit('“');
    else if (word === 'rdblquote') emit('”');
    else if (word === 'bullet') emit('•');
    // The info group is skipped, but its title and author are wanted: let those through.
    if ((word === 'title' || word === 'author') && wasStart) st.skip = false;
  }
  endPara();
  return { paras, title: title.trim() || null, author: author.trim() || null };
}

export function rtfToBook(bytes: Uint8Array): Converted {
  const src = decode(bytes, 'windows-1252');
  if (!src.startsWith('{\\rtf')) throw new Error('This is not a Rich Text (.rtf) file');
  const { paras, title, author } = rtfParagraphs(src);
  const html = paras.map((p) => `<p>${p}</p>`).join('\n');
  return makeBook({ title, authors: author ? [author] : [] }, cutAtHeadings(html).map((h) => ({ html: h })), [], null);
}
