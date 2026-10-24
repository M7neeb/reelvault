/**
 * Share a card as a picture (Wrapped, recaps). Uses the picture-capture module
 * from app build 17 on; in older builds and the browser preview it shares the
 * text instead, so the button always does something.
 */

import { NativeModules, Share, TurboModuleRegistry, type View } from 'react-native';

type ViewShot = typeof import('react-native-view-shot');

function load(): ViewShot | null {
  try {
    const present = TurboModuleRegistry.get('RNViewShot') != null || NativeModules.RNViewShot != null;
    return present ? (require('react-native-view-shot') as ViewShot) : null;
  } catch {
    return null;
  }
}

const shot = load();

/** True where a card can be shared as a picture. */
export const canSnap = shot != null;

/** The view as a PNG through the share sheet; the text when pictures are not possible (or fail). */
export async function shareSnap(view: View | null, fallbackText: string): Promise<void> {
  if (shot && view) {
    try {
      const uri = await shot.captureRef(view, { format: 'png', quality: 1, result: 'tmpfile' });
      await Share.share({ url: uri });
      return;
    } catch {
      // fall back to the text
    }
  }
  await Share.share({ message: fallbackText });
}
