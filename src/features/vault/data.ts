/**
 * The native half of the vault: sqlite + filesystem wiring.
 *
 * Kept separate from `ui/` on purpose. Nothing in `ui/` may import this file,
 * because everything here touches a native module and would kill the browser
 * preview (see the note at the top of `ui/types.ts`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Appearance, Linking } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Paths } from 'expo-file-system';

import { purgeExpired, purgeVideos, restore, trashVideos } from '@/features/vault/actions';
import { isCustomMemory } from '@/features/vault/memories';
import {
  addToAlbums,
  albumMembership,
  albumNameToKeyword,
  createAlbum,
  createFolder,
  deleteAlbum,
  deleteFolder,
  listAlbums,
  listFolders,
  moveSmartFilterToFolder,
  removeFromAlbum,
  removeFromPrivateAlbums,
  renameFolder,
  updateAlbum,
} from '@/features/vault/albums';
import { getDb } from '@/db';
import { CLOUD } from '@/features/vault/cloud/cloudLogic';
import { cloudConfigured, cloudConnected, cloudDownload, cloudList, cloudSignIn, cloudSignOut } from '@/features/vault/cloud/cloud';
import { autoBackup, exportLibraryInfo, exportSpreadsheet, importLibraryInfo, listAutoBackups } from '@/features/vault/backup';
import { appStorage, recoverInbox, tidy } from '@/features/vault/housekeeping';
import { incomingName, onIncoming } from '@/features/vault/incoming';
import { contentKeyOf } from '@/features/vault/contentKey';
import { probeDurationMs } from '@/features/vault/duration';
import { ensureFilmstrip } from '@/features/vault/filmstrip';
import { pickVideoFolder } from '@/features/vault/folderImport';
import { importAssets, type DuplicateInfo, type ImportSummary } from '@/features/vault/import';
import { stickyAsker, type DupChoice } from '@/features/vault/dupMatch';
import {
  addTagMany,
  removeTagMany,
  adjustDates,
  clearTray,
  deleteSmartFilter,
  getSetting,
  listSmartFilters,
  saveSmartFilter,
  setFlagMany,
  setPrivateMany,
  setRatingMany,
  setSetting,
  setStatusMany,
  setTagPinned,
  setTextMany,
  setTrayMany,
} from '@/features/vault/library';
import { readVideoMeta, saveVideoMeta, videosMissingMeta } from '@/features/vault/metadata';
import { unlockWithFaceId } from '@/features/vault/privateLock';
import {
  listDeleted,
  listVideos,
  repairVideoPaths,
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
import {
  checkPasscode,
  clearPasscode,
  getSecurityState,
  setFaceIdEnabled,
  setFakePasscode,
  setPasscode,
} from '@/features/vault/security';
import { canSaveSound, duplicateVideo, extractFrame, saveSoundToAudio, shareFile, videoChapters } from '@/features/vault/share';
import { resetCover, setCoverFromFrame, setCoverFromPhoto } from '@/features/vault/covers';
import { canChooseStrength, cancelMakeSmaller, canMakeSmaller, editVideo, makeSmaller } from '@/features/vault/compress';
import { planForQuality } from '@/features/vault/edit';
import { fmtMs, parseRatingLabels } from '@/features/vault/stats';
import {
  addBookmark,
  allVaultPlays,
  bookmarkCount,
  bookmarksFor,
  deleteBookmark,
  deletePlays,
  recordPlay,
  renameBookmark,
  resumePoints,
  setResumePoint,
} from '@/features/vault/watching';
import {
  addToSeries,
  createSeries,
  deleteSeries,
  forgetKept,
  listKept,
  listMembers,
  listSeries,
  pickKeptCover,
  removeFromSeries,
  reorderSeries,
  setEpisodeLabel,
  setSeriesCover,
  updateKept,
  updateSeries,
} from '@/features/vault/overviewStore';
import type { OvMember, OvSeries, OvVideo } from '@/features/vault/overview';
import { OV_EXTRA_KEY, parseOvExtra } from '@/features/vault/ovExtra';
import {
  onOpenRequestTap,
  onThisDayReminderOn,
  onWrappedTap,
  scheduleOnThisDay,
  scheduleYearWrapped,
  scheduleMonthWrapped,
  monthWrappedReminderOn,
  setMonthWrappedReminder,
  scheduleWeeklySummary,
  setWeeklySummary,
  weeklySummaryOn,
  setOnThisDayReminder,
  setWrappedReminder,
  setYearWrappedReminder,
  wrappedReminderOn,
  yearWrappedReminderOn,
  type OpenRequest,
} from '@/features/vault/wrappedReminder';
import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from 'expo-alternate-app-icons';
import { DEFAULT_PLAYER, DEFAULT_SLIDESHOW, DEFAULT_VAULT_PREFS, PLAYER_SPEEDS, WATCH_SORTS, type PlayerOptions, type SlideshowOptions, type VaultPrefs } from '@/features/vault/ui/types';
import { onThisDayPlan } from '@/features/vault/recap';
import { weeklySummary } from '@/features/vault/yearHeat';
import { ReelVaultMedia } from '../../../modules/reelvault-media';

import { friendlyName } from '@/features/vault/names';
import { frozenTimes } from '@/features/vault/streakFreeze';
import { applyMetadata, pickMetadataFile } from '@/features/vault/metaImport';
import { clearPasscodeLog, logPasscodeAttempt, passcodeLog } from '@/features/vault/passcodeLog';
import { wifiBridge } from '@/features/vault/wifi';
import { useInside, type InsideProgress } from '@/features/vault/scenes';
import type { SceneRow } from '@/features/vault/sceneLogic';
import { parseQuality } from '@/features/vault/smaller';
import {
  clipboardUrl,
  downloadVideo,
  pickFromPhotos,
  recordWithCamera,
  saveToPhotos,
  type PickedFile,
} from '@/features/vault/sources';
import { isHttpUrl, looksLikeVideoFile } from '@/features/vault/sourceNames';
import { thumbnailUri } from '@/features/vault/storage';
import { addTagToVideo, listTags, removeTagFromVideo, tagsForVideo, type Tag, deleteTag, deleteUnusedTags, mergeTags, renameTag, setTagColor } from '@/features/vault/tags';
import type { Video } from '@/features/vault/types';

import { gbFromBytes } from './ui/format';
import { FREE_SPACE_RESERVE_GB, groupDuplicates, parseRule, parseViewOptions } from './ui/logic';
import {
  DEFAULT_VIEW_OPTIONS,
  type DuplicateAsk,
  type ImportSource,
  type SmartFilter,
  type UiAlbum,
  type UiFolder,
  type UiTag,
  type VaultActions,
  type VaultItem,
  type ViewOptions,
} from './ui/types';

const VIEW_OPTIONS_KEY = 'viewOptions';
/** Make Smaller quality applied to every import; missing = off. */
const IMPORT_QUALITY_KEY = 'importQuality';

const asUiTag = (t: Tag): UiTag => ({ id: t.id, name: t.name, pinned: t.pinned === 1, color: t.color });

/** A DB row plus the display-only bits the UI needs. */
function toVaultItem(
  v: Video,
  counts: Record<string, number>,
  tagNamesById: Record<string, string[]>,
  membership: Record<string, number[]>
): VaultItem {
  return {
    id: v.id,
    filename: v.filename,
    uri: v.uri,
    thumbSource: thumbnailUri(v.id, v.coverAt),
    sizeBytes: v.size,
    durationMs: v.durationMs,
    rating: v.rating,
    width: v.width ?? null,
    height: v.height ?? null,
    createdAt: v.createdAt,
    importedAt: v.importedAt,
    tagCount: counts[v.id] ?? 0,
    tagNames: tagNamesById[v.id] ?? [],
    deletedAt: v.deletedAt,
    status: v.status,
    isPrivate: v.isPrivate,
    flag: v.flag,
    inTray: v.inTray,
    albumIds: membership[v.id] ?? [],
    title: v.title,
    notes: v.notes,
    meta: v.meta,
    customCover: v.coverAt != null,
    originalSizeBytes: v.originalSize,
    contentKey: v.contentKey,
  };
}

/**
 * The phone's own controls (alerts, keyboards, switches) follow the chosen
 * theme too. 'system' hands the decision back to iOS.
 */
function applyTheme(theme: ViewOptions['theme']): void {
  try {
    Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
  } catch (e) {
    console.log(`[VIEW] theme not applied: ${String(e)}`);
  }
}

/** One readable line for the header after an import. */
function describeImport(s: ImportSummary, freeGb: number | null): string {
  const parts = [`Imported ${s.imported}`];
  if (s.replaced.length) parts.push(`${s.replaced.length} replaced`);
  if (s.keptBoth.length) parts.push(`${s.keptBoth.length} kept as a second copy`);
  if (s.duplicates.length) parts.push(`${s.duplicates.length} already in ReelVault, skipped`);
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
  /** Picture fingerprints by video id (app build 18 on), for Similar. */
  prints: Map<string, string[]>;
  /** What the phone saw inside the videos, for search. */
  /** What was seen inside videos (one list kept aside; read `.current`). */
  sceneRows: { current: SceneRow[] };
  /** Changes when sceneRows does. */
  sceneVersion: number;
  /** How far the look inside your videos has got (null before it starts). */
  insideProgress: InsideProgress | null;
  deletedItems: VaultItem[];
  duplicateGroups: string[][];
  smartFilters: SmartFilter[];
  albums: UiAlbum[];
  folders: UiFolder[];
  viewOptions: ViewOptions;
  allTags: UiTag[];
  tagMap: Record<string, string[]>;
  freeGb: number | null;
  busy: boolean;
  status: string;
  actions: VaultActions;
  /** An import waits for an answer: this file is already in the library. */
  duplicateAsk: DuplicateAsk | null;
  resume: Map<string, number>;
  prefs: VaultPrefs;
  wrappedRequest: boolean;
  clearWrappedRequest: () => void;
  openRequest: OpenRequest | null;
  clearOpenRequest: () => void;
  kept: OvVideo[];
  series: OvSeries[];
  members: OvMember[];
};

/** Files whose length or fingerprint could not be read, and when (tried again after a week). */
const PROBE_FAILED_KEY = 'vault.probeFailed';
const PREFS_KEY = 'vault.prefs';

/** The shape the pure recap helpers read. */
const asRVideo = (v: Video) => ({
  id: v.id,
  title: v.title,
  filename: v.filename,
  createdAt: v.createdAt,
  importedAt: v.importedAt,
  durationMs: v.durationMs,
  sizeBytes: v.size,
  rating: v.rating,
  tagNames: [] as string[],
});

function parseSlideshow(r: unknown): SlideshowOptions {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const d = DEFAULT_SLIDESHOW;
  const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
  return {
    order: pick(o.order, ['shown', 'shuffle', 'oldest', 'best'] as const, d.order),
    clipSec: typeof o.clipSec === 'number' && [0, 5, 10, 20, 30, 60].includes(o.clipSec) ? o.clipSec : d.clipSec,
    transition: pick(o.transition, ['fade', 'zoom', 'slide', 'none'] as const, d.transition),
    titles: typeof o.titles === 'boolean' ? o.titles : d.titles,
    sound: typeof o.sound === 'boolean' ? o.sound : d.sound,
    repeat: typeof o.repeat === 'boolean' ? o.repeat : d.repeat,
  };
}

function parsePlayer(r: unknown): PlayerOptions {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const d = DEFAULT_PLAYER;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    // The end-of-video choice is new (loop by default): settings saved before it ("loop") start on Loop.
    autoplayNext: 'endLoop' in o ? bool(o.autoplayNext, d.autoplayNext) : d.autoplayNext,
    endLoop: bool(o.endLoop, d.endLoop),
    speed: typeof o.speed === 'number' && (PLAYER_SPEEDS as readonly number[]).includes(o.speed) ? o.speed : d.speed,
    ambient: bool(o.ambient, d.ambient),
    remaining: bool(o.remaining, d.remaining),
    background: bool(o.background, d.background),
    // 'full' (open full screen, sideways) was the default for a day and is gone: those open with the controls.
    start: o.start === 'video' || o.start === 'fill' ? o.start : d.start,
  };
}

function parseSkipIntro(r: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!r || typeof r !== 'object') return out;
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) if (typeof v === 'number' && v > 0 && v < 3600) out[k] = Math.round(v);
  return out;
}

function parsePrefs(json: string | null): VaultPrefs {
  try {
    const r = json ? JSON.parse(json) : {};
    return {
      ratingLabels: parseRatingLabels(JSON.stringify(r?.ratingLabels ?? {})),
      resumeEnabled: typeof r?.resumeEnabled === 'boolean' ? r.resumeEnabled : DEFAULT_VAULT_PREFS.resumeEnabled,
      holdForSpeed: typeof r?.holdForSpeed === 'boolean' ? r.holdForSpeed : DEFAULT_VAULT_PREFS.holdForSpeed,
      videosMode: r?.videosMode === 'overview' || r?.videosMode === 'audio' || r?.videosMode === 'manga' ? r.videosMode : 'watch',
      keepUnrated: typeof r?.keepUnrated === 'boolean' ? r.keepUnrated : DEFAULT_VAULT_PREFS.keepUnrated,
      hiddenSuggestions: Array.isArray(r?.hiddenSuggestions) ? r.hiddenSuggestions.filter((x: unknown) => typeof x === 'string').slice(0, 200) : [],
      showcase: Array.isArray(r?.showcase) ? r.showcase.filter((x: unknown) => typeof x === 'string').slice(0, 3) : [],
      weeklyGoalMin:
        typeof r?.weeklyGoalMin === 'number' && r.weeklyGoalMin >= 10 && r.weeklyGoalMin <= 6000 ? Math.round(r.weeklyGoalMin) : DEFAULT_VAULT_PREFS.weeklyGoalMin,
      memoryFavs: Array.isArray(r?.memoryFavs) ? r.memoryFavs.filter((x: unknown) => typeof x === 'string').slice(0, 500) : [],
      memoryHidden: Array.isArray(r?.memoryHidden) ? r.memoryHidden.filter((x: unknown) => typeof x === 'string').slice(0, 500) : [],
      memoriesSeen: Array.isArray(r?.memoriesSeen) ? r.memoriesSeen.filter((x: unknown) => typeof x === 'string').slice(-1000) : [],
      customMemories: Array.isArray(r?.customMemories) ? r.customMemories.filter(isCustomMemory).slice(0, 100) : [],
      events: Array.isArray(r?.events)
        ? r.events.filter((e: { k?: unknown; at?: unknown }) => e && typeof e.k === 'string' && typeof e.at === 'number').slice(-3000)
        : [],
      badgesSeen: Array.isArray(r?.badgesSeen) ? r.badgesSeen.filter((x: unknown) => typeof x === 'string') : null,
      liveSound: typeof r?.liveSound === 'boolean' ? r.liveSound : DEFAULT_VAULT_PREFS.liveSound,
      slideshow: parseSlideshow(r?.slideshow),
      albumSort: r?.albumSort === 'watched' || r?.albumSort === 'recent' ? r.albumSort : 'name',
      homeRows: typeof r?.homeRows === 'boolean' ? r.homeRows : DEFAULT_VAULT_PREFS.homeRows,
      recentSearches: Array.isArray(r?.recentSearches) ? r.recentSearches.filter((x: unknown) => typeof x === 'string').slice(0, 10) : [],
      player: parsePlayer(r?.player),
      trashDays: [1, 3, 7, 14, 30].includes(r?.trashDays) ? r.trashDays : DEFAULT_VAULT_PREFS.trashDays,
      pinned: Array.isArray(r?.pinned) ? [...new Set<string>(r.pinned.filter((x: unknown) => typeof x === 'string'))].slice(0, 60) : [],
      freezes: {
        banked: typeof r?.freezes?.banked === 'number' ? Math.max(0, Math.min(3, Math.round(r.freezes.banked))) : DEFAULT_VAULT_PREFS.freezes.banked,
        used: Array.isArray(r?.freezes?.used) ? r.freezes.used.filter((x: unknown) => typeof x === 'number').slice(-120) : [],
        lastEarnedWeek: typeof r?.freezes?.lastEarnedWeek === 'number' ? r.freezes.lastEarnedWeek : null,
      },
      gridPreview: r?.gridPreview === true,
      skipIntro: parseSkipIntro(r?.skipIntro),
      customOrder: Array.isArray(r?.customOrder) ? [...new Set<string>(r.customOrder.filter((x: unknown) => typeof x === 'string'))].slice(0, 50_000) : [],
    };
  } catch {
    return DEFAULT_VAULT_PREFS;
  }
}

/** Wi-Fi transfer: the very same file is skipped; a look-alike is kept beside the one you have. */
/** Parts of the library that reload on their own after an edit. */
type LibraryPart = 'videos' | 'tags' | 'albums' | 'series';
const ALL_PARTS: readonly LibraryPart[] = ['videos', 'tags', 'albums', 'series'];

const wifiDuplicates = async (info: DuplicateInfo): Promise<DupChoice> => (info.exact ? 'skip' : 'both');

export function useVaultData(): VaultData {
  const [videos, setVideos] = useState<Video[]>([]);
  const [deleted, setDeleted] = useState<Video[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [membership, setMembership] = useState<Record<string, number[]>>({});
  const [tags, setTags] = useState<Tag[]>([]);
  const [smartFilters, setSmartFilters] = useState<SmartFilter[]>([]);
  const [albums, setAlbums] = useState<UiAlbum[]>([]);
  const [folders, setFolders] = useState<UiFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [duplicateAsk, setDuplicateAsk] = useState<DuplicateAsk | null>(null);
  const [viewOptions, setViewOptions] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [freeGb, setFreeGb] = useState<number | null>(null);
  const [resume, setResume] = useState<Map<string, number>>(new Map());
  const [prefs, setPrefsState] = useState<VaultPrefs>(DEFAULT_VAULT_PREFS);
  const [wrappedRequest, setWrappedRequest] = useState(false);
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  const [kept, setKept] = useState<OvVideo[]>([]);
  const [series, setSeries] = useState<OvSeries[]>([]);
  const [members, setMembers] = useState<OvMember[]>([]);

  useEffect(() => {
    getSetting(PREFS_KEY)
      .then((v) => setPrefsState(parsePrefs(v)))
      .catch(() => undefined);
    resumePoints()
      .then(setResume)
      .catch(() => undefined);
    const offOpen = onOpenRequestTap(setOpenRequest);
    const offWrapped = onWrappedTap(() => setWrappedRequest(true));
    return () => {
      offOpen();
      offWrapped();
    };
  }, []);

  // Sorts by plays are done in the UI; the database lists those newest first.
  const sqlSort = (s: ViewOptions['sort']): SortKey => (WATCH_SORTS.includes(s) || s === 'custom' ? 'recent' : (s as SortKey));
  const videosRef = useRef<Video[]>([]);
  videosRef.current = videos;
  const sortRef = useRef<SortKey>(sqlSort(viewOptions.sort));
  sortRef.current = sqlSort(viewOptions.sort);

  /**
   * Reload from the database: everything, or only the parts an edit changed (a keyword edit
   * needs 4 queries, not 12, and leaves the video list and every tile alone).
   */
  const reload = useCallback(async (parts: readonly LibraryPart[] = ALL_PARTS) => {
    const want = new Set(parts);
    const loadFilters = async () => {
      const filters = await listSmartFilters();
      setSmartFilters(
        filters.map((f) => ({ id: f.id, name: f.name, rule: parseRule(f.rule_json), folderId: f.folder_id }))
      );
    };
    const jobs: Promise<void>[] = [];
    if (want.has('videos'))
      jobs.push(
        Promise.all([listVideos(sortRef.current), listDeleted()]).then(([list, trash]) => {
          setVideos(list);
          setDeleted(trash);
        })
      );
    if (want.has('tags'))
      jobs.push(
        Promise.all([tagCounts(), tagIndex(), listTags()]).then(([map, index, tagList]) => {
          setCounts(map);
          setTagMap(index);
          setTags(tagList);
        })
      );
    if (want.has('albums'))
      jobs.push(
        Promise.all([listAlbums(), listFolders(), albumMembership()]).then(([albumRows, folderRows, members]) => {
          setAlbums(
            albumRows.map((a) => ({
              id: a.id,
              name: a.name,
              folderId: a.folder_id,
              isPrivate: a.is_private === 1,
              pinned: a.pinned === 1,
              excludeUncategorized: a.exclude_uncategorized === 1,
              lastUsedAt: a.last_used_at,
            }))
          );
          setFolders(folderRows.map((f) => ({ id: f.id, name: f.name })));
          setMembership(members);
        })
      );
    // Keyword renames also rewrite smart-filter rules, and filters sit in folders.
    if (want.has('tags') || want.has('albums')) jobs.push(loadFilters());
    if (want.has('series'))
      jobs.push(
        Promise.all([listKept(), listSeries(), listMembers()]).then(([keptRows, seriesRows, seriesMembers]) => {
          setKept(keptRows);
          setSeries(seriesRows);
          setMembers(seriesMembers);
        })
      );
    await Promise.all(jobs);
    if (want.has('videos')) setFreeGb(readFreeGb());
  }, []);
  const refresh = useCallback(() => reload(ALL_PARTS), [reload]);

  // Saved view options first, so the first list already uses the saved sort.
  useEffect(() => {
    getSetting(VIEW_OPTIONS_KEY)
      .then((json) => {
        const saved = parseViewOptions(json, DEFAULT_VIEW_OPTIONS);
        applyTheme(saved.theme);
        setViewOptions(saved);
      })
      .catch((e) => console.log(`[VAULT] view options failed: ${String(e)}`));
  }, []);

  useEffect(() => {
    refresh().catch((e) => console.log(`[VAULT] refresh failed: ${String(e)}`));
  }, [viewOptions.sort, refresh]);

  /** The Sunday summary from what you watched this week (private videos left out). */
  const weeklyPlan = async () => {
    const names = new Map(videosRef.current.filter((v) => !v.isPrivate).map((v) => [v.id, friendlyName(v)]));
    const prefsNow = parsePrefs(await getSetting(PREFS_KEY));
    return weeklySummary(await allVaultPlays(), Date.now(), { nameOf: (id) => names.get(id) ?? null, fmt: fmtMs, extraDays: frozenTimes(prefsNow.freezes) });
  };
  const planWeekly = async () => scheduleWeeklySummary(await weeklyPlan());

  // Plan the next two weeks of On this day notifications (and the yearly Wrapped) once the library is loaded.
  const planned = useRef(false);
  useEffect(() => {
    if (planned.current || !videos.length) return;
    planned.current = true;
    scheduleOnThisDay(onThisDayPlan(videos.filter((v) => !v.isPrivate).map(asRVideo), Date.now())).catch((e) => console.log(`[OTD] ${String(e)}`));
    scheduleYearWrapped().catch((e) => console.log(`[YEAR] ${String(e)}`));
    scheduleMonthWrapped().catch((e) => console.log(`[MONTH] ${String(e)}`));
    planWeekly().catch((e) => console.log(`[WEEK] ${String(e)}`));
  }, [videos]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Sunday summary's words are worked out again whenever you leave the app, so they include what you just watched.
  useEffect(() => {
    let last = 0;
    const sub = AppState.addEventListener('change', (s) => {
      // At most once an hour (quick switches to another app need nothing new).
      if (s !== 'background' || Date.now() - last < 3_600_000) return;
      last = Date.now();
      planWeekly().catch((e) => console.log(`[WEEK] ${String(e)}`));
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A little after start, clear what ReelVault no longer needs (temporary files, leftovers, old filmstrips).
  useEffect(() => {
    const t = setTimeout(() => {
      // First, videos another app sent that never got imported (the app closed part way through).
      recoverInbox()
        .catch((e) => {
          console.log(`[INBOX] ${String(e)}`);
          return 0;
        })
        .then(() => tidy(false))
        .then(() => setFreeGb(readFreeGb()))
        .catch((e) => console.log(`[TIDY] ${String(e)}`))
        // Then the weekly copy of your info (ratings, keywords, history…).
        .then(() => autoBackup(false))
        .catch((e) => console.log(`[BACKUP] ${String(e)}`));
    }, 12_000);
    return () => clearTimeout(t);
  }, []);

  // On start: empty what has been in Recently Deleted for 30 days, then backfill
  // durations, duplicate fingerprints and file metadata for older rows.
  useEffect(() => {
    (async () => {
      // After an update iOS may have moved the app's folder: point every video at where its file is now.
      const moved = await repairVideoPaths().catch((e) => {
        console.log(`[PATHS] ${String(e)}`);
        return 0;
      });
      if (moved) {
        console.log(`[PATHS] ${moved} video addresses updated`);
        await refresh();
      }

      // Recently Deleted keeps videos as long as you chose (30 days unless you changed it).
      const savedPrefs = parsePrefs(await getSetting(PREFS_KEY));
      const purged = await purgeExpired(Date.now(), savedPrefs.trashDays);
      if (purged) console.log(`[PURGE] ${purged} expired videos removed`);

      // Files that could not be read are tried again after a week, not on every launch.
      let failed: Record<string, number> = {};
      try {
        failed = JSON.parse((await getSetting(PROBE_FAILED_KEY)) ?? '{}') ?? {};
      } catch {
        failed = {};
      }
      const now = Date.now();
      const due = (id: string, kind: string) => !failed[`${kind}:${id}`] || now - failed[`${kind}:${id}`] > 7 * 86_400_000;
      let failedChanged = false;
      const fail = (id: string, kind: string) => {
        failed[`${kind}:${id}`] = now;
        failedChanged = true;
      };

      const missing = (await videosMissingDuration()).filter((v) => due(v.id, 'd'));
      if (missing.length) console.log(`[DURATION] backfilling ${missing.length}`);
      for (const v of missing) {
        const ms = await probeDurationMs(v.uri);
        if (ms) await setDuration(v.id, ms);
        else fail(v.id, 'd');
      }

      const unkeyed = (await videosMissingContentKey()).filter((v) => due(v.id, 'k'));
      if (unkeyed.length) console.log(`[DUP] fingerprinting ${unkeyed.length}`);
      for (const v of unkeyed) {
        const key = await contentKeyOf(v.uri);
        if (key) await setContentKey(v.id, key);
        else fail(v.id, 'k');
      }
      if (failedChanged) await setSetting(PROBE_FAILED_KEY, JSON.stringify(failed)).catch(() => undefined);

      const unread = await videosMissingMeta();
      if (unread.length) console.log(`[META] reading ${unread.length} files`);
      for (const v of unread) await saveVideoMeta(v.id, (await readVideoMeta(v.uri)) ?? {});

      if (purged || missing.length || unkeyed.length || unread.length) await refresh();
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

  // A video that did not change keeps the same item (its tile is not redrawn after a rating elsewhere).
  const itemCache = useRef<{ key: unknown[]; map: WeakMap<Video, VaultItem> }>({ key: [], map: new WeakMap() });
  const items = useMemo(() => {
    const key = [counts, tagNamesById, membership];
    if (itemCache.current.key.some((k, i) => k !== key[i]) || itemCache.current.key.length !== key.length) itemCache.current = { key, map: new WeakMap() };
    const c = itemCache.current.map;
    return videos.map((v) => {
      let it = c.get(v);
      if (!it) c.set(v, (it = toVaultItem(v, counts, tagNamesById, membership)));
      return it;
    });
  }, [videos, counts, tagNamesById, membership]);
  const deletedItems = useMemo(
    () => deleted.map((v) => toVaultItem(v, counts, tagNamesById, membership)),
    [deleted, counts, tagNamesById, membership]
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

  // One question per copy found, unless "do the same for the rest" is ticked.
  const makeAsker = useCallback(
    () =>
      stickyAsker<DuplicateInfo>(
        (info) =>
          new Promise((resolve) => {
            const v = info.existing;
            setDuplicateAsk({
              kind: 'video',
              name: info.name,
              size: info.size,
              durationMs: info.durationMs,
              existing: {
                id: v.id,
                title: v.isPrivate ? 'A video in Private' : friendlyName(v),
                detail: v.filename,
                thumb: v.isPrivate ? null : thumbnailUri(v.id, v.coverAt),
                rating: v.isPrivate ? 0 : v.rating,
                importedAt: v.importedAt,
              },
              exact: info.exact,
              reason: info.reason,
              remaining: info.remaining,
              answer: (choice, all) => {
                setDuplicateAsk(null);
                resolve({ choice, all });
              },
            });
          })
      ),
    []
  );

  const runImport = useCallback(
    async (
      assets: { uri: string; name: string; size?: number }[],
      keepOriginals: boolean,
      /** What to do with a video already in the library (default: ask). */
      asker?: (info: DuplicateInfo) => Promise<DupChoice>
    ) => {
      const quality = canMakeSmaller() ? parseQuality(await getSetting(IMPORT_QUALITY_KEY)) : null;
      let saved = 0;
      const onDuplicate = asker ?? makeAsker();
      const summary = await importAssets(
        assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size })),
        (done, total) => setStatus(`Importing ${Math.min(done + 1, total)} of ${total}…`),
        {
          keepOriginals,
          onDuplicate,
          // Each video is made smaller before the next one comes in, so the space is freed as it goes.
          afterEach: quality
            ? async (video, index, total) => {
                const result = await makeSmaller(video, planForQuality(quality), (f) =>
                  setStatus(`Making ${index + 1} of ${total} smaller… ${Math.round(f * 100)}%`)
                );
                if (result.kind === 'done') saved += result.before - result.after;
              }
            : undefined,
        }
      );
      await refresh();
      const line = describeImport(summary, readFreeGb());
      setStatus(saved > 0 ? `${line} · saved ${(saved / 1024 ** 3).toFixed(2)} GB` : line);
      return summary;
    },
    [refresh, makeAsker]
  );

  // Videos sent from another app ("Open in ReelVault"): imported as they arrive.
  useEffect(
    () =>
      onIncoming((uris) => {
        setStatus(uris.length === 1 ? 'Adding the video you sent…' : `Adding ${uris.length} videos you sent…`);
        runImport(
          uris.map((uri) => ({ uri, name: incomingName(uri) })),
          false
        ).catch((e) => setStatus(`Could not add it: ${String(e)}`));
      }),
    [runImport]
  );

  // Wi-Fi transfer: ONE bridge for the life of the app. A new one per render made the Wi-Fi
  // screen stop the server and start it again (with a new code) after every video it added,
  // so the computer's next uploads lost the connection.
  // Nothing is asked over Wi-Fi: a video you already have (the very same file) is left out, and
  // one that only looks like a video you have (same length and picture size) is added, so
  // sending a whole folder again adds just the ones that are missing.
  const runImportRef = useRef(runImport);
  runImportRef.current = runImport;
  const wifi = useMemo(() => wifiBridge((files) => runImportRef.current(files, false, wifiDuplicates)), []);

  const onImport = useCallback(
    async (source: ImportSource) => {
      setBusy(true);
      try {
        let files: PickedFile[] = [];
        if (source === 'files') {
          const picked = await DocumentPicker.getDocumentAsync({
            type: 'video/*',
            multiple: true,
            copyToCacheDirectory: true,
          });
          if (!picked.canceled) files = picked.assets ?? [];
        } else if (source === 'photos') {
          files = await pickFromPhotos();
        } else {
          const recorded = await recordWithCamera();
          if (recorded === null) {
            Alert.alert('No camera access', 'Allow ReelVault to use the camera in Settings → ReelVault.');
            return;
          }
          files = recorded;
        }
        if (!files.length) return;
        await runImport(files, false);
      } catch (e) {
        console.log(`[VAULT] import (${source}) error: ${String(e)}`);
        setStatus('Import failed - check the dev log');
      } finally {
        setBusy(false);
      }
    },
    [runImport]
  );

  const onImportLink = useCallback(
    async (url: string) => {
      if (!isHttpUrl(url)) {
        Alert.alert('Not a link', 'Paste a link that starts with http:// or https://.');
        return;
      }
      setBusy(true);
      try {
        setStatus('Downloading…');
        const file = await downloadVideo(url);
        await runImport([file], false);
      } catch (e) {
        console.log(`[VAULT] link import error: ${String(e)}`);
        setStatus('Download failed');
        Alert.alert(
          'Could not download that',
          looksLikeVideoFile(url)
            ? String(e)
            : 'The link has to point straight at a video file (ending in .mp4, .mov...). Pages like YouTube or Instagram do not work.'
        );
      } finally {
        setBusy(false);
      }
    },
    [runImport]
  );

  /** Import Folder copies, so the whole folder has to fit next to the originals. */
  const onImportFolder = useCallback(async () => {
    setBusy(true);
    try {
      const folder = await pickVideoFolder();
      if (!folder) return;
      if (!folder.videos.length) {
        Alert.alert('No videos found', `"${folder.name}" has no video files.`);
        return;
      }
      const totalGb = folder.videos.reduce((s, v) => s + v.size, 0) / 1024 ** 3;
      const free = readFreeGb();
      if (free !== null && totalGb > free - FREE_SPACE_RESERVE_GB) {
        Alert.alert(
          'Not enough free space',
          `"${folder.name}" holds ${totalGb.toFixed(1)} GB of video, but only ${free} GB is free. ` +
            'Import a smaller folder, or pick the videos with Import instead (that moves them).'
        );
        return;
      }
      await runImport(folder.videos, true);
    } catch (e) {
      console.log(`[VAULT] folder import error: ${String(e)}`);
      setStatus('Folder import failed - check the dev log');
    } finally {
      setBusy(false);
    }
  }, [runImport]);

  /**
   * A write that only changes fields of the videos themselves (rating, status, flag, tray): the
   * videos are updated in place instead of reloading the whole library (12 queries and every
   * screen). Sorted by rating, the order may change, so that one still reloads.
   */
  const andPatch = useCallback(
    <A extends unknown[]>(job: (...args: A) => Promise<unknown>, patch: (...args: A) => { ids: string[]; set: Partial<Video> }) =>
      async (...args: A) => {
        await job(...args);
        const { ids, set } = patch(...args);
        if ('rating' in set && sortRef.current === 'rating') return refresh();
        const want = new Set(ids);
        setVideos((vs) => vs.map((v) => (want.has(v.id) ? { ...v, ...set } : v)));
        setDeleted((vs) => (vs.some((v) => want.has(v.id)) ? vs.map((v) => (want.has(v.id) ? { ...v, ...set } : v)) : vs));
      },
    [refresh]
  );

  /** Run a write, then reload only the parts of the library it changed. */
  const andReload = useCallback(
    <A extends unknown[]>(parts: readonly LibraryPart[], job: (...args: A) => Promise<unknown>) =>
      async (...args: A) => {
        await job(...args);
        await reload(parts);
      },
    [reload]
  );

  /** Run a write, then reload everything. */
  const andRefresh = useCallback(
    <A extends unknown[]>(job: (...args: A) => Promise<unknown>) =>
      async (...args: A) => {
        await job(...args);
        await refresh();
      },
    [refresh]
  );

  const actions = useMemo<VaultActions>(
    () => ({
      onImport: (source) => {
        void onImport(source);
      },
      onImportLink: (url) => {
        void onImportLink(url);
      },
      readClipboardLink: clipboardUrl,
      onSaveToPhotos: async (items) => {
        const uris = items.map((i) => byId(i.id)?.uri).filter((u): u is string => !!u);
        const saved = await saveToPhotos(uris);
        if (saved === null) {
          Alert.alert('No access to Photos', 'Allow ReelVault to add to Photos in Settings → ReelVault → Photos.');
          return;
        }
        setStatus(`Saved ${saved} to Photos`);
      },
      onImportFolder: () => {
        void onImportFolder();
      },
      search: async (q) =>
        (await searchVideos(q)).map((v) => toVaultItem(v, counts, tagNamesById, membership)),
      loadTags: async (id) => (await tagsForVideo(id)).map(asUiTag),
      loadFrames: async (item) => {
        const v = byId(item.id);
        return v ? ensureFilmstrip(v) : [];
      },
      onRate: andPatch((id: string, rating: number) => saveRating(id, rating), (id, rating) => ({ ids: [id], set: { rating } })),
      onAddTag: andReload(['tags'], (id: string, name: string) => addTagToVideo(id, name)),
      onRemoveTag: andReload(['tags'], (id: string, tagId: number) => removeTagFromVideo(id, tagId)),
      onPinTag: andReload(['tags'], setTagPinned),
      renameTag: andReload(['tags'], renameTag),
      mergeTags: andReload(['tags'], mergeTags),
      deleteTag: andReload(['tags'], deleteTag),
      setTagColor: andReload(['tags'], setTagColor),
      deleteUnusedTags: async () => {
        const n = await deleteUnusedTags();
        await reload(['tags']);
        return n;
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
      onRateMany: andPatch(setRatingMany, (ids, rating) => ({ ids, set: { rating } })),
      onAddTagMany: andReload(['tags'], addTagMany),
      onSetStatus: andPatch(setStatusMany, (ids, status) => ({ ids, set: { status } })),
      onSetFlag: andPatch(setFlagMany, (ids, flag) => ({ ids, set: { flag } })),
      onSetTray: andPatch(setTrayMany, (ids, inTray) => ({ ids, set: { inTray } })),
      onClearTray: async () => {
        await clearTray();
        setVideos((vs) => (vs.some((v) => v.inTray) ? vs.map((v) => (v.inTray ? { ...v, inTray: false } : v)) : vs));
      },
      onSetText: andPatch(setTextMany, (ids, field, value) => ({
        ids,
        set: field === 'title' ? { title: value?.trim() || null } : { notes: value?.trim() || null },
      })),
      onAdjustDates: andReload(['videos'], adjustDates),
      onViewOptionsChange: async (next) => {
        setViewOptions(next);
        applyTheme(next.theme);
        await setSetting(VIEW_OPTIONS_KEY, JSON.stringify(next));
      },
      onSetPrivate: andRefresh(async (ids: string[], isPrivate: boolean) => {
        await setPrivateMany(ids, isPrivate);
        if (!isPrivate) await removeFromPrivateAlbums(ids);
      }),
      unlockPrivate: async () => {
        const r = await unlockWithFaceId();
        if (!r.ok && r.message) await logPasscodeAttempt('faceid-failed').catch(() => undefined);
        return r;
      },
      onSaveSmartFilter: andReload(['albums'], (f: { id?: number; name: string; rule: unknown }) =>
        saveSmartFilter({ id: f.id, name: f.name, ruleJson: JSON.stringify(f.rule) })
      ),
      onDeleteSmartFilter: andReload(['albums'], deleteSmartFilter),
      onMoveSmartFilter: andReload(['albums'], moveSmartFilterToFolder),
      onCreateAlbum: async (name, opts) => {
        const id = await createAlbum(name, opts);
        await reload(['albums']);
        return id;
      },
      onUpdateAlbum: andReload(['albums'], updateAlbum),
      onDeleteAlbum: andReload(['albums'], deleteAlbum),
      onAddToAlbums: andReload(['albums', 'videos'], addToAlbums),
      onRemoveFromAlbum: andReload(['albums'], removeFromAlbum),
      onAlbumNameToKeyword: andReload(['albums', 'tags'], albumNameToKeyword),
      onCreateFolder: async (name) => {
        const id = await createFolder(name);
        await reload(['albums']);
        return id;
      },
      onRenameFolder: andReload(['albums'], renameFolder),
      onDeleteFolder: andReload(['albums'], deleteFolder),
      onShare: async (item) => {
        const v = byId(item.id);
        if (v) await shareFile(v.uri);
      },
      onExtractFrame: async (item, timeMs) => {
        const v = byId(item.id);
        if (v) await extractFrame(v, timeMs);
      },
      canSaveSound,
      onSaveSound: async (item) => {
        const v = byId(item.id);
        if (!v) throw new Error('That video is gone');
        return saveSoundToAudio(v);
      },
      loadChapters: async (item) => {
        const v = byId(item.id);
        return v ? videoChapters(v) : [];
      },
      onDuplicate: async (item) => {
        const v = byId(item.id);
        if (v) await duplicateVideo(v);
        await refresh();
      },
      onSetCoverFrame: async (item, timeMs) => {
        const v = byId(item.id);
        if (v) await setCoverFromFrame(v, timeMs);
        await refresh();
      },
      onPickCover: async (item) => {
        const v = byId(item.id);
        const picked = v ? await setCoverFromPhoto(v) : false;
        if (picked) await refresh();
        return picked;
      },
      onResetCover: async (item) => {
        const v = byId(item.id);
        if (v) await resetCover(v);
        await refresh();
      },
      canMakeSmaller,
      canChooseStrength,
      onMakeSmaller: async (item, plan, onProgress) => {
        const v = byId(item.id);
        if (!v) return { kind: 'failed', reason: 'not found' };
        const result = await makeSmaller(v, plan, onProgress);
        if (result.kind === 'done') await refresh();
        return result;
      },
      onEditVideo: async (item, plan, mode, onProgress) => {
        const v = byId(item.id);
        if (!v) return { kind: 'failed', reason: 'not found' };
        const result = await editVideo(v, plan, { mode }, onProgress);
        if (result.kind === 'done') await refresh();
        return result;
      },
      onCancelMakeSmaller: cancelMakeSmaller,
      listAutoBackups: async () => listAutoBackups(),
      backupNow: () => autoBackup(true),
      restoreAutoBackup: async (uri) => {
        const res = await importLibraryInfo(uri);
        await refresh();
        setPrefsState(parsePrefs(await getSetting(PREFS_KEY)));
        setResume(await resumePoints());
        return res;
      },
      searchBookmarks: async (q) => {
        const t = q.trim();
        if (t.length < 2) return [];
        const db = await getDb();
        const rows = await db.getAllAsync<{ video_id: string }>('SELECT DISTINCT video_id FROM vault_bookmarks WHERE label LIKE ? LIMIT 200;', [`%${t}%`]);
        return rows.map((r) => r.video_id);
      },
      getAppStorage: appStorage,
      tidyStorage: async (deep) => {
        const r = await tidy(deep);
        setFreeGb(readFreeGb());
        return r;
      },
      emptyRecentlyDeleted: async () => {
        const all = await listDeleted();
        await purgeVideos(all);
        await refresh();
        setFreeGb(readFreeGb());
        return all.length;
      },
      getImportQuality: async () => parseQuality(await getSetting(IMPORT_QUALITY_KEY)),
      setImportQuality: async (quality) => {
        await setSetting(IMPORT_QUALITY_KEY, quality ?? 'off');
      },
      onOpenMap: (lat, lon, label) => {
        const q = encodeURIComponent(label);
        Linking.openURL(`https://maps.apple.com/?ll=${lat},${lon}&q=${q}`).catch((e) =>
          console.log(`[MAP] could not open: ${String(e)}`)
        );
      },
      onExportBackup: async () => {
        const n = await exportLibraryInfo();
        setStatus(`Library info for ${n} videos exported`);
      },
      cloud: {
        services: async () =>
          Promise.all(
            (['dropbox', 'onedrive'] as const).map(async (kind) => ({
              kind,
              name: CLOUD[kind].name,
              configured: cloudConfigured(kind),
              connected: cloudConfigured(kind) && (await cloudConnected(kind)),
            }))
          ),
        signIn: cloudSignIn,
        signOut: cloudSignOut,
        list: cloudList,
        importFiles: (kind, entries) => {
          void (async () => {
            setBusy(true);
            const files: { uri: string; name: string; size?: number }[] = [];
            const failed: string[] = [];
            try {
              for (const [i, e] of entries.entries()) {
                setStatus(`Downloading from ${CLOUD[kind].name}… ${i + 1} of ${entries.length}`);
                try {
                  files.push(await cloudDownload(kind, e));
                } catch (err) {
                  console.log(`[CLOUD] ${e.name}: ${String(err)}`);
                  failed.push(e.name);
                }
              }
              if (files.length) await runImport(files, false);
              if (failed.length) Alert.alert('Some did not download', failed.slice(0, 6).join('\n'));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
      onExportSpreadsheet: async () => {
        const n = await exportSpreadsheet();
        setStatus(`A spreadsheet of ${n} videos exported`);
      },
      onImportBackup: async () => {
        try {
          const res = await importLibraryInfo();
          if (!res) return;
          await refresh();
          // Settings may have come back too: read them again so nothing saves over them.
          setPrefsState(parsePrefs(await getSetting(PREFS_KEY)));
          setResume(await resumePoints());
          setStatus(`Info restored for ${res.matched} of ${res.total} videos${res.plays ? `, with ${res.plays} plays of history` : ''}`);
        } catch (e) {
          Alert.alert('Could not import', e instanceof Error ? e.message : String(e));
        }
      },
      getSecurity: getSecurityState,
      setPasscode,
      clearPasscode,
      setFakePasscode,
      setFaceId: setFaceIdEnabled,
      checkPasscode: async (code, opts) => {
        const r = await checkPasscode(code);
        if (r !== 'real' && opts?.log !== false) await logPasscodeAttempt(r).catch(() => undefined);
        return r;
      },
      passcodeLog,
      clearPasscodeLog,
      recordPlay,
      loadPlays: allVaultPlays,
      loadBookmarks: bookmarksFor,
      addBookmark,
      renameBookmark,
      deleteBookmark,
      countBookmarks: bookmarkCount,
      setResume: async (videoId, positionMs) => {
        await setResumePoint(videoId, positionMs);
        setResume(await resumePoints());
      },
      setPrefs: async (next) => {
        setPrefsState(next);
        await setSetting(PREFS_KEY, JSON.stringify(next));
      },
      appIcon: () => {
        try {
          return getAppIconName();
        } catch {
          return null;
        }
      },
      setAppIcon: async (name) => {
        await setAlternateAppIcon(name as never);
      },
      canChangeAppIcon: () => supportsAlternateIcons,
      getWrappedReminder: wrappedReminderOn,
      setWrappedReminder,
      getOnThisDayReminder: onThisDayReminderOn,
      setOnThisDayReminder: (on) => setOnThisDayReminder(on, onThisDayPlan(videosRef.current.filter((v) => !v.isPrivate).map(asRVideo), Date.now())),
      getYearWrappedReminder: yearWrappedReminderOn,
      setYearWrappedReminder,
      getMonthWrappedReminder: monthWrappedReminderOn,
      setMonthWrappedReminder,
      colorsOf: async (item) => {
        const src = item.thumbSource as unknown;
        const uri = typeof src === 'object' && src && 'uri' in src ? String((src as { uri: string }).uri) : null;
        if (!uri || !ReelVaultMedia) return null;
        const c = await ReelVaultMedia.colors(uri).catch(() => null);
        return c && c.dominant ? c : null;
      },
      getWeeklySummary: weeklySummaryOn,
      setWeeklySummary: async (on) => setWeeklySummary(on, await weeklyPlan()),
      onRemoveTagMany: andReload(['tags'], removeTagMany),
      deletePlays,
      pickMetadataFile,
      applyMetadata: andRefresh(applyMetadata),
      wifi,
      ovCreateSeries: async (name, ids) => {
        const id = await createSeries(name, ids);
        await reload(['series']);
        return id;
      },
      ovAddToSeries: andReload(['series'], addToSeries),
      ovRemoveFromSeries: andReload(['series'], removeFromSeries),
      ovReorder: andReload(['series'], reorderSeries),
      ovEpisodeName: andReload(['series'], setEpisodeLabel),
      ovUpdateSeries: andReload(['series'], updateSeries),
      ovSeriesCover: async (id, from) => {
        const ok = await setSeriesCover(id, from);
        await reload(['series']);
        return ok;
      },
      ovDeleteSeries: andReload(['series'], deleteSeries),
      ovUpdateKept: andReload(['series'], updateKept),
      ovKeptCover: async (id) => {
        const ok = await pickKeptCover(id);
        await reload(['series']);
        return ok;
      },
      ovForget: andReload(['series'], forgetKept),
      loadOvExtra: async () => parseOvExtra(await getSetting(OV_EXTRA_KEY)),
      saveOvExtra: async (x) => {
        await setSetting(OV_EXTRA_KEY, JSON.stringify(x));
      },
    }),
    [onImport, onImportFolder, onImportLink, runImport, refresh, reload, andRefresh, andReload, andPatch, counts, tagNamesById, membership, byId, resolve]
  );

  const inside = useInside(videos, true);
  const allTags = useMemo(() => tags.map(asUiTag), [tags]);
  const clearWrappedRequest = useCallback(() => setWrappedRequest(false), []);
  const clearOpenRequest = useCallback(() => setOpenRequest(null), []);

  // One object while nothing in it changes: screens that read it do not redraw for other sections' changes.
  return useMemo(
    () => ({
      items,
      prints: inside.prints,
      sceneRows: inside.rows,
      sceneVersion: inside.version,
      insideProgress: inside.progress,
      deletedItems,
      duplicateGroups,
      smartFilters,
      albums,
      folders,
      viewOptions,
      allTags,
      tagMap,
      freeGb,
      busy,
      status,
      actions,
      duplicateAsk,
      resume,
      prefs,
      wrappedRequest,
      clearWrappedRequest,
      openRequest,
      clearOpenRequest,
      kept,
      series,
      members,
    }),
    // prettier-ignore
    [items, inside.prints, inside.rows, inside.version, inside.progress, deletedItems, duplicateGroups, smartFilters, albums, folders, viewOptions, allTags, tagMap, freeGb, busy, status, actions, duplicateAsk, resume, prefs, wrappedRequest, clearWrappedRequest, openRequest, clearOpenRequest, kept, series, members]
  );
}
