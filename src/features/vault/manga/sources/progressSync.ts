/**
 * Telling your own servers how far you read, so Suwayomi, Komga and Kavita
 * show the same progress as ReelVault. Pure: works out where a chapter lives
 * and what to send; the sending is in mangaSources.ts.
 *
 * - Suwayomi: the chapter's id on the server (its GraphQL updateChapter).
 * - Komga (through OPDS): the book id in its page-streaming address; its
 *   read-progress endpoint takes the page (from 1) and "completed".
 * - Kavita (through OPDS): the address carries the OPDS key and the
 *   library, series, volume and chapter ids; progress goes to its reader API
 *   after signing in with that key.
 */

export type ProgressTarget =
  | { kind: 'suwayomi'; serverId: string; chapterId: number }
  | { kind: 'komga'; serverId: string; url: string }
  | { kind: 'kavita'; serverId: string; base: string; apiKey: string; libraryId: number; seriesId: number; volumeId: number; chapterId: number };

/** The page-streaming address inside an OPDS chapter key ("pse:{href,count}"). */
function pseHref(chapterKey: string): string | null {
  if (!chapterKey.startsWith('pse:')) return null;
  try {
    const p = JSON.parse(chapterKey.slice(4)) as { href?: unknown };
    return typeof p.href === 'string' ? p.href : null;
  } catch {
    return null;
  }
}

const int = (v: string | null): number | null => {
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** Where a chapter's progress can go, or null (MangaDex, extensions, plain files). */
export function progressTarget(sourceId: string | null, chapterKey: string | null): ProgressTarget | null {
  if (!sourceId || !chapterKey) return null;
  const m = sourceId.match(/^server:([^:]+)/);
  if (!m) return null;
  const serverId = m[1];
  if (/^\d+$/.test(chapterKey)) return { kind: 'suwayomi', serverId, chapterId: Number(chapterKey) };
  const href = pseHref(chapterKey);
  if (!href) return null;
  const komga = href.match(/^(https?:\/\/.+?\/api\/v1\/books\/[^/?#]+)\/pages\//i);
  if (komga) return { kind: 'komga', serverId, url: `${komga[1]}/read-progress` };
  const kavita = href.match(/^(https?:\/\/.+?)\/api\/opds\/([^/?#]+)\/image\?(.*)$/i);
  if (kavita) {
    const q = new URLSearchParams(kavita[3].replace(/\{[^}]*\}/g, '0'));
    const ids = ['libraryId', 'seriesId', 'volumeId', 'chapterId'].map((k) => int(q.get(k)));
    if (ids.some((x) => x === null)) return null;
    const [libraryId, seriesId, volumeId, chapterId] = ids as number[];
    return { kind: 'kavita', serverId, base: kavita[1], apiKey: decodeURIComponent(kavita[2]), libraryId, seriesId, volumeId, chapterId };
  }
  return null;
}

/** Suwayomi's mutation: read when finished, and the last page seen (from 0). */
export function suwayomiProgress(chapterId: number, page: number, finished: boolean): { query: string; variables: Record<string, unknown> } {
  return {
    query: 'mutation($id: Int!, $read: Boolean!, $page: Int!) { updateChapter(input: { id: $id, patch: { isRead: $read, lastPageRead: $page } }) { chapter { id } } }',
    variables: { id: chapterId, read: finished, page: Math.max(0, Math.round(page)) },
  };
}

/** Komga's body: the page counts from 1. */
export function komgaProgress(page: number, finished: boolean): string {
  return JSON.stringify(finished ? { completed: true } : { page: Math.max(1, Math.round(page) + 1), completed: false });
}

/** Kavita's body for /api/reader/progress: the page counts from 0; a finished chapter is past its last page. */
export function kavitaProgress(t: Extract<ProgressTarget, { kind: 'kavita' }>, page: number, pageCount: number | null, finished: boolean): string {
  const pageNum = finished && pageCount ? pageCount : Math.max(0, Math.round(page));
  return JSON.stringify({ libraryId: t.libraryId, seriesId: t.seriesId, volumeId: t.volumeId, chapterId: t.chapterId, pageNum });
}
