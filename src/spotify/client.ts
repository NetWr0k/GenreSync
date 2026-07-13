import fetch from "node-fetch";
import { getValidAccessToken } from "./auth";
import { logger } from "../logger";
import { SpotifyTrack, AudioFeatures, SpotifyArtist } from "../types";

const BASE = "https://api.spotify.com/v1";

async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") || "1");
    logger.warn(`Rate limited by Spotify, waiting ${retryAfter}s`);
    await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
    return api<T>(path, init);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API error ${res.status} on ${path}: ${text}`);
  }

  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

interface SavedTracksResponse {
  items: {
    added_at: string;
    track: {
      id: string;
      uri: string;
      name: string;
      duration_ms: number;
      popularity: number;
      album: { name: string };
      artists: { id: string; name: string }[];
    };
  }[];
  next: string | null;
  total: number;
}

/**
 * Fetches the most recently liked tracks (newest first), up to `limit`.
 * Spotify returns Liked Songs in reverse-chronological order by default.
 */
export async function getRecentLikedTracks(limit = 50): Promise<SpotifyTrack[]> {
  const data = await api<SavedTracksResponse>(`/me/tracks?limit=${limit}`);
  return data.items.map((item) => ({
    id: item.track.id,
    uri: item.track.uri,
    name: item.track.name,
    artists: item.track.artists.map((a) => ({ id: a.id, name: a.name })),
    album: item.track.album.name,
    addedAt: item.added_at,
    durationMs: item.track.duration_ms,
    popularity: item.track.popularity,
  }));
}

export async function getAudioFeatures(trackId: string): Promise<AudioFeatures | null> {
  try {
    const data = await api<{
      danceability: number;
      energy: number;
      valence: number;
      tempo: number;
      acousticness: number;
      instrumentalness: number;
    }>(`/audio-features/${trackId}`);
    return {
      danceability: data.danceability,
      energy: data.energy,
      valence: data.valence,
      tempo: data.tempo,
      acousticness: data.acousticness,
      instrumentalness: data.instrumentalness,
    };
  } catch (err) {
    // Audio features are sometimes unavailable (e.g. podcasts/local files); degrade gracefully.
    logger.debug(`No audio features for track ${trackId}: ${(err as Error).message}`);
    return null;
  }
}

export async function getArtistsGenres(artistIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (artistIds.length === 0) return result;

  // Spotify allows up to 50 artist IDs per request.
  const chunks: string[][] = [];
  for (let i = 0; i < artistIds.length; i += 50) chunks.push(artistIds.slice(i, i + 50));

  for (const chunk of chunks) {
    const data = await api<{ artists: SpotifyArtist[] }>(
      `/artists?ids=${chunk.join(",")}`
    );
    for (const artist of data.artists) {
      result.set(artist.id, artist.genres || []);
    }
  }
  return result;
}

export async function getCurrentUserId(): Promise<string> {
  const data = await api<{ id: string }>("/me");
  return data.id;
}

interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  description: string;
}

export async function getUserPlaylists(): Promise<SpotifyPlaylistSummary[]> {
  const results: SpotifyPlaylistSummary[] = [];
  let url: string | null = "/me/playlists?limit=50";
  while (url) {
    const data: {
      items: SpotifyPlaylistSummary[];
      next: string | null;
    } = await api(url);
    results.push(...data.items.map((p) => ({ id: p.id, name: p.name, description: p.description })));
    url = data.next ? data.next.replace(BASE, "") : null;
  }
  return results;
}

export async function createPlaylist(
  userId: string,
  name: string,
  description: string
): Promise<{ id: string }> {
  return api<{ id: string }>(`/users/${userId}/playlists`, {
    method: "POST",
    body: { name, description, public: false },
  });
}

export async function getPlaylistTrackIds(playlistId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let url: string | null = `/playlists/${playlistId}/tracks?fields=items(track(id)),next&limit=100`;
  while (url) {
    const data: {
      items: { track: { id: string | null } | null }[];
      next: string | null;
    } = await api(url);
    for (const item of data.items) {
      if (item.track?.id) ids.add(item.track.id);
    }
    url = data.next ? data.next.replace(BASE, "") : null;
  }
  return ids;
}

export async function addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
  // Spotify allows up to 100 URIs per request.
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    await api(`/playlists/${playlistId}/tracks`, { method: "POST", body: { uris: chunk } });
  }
}
