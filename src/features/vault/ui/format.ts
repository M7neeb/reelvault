/**
 * Pure display formatters. No native imports, so these are safe in the browser
 * preview as well as on device.
 */

import type { ThumbInfo } from './types';

const MONTHS =['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `1:05` / `1:02:03`. Null when there is no duration yet. */
export function fmtDuration(ms: number | null): string | null {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** `13 Oct 2026` + `9:41 PM` - the viewer's centred header. */
export function fmtDateTime(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { date, time: `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}` };
}

const GB = 1024 ** 3;

/** Bytes to whole GB, one decimal. */
export const gbFromBytes = (bytes: number): number => Math.round((bytes / GB) * 10) / 10;

/** `1.0 GB` / `245 MB` - for file sizes where GB would read as `0.0`. */
export function fmtSize(bytes: number): string {
  if (bytes >= GB) return `${gbFromBytes(bytes).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/** `MP4` from `clip.mp4`. */
export function fmtFormat(filename: string): string | null {
  const i = filename.lastIndexOf('.');
  return i > 0 && i < filename.length - 1 ? filename.slice(i + 1).toUpperCase() : null;
}

type InfoSource = {
  filename: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  importedAt: number;
  tagNames: string[];
};

/** The label a thumbnail shows for the chosen Thumbnail Info, or null for none. */
export function fmtThumbInfo(item: InfoSource, info: ThumbInfo): string | null {
  switch (info) {
    case 'duration':
      return fmtDuration(item.durationMs);
    case 'size':
      return fmtSize(item.sizeBytes);
    case 'date':
      return fmtDateTime(item.importedAt).date;
    case 'dimensions':
      return item.width && item.height ? `${item.width}×${item.height}` : null;
    case 'format':
      return fmtFormat(item.filename);
    case 'filename':
      return item.filename;
    case 'keywords':
      return item.tagNames.length ? item.tagNames.map((t) => `#${t}`).join(' ') : null;
    default:
      return null;
  }
}
