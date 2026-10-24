/**
 * Your library as a spreadsheet (CSV): one row per video with its title,
 * dates, rating, keywords, albums and how much you watched it. Opens in
 * Numbers, Excel or Google Sheets. Pure (tested).
 */

export type SheetRow = {
  title: string | null;
  filename: string;
  createdAt: number | null;
  importedAt: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  rating: number;
  flag: number;
  status: string | null;
  keywords: string[];
  albums: string[];
  caption: string | null;
  plays: number;
  watchedMs: number;
};

export const SHEET_COLUMNS = [
  'Title',
  'File',
  'Filmed',
  'Added',
  'Length',
  'Size (MB)',
  'Rating',
  'Flag',
  'Status',
  'Keywords',
  'Albums',
  'Caption',
  'Times watched',
  'Minutes watched',
] as const;

/** One cell: quoted when it holds a comma, quote or line break; a leading = + - @ is escaped so a spreadsheet never runs it. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 2026-10-23 19:05, local time (spreadsheets read it as a date). */
export function sheetDate(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** h:mm:ss or m:ss. */
export function sheetLength(ms: number | null): string {
  if (!ms || ms < 0) return '';
  const t = Math.round(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function toCsv(rows: SheetRow[]): string {
  const lines = [SHEET_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.title),
        csvCell(r.filename),
        csvCell(sheetDate(r.createdAt)),
        csvCell(sheetDate(r.importedAt)),
        csvCell(sheetLength(r.durationMs)),
        csvCell(r.sizeBytes ? Math.round((r.sizeBytes / 1_048_576) * 10) / 10 : null),
        csvCell(r.rating || null),
        csvCell(r.flag === 1 ? 'Pick' : r.flag === -1 ? 'Reject' : null),
        csvCell(r.status),
        csvCell(r.keywords.join('; ')),
        csvCell(r.albums.join('; ')),
        csvCell(r.caption),
        csvCell(r.plays || null),
        csvCell(r.watchedMs ? Math.round(r.watchedMs / 60000) : null),
      ].join(',')
    );
  }
  // A byte-order mark so Excel reads accents and emoji correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
