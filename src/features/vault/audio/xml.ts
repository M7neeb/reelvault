/**
 * A small, forgiving XML/XHTML reader for EPUB files: it turns the text into
 * a tree of elements (name, attributes, children) and text. Enough for
 * container.xml, the package (OPF), navigation, SMIL media overlays and the
 * chapters themselves. Namespace prefixes are kept on attributes
 * ("epub:type") and dropped from element names ("smil:par" → "par").
 * Pure: no React, no native modules (tested in Node).
 */

export type XmlNode = XmlElement | string;
export type XmlElement = { name: string; attrs: Record<string, string>; children: XmlNode[] };

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', shy: '­', middot: '·', bull: '•',
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// HTML elements that never have content. Not meta/link: in a package file (OPF) <meta> holds text.
const VOID = new Set(['br', 'hr', 'img', 'input', 'col', 'area', 'wbr', 'embed']);
const local = (n: string) => {
  const i = n.indexOf(':');
  return (i >= 0 ? n.slice(i + 1) : n).toLowerCase();
};

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** The whole document as one root element (named "#root"). Never throws on sloppy markup. */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      const t = text.slice(i);
      if (t) top().children.push(decodeEntities(t));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(text.slice(i, lt)));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      top().children.push(text.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') {
      const end = text.indexOf('>', lt + 1);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const gt = text.indexOf('>', lt + 1);
    if (gt < 0) break;
    const raw = text.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === '/') {
      const name = local(raw.slice(1).trim());
      // Close up to the matching element (tolerates missing end tags).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const sp = body.search(/\s/);
    const name = local(sp < 0 ? body : body.slice(0, sp));
    const el: XmlElement = { name, attrs: sp < 0 ? {} : parseAttrs(body.slice(sp)), children: [] };
    top().children.push(el);
    if (selfClose || VOID.has(name)) continue;
    if (name === 'script' || name === 'style') {
      const end = text.toLowerCase().indexOf(`</${name}`, i);
      i = end < 0 ? n : text.indexOf('>', end) + 1 || n;
      continue;
    }
    stack.push(el);
  }
  return root;
}

export function* walk(el: XmlElement): Generator<XmlElement> {
  for (const c of el.children) {
    if (typeof c === 'string') continue;
    yield c;
    yield* walk(c);
  }
}

export const findAll = (el: XmlElement, name: string) => [...walk(el)].filter((e) => e.name === name);
export const findFirst = (el: XmlElement, name: string) => {
  for (const e of walk(el)) if (e.name === name) return e;
  return null;
};

/** All the text inside, spaces collapsed. */
export function textOf(el: XmlElement | null): string {
  if (!el) return '';
  const parts: string[] = [];
  const go = (e: XmlElement) => {
    for (const c of e.children) typeof c === 'string' ? parts.push(c) : go(c);
  };
  go(el);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
