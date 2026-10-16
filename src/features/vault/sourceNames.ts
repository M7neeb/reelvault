/** Pure helpers for pasted links (tested in Node). */

const VIDEO_EXTS = ['mov', 'mp4', 'm4v', 'webm', 'mkv', 'avi', '3gp'];

export function isHttpUrl(text: string): boolean {
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(text.trim());
}

/** A safe file name for a downloaded link, always with a video extension. */
export function fileNameFromUrl(url: string): string {
  let last = '';
  try {
    last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    last = '';
  }
  const clean = last.replace(/[\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 ? clean.slice(dot + 1).toLowerCase() : '';
  if (clean && VIDEO_EXTS.includes(ext)) return clean;
  return `${clean || 'download'}.mp4`;
}

/** Whether a link looks like it points straight at a video file (and not at a web page). */
export function looksLikeVideoFile(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return VIDEO_EXTS.some((e) => path.endsWith(`.${e}`));
  } catch {
    return false;
  }
}
