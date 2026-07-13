import { generateJson } from "./gemini";
import { tasteProfileStore, historyStore } from "../storage/store";
import { config } from "../config";
import { logger } from "../logger";
import { HistoryEntry } from "../types";

const SYSTEM_INSTRUCTION = `You maintain a running "taste profile" for a Spotify user, used by another AI step
to classify their newly-liked songs into genre/mood playlists.

You will be given the previous taste profile plus a batch of recent classification history, including
any corrections (cases where the user later moved or removed a track from where it was auto-placed,
which is a strong negative signal — that placement was wrong).

Write an updated taste profile: a concise but specific paragraph (roughly 100-200 words) describing:
- genres/subgenres the user actually favors, including edge cases or blends they like
- moods and contexts they tend to sort tracks by
- any patterns in what NOT to do, learned from corrections
- anything notable about how they name/organize playlists

Respond with ONLY a JSON object of this exact shape, no markdown fences, no commentary:
{
  "profileText": string
}`;

function summarizeHistoryForPrompt(entries: HistoryEntry[]): string {
  return entries
    .map((e) => {
      const base = `- "${e.trackName}" by ${e.artistNames.join(", ")} → genre=${e.primaryGenre}, mood=${
        e.mood
      }, placed in [${e.assignedPlaylists.join(", ")}]`;
      if (e.correction) {
        return `${base} | CORRECTION: user removed it from [${e.correction.removedFrom.join(
          ", "
        )}] and it ended up in [${e.correction.movedTo.join(", ") || "nowhere (removed)"}]`;
      }
      return base;
    })
    .join("\n");
}

/** Returns true if enough new classifications have accumulated to justify a rebuild. */
export function shouldRebuildProfile(): boolean {
  const profile = tasteProfileStore.get();
  return profile.classificationsSinceRebuild >= config.sync.profileRebuildEveryN;
}

/** Call after each successful classification to track progress toward the next rebuild. */
export function noteClassificationHappened(): void {
  const profile = tasteProfileStore.get();
  profile.classificationsSinceRebuild += 1;
  tasteProfileStore.set(profile);
}

/**
 * Regenerates the taste profile from recent history (and any corrections found within it).
 * This is GenreSync's "dynamic learning" step — it doesn't fine-tune Gemini, but it evolves
 * the context Gemini is given for every future classification, so behavior compounds over time.
 */
export async function rebuildTasteProfile(): Promise<void> {
  const profile = tasteProfileStore.get();
  const recent = historyStore.recent(50);

  if (recent.length === 0) {
    logger.info("No history yet, skipping taste profile rebuild.");
    return;
  }

  const prompt = `PREVIOUS TASTE PROFILE:
${profile.profileText}

RECENT CLASSIFICATION HISTORY (most recent last):
${summarizeHistoryForPrompt(recent)}

Rewrite the taste profile now, incorporating anything useful learned above.`;

  const result = await generateJson<{ profileText: string }>(SYSTEM_INSTRUCTION, prompt);

  tasteProfileStore.set({
    profileText: result.profileText || profile.profileText,
    lastRebuiltAt: new Date().toISOString(),
    classificationsSinceRebuild: 0,
  });

  logger.info("Taste profile rebuilt from recent history.");
}
