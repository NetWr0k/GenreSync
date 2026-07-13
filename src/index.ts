import { config } from "./config";
import { logger } from "./logger";
import { runLoginFlow } from "./spotify/auth";
import { pollForNewLikedTracks, checkForCorrections } from "./sync/poller";
import { rebuildTasteProfile } from "./ai/tasteProfile";
import { playlistStore, tasteProfileStore } from "./storage/store";

async function runDaemon(): Promise<void> {
  logger.info("GenreSync starting up...");
  logger.info(
    `Polling Liked Songs every ${config.sync.pollIntervalMs / 1000}s, ` +
      `checking for corrections every ${config.sync.correctionCheckIntervalMs / 1000}s.`
  );

  const tick = async () => {
    try {
      await pollForNewLikedTracks();
    } catch (err) {
      logger.error(`Poll cycle failed: ${(err as Error).message}`);
    }
  };

  const correctionTick = async () => {
    try {
      await checkForCorrections();
    } catch (err) {
      logger.error(`Correction check failed: ${(err as Error).message}`);
    }
  };

  await tick();
  setInterval(tick, config.sync.pollIntervalMs);
  setInterval(correctionTick, config.sync.correctionCheckIntervalMs);
}

async function main() {
  const command = process.argv[2] || "run";

  switch (command) {
    case "auth":
      await runLoginFlow();
      logger.info("Spotify authentication complete. You can now run `npm start`.");
      break;

    case "run":
      await runDaemon();
      break;

    case "once":
      await pollForNewLikedTracks();
      await checkForCorrections();
      break;

    case "profile:rebuild":
      await rebuildTasteProfile();
      console.log(tasteProfileStore.get().profileText);
      break;

    case "playlists:list": {
      const all = playlistStore.getAll();
      const names = Object.keys(all);
      if (names.length === 0) {
        console.log("No managed playlists yet.");
      } else {
        for (const name of names) {
          const p = all[name];
          console.log(`- ${p.name}${p.autoCreated ? " (auto-created)" : ""} — tags: ${p.tags.join(", ")}`);
        }
      }
      break;
    }

    default:
      console.log(`Unknown command: ${command}
Available commands:
  auth              One-time Spotify OAuth login
  run               Start the background sync daemon (default)
  once              Run a single poll + correction-check cycle and exit
  profile:rebuild   Force a taste-profile rebuild from history
  playlists:list    List playlists GenreSync currently manages`);
      process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err.message || String(err));
  process.exit(1);
});
