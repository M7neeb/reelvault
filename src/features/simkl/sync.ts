/**
 * Keeping the local Simkl library in step, the way api.simkl.org/guides/sync
 * asks: read /sync/activities first; the first time pull each type in turn;
 * afterwards fetch only the delta since the saved snapshot, the id list when
 * something was removed, and the ratings delta when a rating moved. The
 * snapshot is saved only when every fetch worked.
 */

import { getSetting, setSetting } from '@/features/vault/library';

import { cachedPlan, refreshPlan } from './actions';
import { simklRequest } from './api';
import { parseAllItems, parseCommunityRatings, parseIds, planSync, shouldSync, type Activities } from './logic';
import { deleteSimklItems, listSimklItems, saveCommunityRatings, setWatchedEpisodes, upsertSimklItems } from './repo';

const SNAPSHOT_KEY = 'simkl.snapshot';
const LAST_SYNC_KEY = 'simkl.lastSync';

/** Episode rows come along so the episode checkmarks are right offline. */
const EPISODES = { extended: 'full', episode_watched_at: 'yes', next_watch_info: 'yes' } as const;
const RATINGS_AT_KEY = 'simkl.ratingsAt';
const DAY = 24 * 3600 * 1000;

/**
 * IMDb / MAL / Simkl ratings and rank for the whole library in one request.
 * After the library changed, or once a day; never per title.
 */
async function refreshCommunityRatings(libraryChanged: boolean): Promise<void> {
  const last = Number((await getSetting(RATINGS_AT_KEY)) ?? 0) || 0;
  if (!libraryChanged && Date.now() - last < DAY) return;
  const json = await simklRequest('/ratings/all', { auth: true, query: { user_watchlist: 1, fields: 'simkl,ext,rank' } });
  await saveCommunityRatings(parseCommunityRatings(json));
  await setSetting(RATINGS_AT_KEY, String(Date.now()));
}

async function readSnapshot(): Promise<Activities | null> {
  const raw = await getSetting(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Activities;
  } catch {
    return null;
  }
}

async function store(json: unknown): Promise<number> {
  const { items, episodes } = parseAllItems(json);
  await upsertSimklItems(items);
  for (const [id, eps] of episodes) await setWatchedEpisodes(id, eps);
  return items.length;
}

export type SyncResult = { kind: 'skipped' | 'unchanged' | 'synced'; changed: number };

export async function lastSyncAt(): Promise<number | null> {
  const raw = await getSetting(LAST_SYNC_KEY);
  return raw ? Number(raw) || null : null;
}

/** `force` = pull-to-refresh (still never twice within 10 s). */
export async function syncSimkl(force = false, onStep?: (label: string) => void): Promise<SyncResult> {
  const now = Date.now();
  if (!shouldSync(await lastSyncAt(), now, force)) return { kind: 'skipped', changed: 0 };

  const fresh = await simklRequest<Activities>('/sync/activities', { auth: true });
  const saved = await readSnapshot();
  const plan = planSync(saved, fresh);
  // The account plan (free / PRO / VIP) only changes with the settings timestamp.
  if (fresh?.settings?.all !== saved?.settings?.all || (await cachedPlan()) === 'unknown') {
    await refreshPlan().catch((e) => console.log(`[SIMKL] plan: ${String(e)}`));
  }
  let changed = 0;

  if (plan.kind === 'nothing') {
    await setSetting(LAST_SYNC_KEY, String(now));
    await refreshCommunityRatings(false).catch((e) => console.log(`[SIMKL] ratings: ${String(e)}`));
    return { kind: 'unchanged', changed: 0 };
  }

  if (plan.kind === 'full') {
    // One type after another, never in parallel. `original` keeps the episode
    // rows to what was really watched (lighter than `yes` on big libraries).
    for (const [path, label] of [
      ['shows', 'shows'],
      ['movies', 'movies'],
      ['anime', 'anime'],
    ] as const) {
      onStep?.(`Downloading your ${label}…`);
      const json = await simklRequest(`/sync/all-items/${path}`, {
        auth: true,
        query: path === 'movies' ? { memos: 'yes' } : { ...EPISODES, include_all_episodes: 'original', memos: 'yes' },
      });
      changed += await store(json);
    }
  } else {
    onStep?.('Checking Simkl for changes…');
    const delta = await simklRequest('/sync/all-items', {
      auth: true,
      query: { date_from: plan.dateFrom, ...EPISODES, include_all_episodes: 'original', memos: 'yes' },
    });
    changed += await store(delta);

    if (plan.ratings) {
      const ratings = await simklRequest('/sync/ratings', { auth: true, query: { date_from: plan.dateFrom } });
      changed += await store(ratings);
    }
    if (plan.removals) {
      const current = parseIds(await simklRequest('/sync/all-items', { auth: true, query: { extended: 'simkl_ids_only' } }));
      const gone = (await listSimklItems()).filter((i) => !current.has(i.simklId)).map((i) => i.simklId);
      await deleteSimklItems(gone);
      changed += gone.length;
    }
  }

  await setSetting(SNAPSHOT_KEY, JSON.stringify(fresh));
  await setSetting(LAST_SYNC_KEY, String(now));
  onStep?.('Getting ratings…');
  await refreshCommunityRatings(changed > 0).catch((e) => console.log(`[SIMKL] ratings: ${String(e)}`));
  console.log(`[SIMKL] sync ${plan.kind}: ${changed} rows`);
  return { kind: 'synced', changed };
}

/** After signing out: the next sign-in starts with a full pull again. */
export async function forgetSyncState(): Promise<void> {
  await setSetting(SNAPSHOT_KEY, '');
  await setSetting(LAST_SYNC_KEY, '');
  await setSetting(RATINGS_AT_KEY, '');
}
