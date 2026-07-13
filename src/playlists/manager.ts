import {
  createPlaylist,
  getUserPlaylists,
  getPlaylistTrackIds,
  addTracksToPlaylist,
  getCurrentUserId,
} from "../spotify/client";
import { playlistStore } from "../storage/store";
import { ManagedPlaylist } from "../types";
import { config } from "../config";
import { logger } from "../logger";

let cachedUserId: string | null = null;
async function userId(): Promise<string> {
  if (!cachedUserId) cachedUserId = await getCurrentUserId();
  return cachedUserId;
}

/** Loads GenreSync's local playlist index, reconciling it against what actually exists on Spotify. */
export async function syncPlaylistIndex(): Promise<Record<string, ManagedPlaylist>> {
  const local = playlistStore.getAll();
  const remote = await getUserPlaylists();
  const remoteByName = new Map(remote.map((p) => [p.name, p]));

  // Drop local entries whose playlist was deleted on Spotify; keep the rest in sync.
  for (const name of Object.keys(local)) {
    const match = remoteByName.get(name);
    if (!match) {
      delete local[name];
    } else {
      local[name].id = match.id;
    }
  }
  playlistStore.setAll(local);
  return local;
}

/**
 * Ensures every playlist name in `names` exists (creating it on Spotify if needed,
 * up to the configured cap on auto-created playlists), returning their managed records.
 */
export async function ensurePlaylistsExist(
  names: string[],
  meta: { tags: string[]; description?: string }
): Promise<ManagedPlaylist[]> {
  const index = playlistStore.getAll();
  const uid = await userId();
  const results: ManagedPlaylist[] = [];

  const autoCreatedCount = Object.values(index).filter((p) => p.autoCreated).length;

  for (const name of names) {
    if (index[name]) {
      results.push(index[name]);
      continue;
    }

    if (autoCreatedCount >= config.sync.maxAutoPlaylists) {
      logger.warn(
        `Reached MAX_AUTO_PLAYLISTS (${config.sync.maxAutoPlaylists}); skipping creation of "${name}". ` +
          `Increase the limit in .env or create it manually.`
      );
      continue;
    }

    const description =
      meta.description ||
      `Auto-created by GenreSync for tracks tagged: ${meta.tags.join(", ") || name}`;
    const created = await createPlaylist(uid, name, description);
    const playlist: ManagedPlaylist = {
      id: created.id,
      name,
      description,
      tags: meta.tags,
      autoCreated: true,
    };
    playlistStore.upsert(playlist);
    logger.info(`Created new playlist "${name}"`);
    results.push(playlist);
  }

  return results;
}

/** Adds a track URI to each given playlist unless it's already present there. */
export async function addTrackToPlaylists(trackUri: string, trackId: string, playlists: ManagedPlaylist[]): Promise<void> {
  for (const playlist of playlists) {
    const existingIds = await getPlaylistTrackIds(playlist.id);
    if (existingIds.has(trackId)) {
      logger.debug(`Track ${trackId} already in "${playlist.name}", skipping`);
      continue;
    }
    await addTracksToPlaylist(playlist.id, [trackUri]);
    logger.info(`Added track to playlist "${playlist.name}"`);
  }
}
