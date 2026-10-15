/**
 * ReelVault schema — every change to the database shape is a NEW migration.
 * Never edit an old migration once it has shipped: add a new one.
 */

export const SCHEMA_VERSION = 1;

export type Migration = {
  version: number;
  sql: string;
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      -- One row per imported video file -------------------------------------
      CREATE TABLE IF NOT EXISTS videos (
        id           TEXT PRIMARY KEY,            -- uuid, generated at import
        uri          TEXT NOT NULL,               -- file:// path inside app storage
        filename     TEXT NOT NULL,
        size         INTEGER NOT NULL DEFAULT 0,  -- bytes
        duration_ms  INTEGER,
        width        INTEGER,
        height       INTEGER,
        rating       INTEGER NOT NULL DEFAULT 0,  -- 0..10, user-set
        title        TEXT,
        notes        TEXT,
        created_at   INTEGER NOT NULL,            -- video's own timestamp (ms)
        imported_at  INTEGER NOT NULL             -- when ReelVault took it in (ms)
      );

      -- Tags are global and reusable across videos -------------------------
      CREATE TABLE IF NOT EXISTS tags (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL UNIQUE,
        color TEXT
      );

      -- Many-to-many: a video can have many tags, a tag many videos --------
      CREATE TABLE IF NOT EXISTS video_tags (
        video_id TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
        PRIMARY KEY (video_id, tag_id)
      );

      -- Sorting / filtering hot paths --------------------------------------
      CREATE INDEX IF NOT EXISTS idx_videos_rating    ON videos(rating);
      CREATE INDEX IF NOT EXISTS idx_videos_imported  ON videos(imported_at);
      CREATE INDEX IF NOT EXISTS idx_videos_created   ON videos(created_at);
      CREATE INDEX IF NOT EXISTS idx_video_tags_tag   ON video_tags(tag_id);

      -- Full-text search over title / notes / filename ---------------------
      -- FTS5 verified working on-device during the Phase 0 probe.
      CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
        video_id UNINDEXED,
        title,
        notes,
        filename
      );

      CREATE TRIGGER IF NOT EXISTS videos_ai AFTER INSERT ON videos BEGIN
        INSERT INTO videos_fts(video_id, title, notes, filename)
        VALUES (new.id, new.title, new.notes, new.filename);
      END;

      CREATE TRIGGER IF NOT EXISTS videos_ad AFTER DELETE ON videos BEGIN
        DELETE FROM videos_fts WHERE video_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE ON videos BEGIN
        DELETE FROM videos_fts WHERE video_id = old.id;
        INSERT INTO videos_fts(video_id, title, notes, filename)
        VALUES (new.id, new.title, new.notes, new.filename);
      END;
    `,
  },
];
