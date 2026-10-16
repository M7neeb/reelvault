/**
 * ReelVault schema — every change to the database shape is a NEW migration.
 * Never edit an old migration once it has shipped: add a new one.
 */

export const SCHEMA_VERSION = 2;

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
  {
    version: 2,
    sql: `
      -- Watch status, same values as Simkl ----------------------------------
      -- 'plantowatch' | 'watching' | 'completed' | 'hold' | 'dropped', or NULL
      ALTER TABLE videos ADD COLUMN status TEXT;

      -- Recently Deleted: set instead of deleting, purged after 30 days ----
      ALTER TABLE videos ADD COLUMN deleted_at INTEGER;

      -- Private album (Face ID) ---------------------------------------------
      ALTER TABLE videos ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;

      -- Duplicate detection: size + hash of the first and last 1 MB -------
      ALTER TABLE videos ADD COLUMN content_key TEXT;

      CREATE INDEX IF NOT EXISTS idx_videos_deleted     ON videos(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_videos_content_key ON videos(content_key);

      -- App settings (theme, view options, ...) -----------------------------
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Saved searches shown in the sidebar ----------------------------------
      CREATE TABLE IF NOT EXISTS smart_filters (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        rule_json  TEXT NOT NULL,             -- see SmartRule in ui/types.ts
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `,
  },
];
