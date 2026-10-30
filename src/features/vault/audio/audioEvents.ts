/**
 * Tells the Audio section to reload when something outside it adds audio
 * (for example "Save Sound to Audio" in the video player).
 */

const listeners = new Set<() => void>();

export function onAudioChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function audioChanged(): void {
  for (const fn of listeners) fn();
}
