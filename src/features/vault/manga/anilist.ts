/**
 * AniList: find a title, fill in its details, and keep your AniList list in
 * step with what you read here (status, chapters read, score).
 *
 * Searching and details need no account. Updating your list needs you to
 * sign in once (AniList's "implicit grant": the app gets a token valid for a
 * year, kept in the keychain).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SETTING IT UP (once, free): anilist.co → Settings → Developer → Create New
 * Client. Name: ReelVault. Redirect URL: reelvault://auth/anilist
 * Then put the client's ID (a number) below. The ID is public; there is no
 * secret in this flow.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { getSetting, setSetting } from '../library';
import { parseDetails, parseEntry, parseMedia, tokenFromRedirect, type AniDetails, type AniEntry, type AniMedia, type AniStatus } from './anilistLogic';

/** The AniList client id (anilist.co → Settings → Developer). Empty = not set up yet. */
export const ANILIST_CLIENT_ID = '';
const REDIRECT = 'reelvault://auth/anilist';
const API = 'https://graphql.anilist.co';
const TOKEN_KEY = 'anilist.token';
const LINKS_KEY = 'manga.anilist';

export const anilistConfigured = () => ANILIST_CLIENT_ID.trim().length > 0;

/* ------------------------------------------------------------- requests */

let last = 0;
async function gql<T = any>(query: string, variables: Record<string, unknown>, token?: string | null): Promise<T> {
  // AniList allows 90 requests a minute; one every 700 ms stays well under it.
  const wait = last + 700 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query, variables }),
      signal: ctl.signal,
    });
    const json = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 400 && /invalid token/i.test(JSON.stringify(json))) {
      await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
      throw new Error('AniList signed you out. Sign in again.');
    }
    if (res.status === 429) throw new Error('AniList is busy. Try again in a minute.');
    if (!res.ok || json?.errors?.length) throw new Error(json?.errors?.[0]?.message ?? `AniList answered ${res.status}`);
    return json.data as T;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('AniList did not answer. Check the internet connection.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const MEDIA = 'id title { romaji english native } coverImage { extraLarge large } chapters volumes status format startDate { year } averageScore countryOfOrigin siteUrl';

export async function searchAniList(q: string): Promise<AniMedia[]> {
  const data = await gql(`query ($q: String) { Page(perPage: 20) { media(search: $q, type: MANGA, sort: SEARCH_MATCH) { ${MEDIA} } } }`, { q });
  return (data?.Page?.media ?? []).map(parseMedia).filter((m: AniMedia | null): m is AniMedia => !!m);
}

export async function aniListDetails(id: number): Promise<AniDetails & { media: AniMedia | null }> {
  const data = await gql(
    `query ($id: Int) { Media(id: $id, type: MANGA) { ${MEDIA} description(asHtml: false) genres staff(perPage: 6) { edges { role node { name { full } } } } } }`,
    { id }
  );
  return { ...parseDetails(data?.Media), media: parseMedia(data?.Media) };
}

/* ----------------------------------------------------------------- account */

type Saved = { token: string; expiresAt: number; user: string | null };

async function saved(): Promise<Saved | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Saved;
    if (!s.token || s.expiresAt < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

/** Who is signed in (their AniList name), or null. */
export async function aniListUser(): Promise<string | null> {
  return (await saved())?.user ?? null;
}

/** Signs in through AniList's page; resolves with your AniList name, or null if you cancelled. */
export async function signInAniList(): Promise<string | null> {
  if (!anilistConfigured()) throw new Error('AniList is not set up in this build yet.');
  const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(ANILIST_CLIENT_ID)}&response_type=token`;
  const res = await WebBrowser.openAuthSessionAsync(url, REDIRECT);
  if (res.type !== 'success') return null;
  const got = tokenFromRedirect(res.url);
  if (!got) throw new Error('AniList did not send a sign-in back. Try again.');
  const data = await gql('query { Viewer { name } }', {}, got.token);
  const user = typeof data?.Viewer?.name === 'string' ? data.Viewer.name : null;
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify({ ...got, user } satisfies Saved));
  return user;
}

export async function signOutAniList(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
}

/* ------------------------------------------------------------- your list */

export async function aniListEntry(mediaId: number): Promise<AniEntry | null> {
  const s = await saved();
  if (!s) return null;
  const data = await gql('query ($id: Int) { Media(id: $id) { mediaListEntry { status progress score(format: POINT_10_DECIMAL) } } }', { id: mediaId }, s.token);
  return parseEntry(data?.Media?.mediaListEntry);
}

/** Puts a title's status, chapters read and score on your AniList list. False when not signed in. */
export async function saveAniListEntry(mediaId: number, e: { status: AniStatus; progress: number; scoreRaw: number }): Promise<boolean> {
  const s = await saved();
  if (!s) return false;
  await gql(
    'mutation ($m: Int, $s: MediaListStatus, $p: Int, $r: Int) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p, scoreRaw: $r) { id } }',
    { m: mediaId, s: e.status, p: e.progress, r: e.scoreRaw },
    s.token
  );
  return true;
}

/* ----------------------------------------------------------------- links */

/** Which AniList title each series is linked to (series id → AniList id). */
export async function loadAniListLinks(): Promise<Record<string, number>> {
  try {
    const v = JSON.parse((await getSetting(LINKS_KEY)) ?? '{}') as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, id] of Object.entries(v)) if (typeof id === 'number' && id > 0) out[k] = id;
    return out;
  } catch {
    return {};
  }
}

export async function saveAniListLinks(links: Record<string, number>): Promise<void> {
  await setSetting(LINKS_KEY, JSON.stringify(links));
}
