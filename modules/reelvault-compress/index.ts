import { requireOptionalNativeModule } from 'expo';

/** Same values as `CompressQuality` in src/features/vault/smaller.ts. */
export type CompressQuality = 'same' | '1080p' | '720p' | 'small';

type ProgressEvent = { jobId: string; progress: number };

type NativeCompress = {
  supportedQualities(input: string): Promise<CompressQuality[]>;
  compress(input: string, output: string, quality: CompressQuality, jobId: string): Promise<{ size: number }>;
  cancel(jobId: string): void;
  addListener(event: 'onProgress', listener: (e: ProgressEvent) => void): { remove(): void };
};

/** null in Expo Go, on the web, and in app builds made before this module existed. */
export const ReelVaultCompress = requireOptionalNativeModule<NativeCompress>('ReelVaultCompress');
