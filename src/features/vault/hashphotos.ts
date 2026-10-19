
/** Adds to a list in a map in place (copying the list each time gets slow with thousands of items). */
function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
/**
 * HashPhotos' "Export Metadata" file (CSV, JSON or XML) read back into
 * ReelVault: keywords, rating, title, caption and pick/reject for each file,
 * matched to your videos by file name. The exact column names HashPhotos uses
 * are not documented, so common names are recognised (keywords / tags,
 * rating / stars, title, caption / description, file name / filename...).
 * Nothing is applied until you have seen what was found. Pure, so it is
 * tested in Node.
 */

export type MetaRecord = {
  filename: string;
  keywords: string[];
  /** Already on ReelVault's 1-10 scale (HashPhotos' 1-5 stars are doubled). */
  rating: number | null;
  title: string | null;
  caption: string | null;
  flag: -1 | 0 | 1 | null;
  /** The file's size in bytes and its length, when the export has them (a second way to find the video). */
  size?: number | null;
  durationMs?: number | null;
};

export type MetaFile = { format: 'csv' | 'json' | 'xml'; records: MetaRecord[]; columns: string[]; recognised: string[] };

const norm = (k: string) => k.toLowerCase().replace(/[^a-z]/g, '');

const FIELDS: Record<keyof MetaRecord, string[]> = {
  filename: ['filename', 'name', 'file', 'originalfilename', 'originalname', 'path', 'filepath', 'sourcefile', 'url'],
  keywords: ['keywords', 'keyword', 'tags', 'tag', 'subject', 'labels'],
  rating: ['rating', 'stars', 'starrating', 'score'],
  title: ['title', 'headline', 'objectname'],
  caption: ['caption', 'description', 'comment', 'comments', 'notes', 'note', 'captionabstract'],
  flag: ['flag', 'pick', 'flagged', 'status'],
  size: ['size', 'filesize', 'bytes', 'sizebytes', 'filesizebytes', 'filelength'],
  durationMs: ['duration', 'length', 'videoduration', 'durationseconds', 'seconds', 'runtime'],
};

/** "12345", "12,345" or "14.2 MB" into bytes. */
function bytesOf(v: unknown): number | null {
  const m = /^\s*([\d.,]+)\s*([kmgt]?i?b)?\s*$/i.exec(String(v ?? ''));
  if (!m) return null;
  const unit = (m[2] ?? '').toLowerCase();
  const n = Number(unit ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const pow = { '': 0, b: 0, kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3, tb: 4, tib: 4 }[unit] ?? 0;
  return Math.round(n * 1024 ** pow);
}

/** "83", "83.4", "1:23" or "01:02:03" into milliseconds. */
function msOf(v: unknown): number | null {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (t.includes(':')) {
    const parts = t.split(':').map(Number);
    if (parts.some((x) => !Number.isFinite(x))) return null;
    return Math.round(parts.reduce((a, x) => a * 60 + x, 0) * 1000);
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}

function fieldOf(key: string): keyof MetaRecord | null {
  const k = norm(key);
  for (const [field, names] of Object.entries(FIELDS)) if (names.includes(k)) return field as keyof MetaRecord;
  return null;
}

const baseName = (p: string) => p.split(/[\\/]/).pop()!.trim();

function splitKeywords(v: unknown): string[] {
  const list = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[;,|\n]/);
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

function flagOf(v: unknown): MetaRecord['flag'] {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['1', 'pick', 'picked', 'yes', 'true', 'flagged'].includes(s)) return 1;
  if (['-1', 'reject', 'rejected'].includes(s)) return -1;
  if (['0', 'none', 'no', 'false', 'unflagged'].includes(s)) return 0;
  return null;
}

/** Rows of key → value pairs into records; ratings are scaled once for the whole file. */
function toRecords(rows: Record<string, unknown>[]): { records: MetaRecord[]; columns: string[]; recognised: string[] } {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const map = new Map(columns.map((c) => [c, fieldOf(c)]));
  const recognised = [...new Set([...map.values()].filter((f): f is keyof MetaRecord => !!f))];
  const raw = rows.map((row) => {
    const rec: MetaRecord & { rawRating: number | null } = { filename: '', keywords: [], rating: null, rawRating: null, title: null, caption: null, flag: null };
    for (const [col, value] of Object.entries(row)) {
      const f = map.get(col);
      if (!f || value === null || value === undefined || value === '') continue;
      if (f === 'filename' && !rec.filename) rec.filename = baseName(String(value));
      else if (f === 'keywords') rec.keywords = [...new Set([...rec.keywords, ...splitKeywords(value)])];
      else if (f === 'rating') {
        const n = Number(String(value).replace(',', '.'));
        if (Number.isFinite(n) && n > 0) rec.rawRating = n;
      } else if (f === 'title' && !rec.title) rec.title = String(value).trim() || null;
      else if (f === 'caption' && !rec.caption) rec.caption = String(value).trim() || null;
      else if (f === 'flag') rec.flag = flagOf(value);
      else if (f === 'size' && !rec.size) rec.size = bytesOf(value);
      else if (f === 'durationMs' && !rec.durationMs) rec.durationMs = msOf(value);
    }
    return rec;
  });
  // Stars (1-5) become 2-10; a file that already uses 1-10 is kept as it is.
  const five = raw.every((r) => r.rawRating === null || r.rawRating <= 5);
  const records = raw
    .filter((r) => r.filename)
    .map(({ rawRating, ...r }) => ({ ...r, rating: rawRating === null ? null : Math.max(1, Math.min(10, Math.round(five ? rawRating * 2 : rawRating))) }));
  return { records, columns, recognised };
}

/** RFC 4180-ish CSV: quotes, doubled quotes, commas or semicolons, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

function xmlRows(text: string): Record<string, unknown>[] {
  const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
  // The record element is the one around the first file-name element (or carrying a file-name attribute).
  let recordTag: string | null = null;
  for (const m of text.matchAll(/<([A-Za-z][\w:-]*)([^>]*)>/g)) {
    if (fieldOf(m[1]) === 'filename') {
      const before = text.slice(0, m.index);
      const open: string[] = [];
      for (const t of before.matchAll(/<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g)) {
        if (t[1]) open.pop();
        else if (!t[3]) open.push(t[2]);
      }
      recordTag = open[open.length - 1] ?? null;
      break;
    }
    if ([...m[2].matchAll(/([\w:-]+)="/g)].some((a) => fieldOf(a[1]) === 'filename')) {
      recordTag = m[1];
      break;
    }
  }
  if (!recordTag) return [];
  const tag = recordTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out: Record<string, unknown>[] = [];
  for (const m of text.matchAll(new RegExp(`<${tag}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g'))) {
    const [, attrs = '', body = ''] = m;
    const rec: Record<string, unknown> = {};
    for (const a of attrs.matchAll(/([\w:-]+)="([^"]*)"/g)) rec[a[1]] = decode(a[2]);
    const keywords: string[] = [];
    for (const c of body.matchAll(/<([A-Za-z][\w:-]*)[^>]*>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>[^<]*)?)<\/\1>/g)) {
      const f = fieldOf(c[1]);
      if (f === 'keywords' || norm(c[1]) === 'string' || norm(c[1]) === 'li') keywords.push(decode(c[2]));
      else rec[c[1]] = decode(c[2]);
    }
    if (keywords.length) rec.keywords = keywords;
    out.push(rec);
  }
  return out;
}

/** Reads the file's text. Returns null when it holds nothing ReelVault can use. */
export function parseMetadataFile(text: string): MetaFile | null {
  const t = text.trim();
  if (!t) return null;
  let format: MetaFile['format'];
  let rows: Record<string, unknown>[];
  if (t.startsWith('{') || t.startsWith('[')) {
    format = 'json';
    try {
      const data = JSON.parse(t);
      const list = Array.isArray(data) ? data : (Object.values(data).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [data];
      rows = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
    } catch {
      return null;
    }
  } else if (t.startsWith('<')) {
    format = 'xml';
    rows = xmlRows(t);
  } else {
    format = 'csv';
    const grid = parseCsv(t);
    if (grid.length < 2) return null;
    const [head, ...body] = grid;
    rows = body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
  }
  const { records, columns, recognised } = toRecords(rows);
  if (!records.length) return null;
  return { format, records, columns, recognised };
}

export type MetaTarget = {
  id: string;
  filename: string;
  title: string | null;
  notes: string | null;
  rating: number;
  tagNames: string[];
  flag: number;
  sizeBytes?: number | null;
  durationMs?: number | null;
};

export type MetaChange = {
  videoId: string;
  addKeywords: string[];
  rating: number | null;
  title: string | null;
  caption: string | null;
  flag: -1 | 1 | null;
};

export type MetaPlan = {
  changes: MetaChange[];
  matched: number;
  /** Rows of the file with no video in ReelVault (videos only; pictures are counted in `pictures`). */
  unmatched: string[];
  /** Rows that are pictures (ReelVault keeps videos only). */
  pictures: string[];
  keywords: number;
  ratings: number;
};

const PICTURE = /\.(jpe?g|png|heic|heif|gif|webp|tiff?|bmp|dng|raw|cr2|nef|arw)$/i;

/**
 * A name with what Files and Windows change when they save it: the extension, a
 * " 2" or " (1)" added when the name was taken, and characters a folder can't hold.
 */
export function looseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/(?:\s+\d{1,2}|\s*\(\d{1,3}\)|[-_ ]copy)$/, '')
    // Spaces and punctuation (kept letters of every language).
    .replace(/[\s\-_.,:;!?'"`’‘“”()[\]{}|\\/<>*+=~#@$%^&＿：？｜]+/g, '');
}

/**
 * What would change: keywords are added (never removed); a rating, title,
 * caption or flag is only filled in where the video has none, unless
 * `overwrite` is on. Matched by file name, any case, with or without the
 * extension (HashPhotos may export IMG_1234.MOV as IMG_1234.mov or IMG_1234).
 */
export function planMetadata(file: MetaFile, library: MetaTarget[], overwrite = false): MetaPlan {
  const lower = (s: string) => s.toLowerCase();
  const stem = (s: string) => lower(s).replace(/\.[a-z0-9]{2,5}$/, '');
  const pictures = file.records.filter((r) => PICTURE.test(r.filename)).map((r) => r.filename);
  const records = file.records.filter((r) => !PICTURE.test(r.filename));

  // Each video goes to one row. Rows are matched in passes, surest first; a later pass only
  // looks at rows and videos still free, and takes a match only when it is the only one.
  const found = new Map<number, MetaTarget>();
  const taken = new Set<string>();
  const pass = (keyOfRecord: (r: MetaRecord) => string | null, keyOfVideo: (v: MetaTarget) => string | null, uniqueOnly: boolean) => {
    const index = new Map<string, MetaTarget[]>();
    for (const v of library) {
      if (taken.has(v.id)) continue;
      const k = keyOfVideo(v);
      if (k) pushTo(index, k, v);
    }
    const wanted = new Map<string, number[]>();
    records.forEach((r, i) => {
      if (found.has(i)) return;
      const k = keyOfRecord(r);
      if (k) pushTo(wanted, k, i);
    });
    for (const [k, rows] of wanted) {
      const free = (index.get(k) ?? []).filter((v) => !taken.has(v.id));
      if (uniqueOnly && (free.length !== 1 || rows.length !== 1)) continue;
      // Several rows of one name and as many videos of it: paired in order.
      rows.forEach((i, n) => {
        const v = free[n];
        if (!v) return;
        found.set(i, v);
        taken.add(v.id);
      });
    }
  };
  // 1. The same name (any case). 2. The same name without the extension.
  pass((r) => lower(r.filename), (v) => lower(v.filename), false);
  pass((r) => stem(r.filename), (v) => stem(v.filename), true);
  // 3. The name as Files or Windows may have changed it (" 2", "(1)", ":" or "?" dropped).
  pass((r) => looseName(r.filename) || null, (v) => looseName(v.filename) || null, true);
  // 4. The same size to the byte, when the export has sizes.
  pass((r) => (r.size ? String(r.size) : null), (v) => (v.sizeBytes ? String(v.sizeBytes) : null), true);
  // 5. The same length to the second, when the export has lengths.
  pass((r) => (r.durationMs ? String(Math.round(r.durationMs / 1000)) : null), (v) => (v.durationMs ? String(Math.round(v.durationMs / 1000)) : null), true);

  const changes = new Map<string, MetaChange>();
  const unmatched: string[] = [];
  let matched = 0;
  for (const [i, r] of records.entries()) {
    const v = found.get(i);
    if (!v) {
      unmatched.push(r.filename);
      continue;
    }
    matched += 1;
    const c = changes.get(v.id) ?? { videoId: v.id, addKeywords: [], rating: null, title: null, caption: null, flag: null };
    const have = new Set(v.tagNames.map(lower));
    c.addKeywords = [...new Set([...c.addKeywords, ...r.keywords.filter((k) => !have.has(lower(k)))])];
    if (r.rating !== null && (overwrite || !v.rating) && r.rating !== v.rating) c.rating = r.rating;
    if (r.title && (overwrite || !v.title) && r.title !== v.title) c.title = r.title;
    if (r.caption && (overwrite || !v.notes) && r.caption !== v.notes) c.caption = r.caption;
    if (r.flag && (overwrite || !v.flag) && r.flag !== v.flag) c.flag = r.flag;
    changes.set(v.id, c);
  }
  const list = [...changes.values()].filter((c) => c.addKeywords.length || c.rating !== null || c.title || c.caption || c.flag);
  return {
    changes: list,
    matched,
    unmatched,
    pictures,
    keywords: list.reduce((a, c) => a + c.addKeywords.length, 0),
    ratings: list.filter((c) => c.rating !== null).length,
  };
}
