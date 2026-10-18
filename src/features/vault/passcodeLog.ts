/**
 * Every wrong passcode typed at the Private album, and every time the fake
 * passcode was used, with the time - so you can see if someone tried.
 * Kept in the settings table, newest first, at most 200.
 */

import { getSetting, setSetting } from './library';

const KEY = 'vault.passcodeLog';

export type PasscodeAttempt = { at: number; kind: 'wrong' | 'fake' | 'faceid-failed' };

export async function passcodeLog(): Promise<PasscodeAttempt[]> {
  try {
    const v = JSON.parse((await getSetting(KEY)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x?.at === 'number' && typeof x?.kind === 'string') : [];
  } catch {
    return [];
  }
}

export async function logPasscodeAttempt(kind: PasscodeAttempt['kind']): Promise<void> {
  const list = await passcodeLog();
  await setSetting(KEY, JSON.stringify([{ at: Date.now(), kind }, ...list].slice(0, 200)));
}

export async function clearPasscodeLog(): Promise<void> {
  await setSetting(KEY, '[]');
}
