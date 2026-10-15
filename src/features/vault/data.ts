/**
 * The native half of the vault: sqlite + filesystem wiring.
 *
 * Kept separate from `ui/` on purpose. Nothing in `ui/` may import this file,
 * because everything here touches a native module and would kill the browser
 * preview (see `src/features/vault/ui/README-ish note in types.ts`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Paths } from 'expo-file-system';

import { deleteVideo, deleteVideos } from '@/features/vault/actions';
import { probeDurationMs } from '@/features/vault/duration';
import { ensureFilmstrip } from '@/features/vault/filmstrip';
import { importAssets } from '@/features/vault/import';
import {
  listVideos,
  searchVideos,
  setDuration,
  setRating as saveRating,
  tagCounts,
  tagIndex,
  videosMissingDuration,
  type SortKey,
} from '@/features/vault/repo';
import { thumbnailUri } from '@/features/vault/storage';
import {
  addTagToVideo,
  listTags,
  removeTagFromVideo,
  tagsForVideo,
  type Tag,
} from '@/features/vault/tags';
import type { Video } from '@/features/vault/types';

import { gbFromBytes } from './ui/format';
import type { UiTag, VaultActions, VaultItem, VaultSort } from './ui/types';

const asUiTag = (t: Tag): UiTag => ({ id: t.id, name: t.name });

/** A DB row plus the display-only bits the UI needs. */
function toVaultItem(
  v: Video,
  counts: Record<string, number>,
  tagNamesById: Record<string, string[]>
): VaultItem {
  return {
    id: v.id,
    filename: v.filename,
    uri: v.uri,
    thumbSource: thumbnailUri(v.id),
    sizeBytes: v.size,
    durationMs: v.durationMs,
    rating: v.rating,
    width: v.width ?? null,
    height: v.height ?? null,
    importedAt: v.importedAt,
    tagCount: counts[v.id] ?? 0,
    tagNames: tagNamesById[v.id] ?? [],
  };
}

export type VaultData = {
  items: VaultItem[];
  allTags: UiTag[];
  tagMap: Record<string, string[]>;
  freeGb: number | null;
  busy: boolean;
  status: string;
  sort: VaultSort;
  setSort: (s: VaultSort) => void;
  actions: VaultActions;
};

export function useVaultData(): VaultData {
  const [videos, setVideos] = useState<Video[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [tags, setTags] = useState<Tag[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<VaultSort>('recent');
  const [freeGb, setFreeGb] = useState<number | null>(null);

  const sortRef = useRef<VaultSort>(sort);
  sortRef.current = sort;

  const refresh = useCallback(async () => {
    const [list, map, index, tagList] = await Promise.all([
      listVideos(sortRef.current as SortKey),
      tagCounts(),
      tagIndex(),
      listTags(),
    ]);
    setVideos(list);
    setCounts(map);
    setTagMap(index);
    setTags(tagList);
    try {
      setFreeGb(gbFromBytes(Paths.availableDiskSpace));
    } catch {
      // No filesystem (web) - the UI hides the readout when this is null.
      setFreeGb(null);
    }
  }, []);

  useEffect(() => {
    refresh().catch((e) => console.log(`[VAULT] refresh failed: ${String(e)}`));
  }, [sort, refresh]);

  // One-time duration backfill for rows imported before durations were probed.
  useEffect(() => {
    (async () => {
      const missing = await videosMissingDuration();
      if (!missing.length) return;
      console.log(`[DURATION] backfilling ${missing.length}`);
      for (const v of missing) {
        const ms = await probeDurationMs(v.uri);
        if (ms) await setDuration(v.id, ms);
      }
      console.log('[DURATION] backfill done');
      await refresh();
    })().catch((e) => console.log(`[DURATION] backfill failed: ${String(e)}`));
  }, [refresh]);

  /** video id -> tag names, derived once per tag change. */
  const tagNamesById = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const [name, ids] of Object.entries(tagMap)) {
      for (const id of ids) (m[id] ??= []).push(name);
    }
    return m;
  }, [tagMap]);

  const items = useMemo(
    () => videos.map((v) => toVaultItem(v, counts, tagNamesById)),
    [videos, counts, tagNamesById]
  );

  const byId = useCallback(
    (id: string) => videos.find((v) => v.id === id) ?? null,
    [videos]
  );

  const onImport = useCallback(async () => {
    setBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'video/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) return;
      setStatus(`Importing ${picked.assets.length}…`);
      const summary = await importAssets(picked.assets);
      await refresh();
      setStatus(
        `Imported ${summary.imported}${summary.failed.length ? `, ${summary.failed.length} failed` : ''}`
      );
      console.log(`[IMPORT] done imported=${summary.imported} failed=${summary.failed.length}`);
    } catch (e) {
      console.log(`[VAULT] import error: ${String(e)}`);
      setStatus('Import failed — check the dev log');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const actions = useMemo<VaultActions>(
    () => ({
      onImport: () => {
        void onImport();
      },
      search: async (q) => (await searchVideos(q)).map((v) => toVaultItem(v, counts, tagNamesById)),
      loadTags: async (id) => (await tagsForVideo(id)).map(asUiTag),
      loadFrames: async (item) => {
        const v = byId(item.id);
        return v ? ensureFilmstrip(v) : [];
      },
      onRate: async (id, rating) => {
        await saveRating(id, rating);
        await refresh();
      },
      onAddTag: async (id, name) => {
        await addTagToVideo(id, name);
        await refresh();
      },
      onRemoveTag: async (id, tagId) => {
        await removeTagFromVideo(id, tagId);
        await refresh();
      },
      onDeleteOne: async (item) => {
        const v = byId(item.id);
        if (v) await deleteVideo(v);
        await refresh();
      },
      onDeleteMany: async (list) => {
        const victims = list.map((i) => byId(i.id)).filter((v): v is Video => v !== null);
        if (victims.length) await deleteVideos(victims);
        await refresh();
      },
    }),
    [onImport, refresh, counts, tagNamesById, byId]
  );

  return {
    items,
    allTags: useMemo(() => tags.map(asUiTag), [tags]),
    tagMap,
    freeGb,
    busy,
    status,
    sort,
    setSort,
    actions,
  };
}
