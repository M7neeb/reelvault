/**
 * The app passcode for the Private album, HashPhotos-style: 4 digits, 6 digits,
 * a longer number or letters and numbers, Face ID on top, and an optional fake
 * passcode that opens an empty decoy instead of the real Private album.
 *
 * Only a salted SHA-256 of each code is stored, in the iOS keychain
 * (expo-secure-store), never in the database or in a backup.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export type PasscodeKind = '4' | '6' | 'numeric' | 'alphanumeric';

export type SecurityState = {
  /** null = no passcode: Private is unlocked with Face ID / the phone's passcode. */
  passcodeKind: PasscodeKind | null;
  /** Offer Face ID before asking for the passcode. */
  faceId: boolean;
  hasFakePasscode: boolean;
};

export type PasscodeCheck = 'real' | 'fake' | 'wrong';

const KEY_REAL = 'reelvault.passcode';
const KEY_FAKE = 'reelvault.passcode.fake';
const KEY_FACE_ID = 'reelvault.faceid';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type Stored = { kind: PasscodeKind; salt: string; hash: string };

async function hashCode(salt: string, code: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${code}`);
}

async function readStored(key: string): Promise<Stored | null> {
  const json = await SecureStore.getItemAsync(key, OPTIONS);
  if (!json) return null;
  try {
    return JSON.parse(json) as Stored;
  } catch {
    return null;
  }
}

async function store(key: string, kind: PasscodeKind, code: string): Promise<void> {
  const salt = Crypto.randomUUID();
  const value: Stored = { kind, salt, hash: await hashCode(salt, code) };
  await SecureStore.setItemAsync(key, JSON.stringify(value), OPTIONS);
}

export async function getSecurityState(): Promise<SecurityState> {
  const [real, fake, faceId] = await Promise.all([
    readStored(KEY_REAL),
    readStored(KEY_FAKE),
    SecureStore.getItemAsync(KEY_FACE_ID, OPTIONS),
  ]);
  return { passcodeKind: real?.kind ?? null, faceId: faceId !== '0', hasFakePasscode: !!fake };
}

/** Sets (or replaces) the passcode. A fake passcode equal to it is removed. */
export async function setPasscode(kind: PasscodeKind, code: string): Promise<void> {
  await store(KEY_REAL, kind, code);
  const fake = await readStored(KEY_FAKE);
  if (fake && fake.hash === (await hashCode(fake.salt, code))) await SecureStore.deleteItemAsync(KEY_FAKE, OPTIONS);
}

/** Turning the passcode off also removes the fake one. */
export async function clearPasscode(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_REAL, OPTIONS);
  await SecureStore.deleteItemAsync(KEY_FAKE, OPTIONS);
}

export async function setFakePasscode(code: string | null): Promise<void> {
  if (code === null) {
    await SecureStore.deleteItemAsync(KEY_FAKE, OPTIONS);
    return;
  }
  const real = await readStored(KEY_REAL);
  if (!real) throw new Error('Set a passcode first');
  await store(KEY_FAKE, real.kind, code);
}

export async function setFaceIdEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY_FACE_ID, enabled ? '1' : '0', OPTIONS);
}

export async function checkPasscode(code: string): Promise<PasscodeCheck> {
  const real = await readStored(KEY_REAL);
  if (real && real.hash === (await hashCode(real.salt, code))) return 'real';
  const fake = await readStored(KEY_FAKE);
  if (fake && fake.hash === (await hashCode(fake.salt, code))) return 'fake';
  return 'wrong';
}
