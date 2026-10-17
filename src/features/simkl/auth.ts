/**
 * Simkl AUTH V2 - Device / PIN flow (RFC 8628).
 *
 * Chosen because it needs **no redirect URI**, so it works inside Expo Go where
 * a custom URL scheme cannot be handed back to the app. The user sees an
 * 8-character code, approves it on their phone, and we poll until it lands.
 *
 * Docs: https://api.simkl.org/api-reference/oauth2-device
 *
 * THREE THINGS THAT BIT PEOPLE HERE (all from the docs, all handled below):
 *
 *  1. THERE IS NO DENY SIGNAL. If the user taps "no", Simkl records nothing and
 *     we keep receiving `authorization_pending` forever - identical to them
 *     walking away. Our own deadline is the ONLY thing that ends the loop.
 *
 *  2. `slow_down` RESETS THE POLL WINDOW with the very attempt that was rejected
 *     for being too fast. Retrying immediately re-arms it, so a naive client can
 *     lock itself out until the code dies while polling furiously. Back off
 *     FIRST, then poll.
 *
 *  3. The refresh token lasts 180 days, sliding: each refresh pushes it out again.
 *     It does not rotate (the same one comes back), but refreshing replaces the
 *     access token on the grant, so only one place in the app may refresh -
 *     api.ts and getFreshSimklTokens() below, never anything else.
 */

import * as SecureStore from 'expo-secure-store';
import { SIMKL_API, SIMKL_CLIENT_ID, SIMKL_SCOPE, SIMKL_USER_AGENT } from './config';
import type { SimklDeviceStart, SimklTokens } from './types';

const TOKENS_KEY = 'simkl.tokens.v2';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function encodeForm(body: Record<string, string>): string {
  return Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

type FormResponse = { status: number; json: Record<string, any> };

async function postForm(path: string, body: Record<string, string>): Promise<FormResponse> {
  const res = await fetch(`${SIMKL_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': SIMKL_USER_AGENT,
    },
    body: encodeForm(body),
  });
  const text = await res.text();
  let json: Record<string, any> = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // Error bodies are not always JSON. Keep the status; stash the text.
      json = { raw: text };
    }
  }
  return { status: res.status, json };
}

function requireClientId() {
  if (!SIMKL_CLIENT_ID.trim()) {
    throw new Error(
      'SIMKL_CLIENT_ID is empty. Register an app at https://simkl.com/settings/developer/ ' +
        '(type: "Mobile, desktop & browser apps") and set it in src/features/simkl/config.ts.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 - ask for a device code
// ─────────────────────────────────────────────────────────────────────────────

export async function startSimklDeviceFlow(): Promise<SimklDeviceStart> {
  requireClientId();
  const { status, json } = await postForm('/oauth2/device', {
    client_id: SIMKL_CLIENT_ID,
    scope: SIMKL_SCOPE,
  });

  if (status !== 200 || typeof json.user_code !== 'string') {
    throw new Error(`Simkl /oauth2/device failed (${status}): ${JSON.stringify(json)}`);
  }

  const start = json as SimklDeviceStart;
  console.log('[SIMKL] device code issued', {
    user_code: start.user_code,
    interval: start.interval,
    expires_in: start.expires_in,
  });
  return start;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 - poll for approval (one attempt; the caller owns the loop)
// ─────────────────────────────────────────────────────────────────────────────

export type SimklPollResult =
  | { status: 'approved'; tokens: SimklTokens }
  | { status: 'pending' }
  /** Caller must ADD 5s to its interval before the next attempt (rule 2 above). */
  | { status: 'slow_down' }
  | { status: 'expired' }
  | { status: 'error'; message: string };

export async function pollSimklDevice(deviceCode: string): Promise<SimklPollResult> {
  const { status, json } = await postForm('/oauth2/token', {
    grant_type: DEVICE_GRANT,
    client_id: SIMKL_CLIENT_ID,
    device_code: deviceCode,
  });

  if (status === 200 && typeof json.access_token === 'string') {
    const tokens: SimklTokens = { ...(json as Omit<SimklTokens, 'obtained_at'>), obtained_at: Date.now() };
    await saveSimklTokens(tokens);
    if (tokens.scope && !tokens.scope.includes('media:write')) {
      console.warn(
        '[SIMKL] token came back read-only (scope: ' +
          tokens.scope +
          '). An unrecognised scope string is silently downgraded, so check SIMKL_SCOPE for a typo.',
      );
    }
    return { status: 'approved', tokens };
  }

  // 401 = registration problem. Retrying cannot help; stop and say so.
  if (status === 401 || json.error === 'invalid_client') {
    return {
      status: 'error',
      message:
        'invalid_client - Simkl does not recognise this client_id, or it is an AUTH V1 app ' +
        '(V1 credentials are rejected on the /oauth2/* endpoints). Fix the registration; ' +
        'retrying cannot help.',
    };
  }
  if (json.error === 'authorization_pending') return { status: 'pending' };
  if (json.error === 'slow_down') return { status: 'slow_down' };
  if (json.error === 'expired_token') return { status: 'expired' };

  return { status: 'error', message: `Unexpected response (${status}): ${JSON.stringify(json)}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// The whole flow, driven for you
// ─────────────────────────────────────────────────────────────────────────────

export type SimklDeviceFlowHandle = {
  /** Show this to the user - a QR of `verification_uri_complete`, or the code. */
  start: SimklDeviceStart;
};

/**
 * Run the flow end to end. `onCode` fires as soon as there is something to show,
 * so the UI can render the code/QR while polling continues underneath.
 *
 * @param onCode  called once with the code + URLs to display
 * @param timeoutMs  your own deadline. Defaults to the code's own `expires_in`.
 */
export async function runSimklDeviceFlow(
  onCode: (start: SimklDeviceStart) => void,
  timeoutMs?: number,
): Promise<SimklTokens> {
  const start = await startSimklDeviceFlow();
  onCode(start);

  // `interval` is in seconds, and Simkl asks for 5 by default.
  let intervalMs = Math.max(1, start.interval || 5) * 1000;
  const hardDeadline = Date.now() + Math.min(timeoutMs ?? Infinity, (start.expires_in || 900) * 1000);

  // Rule 1: there is no deny signal, so this deadline is the only exit.
  while (Date.now() < hardDeadline) {
    await sleep(intervalMs);
    const result = await pollSimklDevice(start.device_code);

    if (result.status === 'approved') {
      console.log('[SIMKL] connected');
      return result.tokens;
    }
    if (result.status === 'slow_down') {
      // Rule 2: back off first, then poll. Never retry immediately.
      intervalMs += 5000;
      console.warn('[SIMKL] slow_down - interval is now ' + intervalMs / 1000 + 's');
      continue;
    }
    if (result.status === 'expired') break;
    if (result.status === 'error') throw new Error(result.message);
    // 'pending' - keep waiting at the same interval.
  }

  throw new Error('Simkl code expired before it was approved. Start the flow again.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Token storage (expo-secure-store - never the DB, never git)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveSimklTokens(tokens: SimklTokens): Promise<void> {
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
}

export async function loadSimklTokens(): Promise<SimklTokens | null> {
  const raw = await SecureStore.getItemAsync(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SimklTokens;
  } catch {
    return null;
  }
}

export async function clearSimklTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKENS_KEY);
}

/** Sign out: tell Simkl to end the grant (always answers 200), then forget the tokens. */
export async function revokeSimklTokens(): Promise<void> {
  const tokens = await loadSimklTokens();
  if (tokens) {
    try {
      await postForm('/oauth2/revoke', { client_id: SIMKL_CLIENT_ID, token: tokens.refresh_token });
    } catch (e) {
      console.log(`[SIMKL] revoke failed (ignored): ${String(e)}`);
    }
  }
  await clearSimklTokens();
}

export const isSimklConnected = async (): Promise<boolean> => (await loadSimklTokens()) !== null;

// ─────────────────────────────────────────────────────────────────────────────
// Refresh
// ─────────────────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
/** Refresh a day early rather than racing the 7-day wall mid-request. */
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

export const accessTokenAgeMs = (t: SimklTokens) => Date.now() - t.obtained_at;
export const accessTokenIsStale = (t: SimklTokens) =>
  accessTokenAgeMs(t) > ACCESS_TOKEN_MS - REFRESH_MARGIN_MS;

/**
 * Exchange the refresh token for a new pair.
 *
 * Rule 3: the old access token stops working at once. We save the new pair
 * before returning; the refresh token normally comes back unchanged, and we
 * keep the old one if the response leaves it out.
 */
export async function refreshSimklTokens(tokens: SimklTokens): Promise<SimklTokens> {
  const { status, json } = await postForm('/oauth2/token', {
    grant_type: 'refresh_token',
    client_id: SIMKL_CLIENT_ID,
    refresh_token: tokens.refresh_token,
  });

  if (status !== 200 || typeof json.access_token !== 'string') {
    throw new Error(`Simkl refresh failed (${status}): ${JSON.stringify(json)}`);
  }

  const next: SimklTokens = {
    ...(json as Omit<SimklTokens, 'obtained_at'>),
    refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : tokens.refresh_token,
    obtained_at: Date.now(),
  };
  await saveSimklTokens(next);
  console.log('[SIMKL] tokens refreshed');
  return next;
}

/** Use this everywhere instead of loadSimklTokens() when you need to call the API. */
export async function getFreshSimklTokens(): Promise<SimklTokens | null> {
  const stored = await loadSimklTokens();
  if (!stored) return null;
  if (!accessTokenIsStale(stored)) return stored;
  try {
    return await refreshSimklTokens(stored);
  } catch (err) {
    console.warn('[SIMKL] refresh failed, falling back to the stored token:', err);
    return stored;
  }
}
