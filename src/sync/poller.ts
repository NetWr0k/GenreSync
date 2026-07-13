import {
  getRecentLikedTracks,
  getAudioFeatures,
  getArtistsGenres,
  getPlaylistTrackIds,
} from "../spotify/client";
import { classifyTrack } from "../ai/classifier";
import { ensurePlaylistsExist, addTrackToPlaylists, syncPlaylistIndex } from "../playlists/manager";
import { syncStateStore, historyStore, playlistStore } from "../storage/store";
import { rebuildTasteProfile, shouldRebuildProfile, noteClassificationHappened } from "../ai/tasteProfile";
import { logger } from "../logger";
import { EnrichedTrack, SpotifyTrack, ManagedPlaylist } from "../types";

async function enrichTrack(track: SpotifyTrack): Promise<EnrichedTrack> {
  const artistIds = track.artists.map((a) => a.id).filter(Boolean);
  const [audioFeatures, genresByArtist] = await Promise.all([
    getAudioFeatures(track.id),
    getArtistsGenres(artistIds),
  ]);

  const artistGenres = Array.from(
    new Set(artistIds.flatMap((id) => genresByArtist.get(id) || []))
  );

  return { ...track, artistGenres, audioFeatures };
}

async function processNewTrack(track: SpotifyTrack): Promise<void> {
  logger.info(`New liked track detected: "${track.name}" by ${track.artists.map((a) => a.name).join(", ")}`);

  const enriched = await enrichTrack(track);
  const existingPlaylists = Object.values(playlistStore.getAll());

  const classification = await classifyTrack(enriched, existingPlaylists);
  logger.info(
    `Classified "${track.name}" as genre=${classification.primaryGenre}, mood=${classification.mood} ` +
      `(confidence ${classification.confidence.toFixed(2)}) -> [${classification.playlists.join(", ")}]`
  );

  const targetPlaylists: ManagedPlaylist[] = await ensurePlaylistsExist(classification.playlists, {
    tags: [classification.primaryGenre, classification.mood],
  });

  if (targetPlaylists.length > 0) {
    await addTrackToPlaylists(track.uri, track.id, targetPlaylists);
  }

  historyStore.append({
    trackId: track.id,
    trackName: track.name,
    artistNames: track.artists.map((a) => a.name),
    primaryGenre: classification.primaryGenre,
    mood: classification.mood,
    confidence: classification.confidence,
    assignedPlaylists: targetPlaylists.map((p) => p.name),
    reasoning: classification.reasoning,
    timestamp: new Date().toISOString(),
  });

  const state = syncStateStore.get();
  state.trackPlaylistMap[track.id] = targetPlaylists.map((p) => p.name);
  syncStateStore.set(state);

  noteClassificationHappened();
}

/**
 * Polls Liked Songs, diffs against the last known snapshot, and processes any tracks
 * added since the last poll (oldest-first, so playlist assignment order feels natural).
 */
export async function pollForNewLikedTracks(): Promise<void> {
  const state = syncStateStore.get();
  const recent = await getRecentLikedTracks(50);

  if (state.lastKnownLikedTrackIds.length === 0) {
    // First run: baseline the snapshot without classifying the user's entire back catalog.
    logger.info(
      `First run detected. Baselining against ${recent.length} existing liked tracks ` +
        `(these will NOT be classified retroactively; only future additions will be).`
    );
    state.lastKnownLikedTrackIds = recent.map((t) => t.id);
    state.lastPolledAt = new Date().toISOString();
    syncStateStore.set(state);
    return;
  }

  const knownSet = new Set(state.lastKnownLikedTrackIds);
  const newTracks: SpotifyTrack[] = [];
  for (const track of recent) {
    if (knownSet.has(track.id)) break; // recent[] is newest-first; stop at first already-known track
    newTracks.push(track);
  }

  if (newTracks.length === 0) {
    logger.debug("No new liked tracks since last poll.");
  } else {
    logger.info(`Found ${newTracks.length} newly liked track(s).`);
    // Process oldest-first so ordering of playlist additions matches the order they were liked.
    for (const track of newTracks.reverse()) {
      try {
        await processNewTrack(track);
      } catch (err) {
        logger.error(`Failed to process track "${track.name}": ${(err as Error).message}`);
      }
    }
  }

  const refreshed = await getRecentLikedTracks(50);
  const latestState = syncStateStore.get();
  latestState.lastKnownLikedTrackIds = refreshed.map((t) => t.id);
  latestState.lastPolledAt = new Date().toISOString();
  syncStateStore.set(latestState);

  if (shouldRebuildProfile()) {
    try {
      await rebuildTasteProfile();
    } catch (err) {
      logger.error(`Taste profile rebuild failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Checks GenreSync-managed playlists to see whether the user manually moved or removed
 * a track GenreSync placed. This is the feedback signal that drives taste-profile learning.
 */
export async function checkForCorrections(): Promise<void> {
  const state = syncStateStore.get();
  const playlists = await syncPlaylistIndex();
  const playlistNames = Object.keys(playlists);

  if (playlistNames.length === 0) return;

  const trackIdsToCheck = Object.keys(state.trackPlaylistMap);
  if (trackIdsToCheck.length === 0) return;

  logger.debug(`Checking ${trackIdsToCheck.length} previously-classified track(s) for corrections...`);

  // Build a membership map: which managed playlists currently contain which track IDs.
  const membership = new Map<string, Set<string>>(); // trackId -> set of playlist names it's currently in
  for (const name of playlistNames) {
    const playlist = playlists[name];
    const ids = await getPlaylistTrackIds(playlist.id);
    for (const id of ids) {
      if (!membership.has(id)) membership.set(id, new Set());
      membership.get(id)!.add(name);
    }
  }

  let correctionsFound = 0;
  for (const trackId of trackIdsToCheck) {
    const assignedTo = new Set(state.trackPlaylistMap[trackId]);
    const currentlyIn = membership.get(trackId) || new Set<string>();

    const removedFrom = [...assignedTo].filter((name) => !currentlyIn.has(name));
    const movedTo = [...currentlyIn].filter((name) => !assignedTo.has(name));

    if (removedFrom.length === 0 && movedTo.length === 0) continue;

    correctionsFound++;
    historyStore.updateByTrackId(trackId, {
      correction: {
        removedFrom,
        movedTo,
        detectedAt: new Date().toISOString(),
      },
    });

    // Update our record of where the track lives so we don't re-report the same correction.
    state.trackPlaylistMap[trackId] = [...currentlyIn];
  }

  state.lastCorrectionCheckAt = new Date().toISOString();
  syncStateStore.set(state);

  if (correctionsFound > 0) {
    logger.info(`Detected ${correctionsFound} manual correction(s); will factor into next taste profile rebuild.`);
  }
}
