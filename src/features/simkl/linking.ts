/**
 * Linking a video to Simkl: guess the title (and the episode) from the file
 * name, so the search starts in the right place. Pure, so it is tested in Node.
 */

/** "Harbour.Lights.S02E04.1080p.mp4" → "Harbour Lights". */
export function guessQuery(item: { title: string | null; filename: string }): string {
  const base = (item.title || item.filename).replace(/\.[a-z0-9]{2,4}$/i, '');
  return base
    .replace(/[._]+/g, ' ')
    .replace(/\b(S\d{1,2}E\d{1,3}|\d{3,4}p|x26[45]|h\.?26[45]|hevc|web[- ]?dl|bluray|hdr)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "S02E04" in the file name, if there is one. */
export function guessEpisode(item: { title: string | null; filename: string }): { season: number; episode: number } | null {
  const m = /S(\d{1,2})[ ._-]?E(\d{1,3})/i.exec(`${item.title ?? ''} ${item.filename}`);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}
