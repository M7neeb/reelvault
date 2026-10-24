import { requireOptionalNativeModule } from 'expo';

export type FrameResult = { width: number; height: number; videoWidth: number; videoHeight: number; size: number };

type NativeMedia = {
  /** One frame of a video as a JPEG at most `maxSide` pixels on its long side. */
  frame(input: string, timeMs: number, output: string, maxSide: number, quality: number): Promise<FrameResult>;
  /** Re-saves a picture smaller; its size afterwards, or -1 when it isn't one. */
  shrinkImage(path: string, maxSide: number, quality: number): Promise<number>;
  dirSize(path: string): Promise<number>;
  /** What sits directly in a folder. */
  entries(path: string): Promise<{ name: string; modified: number; bytes: number; dir: boolean }[]>;
  /** Removes what sits directly in a folder older than `olderThanSec`, except `keep`. Bytes freed. */
  clearOld(path: string, olderThanSec: number, keep: string[]): Promise<number>;
  /** A picture's most vivid colour and its average, as "#rrggbb" (empty strings when it can't be read). */
  colors(path: string): Promise<{ dominant: string; average: string }>;
  /** A page's plain borders (fractions of its size) and its edge colour; missing before app build 17. */
  pageMargins?(path: string): Promise<{ top: number; left: number; bottom: number; right: number; edge: string }>;
  /** Every page of a PDF as 0001.jpg, 0002.jpg... in `outDir`; the page count. Missing before app 1.11. */
  pdfPages?(input: string, outDir: string, maxSide: number, quality: number): Promise<number>;
};

/** null in Expo Go, on the web, and in app builds made before this module existed (before 1.9.2). */
export const ReelVaultMedia = requireOptionalNativeModule<NativeMedia>('ReelVaultMedia');
