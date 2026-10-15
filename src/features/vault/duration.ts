import { createVideoPlayer, type VideoPlayerStatus } from 'expo-video';

/**
 * Read a video's duration without showing it.
 * Creates a throwaway player, waits for it to become ready, then releases it.
 * Always resolves — returns null on timeout/error so imports never hang.
 */
export async function probeDurationMs(uri: string, timeoutMs = 12000): Promise<number | null> {
  const player = createVideoPlayer(uri);
  return await new Promise<number | null>((resolve) => {
    let settled = false;
    let sub: { remove: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout>;

    const read = (): number | null =>
      player.duration > 0 ? Math.round(player.duration * 1000) : null;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sub?.remove();
      } catch {
        // ignore
      }
      try {
        player.release();
      } catch {
        // ignore
      }
      resolve(value);
    };

    timer = setTimeout(() => finish(read()), timeoutMs);

    try {
      sub = player.addListener('statusChange', (payload: { status: VideoPlayerStatus }) => {
        if (payload.status === 'readyToPlay') finish(read());
        else if (payload.status === 'error') finish(null);
      });
    } catch {
      finish(null);
    }

    if (player.status === 'readyToPlay') finish(read());
  });
}
