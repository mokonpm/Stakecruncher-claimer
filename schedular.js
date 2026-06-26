/**
 * StakeCruncher Bot Scheduler
 * Runs the bot once immediately, then every 60–80 minutes (randomised).
 * Keep this running in a tmux/screen session or as a systemd service.
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_SCRIPT = join(__dirname, "bot.js");

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function humanMs(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function runBot() {
  return new Promise((resolve) => {
    log("─── Starting bot run ───────────────────────────────────");
    const child = spawn("node", [BOT_SCRIPT], {
      stdio: "inherit",
      cwd: __dirname,
    });

    child.on("close", (code) => {
      if (code === 0 || code === null) {
        log("─── Bot run finished successfully ──────────────────────");
      } else {
        log(`─── Bot run exited with code ${code} ────────────────────`);
      }
      resolve();
    });

    child.on("error", (err) => {
      log(`─── Failed to start bot: ${err.message} ────────────────`);
      resolve();
    });
  });
}

async function loop() {
  log("StakeCruncher scheduler started.");
  log("Press Ctrl+C to stop.");
  log("");

  // Run immediately on first start
  await runBot();

  while (true) {
    const delayMs = randomBetween(60 * 60 * 1000, 80 * 60 * 1000); // 60–80 min
    const nextRun = new Date(Date.now() + delayMs);
    log(
      `Next run in ${humanMs(delayMs)} (at ${nextRun.toLocaleTimeString()})`
    );

    await new Promise((res) => setTimeout(res, delayMs));
    await runBot();
  }
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  log("Scheduler stopped by user.");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Scheduler received SIGTERM, shutting down.");
  process.exit(0);
});

loop().catch((err) => {
  log(`Fatal scheduler error: ${err.message}`);
  process.exit(1);
});
