# GenreSync

**GenreSync** automatically organizes your Spotify Liked Songs. Every time you like a new
track, GenreSync notices, sends it to Google's Gemini API for classification, and files it into
the right genre/mood playlist — creating new playlists on the fly if nothing fits. Over time it
builds a "taste profile" from your listening and correction history, so classification quality
compounds the longer it runs.

## How it works

Spotify has no push notifications for "liked songs changed," so GenreSync **polls**:

```
┌─────────────┐   poll every N sec   ┌───────────────────┐
│ Spotify API  │ ───────────────────▶│  Liked Songs diff  │
└─────────────┘                      └─────────┬──────────┘
                                                │ new track(s) found
                                                ▼
                          ┌────────────────────────────────────┐
                          │ Enrich: audio features + artist     │
                          │ genres (Spotify) + taste profile     │
                          └─────────────────┬────────────────────┘
                                            ▼
                              ┌───────────────────────────┐
                              │  Gemini classification     │
                              │  → playlists, genre, mood  │
                              └─────────────┬───────────────┘
                                            ▼
                         ┌──────────────────────────────────────┐
                         │ Create playlist(s) if needed, add     │
                         │ track, log to history                 │
                         └─────────────────┬──────────────────────┘
                                            ▼
                     ┌───────────────────────────────────────────┐
                     │ Every N classifications, or when manual    │
                     │ corrections are detected, Gemini rewrites   │
                     │ the taste profile from recent history       │
                     └───────────────────────────────────────────┘
```

A second, slower loop periodically re-checks GenreSync-managed playlists. If you manually move or
remove a track GenreSync placed, that's logged as a **correction** — a negative training signal
that feeds into the next taste-profile rewrite. This is GenreSync's "dynamic learning": Gemini
itself isn't fine-tuned, but the context it's given on every call evolves based on your actual
behavior, so its classifications get closer to your taste over time.

## Features

- **Change detection** — polls `Liked Songs`, diffs against the last known snapshot, and only
  processes tracks added since the last check (your existing library is baselined on first run,
  not retroactively classified).
- **AI classification** — each new track is enriched with Spotify audio features (danceability,
  energy, valence, tempo, etc.) and artist genre tags, then sent to Gemini along with your current
  taste profile and existing playlists to decide where it belongs.
- **Dynamic playlist creation** — if nothing existing fits, GenreSync can name and create a new
  playlist itself (capped by `MAX_AUTO_PLAYLISTS` so it doesn't run wild).
- **Correction detection & learning** — if you manually move/remove a track, GenreSync notices on
  its next check and factors that feedback into the next taste-profile rebuild.
- **Local-first state** — all state (tokens, snapshots, playlist index, taste profile,
  classification history) lives in plain JSON files under `./data/`, no external database needed.

## Prerequisites

- Node.js 18+
- A [Spotify Developer](https://developer.spotify.com/dashboard) app (free)
- A [Gemini API key](https://aistudio.google.com/apikey) (free tier available)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Spotify app**

   - Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → *Create app*.
   - Add a Redirect URI: `http://127.0.0.1:8888/callback` (or whatever you set in `.env`).
   - Copy the **Client ID** and **Client Secret**.

3. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Fill in:
   - `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`
   - `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, default `gemini-2.0-flash`)
   - Tune `POLL_INTERVAL_MS`, `CORRECTION_CHECK_INTERVAL_MS`, `PROFILE_REBUILD_EVERY_N`,
     `MAX_AUTO_PLAYLISTS` as you like.

4. **Authenticate with Spotify (one-time)**

   ```bash
   npm run auth
   ```

   This prints a URL — open it, log in, approve access. Tokens are saved to `data/tokens.json`
   and refreshed automatically afterward; you shouldn't need to run this again unless you revoke
   access.

5. **Run it**

   ```bash
   npm run build
   npm start          # long-running daemon: polls forever
   # or, for a single check-and-exit run:
   npm run once
   ```

   For development without a build step: `npm run dev`.

## CLI commands

| Command                  | What it does                                                            |
|---------------------------|--------------------------------------------------------------------------|
| `npm run auth`            | One-time Spotify OAuth login                                             |
| `npm start` / `npm run dev`| Start the long-running daemon (polls + correction checks on their own intervals) |
| `npm run once`            | Run a single poll + correction-check cycle, then exit (good for cron)    |
| `npm run profile:rebuild` | Force-rebuild the taste profile from history right now                  |
| `npm run playlists:list`  | List playlists GenreSync currently manages                              |

## Running continuously

`npm start` runs in the foreground with its own internal timers — fine for a always-on machine
or a small VPS. For production-style deployment, either:

- run it under a process manager (`pm2 start dist/index.js --name genresync -- run`, or a
  `systemd` unit), or
- disable the internal loop by instead calling `npm run once` from `cron` every minute/five
  minutes, which polls once and exits.

## Data & privacy

Everything GenreSync remembers lives in `./data/` (git-ignored):

- `tokens.json` — Spotify OAuth tokens
- `sync-state.json` — last-seen Liked Songs snapshot + track→playlist assignment map
- `playlists.json` — index of playlists GenreSync manages
- `taste-profile.json` — the current learned taste-profile text
- `history.json` — append-only classification log (used to rebuild the taste profile and detect corrections)

No track data or listening history leaves your machine except what's sent to the Spotify Web API
(to read/act on your library) and the Gemini API (track metadata + your taste profile text, for
classification).

## Project structure

```
src/
  config.ts              env loading/validation
  logger.ts               tiny timestamped logger
  types.ts                shared TypeScript types
  storage/store.ts        JSON file-backed persistence
  spotify/
    auth.ts                PKCE OAuth login + token refresh
    client.ts               Spotify Web API wrapper
  ai/
    gemini.ts                generic Gemini JSON-generation client
    classifier.ts             builds the per-track classification prompt
    tasteProfile.ts            rebuilds the taste profile from history/corrections
  playlists/manager.ts     ensures playlists exist, adds tracks idempotently
  sync/poller.ts           change detection, correction detection, orchestration
  index.ts                CLI entrypoint
```

## Limitations / notes

- Spotify's API has no real-time push for library changes, so "detects change in the catalog"
  means polling on an interval — lower `POLL_INTERVAL_MS` for snappier detection at the cost of
  more API calls.
- Audio-features can be unavailable for some tracks (e.g. very new releases, local files);
  GenreSync degrades gracefully and classifies on genre tags + metadata alone in that case.
- Gemini isn't literally fine-tuned per-user — "learning" happens by evolving the taste-profile
  text that's injected into every future prompt, based on real classification history and
  detected corrections.
