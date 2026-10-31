/**
 * Which frame the video Wrapped plays each card's video in (the frames are in
 * ui/videoLooks.tsx). Pure (tested in tests/video-looks.test.mjs).
 */

export type VideoLook = 'full' | 'polaroid' | 'grid' | 'tv' | 'filmstrip' | 'orbit' | 'split' | 'tilt' | 'cinema' | 'stack';

/** The order cards with a video get them in; the full screen comes back every few cards. */
export const VIDEO_LOOKS: VideoLook[] = ['full', 'polaroid', 'grid', 'full', 'tv', 'filmstrip', 'orbit', 'full', 'split', 'tilt', 'cinema', 'stack'];

/**
 * The look for each card (by key): the order above for cards with a video,
 * the full screen for the big moments, never the same look twice in a row.
 * Pure.
 */
export function lookFor(cards: { key: string; media: string[] }[], fullFor: string[] = []): Map<string, VideoLook> {
  const out = new Map<string, VideoLook>();
  let k = 0;
  let prev: VideoLook | null = null;
  for (const c of cards) {
    if (!c.media.length) {
      prev = null;
      continue;
    }
    let look: VideoLook = fullFor.includes(c.key) || c.media.length > 1 ? 'full' : VIDEO_LOOKS[k++ % VIDEO_LOOKS.length];
    if (look === prev) look = VIDEO_LOOKS[k++ % VIDEO_LOOKS.length];
    if (look === prev) look = VIDEO_LOOKS[k++ % VIDEO_LOOKS.length];
    out.set(c.key, look);
    prev = look;
  }
  return out;
}

