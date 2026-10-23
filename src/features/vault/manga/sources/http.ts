/**
 * The network for sources: a time limit on every request, requests to the
 * same site spaced out (sites like MangaDex limit how fast you may ask), and
 * clear errors ("the server answered 404") instead of a bare failure.
 */

import type { Http, HttpInit } from './types';

const SPACING_MS = 250;
const TIMEOUT_MS = 25_000;
const UA = 'ReelVault/1.10 (iPhone; manga reader)';

const lastAt = new Map<string, number>();
const hostOf = (url: string) => url.match(/^[a-z]+:\/\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? '';

async function space(host: string): Promise<void> {
  const now = Date.now();
  const next = Math.max(now, (lastAt.get(host) ?? 0) + SPACING_MS);
  lastAt.set(host, next);
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}

async function request(url: string, init: HttpInit | undefined, accept: string): Promise<Response> {
  if (!/^https?:\/\//i.test(url)) throw new Error(`Not a web address: ${url.slice(0, 60)}`);
  await space(hostOf(url));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: { 'User-Agent': UA, Accept: accept, ...(init?.headers ?? {}) },
      body: init?.body,
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) throw new Error(`${hostOf(url)} refused the request (${res.status}). Check the user name and password.`);
    if (res.status === 429) throw new Error(`${hostOf(url)} asks to slow down. Try again in a minute.`);
    if (!res.ok) throw new Error(`${hostOf(url)} answered ${res.status}`);
    return res;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error(`${hostOf(url)} took too long to answer`);
    if (/network request failed|failed to fetch|load failed/i.test(String(e))) throw new Error(`Could not reach ${hostOf(url)}. Check the address and that it is on.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const sourceHttp: Http = {
  json: async (url, init) => {
    const res = await request(url, init, 'application/json');
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${hostOf(url)} did not answer with data (is the address right?)`);
    }
  },
  text: async (url, init) => (await request(url, init, '*/*')).text(),
};
