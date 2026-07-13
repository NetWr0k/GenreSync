import { generateJson } from "./gemini";
import { EnrichedTrack, ClassificationResult, ManagedPlaylist } from "../types";
import { tasteProfileStore } from "../storage/store";

const SYSTEM_INSTRUCTION = `You are the classification engine inside GenreSync, a tool that automatically
sorts a Spotify user's Liked Songs into genre/mood playlists.

Given one newly-liked track plus the user's evolving taste profile and their existing playlist set,
decide which playlist(s) the track belongs in. You may:
- assign it to one or more existing playlists, and/or
- propose a brand-new playlist name if nothing existing fits well.

Prefer reusing existing playlists over creating near-duplicates. Only propose a new playlist when the
track represents a genre/mood not already covered.

Respond with ONLY a JSON object of this exact shape, no markdown fences, no commentary:
{
  "playlists": string[],       // one or more playlist names (existing and/or new)
  "primaryGenre": string,      // single best genre label, lowercase
  "mood": string,              // single best mood label, lowercase (e.g. "energetic", "mellow", "melancholic")
  "confidence": number,        // 0.0 - 1.0
  "reasoning": string          // one or two sentences explaining the call
}`;

function buildUserPrompt(
  track: EnrichedTrack,
  existingPlaylists: ManagedPlaylist[],
  tasteProfileText: string
): string {
  const playlistLines =
    existingPlaylists.length > 0
      ? existingPlaylists
          .map((p) => `- "${p.name}": ${p.description || "(no description)"} [tags: ${p.tags.join(", ") || "none"}]`)
          .join("\n")
      : "(none yet — this may be one of the first tracks GenreSync has classified)";

  const featuresText = track.audioFeatures
    ? `danceability=${track.audioFeatures.danceability.toFixed(2)}, energy=${track.audioFeatures.energy.toFixed(
        2
      )}, valence=${track.audioFeatures.valence.toFixed(2)}, tempo=${track.audioFeatures.tempo.toFixed(
        0
      )}bpm, acousticness=${track.audioFeatures.acousticness.toFixed(
        2
      )}, instrumentalness=${track.audioFeatures.instrumentalness.toFixed(2)}`
    : "unavailable";

  return `USER TASTE PROFILE (learned so far):
${tasteProfileText}

EXISTING PLAYLISTS:
${playlistLines}

NEW TRACK TO CLASSIFY:
- Title: ${track.name}
- Artist(s): ${track.artists.map((a) => a.name).join(", ")}
- Album: ${track.album}
- Artist genre tags from Spotify: ${track.artistGenres.join(", ") || "none available"}
- Audio features: ${featuresText}
- Popularity: ${track.popularity}/100

Classify this track now.`;
}

export async function classifyTrack(
  track: EnrichedTrack,
  existingPlaylists: ManagedPlaylist[]
): Promise<ClassificationResult> {
  const profile = tasteProfileStore.get();
  const prompt = buildUserPrompt(track, existingPlaylists, profile.profileText);
  const result = await generateJson<ClassificationResult>(SYSTEM_INSTRUCTION, prompt);

  // Basic shape guarding in case the model drifts from the schema.
  return {
    playlists: Array.isArray(result.playlists) && result.playlists.length > 0 ? result.playlists : ["Uncategorized"],
    primaryGenre: result.primaryGenre || "unknown",
    mood: result.mood || "unknown",
    confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
    reasoning: result.reasoning || "",
  };
}
