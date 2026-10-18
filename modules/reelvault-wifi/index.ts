import { requireOptionalNativeModule } from 'expo';

export type WifiFileEvent = { id: string; name: string; received?: number; total?: number; path?: string; reason?: string };

type NativeWifi = {
  /** Starts the server; `url` is empty when the phone has no Wi-Fi address. */
  start(code: string): Promise<{ url: string }>;
  stop(): void;
  addListener(event: 'onFileStart' | 'onFileProgress' | 'onFileDone' | 'onFileError', listener: (e: WifiFileEvent) => void): { remove(): void };
};

/** null in Expo Go, on the web, and in app builds made before this module existed (before 1.9). */
export const ReelVaultWifi = requireOptionalNativeModule<NativeWifi>('ReelVaultWifi');
