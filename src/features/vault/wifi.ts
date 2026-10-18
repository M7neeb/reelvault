/**
 * Wi-Fi transfer (JavaScript half): starts the phone's upload server with a
 * fresh 4-digit code, and imports each video as soon as it has arrived, one
 * at a time (so free space is only needed for one video at a time). The
 * server lives in modules/reelvault-wifi and is only there in app 1.9+.
 */

import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { ReelVaultWifi } from '../../../modules/reelvault-wifi';
import type { ImportSummary } from './import';
import type { WifiBridge, WifiEvent } from './ui/types';

const VIDEO = /\.(mp4|mov|m4v|3gp|avi|mkv|webm|mts|m2ts|hevc)$/i;

/** Strips the server's "<uuid>-" prefix so the video keeps its own name. */
const ownName = (name: string) => name.replace(/^[0-9A-F-]{36}-/i, '');

export function wifiBridge(importFiles: (files: { uri: string; name: string; size: number }[]) => Promise<ImportSummary | undefined>): WifiBridge | null {
  const wifi = ReelVaultWifi;
  if (!wifi) return null;
  let subs: { remove(): void }[] = [];
  let chain: Promise<void> = Promise.resolve();
  return {
    start: async (onEvent: (e: WifiEvent) => void) => {
      subs.forEach((s) => s.remove());
      const code = String(Crypto.getRandomBytes(2).reduce((a, b) => a * 256 + b, 0) % 10000).padStart(4, '0');
      subs = [
        wifi.addListener('onFileStart', (e) => onEvent({ kind: 'receiving', name: ownName(e.name), received: 0, total: e.total ?? 0 })),
        wifi.addListener('onFileProgress', (e) => onEvent({ kind: 'receiving', name: ownName(e.name), received: e.received ?? 0, total: e.total ?? 0 })),
        wifi.addListener('onFileError', (e) => onEvent({ kind: 'failed', name: ownName(e.name), reason: e.reason ?? 'Upload stopped' })),
        wifi.addListener('onFileDone', (e) => {
          const name = ownName(e.name);
          const uri = e.path ?? '';
          // One import at a time, in the order they arrive.
          chain = chain.then(async () => {
            if (!VIDEO.test(name)) {
              try {
                new File(uri).delete();
              } catch {
                // already gone
              }
              onEvent({ kind: 'failed', name, reason: 'Not a video file' });
              return;
            }
            try {
              const summary = await importFiles([{ uri, name, size: e.total ?? 0 }]);
              if (summary && summary.duplicates.length) onEvent({ kind: 'duplicate', name });
              else if (summary && summary.failed.length) onEvent({ kind: 'failed', name, reason: 'Could not be imported' });
              else onEvent({ kind: 'imported', name });
            } catch (err) {
              onEvent({ kind: 'failed', name, reason: String(err) });
            }
          });
        }),
      ];
      const { url } = await wifi.start(code);
      return { url: url || null, code };
    },
    stop: async () => {
      wifi.stop();
      subs.forEach((s) => s.remove());
      subs = [];
    },
  };
}
