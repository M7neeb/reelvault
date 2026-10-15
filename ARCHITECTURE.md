# Architecture

## Screens

The app is a single primary screen plus two modal surfaces.

| Surface | File | Role |
| --- | --- | --- |
| Vault | `src/app/index.tsx` | Grid of videos, floating header, search sheet, sidebar drawer, viewer |
| Tabs shell | `src/app/_layout.tsx` | Navigation shell; opens the database once on startup |

The video **viewer is a modal inside `index.tsx`**, not a route. The root navigator is a
tab navigator, and a normal nested route fights it. If real navigation is needed later,
restructure to a root stack with the tabs in a `(tabs)` group.

## Data model — schema v1

```
videos(id TEXT PK, uri, filename, size, duration_ms, width, height,
       rating INTEGER 0..10, title, notes, created_at, imported_at)

tags(id INTEGER PK, name UNIQUE, color)

video_tags(video_id, tag_id)                              -- many-to-many

videos_fts(video_id UNINDEXED, title, notes, filename)    -- FTS5
```

`videos_fts` is kept in sync by `AFTER INSERT / UPDATE / DELETE` triggers on `videos`.

Indexes cover the hot paths: `rating`, `imported_at`, `created_at`, and
`video_tags(tag_id)`.

## Migrations

**Never edit a migration that has shipped.** Add a new entry to `MIGRATIONS` in
`src/db/schema.ts` and bump `SCHEMA_VERSION`. `src/db/index.ts` applies only the
pending ones, inside a transaction, and records each in a `migrations` table.

## Design decisions

| Decision | Reason |
| --- | --- |
| Videos only, no photos | The library this was built for is video-only |
| **Copy files into app storage** | The source library belongs to another app and can't be read in place |
| Store under `document`, not `cache` | The OS must never purge the user's videos |
| One `Video` type, snake_case mapped in one place | Keeps SQL column names out of the UI |
| Rating 1–10 | More granular than stars for ranking a large library |
| Player as a modal, with a draggable info sheet | Avoids nested-route conflicts; keeps the video full-bleed |
| Playhead driven by `timeUpdate` events | Avoids polling; keeps the filmstrip in sync with playback |
| Feature-first folders | A change lives in one file |

## Performance notes

- Thumbnails are generated once at import and cached per video; the cover lives at
  `thumbs/<id>.jpg`, filmstrip frames at `thumbs/<id>/fN.jpg`.
- The filmstrip is 8 frames generated on first open and reused after that.
- Duration is probed headlessly with `createVideoPlayer` and a `statusChange` listener.
  Imports backfill any video whose duration is still unknown.

## Development notes

- **Expo Go requires a matching account.** Expo Go opens a dev-server project only when
  the app and the CLI are signed in to the same Expo account. Applies to physical iOS
  devices only.
- **The web bundle fails on `expo-sqlite`.** Its web worker imports a `.wasm` file that
  isn't present, so any request for the web bundle errors. iOS is unaffected.
- `expo-file-system` on current SDKs uses the `File` / `Directory` / `Paths` classes.
  The older API lives at `expo-file-system/legacy`.
- `expo-video`'s `VideoView` has no `allowsFullscreen` prop — use
  `fullscreenOptions={{ enable: true }}`. `player.duration` is in **seconds**.

## Known gaps

- `src/app/explore.tsx` and the "Explore" tab are unused scaffolding.
- `src/lib/probe.ts` is a leftover capability check and can be deleted.
- Deleted videos remove their rows, files and thumbnails — but there is no undo.
