# ReelVault

A local-first video vault for iPhone.

Import videos, keep them in one place, and organise them with keywords, ratings and
search. Everything stays on the device — no account, no server, no telemetry.

## Features

- **Import** videos from the Files app, Photos, a whole folder, a link, or a computer over Wi-Fi (drop videos on a page in the browser)
- **HashPhotos info** — read HashPhotos' metadata export (CSV, JSON or XML) and bring its keywords, ratings, titles, captions and flags across, matched by file name
- **Automatic thumbnails** and a scrubbable **filmstrip with a live playhead**
- **Keywords (tags)** with a browsable keyword cloud
- **1–10 rating** per video
- **Sort** by date, rating, name, size, length, or most / least / last watched; albums by name, most watched or recently used
- **Collections** — All, Favorites, Rated, Untagged, plus per-keyword filters
- **Smarter search** — plain words that filter: years and months, "8+", "long", "portrait", "#holiday", "unwatched", "last month", ">1gb"; the rest is searched as text
- **Slideshow** — order, clip length, fade / zoom / slide transitions, titles, sound and repeat, with story bars and taps to move on
- **Haven't watched in a year** shelf and a **Random** button that favours what you rarely see
- **Cover frames** — scrub to the exact frame (a frame or a second at a time) and set it as the thumbnail
- **AirPlay** — play on an Apple TV or AirPlay TV from the viewer
- **History** — everything you watched, day by day, and Stats: streaks, when you watch, month by month, what you rewatch and how much you finish
- **Duplicates and look-alikes** — review a group at a time; the best copy is kept and the others' keywords and rating carried over
- **Multi-select** with batch edits: ratings, flags, status, albums, several keywords at once, or take a keyword off all of them
- **Notifications** — On this day, the yearly Wrapped (1 December), the weekly Wrapped, and new episodes from the Simkl calendar (a bell per title)
- **Private album** with Face ID, its own passcode, a fake passcode and a log of wrong passcodes
- **Storage readout** — what the app holds vs what's free on the device
- **Overview mode** — rate and track your videos like shows, with a spotlight title, a status bar and your ratings 1–10: status, ratings, series with per-episode ratings, and the info of removed videos kept
- **Viewer gestures** — swipe between videos, drag down to close, double-tap to jump 10 s, drag the bar to scrub
- **Memories** — your videos made into little films: on this day, a year ago this month, your first videos, milestones (your 100th video), after dark, trips away from home, big days, the best of each month and season, themes from your tags, favourites, forgotten gems and whole years, played as clips with sound in a Gentle, Upbeat or Epic mood; make your own from a keyword, album, dates and rating, or shuffle
- **Dashboard** — weekly goal ring, a memory for you, things the app noticed, watch time against the period before, On this day memories, favourites to rediscover, habits, taste and ratings
- **Wrapped** — your year, months, weeks or any range as a story that plays your own videos with sound: a guess-your-#1 quiz, a top-5 countdown and list, your #1 of every month, a memory from the time, your video era, comfort video, biggest day, throwback, hidden gem, taste, habits and a persona
- **Badges** — a trophy room of 90+ badges: levels and XP, a full-screen reveal for each new badge, medals you can tilt, a showcase, weekly and monthly challenges, personal records, your journey, and badges for memories, Wrapped, trips and secret dates
- **Live cards** — Dashboard, Memories, Wrapped and History cards play their video with sound while on screen (one at a time, with a mute button)
- **Storage** — how full the phone is, a tidiness grade, big videos you rarely watch to shrink, how long the free space lasts, a map of your biggest videos, ways to free space, how the library grew, and size by quality, keyword, format and year

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
