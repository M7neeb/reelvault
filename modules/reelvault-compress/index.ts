import { requireOptionalNativeModule } from 'expo';

/** Same values as `CompressQuality` in src/features/vault/smaller.ts. */
export type CompressQuality = 'same' | '1080p' | '720p' | 'small';

/** Mirrors EditOptions in ReelVaultCompressModule.swift. Crop is in fractions of the shown frame. */
export type EditOptions = {
  startMs: number;
  endMs: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  maxShortSide: number;
  fps: number;
  passthrough: boolean;
  /** Keep this share of the source's video bitrate (0 = automatic). */
  bitrateShare: number;
};

type ProgressEvent = { jobId: string; progress: number };

type NativeCompress = {
  supportedQualities(input: string): Promise<CompressQuality[]>;
  compress(input: string, output: string, quality: CompressQuality, jobId: string): Promise<{ size: number }>;
  edit(input: string, output: string, options: EditOptions, jobId: string): Promise<{ size: number }>;
  cancel(jobId: string): void;
  /** Missing in app builds before 18. */
  features?: () => string[];
  addListener(event: 'onProgress', listener: (e: ProgressEvent) => void): { remove(): void };
};

/** null in Expo Go, on the web, and in app builds made before this module existed. */
export const ReelVaultCompress = requireOptionalNativeModule<NativeCompress>('ReelVaultCompress');
