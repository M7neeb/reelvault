/**
 * AniList for the Manga section: links between your titles and AniList,
 * signing in, filling in details, and keeping your AniList list in step.
 *
 * Syncing watches the library: whenever a linked title's status, chapters
 * read or score changes here, it is sent to AniList a few seconds later (so a
 * run of chapters is one update). Nothing is sent for changes made before
 * the app opened, and nothing at all until you sign in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  aniListDetails,
  aniListEntry,
  aniListUser,
  anilistConfigured,
  loadAniListLinks,
  saveAniListEntry,
  saveAniListLinks,
  searchAniList,
  signInAniList,
  signOutAniList,
} from './anilist';
import { chaptersToMark, entryFor, fromAniStatus, type AniMedia } from './anilistLogic';
import type { MangaSeries } from './mangaLogic';
import { saveCoverFrom } from './mangaSources';
import { addMangaTag, getSeries, setChaptersRead, updateSeries } from './mangaStore';

export type AniListState = { configured: boolean; user: string | null; links: Record<string, number>; syncing: boolean; error: string | null };

export type AniListActions = {
  search: (q: string) => Promise<AniMedia[]>;
  /** One AniList title (for showing what a series is linked to). */
  get: (id: number) => Promise<AniMedia | null>;
  /** Links a title; with an account, takes over AniList's progress when it is further. How many chapters were marked read. */
  link: (seriesId: string, media: AniMedia) => Promise<number>;
  unlink: (seriesId: string) => Promise<void>;
  /** Fills in what the title is missing (summary, author, genres, cover) from AniList. */
  fill: (seriesId: string) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Sends this title to AniList now. */
  syncNow: (seriesId: string) => Promise<void>;
};

const sig = (e: ReturnType<typeof entryFor>) => `${e.status}|${e.progress}|${e.scoreRaw}`;

export function useAniList(all: MangaSeries[], refresh: () => Promise<void>): { state: AniListState; actions: AniListActions } {
  const [links, setLinks] = useState<Record<string, number>>({});
  const [user, setUser] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linksRef = useRef(links);
  linksRef.current = links;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    loadAniListLinks().then(setLinks).catch(() => undefined);
    aniListUser().then(setUser).catch(() => undefined);
  }, []);

  // What was last sent (or found at start) per title: only real changes go out.
  const sent = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = useCallback(async (ids: string[]) => {
    if (!userRef.current || !ids.length) return;
    setSyncing(true);
    try {
      for (const id of ids) {
        const mediaId = linksRef.current[id];
        const s = await getSeries(id).catch(() => null);
        if (!mediaId || !s || s.deletedAt) continue;
        const e = entryFor(s);
        await saveAniListEntry(mediaId, e);
        sent.current.set(id, sig(e));
      }
      setError(null);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
      if (/signed you out/i.test(String(e))) setUser(null);
    } finally {
      setSyncing(false);
    }
  }, []);

  const ready = useRef(false);
  useEffect(() => {
    const linked = all.filter((s) => links[s.id] && !s.deletedAt);
    if (!ready.current) {
      // The state at start (or when links first load) counts as sent.
      if (all.length) {
        for (const s of linked) sent.current.set(s.id, sig(entryFor(s)));
        ready.current = true;
      }
      return;
    }
    const changed = linked.filter((s) => {
      const now = sig(entryFor(s));
      if (!sent.current.has(s.id)) {
        sent.current.set(s.id, now);
        return false;
      }
      return sent.current.get(s.id) !== now;
    });
    if (!changed.length || !userRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    const ids = changed.map((s) => s.id);
    timer.current = setTimeout(() => void push(ids), 4000);
  }, [all, links, push]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const saveLinks = useCallback(async (next: Record<string, number>) => {
    linksRef.current = next;
    setLinks(next);
    await saveAniListLinks(next);
  }, []);

  const actions = useMemo<AniListActions>(
    () => ({
      search: (q) => searchAniList(q),
      get: async (id) => (await aniListDetails(id)).media,
      link: async (seriesId, media) => {
        await saveLinks({ ...linksRef.current, [seriesId]: media.id });
        let marked = 0;
        if (userRef.current) {
          const entry = await aniListEntry(media.id).catch(() => null);
          const s = await getSeries(seriesId);
          if (s && entry) {
            // AniList knows you read further, or has a status / score you set there.
            const ids = chaptersToMark(s.chapters, entry.progress);
            if (ids.length) await setChaptersRead(ids, true, Date.now());
            marked = ids.length;
            const patch: Parameters<typeof updateSeries>[1] = {};
            const st = fromAniStatus(entry.status);
            if (st && (!s.status || s.status === 'planned')) patch.status = st;
            if (entry.score > 0 && !s.rating) patch.rating = Math.round(entry.score * 10) / 10;
            if (Object.keys(patch).length) await updateSeries([seriesId], patch);
          }
          await refresh();
          sent.current.delete(seriesId);
          await push([seriesId]);
        } else await refresh();
        return marked;
      },
      unlink: async (seriesId) => {
        const next = { ...linksRef.current };
        delete next[seriesId];
        sent.current.delete(seriesId);
        await saveLinks(next);
      },
      fill: async (seriesId) => {
        const mediaId = linksRef.current[seriesId];
        const s = await getSeries(seriesId);
        if (!mediaId || !s) return;
        const d = await aniListDetails(mediaId);
        await updateSeries([seriesId], {
          ...(!s.description && d.description ? { description: d.description } : {}),
          ...(!s.author && d.author ? { author: d.author } : {}),
          ...(!s.artist && d.artist && d.artist !== d.author ? { artist: d.artist } : {}),
          ...(!s.pubStatus && d.pubStatus ? { pubStatus: d.pubStatus } : {}),
          ...(!s.kind && d.kind ? { kind: d.kind } : {}),
        });
        if (!s.tags.length) for (const g of d.genres.slice(0, 10)) await addMangaTag(seriesId, g);
        if (!s.cover && d.media?.cover) await saveCoverFrom(seriesId, s.folder, d.media.cover);
        await refresh();
      },
      signIn: async () => {
        setError(null);
        const name = await signInAniList();
        if (name !== null) {
          setUser(name);
          userRef.current = name;
        }
      },
      signOut: async () => {
        await signOutAniList();
        setUser(null);
      },
      syncNow: async (seriesId) => {
        sent.current.delete(seriesId);
        await push([seriesId]);
      },
    }),
    [push, refresh, saveLinks]
  );

  return { state: { configured: anilistConfigured(), user, links, syncing, error }, actions };
}
