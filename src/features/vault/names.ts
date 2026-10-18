/**
 * The name shown for a video. Your own title wins; otherwise the file name,
 * unless it is a meaningless id (videos picked from Photos arrive named like
 * "25FCDDB3-9317-4C2B-….mov", or downloads named after a post number), which
 * becomes "Video from 17 Oct 2026" or "TikTok video from 17 Oct 2026".
 * Pure, so it is tested in Node.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEXISH = /^[0-9a-f_-]{24,}$/i;
/** Downloader apps name TikToks after the post number ("Snaptik.app_7358080437329153323"). */
const TIKTOK = /^(snaptik|ssstik|tiktok|musicaldown|savett|tikmate)/i;
/** Mostly one long number, with little else ("7609629117616590111_v3 (1)"). */
const NUMBERISH = (base: string) => /\d{10,}/.test(base) && base.replace(/\d{10,}/g, '').replace(/[^a-z]/gi, '').length <= 12;

export function stripExt(filename: string): string {
  return filename.replace(/\.[a-z0-9]{2,4}$/i, '');
}

/** True for file names that say nothing about the video. */
export function isIdName(filename: string): boolean {
  const base = stripExt(filename).trim();
  return UUID.test(base) || HEXISH.test(base) || NUMBERISH(base);
}

export function friendlyName(v: { title?: string | null; filename: string; createdAt?: number | null }): string {
  const title = v.title?.trim();
  if (title) return title;
  if (isIdName(v.filename)) {
    const kind = TIKTOK.test(v.filename) ? 'TikTok video' : 'Video';
    if (v.createdAt) {
      const d = new Date(v.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      return `${kind} from ${d}`;
    }
    return kind === 'Video' ? 'Untitled video' : kind;
  }
  return stripExt(v.filename);
}
