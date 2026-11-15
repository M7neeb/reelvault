/**
 * Plain text (.txt) and Markdown (.md) books: paragraphs found from blank
 * lines (hard-wrapped lines joined back up), chapters found from their
 * headings ("CHAPTER IV", "Part Two", "Глава 3", "# Title"), and a Project
 * Gutenberg licence cut off so the book starts at its first page.
 * Pure: no React, no native modules (tested in Node).
 */

import { escapeHtml } from './bytes.ts';
import { makeBook, type Chapter, type Converted } from './book.ts';

const HEADING = /^(chapter|part|book|volume|section|prologue|epilogue|preface|introduction|afterword|appendix|letter|act|scene|kapitel|teil|chapitre|partie|livre|capítulo|capitulo|parte|libro|глава|часть|книга|пролог|эпилог)(?=$|[\s.:\-–—])[\s.:\-–—]*[\p{L}\p{N}\s.:\-–—'’"“”,]{0,60}$/iu;
const ROMAN = /^(?=[MDCLXVI])M{0,3}(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})\.?$/;
const NUMBERED = /^\d{1,3}\.?$/;

/** A line that names a chapter. */
export function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 70) return false;
  if (ROMAN.test(t) || NUMBERED.test(t)) return true;
  // "CHAPTER I CHAPTER II CHAPTER III" is a list of contents run together, not a heading.
  const words = t.match(/\p{L}+/gu) ?? [];
  const keyword = words[0]?.toLowerCase();
  return HEADING.test(t) && words.filter((w) => w.toLowerCase() === keyword).length === 1;
}

/** The book between Project Gutenberg's start and end markers, and its title and author. */
export function gutenberg(text: string): { body: string; title: string | null; author: string | null } {
  const start = /\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i.exec(text);
  const end = /\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i.exec(text);
  if (!start) return { body: text, title: null, author: null };
  const head = text.slice(0, start.index);
  const title = /^Title:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? null;
  const author = /^Author:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? null;
  return { body: text.slice(start.index + start[0].length, end && end.index > start.index ? end.index : undefined), title, author };
}

/** Paragraphs of a text: split at blank lines, or at every line when the file has (almost) none. */
export function paragraphsOf(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blank = lines.filter((l) => !l.trim()).length;
  const lineEach = lines.length > 20 && blank / lines.length < 0.02;
  if (lineEach) return lines.map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (!l.trim()) {
      if (cur.length) out.push(cur.join(' '));
      cur = [];
    } else cur.push(l.trim());
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

const inline = (s: string, md: boolean) => {
  let h = escapeHtml(s);
  if (md) {
    h = h
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
      .replace(/(^|[\s(])_(?!\s)(.+?)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  } else {
    // Gutenberg marks italics _like this_.
    h = h.replace(/(^|[\s("“])_(?!\s)([^_]+?)_(?=[\s).,;:!?"”]|$)/g, '$1<i>$2</i>');
  }
  return h;
};

/** Three or more chapters in a row with almost no text are a contents list printed as headings: one chapter, "Contents". */
export function mergeContents(chapters: Chapter[]): void {
  const tiny = (c: Chapter) => c.html.replace(/<h\d>[\s\S]*?<\/h\d>/g, '').replace(/<[^>]+>/g, '').trim().length < 300;
  for (let i = 0; i < chapters.length; i++) {
    let j = i;
    while (j < chapters.length && tiny(chapters[j])) j++;
    if (j - i >= 3) {
      chapters.splice(i, j - i, { title: 'Contents', html: chapters.slice(i, j).map((c) => c.html).join('\n'), depth: 0 });
    }
  }
}

export function textToBook(text: string, markdown = false): Converted {
  const g = markdown ? { body: text, title: null, author: null } : gutenberg(text);
  const paras = paragraphsOf(g.body);
  const chapters: Chapter[] = [];
  let cur: { title: string | null; parts: string[]; depth: number } | null = null;
  let lastWasHeading = false;
  let mdTitle: string | null = null;

  const flush = () => {
    if (cur && cur.parts.length) chapters.push({ title: cur.title, html: cur.parts.join('\n'), depth: cur.depth });
    cur = null;
  };

  for (const p of paras) {
    const md = markdown ? /^(#{1,6})\s+(.+?)\s*#*$/.exec(p) : null;
    if (md || (!markdown && isHeading(p))) {
      const level = md ? md[1].length : 2;
      const name = md ? md[2] : p.trim();
      if (md && level === 1 && !mdTitle) mdTitle = name;
      const tag = `h${Math.min(4, Math.max(1, level))}`;
      // "PART ONE" followed straight away by "CHAPTER I" opens one chapter, not two.
      if (lastWasHeading && cur) {
        cur.parts.push(`<${tag}>${inline(name, markdown)}</${tag}>`);
        cur.title = `${cur.title} · ${name}`;
      } else {
        flush();
        cur = { title: name, parts: [`<${tag}>${inline(name, markdown)}</${tag}>`], depth: 0 };
      }
      lastWasHeading = true;
      continue;
    }
    lastWasHeading = false;
    if (!cur) cur = { title: null, parts: [], depth: 0 };
    if (markdown && /^(-{3,}|\*{3,})$/.test(p)) cur.parts.push('<hr/>');
    else if (markdown && /^>\s?/.test(p)) cur.parts.push(`<blockquote><p>${inline(p.replace(/^>\s?/gm, ''), true)}</p></blockquote>`);
    else if (markdown && /^([-*+]|\d+\.)\s/.test(p)) cur.parts.push(`<ul>${p.split(/\s(?=[-*+]\s|\d+\.\s)/).map((x) => `<li>${inline(x.replace(/^([-*+]|\d+\.)\s/, ''), true)}</li>`).join('')}</ul>`);
    else cur.parts.push(`<p>${inline(p, markdown)}</p>`);
  }
  flush();
  mergeContents(chapters);
  return makeBook({ title: g.title ?? mdTitle ?? null, authors: g.author ? [g.author] : [] }, chapters, [], null);
}
