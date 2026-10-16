/**
 * The native half of the vault: sqlite + filesystem wiring.
 *
 * Kept separate from `ui/` on purpose. Nothing in `ui/` may import this file,
 * because everything here touches a native module and would kill the browser
 * preview (see the note at the top of `ui/types.ts`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Paths } from 'expo-file-system';

import { purgeExpired, purgeVideos, restore, trashVideos } from '@/features/vault/actions';
import { contentKeyOf } from '@/features/vault/contentKey';
import { probeDurationMs } from '@/features/vault/duration';
import { ensureFilmstrip } from '@/features/vault/filmstrip';
import { importAssets, type ImportSummary } from '@/features/vault/import';
import {
  addTagMany,
  deleteSmartFilter,
  getSetting,
  listSmartFilters,
  saveSmartFilter,
  setRatingMany,
  setSetting,
  setStatusMany,
} from '@/features/vault/library';
import {
  listDeleted,
  listVideos,
  searchVideos,
  setContentKey,
  setDuration,
  setRating as saveRating,
  tagCounts,
  tagIndex,
  videosMissingContentKey,
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
import { groupDuplicates, parseRule, parseViewOptions } from './ui/logic';
import {
  DEFAULT_VIEW_OPTIONS,
  type SmartFilter,
  type UiTag,
  type VaultActions,
  type VaultItem,
  type ViewOptions,
} from './ui/types';

const VIEW_OPTIONS_KEY = 'viewOptions';

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
    deletedAt: v.deletedAt,
    status: v.status,
  };
}

/** One readable line for the header after an import. */
function describeImport(s: ImportSummary, freeGb: number | null): string {
  const parts = [`Imported ${s.imported}`];
  if (s.duplicates.length) parts.push(`${s.duplicates.length} already in ReelVault`);
  if (s.unverified.length) parts.push(`${s.unverified.length} may not play`);
  if (s.failed.length) parts.push(`${s.failed.length} failed`);
  if (freeGb !== null) parts.push(`${freeGb} GB free`);
  return parts.join(' · ');
}

function readFreeGb(): number | null {
  try {
    return gbFromBytes(Paths.availableDiskSpace);
  } catch {
    // No filesystem (web) - the UI hides the readout when this is null.
    return null;
  }
}

export type VaultData = {
  items: VaultItem[];
  deletedItems: VaultItem[];
  duplicateGroups: string[][];
  smartFilters: SmartFilter[];
  viewOptions: ViewOptions;
  allTags: UiTag[];
  tagMap: Record<string, string[]>;
  freeGb: number | null;
  busy: boolean;
  status: string;
  actions: VaultActions;
};

export function useVaultData(): VaultData {
  const [videos, setVideos] = useState<Video[]>([]);
  const [deleted, setDeleted] = useState<Video[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [tags, setTags] = useState<Tag[]>([]);
  const [smartFilters, setSmartFilters] = useState<SmartFilter[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [viewOptions, setViewOptions] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [freeGb, setFreeGb] = useState<number | null>(null);

  const sortRef = useRef<SortKey>(viewOptions.sort);
  sortRef.current = viewOptions.sort;

  const refresh = useCallback(async () => {
    const [list, trash, map, index, tagList, filters] = await Promise.all([
      listVideos(sortRef.current),
      listDeleted(),
      tagCounts(),
      tagIndex(),
      listTags(),
      listSmartFilters(),
    ]);
    setVideos(list);
    setDeleted(trash);
    setCounts(map);
    setTagMap(index);
    setTags(tagList);
    setSmartFilters(filters.map((f) => ({ id: f.id, name: f.name, rule: parseRule(f.rule_json) })));
    setFreeGb(readFreeGb());
  }, []);

  // Saved view options first, so the first list already uses the saved sort.
  useEffect(() => {
    getSetting(VIEW_OPTIONS_KEY)
      .then((json) => setViewOptions(parseViewOptions(json, DEFAULT_VIEW_OPTIONS)))
      .catch((e) => console.log(`[VAULT] view options failed: ${String(e)}`));
  }, []);

  useEffect(() => {
    refresh().catch((e) => console.log(`[VAULT] refresh failed: ${String(e)}`));
  }, [viewOptions.sort, refresh]);

  // On start: empty what has been in Recently Deleted for 30 days, then backfill
  // durations and duplicate fingerprints for rows imported before those existed.
  useEffect(() => {
    (async () => {
      const purged = await purgeExpired();
      if (purged) console.log(`[PURGE] ${purged} expired videos removed`);

      const missing = await videosMissingDuration();
      if (missing.length) console.log(`[DURATION] backfilling ${missing.length}`);
      for (const v of missing) {
        const ms = await probeDurationMs(v.uri);
        if (ms) await setDuration(v.id, ms);
      }

      const unkeyed = await videosMissingContentKey();
      if (unkeyed.length) console.log(`[DUP] fingerprinting ${unkeyed.length}`);
      for (const v of unkeyed) {
        const key = await contentKeyOf(v.uri);
        if (key) await setContentKey(v.id, key);
      }

      if (purged || missing.length || unkeyed.length) await refresh();
    })().catch((e) => console.log(`[VAULT] start-up tasks failed: ${String(e)}`));
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
  const deletedItems = useMemo(
    () => deleted.map((v) => toVaultItem(v, counts, tagNamesById)),
    [deleted, counts, tagNamesById]
  );
  const duplicateGroups = useMemo(() => groupDuplicates(videos), [videos]);

  const byId = useCallback(
    (id: string) => videos.find((v) => v.id === id) ?? deleted.find((v) => v.id === id) ?? null,
    [videos, deleted]
  );
  const resolve = useCallback(
    (list: VaultItem[]) => list.map((i) => byId(i.id)).filter((v): v is Video => v !== null),
    [byId]
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
      const summary = await importAssets(picked.assets, (done, total) =>
        setStatus(`Importing ${Math.min(done + 1, total)} of ${total}…`)
      );
      await refresh();
      setStatus(describeImport(summary, readFreeGb()));
    } catch (e) {
      console.log(`[VAULT] import error: ${String(e)}`);
      setStatus('Import failed - check the dev log');
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
        await trashVideos(resolve([item]));
        await refresh();
      },
      onDeleteMany: async (list) => {
        await trashVideos(resolve(list));
        await refresh();
      },
      onRestoreMany: async (list) => {
        await restore(resolve(list));
        await refresh();
      },
      onPurgeMany: async (list) => {
        await purgeVideos(resolve(list));
        await refresh();
      },
      onRateMany: async (ids, rating) => {
        await setRatingMany(ids, rating);
        await refresh();
      },
      onAddTagMany: async (ids, name) => {
        await addTagMany(ids, name);
        await refresh();
      },
      onSetStatus: async (ids, next) => {
        await setStatusMany(ids, next);
        await refresh();
      },
      onViewOptionsChange: async (next) => {
        setViewOptions(next);
        await setSetting(VIEW_OPTIONS_KEY, JSON.stringify(next));
      },
      onSaveSmartFilter: async (f) => {
        await saveSmartFilter({ id: f.id, name: f.name, ruleJson: JSON.stringify(f.rule) });
        await refresh();
      },
      onDeleteSmartFilter: async (id) => {
        await deleteSmartFilter(id);
        await refresh();
      },
    }),
    [onImport, refresh, counts, tagNamesById, byId, resolve]
  );

  return {
    items,
    deletedItems,
    duplicateGroups,
    smartFilters,
    viewOptions,
    allTags: useMemo(() => tags.map(asUiTag), [tags]),
    tagMap,
    freeGb,
    busy,
    status,
    actions,
  };
}
