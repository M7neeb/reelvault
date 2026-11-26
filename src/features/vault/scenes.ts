/**
 * Looking inside your videos (app build 18 on): picture fingerprints for
 * "Similar" and scene words / text on screen for search. Each video is looked
 * at once, in the background while the app is open (a few seconds each), and
 * the results are kept in the database (video_prints, video_scenes). Native
 * wiring; the rules are in sceneLogic.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getDb } from '@/db';

import { ReelVaultMedia } from '../../../modules/reelvault-media';
import { getSetting, setSetting } from './library';
import { PRINT_AT, readTimes, type SceneRow } from './sceneLogic';
import type { Video } from './types';

export type InsideProgress = { done: number; total: number; running: boolean };

/** A frame every 4 seconds, at most 60 per video. */
const EVERY_SEC = 4;
const MAX_FRAMES = 60;

/** While a video plays, the scan waits (decoding two videos at once can make playback stutter). */
let busyCount = 0;
/** True while a video plays (other background jobs that decode video wait too). */
export const playbackBusy = (): boolean => busyCount > 0;

export function pauseLookingInside(): () => void {
  busyCount++;
  let done = false;
  return () => {
    if (!done) busyCount--;
    done = true;
  };
}

/** Results reach the screen in batches, not after every video (each update redraws the library). */
const FLUSH_EVERY = 15;
const FLUSH_MS = 45_000;

export const canLookInside = (): boolean => !!ReelVaultMedia?.videoPrints && !!ReelVaultMedia?.scanFrames;
/** App build 27 on: text read carefully, the first two minutes closely. */
const canReadCarefully = (): boolean => !!ReelVaultMedia?.readFrames;
/** When careful reading arrived: videos looked at before it are read once more. */
const CAREFUL_KEY = 'inside.carefulSince';
const READ_SIDE = 1280;

async function carefulSince(): Promise<number | null> {
  if (!canReadCarefully()) return null;
  const saved = Number(await getSetting(CAREFUL_KEY));
  if (saved > 0) return saved;
  const now = Date.now();
  await setSetting(CAREFUL_KEY, String(now));
  return now;
}

async function loadAll(): Promise<{ prints: Map<string, string[]>; rows: SceneRow[]; scanned: Set<string> }> {
  const db = await getDb();
  const p = await db.getAllAsync<{ video_id: string; prints: string; made_at: number }>('SELECT video_id, prints, made_at FROM video_prints;');
  const prints = new Map<string, string[]>();
  const since = await carefulSince();
  const scanned = new Set<string>();
  for (const r of p) {
    // Read the old, quick way: kept (still searchable) until read again.
    if (since === null || r.made_at >= since) scanned.add(r.video_id);
    try {
      const list = JSON.parse(r.prints);
      if (Array.isArray(list)) prints.set(r.video_id, list.filter((x): x is string => typeof x === 'string'));
    } catch {
      // a broken row is looked at again
    }
  }
  const s = await db.getAllAsync<{ video_id: string; at_ms: number; labels: string; words: string }>('SELECT video_id, at_ms, labels, words FROM video_scenes;');
  const rows = s.map((r) => ({ videoId: r.video_id, atMs: r.at_ms, labels: r.labels, words: r.words }));
  return { prints, rows, scanned };
}

/** Looks inside one video and keeps what it found. */
async function lookInside(v: Video): Promise<{ prints: string[]; rows: SceneRow[] }> {
  const native = ReelVaultMedia!;
  const prints = await native.videoPrints!(v.uri, PRINT_AT).catch(() => [] as string[]);
  const frames = canReadCarefully()
    ? await native.readFrames!(v.uri, readTimes(v.durationMs), READ_SIDE).catch(() => [])
    : await native.scanFrames!(v.uri, EVERY_SEC, MAX_FRAMES).catch(() => []);
  const rows: SceneRow[] = frames.map((f) => ({ videoId: v.id, atMs: Math.round(f.atMs), labels: f.labels.join(', '), words: f.text }));
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM video_scenes WHERE video_id = ?;', [v.id]);
    for (const r of rows) await db.runAsync('INSERT INTO video_scenes (video_id, at_ms, labels, words) VALUES (?, ?, ?, ?);', [r.videoId, r.atMs, r.labels, r.words]);
    await db.runAsync('INSERT OR REPLACE INTO video_prints (video_id, prints, made_at) VALUES (?, ?, ?);', [v.id, JSON.stringify(prints), Date.now()]);
  });
  return { prints, rows };
}

/**
 * What the phone has seen inside your videos, kept up to date: new videos are
 * looked at in the background (one at a time, only while the app is open).
 */
export function useInside(
  videos: Video[],
  enabled: boolean
): { prints: Map<string, string[]>; rows: { current: SceneRow[] }; version: number; progress: InsideProgress | null } {
  const [prints, setPrints] = useState<Map<string, string[]>>(new Map());
  // What was seen inside videos: one list kept aside (not in screen state, never copied whole);
  // `version` changes when it does, for the few screens that search it.
  const rows = useRef<SceneRow[]>([]);
  const [version, setVersion] = useState(0);
  const [progress, setProgress] = useState<InsideProgress | null>(null);
  const scanned = useRef<Set<string> | null>(null);
  /** Looked at at all (perhaps the old way), so their prints are there. */
  const seen = useRef<Set<string>>(new Set());
  const videosRef = useRef(videos);
  videosRef.current = videos;
  const running = useRef(false);
  const alive = useRef(true);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  useEffect(() => {
    if (!canLookInside()) return;
    loadAll()
      .then((all) => {
        scanned.current = all.scanned;
        seen.current = new Set(all.prints.keys());
        const total = videosRef.current.filter((v) => !v.deletedAt).length;
        if (total) setProgress({ done: videosRef.current.filter((v) => !v.deletedAt && all.scanned.has(v.id)).length, total, running: true });
        setPrints(all.prints);
        rows.current = all.rows;
        setVersion((n) => n + 1);
      })
      .catch((e) => console.log(`[INSIDE] load failed: ${String(e)}`));
  }, []);

  useEffect(() => {
    // A scan already running picks up new videos by itself.
    if (!enabled || !canLookInside() || running.current) return;
    const t = setTimeout(async () => {
      running.current = true;
      try {
        // The saved results load first (a big library can take a moment).
        while (!scanned.current && alive.current) await new Promise((r) => setTimeout(r, 1000));
        if (!scanned.current) return;
        // Never looked at first, then the ones read the old way.
        const todo = () => {
          const left = videosRef.current.filter((v) => !v.deletedAt && !scanned.current!.has(v.id));
          const fresh = left.filter((v) => !seen.current.has(v.id));
          return fresh.length ? fresh : left;
        };
        let done = videosRef.current.filter((v) => !v.deletedAt && scanned.current!.has(v.id)).length;
        const newPrints = new Map<string, string[]>();
        let newRows: SceneRow[] = [];
        let lastFlush = Date.now();
        const flush = () => {
          if (!newPrints.size || !alive.current) return;
          const p = new Map(newPrints);
          const r = newRows;
          newPrints.clear();
          newRows = [];
          lastFlush = Date.now();
          setPrints((m) => {
            const out = new Map(m);
            for (const [k, v] of p) out.set(k, v);
            return out;
          });
          // Videos looked at again replace their old rows; the rest stays where it is.
          if ([...p.keys()].some((id) => rows.current.some((x) => x.videoId === id))) rows.current = rows.current.filter((x) => !p.has(x.videoId));
          rows.current.push(...r);
          setVersion((n) => n + 1);
        };
        while (alive.current && enabledRef.current) {
          const next = todo()[0];
          const total = videosRef.current.filter((v) => !v.deletedAt).length;
          if (!next) {
            flush();
            setProgress({ done: total, total, running: false });
            break;
          }
          // Read fresh every time: the scan keeps going past a reload of this effect, and must
          // still stop while the app is in the background (sound playing keeps it alive there).
          if (AppState.currentState !== 'active' || busyCount > 0) {
            flush();
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          if (done % FLUSH_EVERY === 0) setProgress({ done, total, running: true });
          try {
            const found = await lookInside(next);
            newPrints.set(next.id, found.prints);
            newRows.push(...found.rows);
          } catch (e) {
            console.log(`[INSIDE] ${next.filename}: ${String(e)}`);
          }
          scanned.current!.add(next.id);
          seen.current.add(next.id);
          done++;
          if (newPrints.size >= FLUSH_EVERY || Date.now() - lastFlush > FLUSH_MS) flush();
          // A breath between videos, so the app stays smooth.
          await new Promise((r) => setTimeout(r, 400));
        }
      } finally {
        running.current = false;
      }
    }, 20_000);
    return () => clearTimeout(t);
  }, [enabled, videos.length]);

  return { prints, rows, version, progress };
}
