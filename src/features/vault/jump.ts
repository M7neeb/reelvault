/**
 * Asks the Videos tab to open something found elsewhere (the Search tab):
 * play a video, open an audio item or a book, open a manga series or carry
 * on reading it. Works like quickOpen: a request made before the Videos tab
 * listens waits for it. Pure: no React, no native modules.
 */

export type JumpRequest =
  | { kind: 'video'; id: string; /** Start here (a moment found inside the video). */ atMs?: number }
  | { kind: 'audio'; id: string; /** true = carry on playing; false = its page. */ play: boolean }
  | { kind: 'manga'; id: string; /** true = carry on reading; false = its page. */ read: boolean };

let pending: JumpRequest | null = null;
const listeners = new Set<(r: JumpRequest) => void>();

export function pushJump(r: JumpRequest): void {
  if (listeners.size) for (const fn of listeners) fn(r);
  else pending = r;
}

export function onJump(fn: (r: JumpRequest) => void): () => void {
  listeners.add(fn);
  if (pending) {
    const r = pending;
    pending = null;
    fn(r);
  }
  return () => {
    listeners.delete(fn);
  };
}
