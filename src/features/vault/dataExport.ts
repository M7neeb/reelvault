/**
 * Export all data: reads every section out of the database, turns it into
 * tables (dataExportFormat.ts) and hands one ZIP to the share sheet. Private
 * items and Recently Deleted stay out, as in the other exports.
 */

import { File, Paths } from 'expo-file-system';
import { strToU8 } from 'fflate';

import { getDb } from '@/db';

import { openSink } from './audio/audioFiles';
import { zipWriter } from './audio/zip';
import { exportTables, myRating, readme, tableCsv, tablesJson, type ExportInput } from './dataExportFormat';
import { shareFile } from './share';

function stringList(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function groupNames<K extends string, R extends Record<K, string> & { name: string }>(rows: R[], key: K): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const l = m.get(r[key]);
    if (l) l.push(r.name);
    else m.set(r[key], [r.name]);
  }
  return m;
}

/** Tables that came with a later app version may be missing on an old database; an empty list then. */
async function rows<T>(sql: string): Promise<T[]> {
  const db = await getDb();
  try {
    return await db.getAllAsync<T>(sql);
  } catch (e) {
    console.log(`[EXPORT] skipped: ${String(e)}`);
    return [];
  }
}

async function collect(): Promise<ExportInput> {
  const videos = await rows<{
    id: string; title: string | null; filename: string; size: number | null; duration_ms: number | null; width: number | null; height: number | null;
    rating: number; flag: number | null; status: string | null; notes: string | null; created_at: number | null; imported_at: number | null;
  }>(
    `SELECT id, title, filename, size, duration_ms, width, height, rating, flag, status, notes, created_at, imported_at
       FROM videos WHERE deleted_at IS NULL AND is_private = 0 ORDER BY created_at;`
  );
  const tags = groupNames(await rows<{ video_id: string; name: string }>('SELECT vt.video_id, t.name FROM video_tags vt JOIN tags t ON t.id = vt.tag_id;'), 'video_id');
  const albums = groupNames(
    await rows<{ video_id: string; name: string }>('SELECT av.video_id, a.name FROM album_videos av JOIN albums a ON a.id = av.album_id WHERE a.is_private = 0;'),
    'video_id'
  );
  const seriesOf = new Map(
    (await rows<{ video_id: string; name: string }>('SELECT i.video_id, s.name FROM vault_series_items i JOIN vault_series s ON s.id = i.series_id;')).map((r) => [r.video_id, r.name])
  );
  const kept = await rows<{
    video_id: string; title: string | null; filename: string; duration_ms: number | null; rating: number; status: string | null; tags: string | null;
    created_at: number | null; imported_at: number | null; removed_at: number;
  }>('SELECT * FROM vault_kept WHERE is_private = 0 ORDER BY removed_at;');
  const plays = await rows<{ video_id: string; started_at: number; watched_ms: number }>('SELECT video_id, started_at, watched_ms FROM vault_plays ORDER BY started_at;');
  const publicVideos = new Set([...videos.map((v) => v.id), ...kept.map((k) => k.video_id)]);
  const series = await rows<{ id: string; name: string; description: string | null; rating: number; status: string | null; episodes: number }>(
    `SELECT s.id, s.name, s.description, s.rating, s.status, COUNT(i.video_id) AS episodes
       FROM vault_series s LEFT JOIN vault_series_items i ON i.series_id = s.id GROUP BY s.id ORDER BY s.name;`
  );

  const titles = await rows<{
    simkl_id: number; type: string; title: string; year: number | null; slug: string | null; runtime: number | null; status: string; rating: number | null;
    rated_at: string | null; added_at: string | null; last_watched_at: string | null; watched_episodes: number; total_episodes: number; anime_type: string | null;
    memo: string | null; simkl_rating: number | null; imdb_rating: number | null; mal_rating: number | null; exact: number | null;
    genres: string | null; network: string | null; country: string | null; language: string | null; meta_runtime: number | null;
  }>(
    `SELECT i.*, r.rating AS exact, m.genres, m.network, m.country, m.language, m.runtime AS meta_runtime
       FROM simkl_items i
       LEFT JOIN simkl_my_ratings r ON r.simkl_id = i.simkl_id
       LEFT JOIN simkl_meta m ON m.simkl_id = i.simkl_id
      ORDER BY i.type, i.title;`
  );
  const episodes = await rows<{ simkl_id: number; season: number; episode: number; watched_at: string | null }>(
    'SELECT simkl_id, season, episode, watched_at FROM simkl_episodes ORDER BY watched_at;'
  );
  const rewatches = await rows<{ simkl_id: number; season: number; episode: number; watched_at: string }>(
    'SELECT simkl_id, season, episode, watched_at FROM simkl_plays ORDER BY watched_at;'
  );
  const lists = await rows<{ list: string; simkl_id: number; type: string; title: string; year: number | null; added_at: string | null }>(
    `SELECT l.name AS list, li.simkl_id, li.type, li.title, li.year, li.added_at
       FROM simkl_list_items li JOIN simkl_lists l ON l.id = li.list_id ORDER BY l.position, li.position;`
  );

  const audio = await rows<{
    id: string; kind: string; title: string | null; filename: string; author: string | null; narrator: string | null; album: string | null; genre: string | null;
    year: number | null; duration_ms: number | null; rating: number; status: string | null; created_at: number | null; last_played_at: number | null; finished_at: number | null;
  }>('SELECT * FROM audio_items WHERE deleted_at IS NULL AND is_private = 0 ORDER BY created_at;');
  const audioTags = groupNames(await rows<{ item_id: string; name: string }>('SELECT item_id, name FROM audio_tags;'), 'item_id');
  const audioPlays = await rows<{ item_id: string; started_at: number; listened_ms: number }>('SELECT item_id, started_at, listened_ms FROM audio_plays ORDER BY started_at;');

  const manga = await rows<{
    id: string; title: string; alt_title: string | null; author: string | null; artist: string | null; kind: string | null; pub_status: string | null;
    status: string | null; rating: number; source_id: string | null; created_at: number | null; last_read_at: number | null; finished_at: number | null;
  }>('SELECT * FROM manga_series WHERE deleted_at IS NULL AND is_private = 0 ORDER BY title;');
  const mangaTags = groupNames(await rows<{ series_id: string; name: string }>('SELECT series_id, name FROM manga_tags;'), 'series_id');
  const chapters = await rows<{
    id: string; series_id: string; number: number | null; volume: number | null; title: string | null; filename: string | null; page_count: number;
    read_at: number | null; last_page: number; uploaded_at: number | null; scanlator: string | null;
  }>(
    `SELECT id, series_id, number, volume, title, filename, page_count, read_at, last_page, uploaded_at, scanlator
       FROM manga_chapters ORDER BY series_id, position;`
  );
  const reads = await rows<{ series_id: string; chapter_id: string | null; started_at: number; read_ms: number; pages: number }>(
    'SELECT series_id, chapter_id, started_at, read_ms, pages FROM manga_reads ORDER BY started_at;'
  );

  return {
    exportedAt: Date.now(),
    videos: videos.map((v) => ({
      id: v.id,
      title: v.title,
      filename: v.filename,
      size: v.size,
      durationMs: v.duration_ms,
      width: v.width,
      height: v.height,
      rating: v.rating,
      flag: v.flag ?? 0,
      status: v.status,
      notes: v.notes,
      createdAt: v.created_at,
      importedAt: v.imported_at,
      keywords: tags.get(v.id) ?? [],
      albums: albums.get(v.id) ?? [],
      series: seriesOf.get(v.id) ?? null,
    })),
    keptVideos: kept.map((k) => ({
      id: k.video_id,
      title: k.title,
      filename: k.filename,
      durationMs: k.duration_ms,
      rating: k.rating,
      status: k.status,
      keywords: stringList(k.tags),
      createdAt: k.created_at,
      importedAt: k.imported_at,
      removedAt: k.removed_at,
    })),
    videoPlays: plays.filter((p) => publicVideos.has(p.video_id)).map((p) => ({ videoId: p.video_id, startedAt: p.started_at, watchedMs: p.watched_ms })),
    videoSeries: series.map((s) => ({ name: s.name, description: s.description, rating: s.rating, status: s.status, episodes: s.episodes })),
    titles: titles.map((t) => ({
      simklId: t.simkl_id,
      type: t.type,
      title: t.title,
      year: t.year,
      slug: t.slug,
      runtime: t.meta_runtime ?? t.runtime,
      status: t.status,
      rating: myRating(t.rating, t.exact),
      ratedAt: t.rated_at,
      addedAt: t.added_at,
      lastWatchedAt: t.last_watched_at,
      watchedEpisodes: t.watched_episodes,
      totalEpisodes: t.total_episodes,
      animeType: t.anime_type,
      memo: t.memo,
      simklRating: t.simkl_rating,
      imdbRating: t.imdb_rating,
      malRating: t.mal_rating,
      genres: stringList(t.genres),
      network: t.network,
      country: t.country,
      language: t.language,
    })),
    episodes: episodes.map((e) => ({ simklId: e.simkl_id, season: e.season, episode: e.episode, watchedAt: e.watched_at })),
    rewatches: rewatches.map((r) => ({ simklId: r.simkl_id, season: r.season, episode: r.episode, watchedAt: r.watched_at })),
    lists: lists.map((l) => ({ list: l.list, simklId: l.simkl_id, type: l.type, title: l.title, year: l.year, addedAt: l.added_at })),
    audio: audio.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      filename: a.filename,
      author: a.author,
      narrator: a.narrator,
      album: a.album,
      genre: a.genre,
      year: a.year,
      durationMs: a.duration_ms,
      rating: a.rating,
      status: a.status,
      keywords: audioTags.get(a.id) ?? [],
      createdAt: a.created_at,
      lastPlayedAt: a.last_played_at,
      finishedAt: a.finished_at,
    })),
    audioPlays: audioPlays.map((p) => ({ itemId: p.item_id, startedAt: p.started_at, listenedMs: p.listened_ms })),
    manga: manga.map((m) => ({
      id: m.id,
      title: m.title,
      altTitle: m.alt_title,
      author: m.author,
      artist: m.artist,
      kind: m.kind,
      pubStatus: m.pub_status,
      status: m.status,
      rating: m.rating,
      keywords: mangaTags.get(m.id) ?? [],
      source: m.source_id,
      createdAt: m.created_at,
      lastReadAt: m.last_read_at,
      finishedAt: m.finished_at,
    })),
    chapters: chapters.map((c) => ({
      id: c.id,
      seriesId: c.series_id,
      number: c.number,
      volume: c.volume,
      title: c.title ?? c.filename,
      pageCount: c.page_count,
      readAt: c.read_at,
      lastPage: c.last_page,
      uploadedAt: c.uploaded_at,
      scanlator: c.scanlator,
    })),
    mangaReads: reads.map((r) => ({ seriesId: r.series_id, chapterId: r.chapter_id, startedAt: r.started_at, readMs: r.read_ms, pages: r.pages })),
  };
}

/** Builds the ZIP, opens the share sheet, and says how many activity rows went in. */
export async function exportAllData(): Promise<{ sessions: number; items: number }> {
  const input = await collect();
  const tables = exportTables(input);
  const day = new Date(input.exportedAt).toISOString().slice(0, 10);
  const file = new File(Paths.cache, `ReelVault data ${day}.zip`);
  const sink = openSink(file);
  try {
    const w = zipWriter((b) => sink.write(b));
    w.addStored('README.txt', strToU8(readme(tables, input.exportedAt)));
    for (const t of tables) w.addStored(t.file, strToU8(tableCsv(t)));
    w.addStored('everything.json', strToU8(tablesJson(tables, input.exportedAt)));
    w.finish();
  } catch (e) {
    sink.close();
    if (file.exists) file.delete();
    throw e;
  }
  sink.close();
  await shareFile(file.uri);
  const items = input.videos.length + input.titles.length + input.audio.length + input.manga.length;
  return { sessions: tables.find((t) => t.file === 'activity.csv')?.rows.length ?? 0, items };
}
