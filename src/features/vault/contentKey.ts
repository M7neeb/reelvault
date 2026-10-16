import * as Crypto from 'expo-crypto';
import { File, FileMode } from 'expo-file-system';

/** Bytes read from each end of a file. */
const SAMPLE = 1024 * 1024;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A fingerprint for duplicate detection: the size plus a SHA-256 of the first
 * and last 1 MB. Hashing whole files would take far too long for a 45 GB
 * library on a phone; for videos, size + both ends is practically unique.
 *
 * Returns null when the file can't be read - the video is then simply never
 * reported as a duplicate.
 */
export async function contentKeyOf(uri: string): Promise<string | null> {
  try {
    const file = new File(uri);
    const size = file.size;
    if (!size) return null;

    const handle = file.open(FileMode.ReadOnly);
    try {
      handle.offset = 0;
      const head = handle.readBytes(Math.min(SAMPLE, size));

      let tail = new Uint8Array(0);
      const tailStart = Math.max(head.length, size - SAMPLE);
      if (tailStart < size) {
        handle.offset = tailStart;
        tail = handle.readBytes(size - tailStart);
      }

      const sample = new Uint8Array(head.length + tail.length);
      sample.set(head, 0);
      sample.set(tail, head.length);
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, sample);
      return `${size}:${toHex(digest)}`;
    } finally {
      handle.close();
    }
  } catch (e) {
    console.log(`[DUP] could not fingerprint ${uri}: ${String(e)}`);
    return null;
  }
}
