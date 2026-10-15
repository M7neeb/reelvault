import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as VideoThumbnails from 'expo-video-thumbnails';

export type ProbeResult = {
  name: string;
  ok: boolean;
  detail: string;
};

/**
 * Every result is mirrored to the Metro/Expo dev-server log, so the results are
 * visible in the terminal as well as on the phone. Search the log for "[PROBE]".
 */
function report(r: ProbeResult): ProbeResult {
  console.log(`[PROBE] ${r.ok ? 'PASS' : 'FAIL'} | ${r.name} | ${r.detail}`);
  return r;
}

/**
 * Question 1: can expo-sqlite create an FTS5 virtual table and MATCH against it?
 * If this fails, ReelVault v1 search uses indexed LIKE instead of FTS.
 */
export async function testSqliteFts5(): Promise<ProbeResult> {
  try {
    const db = await SQLite.openDatabaseAsync('probe.db');
    await db.execAsync(`CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(body);`);
    await db.runAsync(`INSERT INTO probe_fts (body) VALUES (?);`, 'hello reelvault');
    const row = await db.getFirstAsync<{ body: string }>(
      `SELECT body FROM probe_fts WHERE probe_fts MATCH 'reelvault' LIMIT 1;`
    );
    await db.execAsync(`DROP TABLE IF EXISTS probe_fts;`);
    return report({
      name: 'SQLite + FTS5',
      ok: !!row,
      detail: row ? `MATCH returned "${row.body}"` : 'table made, MATCH returned nothing',
    });
  } catch (e) {
    return report({
      name: 'SQLite + FTS5',
      ok: false,
      detail: `unavailable (${errMsg(e)}) → use LIKE fallback`,
    });
  }
}

/**
 * Question 2: does expo-crypto produce a SHA-256 digest on-device?
 */
export async function testCrypto(): Promise<ProbeResult> {
  try {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      'reelvault'
    );
    return report({
      name: 'expo-crypto SHA-256',
      ok: digest.length === 64,
      detail: `${digest.slice(0, 24)}…`,
    });
  } catch (e) {
    return report({ name: 'expo-crypto SHA-256', ok: false, detail: errMsg(e) });
  }
}

/**
 * Question 3: can we generate a thumbnail from a real video file?
 */
export async function testThumbnail(uri: string): Promise<ProbeResult> {
  try {
    const { uri: thumbUri, width, height } = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 1000,
    });
    return report({
      name: 'Video thumbnail',
      ok: true,
      detail: `${width}×${height} → ${thumbUri.split('/').pop()}`,
    });
  } catch (e) {
    return report({ name: 'Video thumbnail', ok: false, detail: errMsg(e) });
  }
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
