import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  spotify: {
    clientId: required("SPOTIFY_CLIENT_ID"),
    clientSecret: required("SPOTIFY_CLIENT_SECRET"),
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:8888/callback",
    scopes: [
      "user-library-read",
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-public",
      "playlist-modify-private",
    ].join(" "),
  },
  gemini: {
    apiKey: required("GEMINI_API_KEY"),
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  },
  sync: {
    pollIntervalMs: int("POLL_INTERVAL_MS", 60_000),
    correctionCheckIntervalMs: int("CORRECTION_CHECK_INTERVAL_MS", 300_000),
    profileRebuildEveryN: int("PROFILE_REBUILD_EVERY_N", 10),
    maxAutoPlaylists: int("MAX_AUTO_PLAYLISTS", 25),
  },
  auth: {
    callbackPort: int("AUTH_CALLBACK_PORT", 8888),
  },
  dataDir: path.join(process.cwd(), "data"),
};

export type Config = typeof config;
