/**
 * ReelVault schema — every change to the database shape is a NEW migration.
 * Never edit an old migration once it has shipped: add a new one.
 */

export const SCHEMA_VERSION = 10;

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
  {
    version: 4,
    sql: `
      -- Custom cover: when it was set (its file is thumbs/<id>-<cover_at>.jpg);
      -- NULL = the frame made at import (thumbs/<id>.jpg).
      ALTER TABLE videos ADD COLUMN cover_at INTEGER;

      -- After "Make Smaller": the size and duplicate key of the file as it was
      -- imported, so importing that original again is still caught as a duplicate.
      ALTER TABLE videos ADD COLUMN original_size INTEGER;
      ALTER TABLE videos ADD COLUMN original_key TEXT;
      CREATE INDEX IF NOT EXISTS idx_videos_original_key ON videos(original_key);
    `,
  },
  {
    version: 5,
    sql: `
      -- The user's Simkl library (movies, shows, anime). Never linked to videos.
      CREATE TABLE IF NOT EXISTS simkl_items (
        simkl_id          INTEGER PRIMARY KEY,
        type              TEXT    NOT NULL,          -- movie | show | anime
        title             TEXT    NOT NULL,
        year              INTEGER,
        poster            TEXT,                      -- image path, see simkl/logic.ts posterUrl
        slug              TEXT,
        runtime           INTEGER,
        status            TEXT    NOT NULL,          -- watching | plantowatch | hold | completed | dropped
        rating            INTEGER,                   -- 1..10 or NULL
        rated_at          TEXT,
        added_at          TEXT,
        last_watched_at   TEXT,
        watched_episodes  INTEGER NOT NULL DEFAULT 0,
        total_episodes    INTEGER NOT NULL DEFAULT 0,
        not_aired         INTEGER NOT NULL DEFAULT 0,
        next_to_watch     TEXT,
        anime_type        TEXT,
        memo              TEXT,
        next_title        TEXT,                      -- next_to_watch_info
        next_date         TEXT,
        simkl_rating      REAL,                      -- community ratings (/ratings/all)
        simkl_votes       INTEGER,
        imdb_rating       REAL,
        imdb_votes        INTEGER,
        mal_rating        REAL,
        rank              INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_simkl_items_type ON simkl_items(type, status);

      -- Watched episodes per show / anime, as far as Simkl told us.
      CREATE TABLE IF NOT EXISTS simkl_episodes (
        simkl_id   INTEGER NOT NULL REFERENCES simkl_items(simkl_id) ON DELETE CASCADE,
        season     INTEGER NOT NULL,
        episode    INTEGER NOT NULL,
        watched_at TEXT,
        PRIMARY KEY (simkl_id, season, episode)
      );

      -- Cached catalog responses (details, episode lists, search, trending, calendar).
      CREATE TABLE IF NOT EXISTS simkl_cache (
        key        TEXT PRIMARY KEY,
        json       TEXT    NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 6,
    sql: `
      -- Your exact rating (9.7). Simkl only stores whole numbers, so it gets the
      -- rounded one; this is shown while the two still agree.
      CREATE TABLE IF NOT EXISTS simkl_my_ratings (
        simkl_id INTEGER PRIMARY KEY,
        rating   REAL    NOT NULL,
        rated_at TEXT
      );

      -- Rewatches logged in ReelVault (Simkl keeps them only for PRO / VIP).
      -- A session = one rewatch of a whole show / anime ("Rewatch #2").
      CREATE TABLE IF NOT EXISTS simkl_sessions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        simkl_id    INTEGER NOT NULL,
        number      INTEGER NOT NULL,          -- 2 = first rewatch
        started_at  TEXT    NOT NULL,
        finished_at TEXT,                      -- NULL = in progress
        remote_id   INTEGER                    -- Simkl's rewatch_id when saved there
      );
      CREATE INDEX IF NOT EXISTS idx_simkl_sessions_item ON simkl_sessions(simkl_id);

      -- Every extra watch: an episode again, a movie again, or an episode of a session.
      -- Movies use season 0, episode 0.
      CREATE TABLE IF NOT EXISTS simkl_plays (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        simkl_id   INTEGER NOT NULL,
        season     INTEGER NOT NULL,
        episode    INTEGER NOT NULL,
        watched_at TEXT    NOT NULL,
        session_id INTEGER REFERENCES simkl_sessions(id) ON DELETE CASCADE,
        on_simkl   INTEGER NOT NULL DEFAULT 0  -- 1 = also saved as a Simkl rewatch
      );
      CREATE INDEX IF NOT EXISTS idx_simkl_plays_item ON simkl_plays(simkl_id);

      -- Genres, network, country for stats; filled from detail pages and on demand.
      CREATE TABLE IF NOT EXISTS simkl_meta (
        simkl_id   INTEGER PRIMARY KEY,
        genres     TEXT,                       -- JSON array
        network    TEXT,
        country    TEXT,
        language   TEXT,
        runtime    INTEGER,
        fetched_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 7,
    sql: `
      -- The wide picture behind a title (Up Next cards, the detail header).
      ALTER TABLE simkl_meta ADD COLUMN fanart TEXT;

      -- Your own lists ("Comfort shows", "Watch with Sam"). Kept in ReelVault:
      -- Simkl's own custom lists are PRO-only and read-only through the API.
      CREATE TABLE IF NOT EXISTS simkl_lists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        icon       TEXT,
        created_at TEXT    NOT NULL,
        position   INTEGER NOT NULL DEFAULT 0
      );

      -- A list entry keeps the title, year and poster, so a list can hold
      -- titles that are not in your Simkl library.
      CREATE TABLE IF NOT EXISTS simkl_list_items (
        list_id  INTEGER NOT NULL REFERENCES simkl_lists(id) ON DELETE CASCADE,
        simkl_id INTEGER NOT NULL,
        type     TEXT    NOT NULL,
        title    TEXT    NOT NULL,
        year     INTEGER,
        poster   TEXT,
        slug     TEXT,
        added_at TEXT    NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (list_id, simkl_id)
      );

      -- One of your videos is this movie or episode: finishing it in the
      -- viewer marks it watched on Simkl.
      CREATE TABLE IF NOT EXISTS vault_simkl_links (
        video_id  TEXT PRIMARY KEY,
        simkl_id  INTEGER NOT NULL,
        type      TEXT    NOT NULL,
        title     TEXT    NOT NULL,
        year      INTEGER,
        poster    TEXT,
        season    INTEGER,
        episode   INTEGER,
        linked_at TEXT    NOT NULL,
        logged_at TEXT                         -- last time it was marked watched from here
      );
    `,
  },
  {
    version: 8,
    sql: `
      -- Every time you watch one of your videos (for the dashboard, Wrapped, badges).
      CREATE TABLE IF NOT EXISTS vault_plays (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id   TEXT    NOT NULL,
        started_at INTEGER NOT NULL,          -- ms since epoch
        watched_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_vault_plays_video ON vault_plays(video_id);
      CREATE INDEX IF NOT EXISTS idx_vault_plays_time ON vault_plays(started_at);

      -- Moments inside a video you can jump back to.
      CREATE TABLE IF NOT EXISTS vault_bookmarks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id   TEXT    NOT NULL,
        at_ms      INTEGER NOT NULL,
        label      TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vault_bookmarks_video ON vault_bookmarks(video_id);

      -- "Continue another time": where to pick a long video up again.
      CREATE TABLE IF NOT EXISTS vault_resume (
        video_id    TEXT PRIMARY KEY,
        position_ms INTEGER NOT NULL,
        saved_at    INTEGER NOT NULL
      );
    `,
  },
  {
    version: 9,
    sql: `
      -- What is kept after a video is removed for good: its rating and info,
      -- so the Overview still shows it (the file itself is gone).
      CREATE TABLE IF NOT EXISTS vault_kept (
        video_id    TEXT PRIMARY KEY,         -- the id the video had
        title       TEXT,
        filename    TEXT NOT NULL,
        size        INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        rating      REAL NOT NULL DEFAULT 0,
        status      TEXT,
        notes       TEXT,
        tags        TEXT,                     -- JSON array of keyword names
        is_private  INTEGER NOT NULL DEFAULT 0,
        thumb       TEXT,                     -- file name in thumbs/kept, or null
        created_at  INTEGER NOT NULL,
        imported_at INTEGER NOT NULL,
        removed_at  INTEGER NOT NULL
      );

      -- Videos that belong together ("a show"), rated as a whole and per episode.
      CREATE TABLE IF NOT EXISTS vault_series (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        cover       TEXT,                     -- file name in thumbs/series, or null = first episode
        rating      REAL NOT NULL DEFAULT 0,
        status      TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      -- A video is in at most one series. No foreign key to videos: the
      -- episode stays in its series after the video is removed for good.
      CREATE TABLE IF NOT EXISTS vault_series_items (
        video_id  TEXT PRIMARY KEY,
        series_id TEXT NOT NULL REFERENCES vault_series(id) ON DELETE CASCADE,
        position  INTEGER NOT NULL,
        label     TEXT                        -- episode name, null = the video's own
      );
      CREATE INDEX IF NOT EXISTS idx_series_items ON vault_series_items(series_id, position);
    `,
  },
  {
    version: 10,
    sql: `
      -- The Audio section: your own audio files, books made of several files,
      -- and EPUB 3 books (read-along). Each item's files live in its own folder,
      -- stored RELATIVE to the app's documents ("audio/<id>"), so iOS moving
      -- the app's folder on an update never loses them.
      CREATE TABLE IF NOT EXISTS audio_items (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL,              -- 'audio' | 'book' (EPUB 3)
        folder         TEXT NOT NULL,              -- relative: audio/<id>
        filename       TEXT NOT NULL,              -- what it was called when added
        size           INTEGER NOT NULL DEFAULT 0, -- bytes on the phone
        duration_ms    INTEGER,
        title          TEXT,
        author         TEXT,
        album          TEXT,
        narrator       TEXT,
        year           INTEGER,
        genre          TEXT,
        description    TEXT,
        notes          TEXT,
        rating         REAL NOT NULL DEFAULT 0,   -- 0 = none, else 1.0..10.0
        status         TEXT,                       -- planned | listening | finished | dropped
        cover          TEXT,                       -- file name in the folder
        tracks_json    TEXT NOT NULL DEFAULT '[]', -- [{file, title, durationMs}]
        chapters_json  TEXT NOT NULL DEFAULT '[]', -- [{title, track, startMs}]
        content_key    TEXT,
        is_private     INTEGER NOT NULL DEFAULT 0,
        position_track INTEGER NOT NULL DEFAULT 0,
        position_ms    INTEGER NOT NULL DEFAULT 0,
        speed          REAL,
        last_played_at INTEGER,
        finished_at    INTEGER,
        created_at     INTEGER NOT NULL,
        imported_at    INTEGER NOT NULL,
        deleted_at     INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audio_items_key ON audio_items(content_key);

      CREATE TABLE IF NOT EXISTS audio_tags (
        item_id TEXT NOT NULL REFERENCES audio_items(id) ON DELETE CASCADE,
        name    TEXT NOT NULL COLLATE NOCASE,
        PRIMARY KEY (item_id, name)
      );

      -- Every listen: when it started and how much was heard (for stats and history).
      CREATE TABLE IF NOT EXISTS audio_plays (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     TEXT NOT NULL,
        started_at  INTEGER NOT NULL,
        listened_ms INTEGER NOT NULL,
        from_ms     INTEGER,
        to_ms       INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audio_plays_item ON audio_plays(item_id);
      CREATE INDEX IF NOT EXISTS idx_audio_plays_time ON audio_plays(started_at);

      CREATE TABLE IF NOT EXISTS audio_bookmarks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id    TEXT NOT NULL REFERENCES audio_items(id) ON DELETE CASCADE,
        track      INTEGER NOT NULL DEFAULT 0,
        at_ms      INTEGER NOT NULL,
        label      TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audio_bookmarks_item ON audio_bookmarks(item_id);
    `,
  },
  {
    version: 11,
    sql: `
      -- A list entry you looked up on Google ("which have I searched?"); NULL = not yet.
      ALTER TABLE simkl_list_items ADD COLUMN searched_at TEXT;
    `,
  },
];
