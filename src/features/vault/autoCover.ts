/**
 * Covers chosen by the app: each video still showing the frame from one second in gets the best
 * looking frame instead (rules in bestFrame.ts). Each video is looked at once, in the background
 * while the app is open; a cover you choose yourself is never replaced, and Reset goes back to
 * the import frame for good. Native wiring.
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';

import { ReelVaultMedia } from '../../../modules/reelvault-media';
import { COVER_FRACTIONS, importFrameMs, lookFromColors, needsAutoCover, parseDone, pickCover, type FrameLook } from './bestFrame';
import { setCoverFromFrame } from './covers';
import { frameTo } from './frames';
import { getSetting, setSetting } from './library';
import { getVideo } from './repo';
import { playbackBusy } from './scenes';
import type { Video } from './types';

export const AUTO_COVER_KEY = 'autoCover.on';
const DONE_KEY = 'autoCover.done';
const SAVE_EVERY = 10;
const SHOW_EVERY = 8;
const SHOW_MS = 40_000;

export const canAutoCover = (): boolean => !!ReelVaultMedia;

/** How each candidate frame looks, and how the current (import) frame looks. */
async function measure(v: Video): Promise<{ frames: FrameLook[]; current: FrameLook | null }> {
  const native = ReelVaultMedia!;
  const d = v.durationMs ?? 0;
  const nowAt = importFrameMs(d);
  if (native.frameStats) {
    const rows = await native.frameStats(v.uri, [nowAt / d, ...COVER_FRACTIONS]).catch(() => []);
    // The import frame is the row nearest one second (rows that could not be read are left out).
    const near = rows.length ? rows.reduce((a, r) => (Math.abs(r.atMs - nowAt) < Math.abs(a.atMs - nowAt) ? r : a)) : null;
    const current = near && Math.abs(near.atMs - nowAt) < 700 ? near : null;
    return { frames: rows.filter((r) => r !== current), current };
  }
  // Older app builds: a tiny frame each, judged by its colours.
  const looks: FrameLook[] = [];
  let current: FrameLook | null = null;
  const times = [nowAt, ...COVER_FRACTIONS.map((f) => Math.round(f * d))];
  for (const [i, t] of times.entries()) {
    const tmp = new File(Paths.cache, `cover-probe-${v.id}-${i}.jpg`);
    try {
      await frameTo(v.uri, t, tmp, 64);
      const c = await native.colors(tmp.uri);
      const look = lookFromColors(t, c.average, c.dominant);
      if (look && i === 0) current = look;
      else if (look) looks.push(look);
    } catch {
      // that frame is skipped
    } finally {
      try {
        if (tmp.exists) tmp.delete();
      } catch {
        // the cache is cleared by the system
      }
    }
  }
  return { frames: looks, current };
}

/** Looks at one video; true when its cover changed. */
async function improveCover(v: Video): Promise<boolean> {
  const { frames, current } = await measure(v);
  const best = pickCover(frames, current);
  if (!best) return false;
  // You may have chosen a cover (or deleted the video) while it was being looked at.
  const fresh = await getVideo(v.id);
  if (!fresh || fresh.coverAt !== null || fresh.deletedAt) return false;
  await setCoverFromFrame(fresh, best.atMs);
  console.log(`[COVER] picked ${Math.round(best.atMs / 1000)} s for ${v.filename}`);
  return true;
}

/** Keeps covers improving in the background while `enabled`; `onChanged` redraws the library. */
export function useAutoCovers(videos: Video[], enabled: boolean, onChanged: () => void): void {
  const videosRef = useRef(videos);
  videosRef.current = videos;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  useEffect(() => {
    if (!enabled || !canAutoCover() || running.current) return;
    // After the library and the scene scan have had their start.
    const t = setTimeout(async () => {
      running.current = true;
      try {
        const done = parseDone(await getSetting(DONE_KEY));
        let unsaved = 0;
        let changed = 0;
        let lastShow = Date.now();
        const save = async () => {
          if (!unsaved) return;
          unsaved = 0;
          await setSetting(DONE_KEY, JSON.stringify([...done])).catch(() => undefined);
        };
        const show = () => {
          if (!changed || !alive.current) return;
          changed = 0;
          lastShow = Date.now();
          changedRef.current();
        };
        while (alive.current && enabledRef.current) {
          const next = needsAutoCover(videosRef.current, done)[0];
          if (!next) break;
          if (AppState.currentState !== 'active' || playbackBusy()) {
            await save();
            show();
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          try {
            if (await improveCover(next)) changed++;
          } catch (e) {
            console.log(`[COVER] ${next.filename}: ${String(e)}`);
          }
          done.add(next.id);
          unsaved++;
          if (unsaved >= SAVE_EVERY) await save();
          if (changed >= SHOW_EVERY || (changed && Date.now() - lastShow > SHOW_MS)) show();
          await new Promise((r) => setTimeout(r, 300));
        }
        await save();
        show();
      } catch (e) {
        console.log(`[COVER] stopped: ${String(e)}`);
      } finally {
        running.current = false;
      }
    }, 30_000);
    return () => clearTimeout(t);
  }, [enabled, videos.length]);
}
