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
  /** Filming date. */
  createdAt: number;
  tagNames: string[];
  albumIds?: number[];
  meta?: { model?: string; make?: string } | null;
};

/** One Thumbnail Info item, or null when the video has nothing to show for it. */
export function fmtThumbInfo(
  item: InfoSource,
  info: ThumbInfo,
  albumNames?: Map<number, string>
): string | null {
  switch (info) {
    case 'duration':
      return fmtDuration(item.durationMs);
    case 'size':
      return fmtSize(item.sizeBytes);
    case 'date':
      return fmtDateTime(item.createdAt).date;
    case 'time':
      return fmtDateTime(item.createdAt).time;
    case 'dimensions':
      return item.width && item.height ? `${item.width}×${item.height}` : null;
    case 'format':
      return fmtFormat(item.filename);
    case 'filename':
      return item.filename;
    case 'keywords':
      return item.tagNames.length ? item.tagNames.map((t) => `#${t}`).join(' ') : null;
    case 'albums': {
      const names = (item.albumIds ?? []).map((id) => albumNames?.get(id)).filter(Boolean);
      return names.length ? names.join(', ') : null;
    }
    case 'device':
      return item.meta?.model ?? item.meta?.make ?? null;
    default:
      return null;
  }
}

/** The whole thumbnail label: every chosen item that has a value, joined. */
export function fmtThumbInfos(
  item: InfoSource,
  infos: ThumbInfo[],
  albumNames?: Map<number, string>
): string | null {
  const parts = infos.map((i) => fmtThumbInfo(item, i, albumNames)).filter((s): s is string => !!s);
  return parts.length ? parts.join(' · ') : null;
}

/** `1 h 12 min` / `14 min` / `45 s` - for totals. */
export function fmtTotalDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin >= 60) return `${Math.floor(totalMin / 60)} h ${totalMin % 60} min`;
  if (totalMin >= 1) return `${totalMin} min`;
  return `${Math.round(ms / 1000)} s`;
}

/** `8.4 Mbit/s` from size and duration. */
export function fmtBitrate(bytes: number, durationMs: number | null): string | null {
  if (!durationMs) return null;
  const mbit = (bytes * 8) / (durationMs / 1000) / 1_000_000;
  return `${mbit >= 10 ? Math.round(mbit) : Math.round(mbit * 10) / 10} Mbit/s`;
}
