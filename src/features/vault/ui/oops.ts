/**
 * Something you tapped went wrong: say so, in plain words, instead of doing
 * nothing (a silent failure looks like a broken button).
 */

import { Alert } from 'react-native';

export function showFailure(e: unknown, title = 'That did not work'): void {
  const msg = String((e as Error)?.message ?? e).replace(/^Error:\s*/, '');
  // Cancelling a picker is not a failure.
  if (/cancel/i.test(msg) && msg.length < 40) return;
  Alert.alert(title, msg || 'Something went wrong. Try again.');
}
