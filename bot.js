/**
 * StakeCruncher Auto-Clicker Bot
 * Loads saved cookies, navigates to the site, clicks "Claim your drop", closes.
 *
 * Extension support:
 *   Drop your unpacked extension folder at ./extension/
 *   The bot will automatically load it on startup.
 */

import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = join(__dirname, "cookies.json");
const EXTENSION_DIR = join(__dirname, "extension");
const SITE_URL = "https://stakecruncher.com/";
const BUTTON_TEXT = /claim your drop/i;

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function run() {
  // --- Pre-flight checks ---
  if (!existsSync(COOKIES_FILE)) {
    log("ERROR: cookies.json not found. Run 'node import-cookies.js' first.");
    process.exit(1);
  }

  let cookies;
  try {
    cookies = JSON.parse(readFileSync(COOKIES_FILE, "utf-8"));
    if (!Array.isArray(cookies) || cookies.length === 0) {
      throw new Error("cookies.json is empty or not an array.");
    }
  } catch (e) {
    log(`ERROR: Failed to load cookies.json — ${e.message}`);
    process.exit(1);
  }

  const hasExtension = existsSync(EXTENSION_DIR);

  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
  ];

  if (hasExtension) {
    log(`Extension found — loading from: ${EXTENSION_DIR}`);
    launchArgs.push(
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`
    );
  }

  let context;

  try {
    log("Launching headless browser...");

    if (hasExtension) {
      // Extensions require launchPersistentContext in Playwright
      const userDataDir = join(__dirname, ".chrome-profile");
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        args: launchArgs,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 720 },
      });
    } else {
      const browser = await chromium.launch({ headless: true, args: launchArgs });
      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 720 },
      });
    }

    // Load saved cookies
    try {
      await context.addCookies(cookies);
      log(`Loaded ${cookies.length} cookies.`);
    } catch (e) {
      log(`ERROR: Failed to load cookies — ${e.message}`);
      log("Re-run 'node import-cookies.js' with a fresh cookie export.");
      await context.close();
      process.exit(1);
    }

    const page = await context.newPage();

    log(`Navigating to ${SITE_URL} ...`);
    await page.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for page to stabilise
    await page.waitForTimeout(3000);

    // Check if still logged in
    const pageText = (await page.textContent("body")).toLowerCase();
    if (
      pageText.includes("login with discord") ||
      pageText.includes("sign in with discord")
    ) {
      log("WARNING: Appears to be logged out. Your cookies may have expired.");
      log("Re-run 'node import-cookies.js' with fresh cookies from your browser.");
      await page.screenshot({ path: join(__dirname, "logged-out.png") });
      log("Screenshot saved to logged-out.png.");
      await context.close();
      process.exit(1);
    }

    log("Looking for 'Claim your drop' button...");

    const button = page
      .getByRole("button", { name: BUTTON_TEXT })
      .or(page.getByRole("link", { name: BUTTON_TEXT }))
      .or(page.locator(`text=${BUTTON_TEXT}`))
      .first();

    const isVisible = await button.isVisible().catch(() => false);

    if (!isVisible) {
      log("Button not found or not visible. Already claimed today, or page layout changed.");
      await page.screenshot({ path: join(__dirname, "last-run.png") });
      log("Screenshot saved to last-run.png for debugging.");
      await context.close();
      return;
    }

    // --- Snapshot existing buttons BEFORE clicking ---
    // so we can detect NEW buttons that appear after the captcha + animation
    const existingButtonTexts = new Set();
    const existingButtons = await page.locator("button, [role='button'], a[href]").all();
    for (const btn of existingButtons) {
      const text = (await btn.textContent().catch(() => "")).trim();
      if (text) existingButtonTexts.add(text.toLowerCase());
    }
    log(`Snapshotted ${existingButtonTexts.size} existing buttons before click.`);

    log("Found button — clicking...");
    await button.click();
    log("Clicked! Waiting for captcha + animation to complete...");

    let claimClicked = false;
    const maxWait = 3 * 60 * 1000; // up to 3 minutes total
    const pollInterval = 4000;
    const deadline = Date.now() + maxWait;

    // Give at least 15 seconds for captcha to be solved + animation to start
    await page.waitForTimeout(15000);

    while (Date.now() < deadline) {
      await page.waitForTimeout(pollInterval);
      await page.screenshot({ path: join(__dirname, "last-run.png") });

      // Find all currently visible buttons
      const allButtons = await page.locator("button, [role='button']").all();
      const newButtons = [];

      for (const btn of allButtons) {
        const visible = await btn.isVisible().catch(() => false);
        if (!visible) continue;

        const box = await btn.boundingBox().catch(() => null);
        if (!box) continue;

        const text = (await btn.textContent().catch(() => "")).trim();
        if (!text || text.length < 2) continue;

        // Skip buttons that were already on the page before the click
        if (existingButtonTexts.has(text.toLowerCase())) continue;

        // Skip disabled or faded buttons (pouring state)
        const isDisabled = await btn.evaluate((el) => {
          if (el.disabled) return true;
          if (el.getAttribute("disabled") !== null) return true;
          if (el.getAttribute("aria-disabled") === "true") return true;
          // Check opacity — faded buttons are typically < 0.5
          const style = window.getComputedStyle(el);
          const opacity = parseFloat(style.opacity);
          if (opacity < 0.5) return true;
          // Check for common disabled class names
          const cls = el.className || "";
          if (/disabled|faded|inactive|loading|pouring/i.test(cls)) return true;
          return false;
        }).catch(() => false);

        if (isDisabled) {
          log(`Skipping disabled/faded button: "${text}"`);
          continue;
        }

        // Skip if the text itself says "pouring"
        if (/pouring|loading|wait/i.test(text)) {
          log(`Skipping non-interactive button: "${text}"`);
          continue;
        }

        newButtons.push({ btn, box, text });
      }

      if (newButtons.length === 0) {
        log("Waiting... no new enabled buttons yet (animation/pouring still in progress).");
        continue;
      }

      log(`New enabled buttons appeared: ${newButtons.map(b => `"${b.text}"`).join(", ")}`);

      if (newButtons.length >= 2) {
        // Two choice buttons — click the leftmost (claim, not gamble)
        newButtons.sort((a, b) => a.box.x - b.box.x);
        const leftButton = newButtons[0];
        log(`Clicking left button: "${leftButton.text}"`);
        await leftButton.btn.dispatchEvent("click");
        log("Claimed multiplier!");
        claimClicked = true;
        break;
      }

      if (newButtons.length === 1) {
        log(`Clicking the only new enabled button: "${newButtons[0].text}"`);
        await newButtons[0].btn.dispatchEvent("click");
        log("Clicked!");
        claimClicked = true;
        break;
      }
    }

    if (!claimClicked) {
      log("WARNING: Could not find new choice buttons after 3 minutes. Check last-run.png.");
    }

    // Wait 1 minute after claiming before closing
    log("Waiting 1 minute before closing browser...");
    await page.waitForTimeout(60 * 1000);

    await page.screenshot({ path: join(__dirname, "last-run.png") });
    log("Final screenshot saved to last-run.png.");

  } catch (err) {
    log(`ERROR during run: ${err.message}`);
    if (err.message.includes("Executable doesn't exist")) {
      log("Chromium not found. Run: npx playwright install chromium && sudo npx playwright install-deps chromium");
    }
    if (context) {
      await context.close().catch(() => {});
    }
    process.exit(1);
  }

  await context.close();
  log("Browser closed. Done.");
}

run();
