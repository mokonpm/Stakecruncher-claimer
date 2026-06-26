/**
 * StakeCruncher Auto-Clicker Bot
 * Loads saved cookies, navigates to the site, clicks "Claim your drop", closes.
 */

import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = join(__dirname, "cookies.json");
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

  let browser;
  try {
    log("Launching headless browser...");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });

    // Load saved cookies
    try {
      await context.addCookies(cookies);
      log(`Loaded ${cookies.length} cookies.`);
    } catch (e) {
      log(`ERROR: Failed to load cookies — ${e.message}`);
      log("Re-run 'node import-cookies.js' with a fresh cookie export.");
      await browser.close();
      process.exit(1);
    }

    const page = await context.newPage();

    log(`Navigating to ${SITE_URL} ...`);
    await page.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for page to stabilise
    await page.waitForTimeout(3000);

    // Check if we're still logged in
    const pageText = (await page.textContent("body")).toLowerCase();
    if (
      pageText.includes("login with discord") ||
      pageText.includes("sign in with discord")
    ) {
      log(
        "WARNING: Appears to be logged out. Your cookies may have expired."
      );
      log("Re-run 'node import-cookies.js' with fresh cookies from your browser.");
      await page.screenshot({ path: join(__dirname, "logged-out.png") });
      log("Screenshot saved to logged-out.png.");
      await browser.close();
      process.exit(1);
    }

    log("Looking for 'Claim your drop' button...");

    // Try multiple selector strategies
    const button = page
      .getByRole("button", { name: BUTTON_TEXT })
      .or(page.getByRole("link", { name: BUTTON_TEXT }))
      .or(page.locator(`text=${BUTTON_TEXT}`))
      .first();

    const isVisible = await button.isVisible().catch(() => false);

    if (!isVisible) {
      log(
        "Button not found or not visible. It may already be claimed for today, or the page layout changed."
      );
      await page.screenshot({ path: join(__dirname, "last-run.png") });
      log("Screenshot saved to last-run.png for debugging.");
      await browser.close();
      return;
    }

    log("Found button — clicking...");
    await button.click();
    log("Clicked successfully!");

    // Wait for confirmation/animation
    await page.waitForTimeout(4000);

    await page.screenshot({ path: join(__dirname, "last-run.png") });
    log("Post-click screenshot saved to last-run.png.");
  } catch (err) {
    log(`ERROR during run: ${err.message}`);
    if (err.message.includes("Executable doesn't exist")) {
      log(
        "Chromium not found. Run: npx playwright install chromium && npx playwright install-deps chromium"
      );
    }
    if (browser) {
      await browser
        .newPage()
        .then((p) => p.screenshot({ path: join(__dirname, "error.png") }))
        .catch(() => {});
      log("Error screenshot attempted at error.png.");
      await browser.close().catch(() => {});
    }
    process.exit(1);
  }

  log("Browser closed. Done.");
}

run();
