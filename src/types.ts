// Shared domain types used across GenreSync.

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix ms timestamp when accessToken expires */
  expiresAt: number;
  scope: string;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: { id: string; name: string }[];
  album: string;
  addedAt: string; // ISO timestamp from Spotify's "added_at" field
  durationMs: number;
  popularity: number;
}

export interface AudioFeatures {
  danceability: number;
  energy: number;
  valence: number;
  tempo: number;
  acousticness: number;
  instrumentalness: number;
}

export interface EnrichedTrack extends SpotifyTrack {
  artistGenres: string[];
  audioFeatures: AudioFeatures | null;
}

export interface ManagedPlaylist {
  id: string;
  name: string;
  description: string;
  /** genre/mood tags GenreSync associates with this playlist */
  tags: string[];
  /** true if GenreSync created this playlist itself */
  autoCreated: boolean;
}

export interface ClassificationResult {
  /** Playlist names the track should be added to. May include brand-new names. */
  playlists: string[];
  primaryGenre: string;
  mood: string;
  /** 0..1 model confidence */
  confidence: number;
  reasoning: string;
}

export interface HistoryEntry {
  trackId: string;
  trackName: string;
  artistNames: string[];
  primaryGenre: string;
  mood: string;
  confidence: number;
  assignedPlaylists: string[];
  reasoning: string;
  timestamp: string;
  /** Set once GenreSync notices the user disagreed with a placement */
  correction?: {
    removedFrom: string[];
    movedTo: string[];
    detectedAt: string;
  };
}

export interface TasteProfile {
  /** Free-text summary Gemini maintains/updates describing the user's taste */
  profileText: string;
  lastRebuiltAt: string | null;
  classificationsSinceRebuild: number;
}

export interface SyncState {
  /** Track IDs seen in Liked Songs as of the last poll, newest first */
  lastKnownLikedTrackIds: string[];
  /** trackId -> playlist names it was last placed into, used to detect corrections */
  trackPlaylistMap: Record<string, string[]>;
  lastPolledAt: string | null;
  lastCorrectionCheckAt: string | null;
}
