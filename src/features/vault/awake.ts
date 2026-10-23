/**
 * Keeps the screen on while you read (the phone would dim and lock after its
 * Auto-Lock time even though you are looking at a page). Uses expo-keep-awake
 * when the app has it; does nothing otherwise, so it can never break reading.
 */

type KeepAwake = { activateKeepAwakeAsync: (tag?: string) => Promise<void>; deactivateKeepAwake: (tag?: string) => Promise<void> };

let mod: KeepAwake | null | undefined;
function load(): KeepAwake | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-keep-awake') as KeepAwake;
  } catch {
    mod = null;
  }
  return mod;
}

export function keepAwake(tag: string, on: boolean): void {
  const m = load();
  if (!m) return;
  try {
    (on ? m.activateKeepAwakeAsync(tag) : m.deactivateKeepAwake(tag)).catch(() => undefined);
  } catch {
    // The native part is missing from this build: the screen dims as usual.
  }
}
