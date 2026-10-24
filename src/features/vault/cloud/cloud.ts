/**
 * Dropbox and OneDrive: sign in (in Safari's sign-in sheet; ReelVault never
 * sees your password), browse folders and bring videos into the library. The
 * sign-in is kept in the keychain and renewed by itself. Each service needs an
 * app id made on its developer site (see CLOUD_CLIENT_IDS); without one the
 * service shows as "not set up".
 */

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { base64Url, CLOUD, codeFromRedirect, parseDropboxList, parseGraphList, parseTokens, signInUrl, visibleEntries, type CloudEntry, type CloudKind, type CloudTokens } from './cloudLogic';

/**
 * App ids, made once by the owner:
 * - Dropbox: dropbox.com/developers/apps → Create app → Scoped access, App folder or Full Dropbox;
 *   Permissions: files.metadata.read and files.content.read; Redirect URI: reelvault://auth/dropbox.
 * - OneDrive: portal.azure.com → App registrations → New, "Personal Microsoft accounts only";
 *   Authentication → Mobile and desktop applications → reelvault://auth/onedrive; API permission Files.Read.
 */
export const CLOUD_CLIENT_IDS: Record<CloudKind, string> = { dropbox: '', onedrive: '' };

export const cloudConfigured = (kind: CloudKind) => !!CLOUD_CLIENT_IDS[kind];

const keyOf = (kind: CloudKind) => `cloud.${kind}`;

async function load(kind: CloudKind): Promise<CloudTokens | null> {
  try {
    const j = await SecureStore.getItemAsync(keyOf(kind));
    return j ? (JSON.parse(j) as CloudTokens) : null;
  } catch {
    return null;
  }
}

const save = (kind: CloudKind, t: CloudTokens) => SecureStore.setItemAsync(keyOf(kind), JSON.stringify(t));

export async function cloudConnected(kind: CloudKind): Promise<boolean> {
  return !!(await load(kind));
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
function randomString(n: number): string {
  const bytes = Crypto.getRandomBytes(n);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

async function tokenRequest(kind: CloudKind, body: Record<string, string>): Promise<unknown> {
  const res = await fetch(CLOUD[kind].tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: CLOUD_CLIENT_IDS[kind], ...body }).toString(),
  });
  return res.json();
}

/** Signs in; false when you closed the sheet. */
export async function cloudSignIn(kind: CloudKind): Promise<boolean> {
  if (!cloudConfigured(kind)) throw new Error(`${CLOUD[kind].name} is not set up in this build yet.`);
  const verifier = randomString(64);
  const challenge = base64Url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const state = randomString(24);
  const res = await WebBrowser.openAuthSessionAsync(signInUrl(kind, CLOUD_CLIENT_IDS[kind], challenge, state), CLOUD[kind].redirect);
  if (res.type !== 'success') return false;
  const code = codeFromRedirect(res.url, state);
  if (!code) throw new Error(`${CLOUD[kind].name} did not send a sign-in back. Try again.`);
  const json = await tokenRequest(kind, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CLOUD[kind].redirect });
  await save(kind, parseTokens(json, Date.now()));
  return true;
}

export async function cloudSignOut(kind: CloudKind): Promise<void> {
  await SecureStore.deleteItemAsync(keyOf(kind)).catch(() => undefined);
}

/** A working access token, renewed when it is about to run out. */
async function access(kind: CloudKind): Promise<string> {
  const t = await load(kind);
  if (!t) throw new Error(`Not signed in to ${CLOUD[kind].name}.`);
  if (Date.now() < t.expiresAt) return t.access;
  if (!t.refresh) throw new Error(`Sign in to ${CLOUD[kind].name} again.`);
  const next = parseTokens(await tokenRequest(kind, { grant_type: 'refresh_token', refresh_token: t.refresh }), Date.now(), t.refresh);
  await save(kind, next);
  return next.access;
}

async function api(kind: CloudKind, url: string, init: RequestInit = {}): Promise<any> {
  const token = await access(kind);
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) await cloudSignOut(kind);
    throw new Error(`${CLOUD[kind].name} answered ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  return text ? JSON.parse(text) : null;
}

/** A folder's folders and videos. Dropbox: '' is the top; OneDrive: null is the top. */
export async function cloudList(kind: CloudKind, folder: string | null): Promise<CloudEntry[]> {
  const all: CloudEntry[] = [];
  if (kind === 'dropbox') {
    const post = (path: string, body: unknown) =>
      api(kind, `https://api.dropboxapi.com/2/files/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let page = parseDropboxList(await post('list_folder', { path: folder ?? '', limit: 2000 }));
    all.push(...page.entries);
    for (let i = 0; page.cursor && i < 10; i++) {
      page = parseDropboxList(await post('list_folder/continue', { cursor: page.cursor }));
      all.push(...page.entries);
    }
  } else {
    const base = folder ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folder)}/children` : 'https://graph.microsoft.com/v1.0/me/drive/root/children';
    let next: string | null = `${base}?$top=500&$select=id,name,size,folder,file,lastModifiedDateTime,@microsoft.graph.downloadUrl`;
    for (let i = 0; next && i < 10; i++) {
      const page = parseGraphList(await api(kind, next));
      all.push(...page.entries);
      next = page.next;
    }
  }
  return visibleEntries(all);
}

/** Downloads one video into the cache, ready to import. */
export async function cloudDownload(kind: CloudKind, e: CloudEntry): Promise<{ uri: string; name: string; size?: number }> {
  let url = e.downloadUrl ?? null;
  if (kind === 'dropbox') {
    const r = await api(kind, 'https://api.dropboxapi.com/2/files/get_temporary_link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: e.id }),
    });
    url = typeof r?.link === 'string' ? r.link : null;
  } else if (!url) {
    const r = await api(kind, `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(e.id)}?$select=id,@microsoft.graph.downloadUrl`);
    url = r?.['@microsoft.graph.downloadUrl'] ?? null;
  }
  if (!url) throw new Error(`${CLOUD[kind].name} gave no download for ${e.name}`);
  const dir = new Directory(Paths.cache, `cloud-${Date.now()}`);
  dir.create({ intermediates: true });
  const target = new File(dir, e.name.replace(/[\\/:*?"<>|]+/g, '_'));
  await File.downloadFileAsync(url, target);
  return { uri: target.uri, name: e.name, size: target.size ?? undefined };
}
