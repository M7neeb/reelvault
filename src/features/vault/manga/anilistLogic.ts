/**
 * AniList tracking: how a ReelVault title maps to an AniList list entry
 * (status, chapters read, score), and the shapes AniList sends back.
 * Pure: no network, no React (tested in tests/anilist.test.mjs).
 */

import type { MangaStatus } from './mangaLogic.ts';

export type AniStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING';

export type AniMedia = {
  id: number;
  title: string;
  /** Other names (English, native) to help pick the right one. */
  altTitles: string[];
  cover: string | null;
  chapters: number | null;
  volumes: number | null;
  year: number | null;
  format: string | null;
  /** AniList's own release status ("FINISHED", "RELEASING"...). */
  status: string | null;
  averageScore: number | null;
  country: string | null;
  url: string;
};

export type AniEntry = { status: AniStatus | null; progress: number; score: number };

export type AniDetails = {
  description: string | null;
  genres: string[];
  author: string | null;
  artist: string | null;
  pubStatus: string | null;
  kind: 'manga' | 'manhwa' | 'comic' | null;
};

const TO_ANI: Record<MangaStatus, AniStatus> = { reading: 'CURRENT', planned: 'PLANNING', completed: 'COMPLETED', onHold: 'PAUSED', dropped: 'DROPPED' };
const FROM_ANI: Record<AniStatus, MangaStatus> = { CURRENT: 'reading', PLANNING: 'planned', COMPLETED: 'completed', PAUSED: 'onHold', DROPPED: 'dropped', REPEATING: 'reading' };

export const toAniStatus = (s: MangaStatus | null): AniStatus => TO_ANI[s ?? 'planned'];
export const fromAniStatus = (s: AniStatus | null): MangaStatus | null => (s ? FROM_ANI[s] : null);

/**
 * Chapters read, as AniList counts them: the highest whole chapter number you
 * finished, or how many you finished when chapters have no numbers.
 */
export function progressOf(chapters: { number: number | null; readAt: number | null }[]): number {
  const read = chapters.filter((c) => c.readAt !== null);
  if (!read.length) return 0;
  const numbered = read.filter((c) => c.number !== null && c.number > 0);
  if (numbered.length) return Math.floor(Math.max(...numbered.map((c) => c.number!)));
  return read.length;
}

/** The entry to save on AniList for a title. Score: ReelVault 1-10 (decimals) as AniList's 0-100. */
export function entryFor(s: { status: MangaStatus | null; rating: number; chapters: { number: number | null; readAt: number | null }[] }): { status: AniStatus; progress: number; scoreRaw: number } {
  const progress = progressOf(s.chapters);
  // Reading something you only planned to read: it is current now.
  const status = s.status === null || (s.status === 'planned' && progress > 0) ? (progress > 0 ? 'CURRENT' : 'PLANNING') : toAniStatus(s.status);
  return { status, progress, scoreRaw: Math.round(Math.max(0, Math.min(10, s.rating)) * 10) };
}

/** Chapters to mark read here because AniList says you read further (numbers up to its progress). */
export function chaptersToMark(chapters: { id: string; number: number | null; readAt: number | null }[], aniProgress: number): string[] {
  if (aniProgress <= 0) return [];
  return chapters.filter((c) => c.readAt === null && c.number !== null && c.number > 0 && c.number <= aniProgress).map((c) => c.id);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One `Media` object from AniList's answer. */
export function parseMedia(m: any): AniMedia | null {
  const id = num(m?.id);
  if (id === null) return null;
  const names = [str(m?.title?.english), str(m?.title?.romaji), str(m?.title?.native)].filter((x): x is string => !!x);
  const title = str(m?.title?.english) ?? str(m?.title?.romaji) ?? names[0] ?? `AniList ${id}`;
  return {
    id,
    title,
    altTitles: [...new Set(names.filter((n) => n !== title))],
    cover: str(m?.coverImage?.extraLarge) ?? str(m?.coverImage?.large) ?? str(m?.coverImage?.medium),
    chapters: num(m?.chapters),
    volumes: num(m?.volumes),
    year: num(m?.startDate?.year),
    format: str(m?.format),
    status: str(m?.status),
    averageScore: num(m?.averageScore),
    country: str(m?.countryOfOrigin),
    url: str(m?.siteUrl) ?? `https://anilist.co/manga/${id}`,
  };
}

export function parseEntry(e: any): AniEntry | null {
  if (!e || typeof e !== 'object') return null;
  const status = typeof e.status === 'string' && e.status in FROM_ANI ? (e.status as AniStatus) : null;
  return { status, progress: num(e.progress) ?? 0, score: num(e.score) ?? 0 };
}

/** AniList's description has HTML bits (<br>, <i>) and a "(Source: …)" line. */
export function cleanDescription(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

export function parseDetails(m: any): AniDetails {
  const staff: { role: string; name: string }[] = (m?.staff?.edges ?? [])
    .map((e: any) => ({ role: String(e?.role ?? ''), name: str(e?.node?.name?.full) ?? '' }))
    .filter((x: { name: string }) => x.name);
  const story = staff.find((s) => /story/i.test(s.role)) ?? staff[0];
  const art = staff.find((s) => /art/i.test(s.role) && s.name !== story?.name) ?? null;
  const status = str(m?.status);
  const country = str(m?.countryOfOrigin);
  return {
    description: cleanDescription(str(m?.description)),
    genres: Array.isArray(m?.genres) ? m.genres.filter((g: unknown): g is string => typeof g === 'string') : [],
    author: story?.name ?? null,
    artist: art?.name ?? null,
    pubStatus: status === 'FINISHED' ? 'completed' : status === 'RELEASING' ? 'ongoing' : status === 'HIATUS' ? 'hiatus' : status === 'CANCELLED' ? 'cancelled' : null,
    kind: country === 'KR' ? 'manhwa' : country === 'JP' || country === 'CN' || country === 'TW' ? 'manga' : null,
  };
}

/** The access token from the address AniList sends you back to ("…#access_token=…&expires_in=…"). */
export function tokenFromRedirect(url: string): { token: string; expiresAt: number } | null {
  const frag = url.includes('#') ? url.slice(url.indexOf('#') + 1) : url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const params = new Map(frag.split('&').map((kv) => {
    const i = kv.indexOf('=');
    return [decodeURIComponent(i < 0 ? kv : kv.slice(0, i)), decodeURIComponent(i < 0 ? '' : kv.slice(i + 1))] as const;
  }));
  const token = params.get('access_token');
  if (!token) return null;
  const secs = Number(params.get('expires_in')) || 365 * 86_400;
  return { token, expiresAt: Date.now() + secs * 1000 };
}
