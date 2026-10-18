/**
 * Screen rotation. The app stays upright everywhere except the video viewer
 * and the slideshow, which turn with the phone (and the full-screen button
 * turns a landscape video sideways on its own).
 *
 * Optional like the other native parts: in builds before 1.9.1, Expo Go and
 * the browser preview every call does nothing.
 */

import { requireOptionalNativeModule } from 'expo';

type SO = typeof import('expo-screen-orientation');

const SO: SO | null = requireOptionalNativeModule('ExpoScreenOrientation') ? (require('expo-screen-orientation') as SO) : null;

/** True where the app can turn sideways. */
export const canRotate = SO != null;

const quiet = (job: Promise<void> | undefined) => job?.catch(() => undefined);

/** Turn with the phone (still respects the Control Center rotation lock). */
export function allowRotation(): void {
  if (SO) void quiet(SO.unlockAsync());
}

/** Back to upright. */
export function lockUpright(): void {
  if (SO) void quiet(SO.lockAsync(SO.OrientationLock.PORTRAIT_UP));
}

/** Sideways, whichever way the phone is held. */
export function lockSideways(): void {
  if (SO) void quiet(SO.lockAsync(SO.OrientationLock.LANDSCAPE));
}
