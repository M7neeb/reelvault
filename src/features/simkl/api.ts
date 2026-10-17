/**
 * Every call to api.simkl.com goes through here: the three required URL
 * parameters and the User-Agent, the user token (refreshed on a 401, once),
 * one request at a time, writes at most once a second, and backoff on
 * 429 / 5xx (doubling, max 60 s, 5 tries). See api.simkl.org → API rules.
 */

import Constants from 'expo-constants';

import { getFreshSimklTokens, loadSimklTokens, refreshSimklTokens } from './auth';
import { SIMKL_API, SIMKL_CLIENT_ID, SIMKL_USER_AGENT } from './config';
import { backoffMs } from './logic';

const APP_NAME = 'reelvault';
const APP_VERSION = Constants.expoConfig?.version ?? '1.0';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SimklError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** One request at a time, in order. */
let chain: Promise<unknown> = Promise.resolve();
let lastWriteAt = 0;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

function withParams(url: string, query?: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams({ client_id: SIMKL_CLIENT_ID, 'app-name': APP_NAME, 'app-version': APP_VERSION });
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) params.set(k, String(v));
  return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
}

type Options = {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Send the user token (sync endpoints). Catalog endpoints must leave it off. */
  auth?: boolean;
  /** A full URL instead of a path on api.simkl.com (the data.simkl.in CDN files). */
  absolute?: boolean;
};

async function send(path: string, opts: Options, token: string | null): Promise<Response> {
  const url = withParams(opts.absolute ? path : `${SIMKL_API}${path}`, opts.query);
  const headers: Record<string, string> = { 'User-Agent': SIMKL_USER_AGENT, Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export function simklRequest<T = any>(path: string, opts: Options = {}): Promise<T> {
  return enqueue(async () => {
    if (!SIMKL_CLIENT_ID) throw new SimklError('Simkl is not set up in this build yet (no client id).', 0);
    if (opts.method === 'POST') {
      const wait = lastWriteAt + 1100 - Date.now();
      if (wait > 0) await sleep(wait);
    }

    let token = opts.auth ? ((await getFreshSimklTokens())?.access_token ?? null) : null;
    if (opts.auth && !token) throw new SimklError('Not signed in to Simkl.', 401);

    let refreshed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await send(path, opts, token);
      if (opts.method === 'POST') lastWriteAt = Date.now();

      if (res.status === 401 && opts.auth && !refreshed) {
        // Expired early or revoked: refresh once, then retry once.
        refreshed = true;
        const stored = await loadSimklTokens();
        if (!stored) throw new SimklError('Not signed in to Simkl.', 401);
        try {
          token = (await refreshSimklTokens(stored)).access_token;
        } catch {
          throw new SimklError('Simkl sign-in has expired. Sign in again in Settings.', 401);
        }
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        await sleep(backoffMs(attempt, res.headers.get('Retry-After')));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        let message = `Simkl answered ${res.status}`;
        try {
          const j = JSON.parse(text);
          message = j.message || j.error_description || j.error || message;
        } catch {
          // keep the status line
        }
        throw new SimklError(message, res.status);
      }
      if (!text) return null as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new SimklError('Simkl sent something that is not JSON.', res.status);
      }
    }
    throw new SimklError('Simkl is busy right now - try again in a minute.', 429);
  });
}
