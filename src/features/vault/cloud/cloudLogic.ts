/**
 * Cloud drives (Dropbox, OneDrive): the sign-in addresses, reading the
 * services' folder listings, and which files are videos. Pure (tested); the
 * network and the keychain are in cloud.ts.
 */

export type CloudKind = 'dropbox' | 'onedrive';

export type CloudEntry = {
  /** Dropbox: the path; OneDrive: the item id. */
  id: string;
  name: string;
  folder: boolean;
  size: number;
  modified: number | null;
  /** OneDrive gives a ready download address in the listing. */
  downloadUrl?: string | null;
};

export type CloudService = {
  kind: CloudKind;
  name: string;
  authUrl: string;
  tokenUrl: string;
  redirect: string;
  scopes: string;
};

export const CLOUD: Record<CloudKind, CloudService> = {
  dropbox: {
    kind: 'dropbox',
    name: 'Dropbox',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    redirect: 'reelvault://auth/dropbox',
    scopes: 'files.metadata.read files.content.read',
  },
  onedrive: {
    kind: 'onedrive',
    name: 'OneDrive',
    authUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    redirect: 'reelvault://auth/onedrive',
    scopes: 'Files.Read offline_access',
  },
};

/** The sign-in page (authorization code with PKCE: no secret in the app). */
export function signInUrl(kind: CloudKind, clientId: string, challenge: string, state: string): string {
  const s = CLOUD[kind];
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: s.redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  if (kind === 'dropbox') {
    q.set('token_access_type', 'offline');
    q.set('scope', s.scopes);
  } else q.set('scope', s.scopes);
  return `${s.authUrl}?${q.toString()}`;
}

/** The code from the address the service sends you back to; null when it was refused or is not ours. */
export function codeFromRedirect(url: string, state: string): string | null {
  const q = url.split('?')[1]?.split('#')[0];
  if (!q) return null;
  const p = new URLSearchParams(q);
  if (p.get('state') !== state) return null;
  return p.get('code');
}

/** Base64 to the URL-safe form PKCE uses (no padding). */
export const base64Url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type CloudTokens = { access: string; refresh: string | null; expiresAt: number };

export function parseTokens(json: unknown, now: number, keepRefresh: string | null = null): CloudTokens {
  const r = (json ?? {}) as Record<string, unknown>;
  if (typeof r.access_token !== 'string') throw new Error(typeof r.error_description === 'string' ? r.error_description : 'The sign-in did not work.');
  const secs = typeof r.expires_in === 'number' ? r.expires_in : 3600;
  return { access: r.access_token, refresh: typeof r.refresh_token === 'string' ? r.refresh_token : keepRefresh, expiresAt: now + Math.max(60, secs - 60) * 1000 };
}

const time = (v: unknown) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Dropbox `files/list_folder` → entries. */
export function parseDropboxList(json: unknown): { entries: CloudEntry[]; cursor: string | null } {
  const r = (json ?? {}) as { entries?: unknown[]; has_more?: boolean; cursor?: string };
  const entries: CloudEntry[] = [];
  for (const e of Array.isArray(r.entries) ? (r.entries as Record<string, unknown>[]) : []) {
    const tag = e['.tag'];
    if ((tag !== 'file' && tag !== 'folder') || typeof e.name !== 'string' || typeof e.path_lower !== 'string') continue;
    entries.push({
      id: typeof e.path_display === 'string' ? e.path_display : e.path_lower,
      name: e.name,
      folder: tag === 'folder',
      size: typeof e.size === 'number' ? e.size : 0,
      modified: time(e.client_modified ?? e.server_modified),
    });
  }
  return { entries, cursor: r.has_more && typeof r.cursor === 'string' ? r.cursor : null };
}

/** Microsoft Graph `children` → entries. */
export function parseGraphList(json: unknown): { entries: CloudEntry[]; next: string | null } {
  const r = (json ?? {}) as { value?: unknown[]; '@odata.nextLink'?: string };
  const entries: CloudEntry[] = [];
  for (const e of Array.isArray(r.value) ? (r.value as Record<string, unknown>[]) : []) {
    if (typeof e.id !== 'string' || typeof e.name !== 'string') continue;
    entries.push({
      id: e.id,
      name: e.name,
      folder: !!e.folder,
      size: typeof e.size === 'number' ? e.size : 0,
      modified: time(e.lastModifiedDateTime),
      downloadUrl: typeof e['@microsoft.graph.downloadUrl'] === 'string' ? (e['@microsoft.graph.downloadUrl'] as string) : null,
    });
  }
  return { entries, next: typeof r['@odata.nextLink'] === 'string' ? r['@odata.nextLink'] : null };
}

const VIDEO = /\.(mp4|m4v|mov|3gp|mkv|webm|avi|hevc|mts|m2ts|ts)$/i;
export const isCloudVideo = (name: string) => VIDEO.test(name);

/** Folders first, then videos, by name; other files left out. */
export function visibleEntries(entries: CloudEntry[]): CloudEntry[] {
  return entries
    .filter((e) => e.folder || isCloudVideo(e.name))
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}
