# ReelVault

A local-first video vault for iPhone.

Import videos, keep them in one place, and organise them with keywords, ratings and
search. Everything stays on the device — no account, no server, no telemetry.

## Features

- **Import** videos from the Files app
- **Automatic thumbnails** and a scrubbable **filmstrip with a live playhead**
- **Keywords (tags)** with a browsable keyword cloud
- **1–10 rating** per video
- **Sort** by date, rating, name or size
- **Collections** — All, Favorites, Rated, Untagged, plus per-keyword filters
- **Full-text search** across filenames, notes and keywords
- **Multi-select** with batch delete
- **Storage readout** — what the app holds vs what's free on the device

## Tech stack

- Expo SDK 57 · React Native 0.86 · TypeScript (strict)
- [`expo-router`](https://docs.expo.dev/router/introduction/) for navigation
- [`expo-sqlite`](https://docs.expo.dev/versions/latest/sdk/sqlite/) — WAL mode, **FTS5** with sync triggers
- [`expo-video`](https://docs.expo.dev/versions/latest/sdk/video/) + [`expo-video-thumbnails`](https://docs.expo.dev/versions/latest/sdk/video-thumbnails/)
- [`expo-file-system`](https://docs.expo.dev/versions/latest/sdk/filesystem/) for app-owned storage
- [`expo-crypto`](https://docs.expo.dev/versions/latest/sdk/crypto/)

## Getting started

```bash
npm install
npx expo start
```

Then scan the QR code with **Expo Go** on your iPhone. The phone and computer must be
on the same network. Note that Expo Go only opens a project when the app and the CLI are
signed in to the same Expo account.

## Project structure

Feature-first, so a change lives in one place:

```
src/app/                  screens (expo-router file-based routes)
  _layout.tsx             tabs shell + database initialisation
  index.tsx               the vault: grid, search, collections, viewer
src/db/
  schema.ts               append-only migrations
  index.ts                open + migrate, single shared handle
src/features/vault/
  types.ts                the Video model
  repo.ts                 every SQL query
  storage.ts              app-owned paths
  import.ts               pick → copy → thumbnail → record
  tags.ts                 keyword CRUD + video↔keyword links
  duration.ts             headless duration probe
  filmstrip.ts            scrubber frame generation + cache
  actions.ts              delete (single + batch)
```

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the data model, migration policy and
design decisions.

## Status

Working: import, thumbnails, filmstrip, keywords, rating, sorting, search, collections,
multi-select delete.

Planned: real albums, saved smart filters, pick/reject flags, timeline jump,
size-badge toggle, theme switch, slideshow.

## License

See [LICENSE](./LICENSE).
