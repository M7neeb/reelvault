/**
 * ReelVault schema — every change to the database shape is a NEW migration.
 * Never edit an old migration once it has shipped: add a new one.
 */

export const SCHEMA_VERSION = 3;

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
  {
    version: 3,
    sql: `
      -- Pick / reject flag: 1 = pick, -1 = reject, 0 = none -----------------
      ALTER TABLE videos ADD COLUMN flag INTEGER NOT NULL DEFAULT 0;

      -- The Tray: a working set that stays across views ---------------------
      ALTER TABLE videos ADD COLUMN in_tray INTEGER NOT NULL DEFAULT 0;

      -- What the file itself says (codec, fps, device, location...) as JSON;
      -- NULL = not read yet. created_at is set from it when the file knows
      -- when it was filmed.
      ALTER TABLE videos ADD COLUMN meta_json TEXT;

      -- Folders group albums and smart filters -------------------------------
      CREATE TABLE IF NOT EXISTS folders (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS albums (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        name                  TEXT NOT NULL,
        folder_id             INTEGER REFERENCES folders(id) ON DELETE SET NULL,
        is_private            INTEGER NOT NULL DEFAULT 0,  -- only shown inside unlocked Private
        pinned                INTEGER NOT NULL DEFAULT 0,
        exclude_uncategorized INTEGER NOT NULL DEFAULT 0,  -- its videos still count as uncategorized
        last_used_at          INTEGER,                     -- for "recent destinations"
        sort_order            INTEGER NOT NULL DEFAULT 0,
        created_at            INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS album_videos (
        album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        video_id TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (album_id, video_id)
      );
      CREATE INDEX IF NOT EXISTS idx_album_videos_video ON album_videos(video_id);

      -- Pinned keywords sit at the top of the sidebar and search cloud ------
      ALTER TABLE tags ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

      -- Smart filters can live in a folder ("smart folder") ----------------
      ALTER TABLE smart_filters ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
    `,
  },
];
