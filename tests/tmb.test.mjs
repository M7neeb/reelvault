// Run with `npm test`. Tachimanga's own backups (.tmb): a ZIP with contents.zip, holding its SQLite database.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';

import { planTachiImport, readTachiBackup, TMB_QUERIES } from '../src/features/vault/manga/mangaBackup.ts';

const dir = mkdtempSync(join(tmpdir(), 'tmb-'));

/** A small tachimanga.db, laid out like the real one. */
function makeDb() {
  const path = join(dir, `t${Math.random()}.db`);
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE Category (id INTEGER PRIMARY KEY AUTOINCREMENT, "name" VARCHAR(64) NOT NULL, "order" INT DEFAULT 0 NOT NULL, is_default BOOLEAN DEFAULT 0 NOT NULL);
    CREATE TABLE CategoryManga (id INTEGER PRIMARY KEY AUTOINCREMENT, category INT NOT NULL, manga INT NOT NULL);
    CREATE TABLE Chapter (id INTEGER PRIMARY KEY AUTOINCREMENT, url VARCHAR(2048) NOT NULL, "name" VARCHAR(512) NOT NULL, date_upload BIGINT DEFAULT 0 NOT NULL, chapter_number SINGLE DEFAULT -1.0 NOT NULL, scanlator VARCHAR(128) NULL, "read" BOOLEAN DEFAULT 0 NOT NULL, bookmark BOOLEAN DEFAULT 0 NOT NULL, last_page_read INT DEFAULT 0 NOT NULL, last_read_at BIGINT DEFAULT 0 NOT NULL, fetched_at BIGINT DEFAULT 0 NOT NULL, source_order INT NOT NULL, real_url VARCHAR(2048) NULL, is_downloaded BOOLEAN DEFAULT 0 NOT NULL, page_count INT DEFAULT -1 NOT NULL, manga INT NOT NULL);
    CREATE TABLE History (id INTEGER PRIMARY KEY AUTOINCREMENT, create_at BIGINT DEFAULT 0 NOT NULL, update_at BIGINT DEFAULT 0 NOT NULL, is_delete BOOLEAN DEFAULT 0 NOT NULL, manga_id INTEGER NOT NULL, last_chapter_id INTEGER NOT NULL, last_read_at BIGINT DEFAULT 0 NOT NULL);
    CREATE TABLE Manga (id INTEGER PRIMARY KEY AUTOINCREMENT, url VARCHAR(2048) NOT NULL, title VARCHAR(512) NOT NULL, artist VARCHAR(512) NULL, author VARCHAR(512) NULL, description TEXT NULL, genre TEXT NULL, status INT DEFAULT 0 NOT NULL, thumbnail_url VARCHAR(2048) NULL, in_library BOOLEAN DEFAULT 0 NOT NULL, in_library_at BIGINT DEFAULT 0 NOT NULL, "source" BIGINT NOT NULL, real_url VARCHAR(2048) NULL);
    CREATE TABLE "Source" (id BIGINT NOT NULL, "name" VARCHAR(128) NOT NULL, lang VARCHAR(32) NOT NULL, extension INT NOT NULL);
    INSERT INTO Category (id, name, "order") VALUES (1, 'Favourites', 0), (2, 'Later', 1);
    INSERT INTO "Source" VALUES (2499283573021220255, 'MangaDex', 'en', 1);
    INSERT INTO Manga (id, url, title, author, genre, status, thumbnail_url, in_library, in_library_at, source)
      VALUES (1, '/title/abc', 'Dandadan', 'Yukinobu Tatsu', 'Action, Comedy', 1, 'https://x/c.jpg', 1, 1760000000, 2499283573021220255),
             (2, '/title/old', 'Not in library', NULL, NULL, 0, NULL, 0, 0, 2499283573021220255);
    INSERT INTO Chapter (id, url, name, chapter_number, read, last_page_read, last_read_at, fetched_at, source_order, manga, date_upload)
      VALUES (1, '/chapter/1', 'Chapter 1', 1, 1, 0, 1760100000, 1760000000, 1, 1, 1750000000000),
             (2, '/chapter/2', 'Chapter 2', 2, 0, 7, 1760200000, 1760000000, 0, 1, 1750000000000);
    INSERT INTO CategoryManga (category, manga) VALUES (1, 1);
    INSERT INTO History (manga_id, last_chapter_id, last_read_at) VALUES (1, 2, 1760200000000);
  `);
  db.close();
  return readFileSync(path);
}

/** Opens the database bytes the way the app does (here with Node's SQLite). */
async function openTmb(bytes) {
  const path = join(dir, `o${Math.random()}.db`);
  writeFileSync(path, bytes);
  const db = new DatabaseSync(path);
  const out = {};
  for (const [k, sql] of Object.entries(TMB_QUERIES)) {
    try {
      out[k] = db.prepare(sql).all();
    } catch {
      out[k] = [];
    }
  }
  db.close();
  return out;
}

const tmb = (db) =>
  zipSync({
    'meta.json': strToU8(JSON.stringify({ name: 'Backup', version: 1 })),
    'contents.zip': [zipSync({ 'pref.json': strToU8('{}'), 'tachimanga.db': [db, { level: 0 }] }), { level: 0 }],
  });

test('a .tmb opens: titles in the library, chapters, read marks, categories and big source ids kept', async () => {
  const backup = await readTachiBackup(tmb(makeDb()), openTmb);
  const d = backup.mangas.find((m) => m.title === 'Dandadan');
  assert.equal(d.favorite, true);
  assert.equal(d.source, '2499283573021220255');
  assert.deepEqual(d.genres, ['Action', 'Comedy']);
  assert.equal(d.dateAdded, 1760000000 * 1000);
  assert.equal(d.chapters.length, 2);
  assert.equal(d.chapters.find((c) => c.number === 1).read, true);
  assert.equal(d.chapters.find((c) => c.number === 2).lastPageRead, 7);
  assert.deepEqual(backup.categories.map((c) => c.name), ['Favourites', 'Later']);
  assert.equal(backup.sources[0].name, 'MangaDex');

  const plan = planTachiImport(backup, Date.now());
  assert.deepEqual(plan.map((p) => p.title), ['Dandadan']);
  const t = plan[0];
  assert.deepEqual(t.categories, ['Favourites']);
  const c1 = t.chapters.find((c) => c.number === 1);
  assert.equal(c1.readAt, 1760100000 * 1000);
  assert.equal(t.chapters.find((c) => c.number === 2).readAt, null);
});

test('a ZIP that is neither says so; a .tmb without its database says what is missing', async () => {
  await assert.rejects(readTachiBackup(zipSync({ 'notes.txt': strToU8('hi') }), openTmb), /not a Tachimanga or Tachiyomi backup/);
  await assert.rejects(readTachiBackup(zipSync({ 'meta.json': strToU8('{}'), 'contents.zip': zipSync({ 'pref.json': strToU8('{}') }) }), openTmb), /tachimanga\.db is missing/);
});
