import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import {
  SpotifyTokens,
  SyncState,
  ManagedPlaylist,
  TasteProfile,
  HistoryEntry,
} from "../types";

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

function readJson<T>(file: string, fallback: T): T {
  ensureDataDir();
  const p = path.join(config.dataDir, file);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(file: string, data: T): void {
  ensureDataDir();
  const p = path.join(config.dataDir, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// --- Tokens ---
export const tokenStore = {
  get(): SpotifyTokens | null {
    return readJson<SpotifyTokens | null>("tokens.json", null);
  },
  set(tokens: SpotifyTokens): void {
    writeJson("tokens.json", tokens);
  },
};

// --- Sync state (last-seen liked tracks, playlist assignment map) ---
const defaultSyncState: SyncState = {
  lastKnownLikedTrackIds: [],
  trackPlaylistMap: {},
  lastPolledAt: null,
  lastCorrectionCheckAt: null,
};

export const syncStateStore = {
  get(): SyncState {
    return readJson<SyncState>("sync-state.json", { ...defaultSyncState });
  },
  set(state: SyncState): void {
    writeJson("sync-state.json", state);
  },
};

// --- Managed playlists index (name -> playlist metadata) ---
export const playlistStore = {
  getAll(): Record<string, ManagedPlaylist> {
    return readJson<Record<string, ManagedPlaylist>>("playlists.json", {});
  },
  setAll(playlists: Record<string, ManagedPlaylist>): void {
    writeJson("playlists.json", playlists);
  },
  upsert(playlist: ManagedPlaylist): void {
    const all = playlistStore.getAll();
    all[playlist.name] = playlist;
    playlistStore.setAll(all);
  },
};

// --- Taste profile ---
const defaultProfile: TasteProfile = {
  profileText:
    "No listening history yet. Classify tracks using general genre/mood conventions until enough data accumulates.",
  lastRebuiltAt: null,
  classificationsSinceRebuild: 0,
};

export const tasteProfileStore = {
  get(): TasteProfile {
    return readJson<TasteProfile>("taste-profile.json", { ...defaultProfile });
  },
  set(profile: TasteProfile): void {
    writeJson("taste-profile.json", profile);
  },
};

// --- Classification history (append-only log, used to rebuild taste profile & detect corrections) ---
export const historyStore = {
  getAll(): HistoryEntry[] {
    return readJson<HistoryEntry[]>("history.json", []);
  },
  append(entry: HistoryEntry): void {
    const all = historyStore.getAll();
    all.push(entry);
    writeJson("history.json", all);
  },
  updateByTrackId(trackId: string, patch: Partial<HistoryEntry>): void {
    const all = historyStore.getAll();
    const idx = all.findIndex((h) => h.trackId === trackId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...patch };
      writeJson("history.json", all);
    }
  },
  recent(n: number): HistoryEntry[] {
    const all = historyStore.getAll();
    return all.slice(Math.max(0, all.length - n));
  },
};
