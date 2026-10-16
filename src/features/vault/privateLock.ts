import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Unlock the Private album: Face ID, falling back to the phone's passcode.
 *
 * Expo Go has no Face ID permission text, so there it always asks for the
 * passcode instead; the installed app uses Face ID.
 */
export async function unlockWithFaceId(): Promise<{ ok: boolean; message?: string }> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      return {
        ok: false,
        message: 'Set up Face ID or a passcode in the iPhone Settings first. Without one, Private cannot be locked.',
      };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Private videos',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
    });
    if (result.success) return { ok: true };

    switch (result.error) {
      case 'user_cancel':
      case 'system_cancel':
      case 'app_cancel':
        return { ok: false };
      case 'lockout':
        return { ok: false, message: 'Face ID is locked after too many tries. Unlock the iPhone with its passcode, then try again.' };
      case 'passcode_not_set':
      case 'not_enrolled':
        return { ok: false, message: 'Set up Face ID or a passcode in the iPhone Settings first.' };
      default:
        console.log(`[PRIVATE] unlock failed: ${result.error}`);
        return { ok: false, message: 'That did not work. Try again.' };
    }
  } catch (e) {
    console.log(`[PRIVATE] unlock error: ${String(e)}`);
    return { ok: false, message: 'Face ID is not available right now.' };
  }
}
