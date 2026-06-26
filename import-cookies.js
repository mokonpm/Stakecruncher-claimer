/**
 * Cookie Importer
 * Paste cookies exported from "Cookie Editor" browser extension.
 *
 * Supported input:
 *   Cookie Editor extension JSON export (array of objects)
 *
 * Normalises sameSite values and validates required fields before saving.
 */

import { createInterface } from "readline";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = join(__dirname, "cookies.json");
const TARGET_DOMAIN = "stakecruncher.com";

function log(msg) {
  console.log(msg);
}

/**
 * Map any sameSite variant to Playwright's accepted enum.
 * Playwright accepts: "Lax" | "None" | "Strict"
 */
function normaliseSameSite(raw) {
  if (!raw) return "Lax";
  const val = String(raw).toLowerCase().replace(/[_\s-]/g, "");
  if (val === "strict") return "Strict";
  if (val === "none" || val === "norestriction") return "None";
  return "Lax"; // default covers "lax", "unspecified", "no_restriction", unknown values
}

/**
 * Convert a Cookie Editor JSON array to Playwright cookie format.
 */
function normaliseCookies(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      "Expected a JSON array of cookies. Make sure you used 'Export as JSON' in Cookie Editor."
    );
  }

  const results = [];
  const skipped = [];

  for (const c of raw) {
    // Required fields
    if (!c.name || c.value === undefined) {
      skipped.push(`Skipped cookie missing name/value: ${JSON.stringify(c)}`);
      continue;
    }

    const domain = c.domain || `.${TARGET_DOMAIN}`;

    results.push({
      name: String(c.name),
      value: String(c.value),
      domain: domain.startsWith(".") ? domain : `.${domain}`,
      path: c.path || "/",
      // expirationDate is Cookie Editor's field; expires is Playwright's
      expires: c.expirationDate ?? c.expires ?? -1,
      httpOnly: Boolean(c.httpOnly ?? false),
      secure: Boolean(c.secure ?? false),
      sameSite: normaliseSameSite(c.sameSite),
    });
  }

  if (skipped.length > 0) {
    log(`\nWarnings (${skipped.length} cookies skipped):`);
    skipped.forEach((s) => log(`  ${s}`));
  }

  return results;
}

async function main() {
  log("");
  log("=== StakeCruncher Cookie Importer ===");
  log("");
  log("HOW TO EXPORT COOKIES (do this on any device where you're logged in):");
  log("─────────────────────────────────────────────────────────────────────");
  log("");
  log("1. On a PC or Mac (Chrome or Firefox), install 'Cookie Editor':");
  log("   Chrome:  https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm");
  log("   Firefox: https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/");
  log("");
  log("2. Log in to https://stakecruncher.com with Discord");
  log("");
  log("3. Click the Cookie Editor icon in your browser toolbar");
  log("");
  log("4. Click 'Export' → 'Export as JSON'  (copies to clipboard)");
  log("");
  log("5. Paste that JSON here and press Enter, then Ctrl+D");
  log("");
  log("─────────────────────────────────────────────────────────────────────");
  log("Paste cookie JSON below (then press Enter + Ctrl+D to finish):");
  log("");

  const rl = createInterface({ input: process.stdin });
  let input = "";

  rl.on("line", (line) => {
    input += line + "\n";
  });

  rl.on("close", () => {
    const trimmed = input.trim();
    if (!trimmed) {
      log("No input received. Exiting.");
      process.exit(1);
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      log(`\nERROR: Could not parse JSON — ${e.message}`);
      log("Make sure you clicked 'Export as JSON' in Cookie Editor, not another format.");
      process.exit(1);
    }

    let cookies;
    try {
      cookies = normaliseCookies(parsed);
    } catch (e) {
      log(`\nERROR: ${e.message}`);
      process.exit(1);
    }

    if (cookies.length === 0) {
      log("\nERROR: No valid cookies found after parsing. Nothing saved.");
      process.exit(1);
    }

    // Prefer cookies from the target domain; if none matched, keep all
    const siteOnly = cookies.filter(
      (c) =>
        c.domain.includes(TARGET_DOMAIN) ||
        c.domain.includes("discord.com") ||
        c.domain.includes("discordapp.com")
    );
    const finalCookies = siteOnly.length > 0 ? siteOnly : cookies;

    writeFileSync(COOKIES_FILE, JSON.stringify(finalCookies, null, 2));
    log("");
    log(`✓ Saved ${finalCookies.length} cookies to cookies.json`);
    log("");
    log("Next steps:");
    log("  Test a single run:      node bot.js");
    log("  Start the scheduler:    node scheduler.js");
  });
}

main();
