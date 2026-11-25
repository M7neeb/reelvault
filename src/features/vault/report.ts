import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';

import { appLog, reportText } from './errorLog';
import { shareFile } from './share';

/** "Report a problem": what you wrote, the app and phone facts and the recent log, as a text file to send. */
export async function reportProblem(note: string, extra: Record<string, string> = {}): Promise<void> {
  const at = Date.now();
  const facts: Record<string, string> = {
    App: `${Constants.expoConfig?.version ?? '?'} (runtime ${Updates.runtimeVersion ?? '?'})`,
    Update: Updates.updateId ? `${Updates.updateId}${Updates.createdAt ? ` from ${Updates.createdAt.toISOString().slice(0, 16)}` : ''}` : 'the one built in',
    Phone: `${Device.modelName ?? '?'} on iOS ${Device.osVersion ?? '?'}`,
    ...extra,
  };
  const file = new File(Paths.cache, `ReelVault report ${new Date(at).toISOString().slice(0, 16).replace(':', '-')}.txt`);
  if (file.exists) file.delete();
  file.create();
  file.write(reportText({ note, facts, lines: appLog.lines(), at }));
  await shareFile(file.uri);
}
