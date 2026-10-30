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
import { PRINT_AT, type SceneRow } from './sceneLogic';
import type { Video } from './types';

export type InsideProgress = { done: number; total: number; running: boolean };

/** A frame every 4 seconds, at most 60 per video. */
const EVERY_SEC = 4;
const MAX_FRAMES = 60;

export const canLookInside = (): boolean => !!ReelVaultMedia?.videoPrints && !!ReelVaultMedia?.scanFrames;

async function loadAll(): Promise<{ prints: Map<string, string[]>; rows: SceneRow[]; scanned: Set<string> }> {
  const db = await getDb();
  const p = await db.getAllAsync<{ video_id: string; prints: string }>('SELECT video_id, prints FROM video_prints;');
  const prints = new Map<string, string[]>();
  for (const r of p) {
    try {
      const list = JSON.parse(r.prints);
      if (Array.isArray(list)) prints.set(r.video_id, list.filter((x): x is string => typeof x === 'string'));
    } catch {
      // a broken row is looked at again
    }
  }
  const s = await db.getAllAsync<{ video_id: string; at_ms: number; labels: string; words: string }>('SELECT video_id, at_ms, labels, words FROM video_scenes;');
  const rows = s.map((r) => ({ videoId: r.video_id, atMs: r.at_ms, labels: r.labels, words: r.words }));
  return { prints, rows, scanned: new Set(prints.keys()) };
}

/** Looks inside one video and keeps what it found. */
async function lookInside(v: Video): Promise<{ prints: string[]; rows: SceneRow[] }> {
  const native = ReelVaultMedia!;
  const prints = await native.videoPrints!(v.uri, PRINT_AT).catch(() => [] as string[]);
  const frames = await native.scanFrames!(v.uri, EVERY_SEC, MAX_FRAMES).catch(() => []);
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
export function useInside(videos: Video[], enabled: boolean): { prints: Map<string, string[]>; rows: SceneRow[]; progress: InsideProgress | null } {
  const [prints, setPrints] = useState<Map<string, string[]>>(new Map());
  const [rows, setRows] = useState<SceneRow[]>([]);
  const [progress, setProgress] = useState<InsideProgress | null>(null);
  const scanned = useRef<Set<string> | null>(null);
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
        setPrints(all.prints);
        setRows(all.rows);
      })
      .catch((e) => console.log(`[INSIDE] load failed: ${String(e)}`));
  }, []);

  useEffect(() => {
    // A scan already running picks up new videos by itself.
    if (!enabled || !canLookInside() || running.current) return;
    let active = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', (st) => {
      active = st === 'active';
    });
    const t = setTimeout(async () => {
      if (!scanned.current) return;
      running.current = true;
      try {
        const todo = () => videosRef.current.filter((v) => !v.deletedAt && !scanned.current!.has(v.id));
        let done = videosRef.current.length - todo().length;
        while (alive.current && enabledRef.current) {
          const next = todo()[0];
          const total = videosRef.current.filter((v) => !v.deletedAt).length;
          if (!next) {
            setProgress({ done: total, total, running: false });
            break;
          }
          if (!active) {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }
          setProgress({ done, total, running: true });
          try {
            const found = await lookInside(next);
            setPrints((m) => new Map(m).set(next.id, found.prints));
            setRows((list) => [...list.filter((r) => r.videoId !== next.id), ...found.rows]);
          } catch (e) {
            console.log(`[INSIDE] ${next.filename}: ${String(e)}`);
          }
          scanned.current!.add(next.id);
          done++;
          // A breath between videos, so the app stays smooth.
          await new Promise((r) => setTimeout(r, 400));
        }
      } finally {
        running.current = false;
      }
    }, 20_000);
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [enabled, videos.length]);

  return { prints, rows, progress };
}
