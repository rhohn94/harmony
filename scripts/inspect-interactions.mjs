// Real-gesture interaction gate (v0.9 "Contact" W95).
//
// The interaction-layer bugs (dead create-folder button, untypeable search box)
// shipped green because the old headless scripts DISPATCHED a synthetic
// "aura-click" CustomEvent that a real mouse never produces — the test agreed
// with the bug on a fictional event. This script instead drives the UI with
// REAL Playwright gestures (trusted mouse clicks + keyboard typing) and asserts
// the resulting state change, so a regression to dead wiring fails the gate:
//
//   1. Real-click the empty-Library "Create a games folder for me" button →
//      the create dialog must open (Location field appears, pre-filled).
//   2. Real-type into the Location input → its value must update (a controlled
//      input only retains typed text if its onChange fired).
//   3. Real-click "Create folder" → the "Games folder ready" success state.
//   4. On /search, real-type into the query box → its value must update.
//
// Exit non-zero on any failed assertion (a true gate), unlike the best-effort
// visual captures. Reuses the helpers exported from visual-inspect.mjs.

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { buildMockIpcInitScript } from "./mock-ipc.mjs";
import { startStaticServer, resolveChromiumExecutable } from "./visual-inspect.mjs";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT_DIR = join(ROOT, "artifacts", "visual-inspection");
// Empty library + folders so the Library renders the create-folder empty state.
const EMPTY = { list_games: [], list_content_folders: [] };

/** Assert helper: record a failure (does not throw) so all checks run. */
function makeChecks() {
  const failures = [];
  return {
    ok(cond, label) {
      console.log(`[interactions] ${cond ? "ok  " : "FAIL"} ${label}`);
      if (!cond) failures.push(label);
    },
    failures,
  };
}

/** Real trusted click on the first element matching `selector`. Playwright's
 *  .click() runs actionability checks then dispatches a trusted click via CDP —
 *  the genuine gesture that React's onClick delegation receives. Falls back to a
 *  bounding-box mouse click if the actionability path is blocked. */
async function realClick(page, selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: "visible", timeout: 8000 });
  try {
    await loc.click({ timeout: 4000 });
  } catch {
    const box = await loc.boundingBox();
    if (!box) throw new Error(`no bounding box for ${selector}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("[interactions] dist/ not built. Run `pnpm build` first.");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const { chromium } = require("playwright-core");
  const executablePath = resolveChromiumExecutable(chromium);
  if (!executablePath) {
    console.error("[interactions] no Chromium available — cannot run the real-gesture gate.");
    process.exit(1);
  }

  const { server, port } = await startStaticServer(DIST);
  const base = `http://127.0.0.1:${port}`;
  const checks = makeChecks();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 832 },
      deviceScaleFactor: 2,
    });
    await page.addInitScript(buildMockIpcInitScript(EMPTY));

    // ── 1. Create-folder button opens the dialog ──────────────────────────────
    await page.goto(`${base}/#/`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(500);
    await realClick(page, 'aura-button:has-text("Create a games folder for me")');
    const locationInput = page.locator("#games-dir-path");
    let dialogOpened = false;
    try {
      await locationInput.waitFor({ state: "visible", timeout: 6000 });
      dialogOpened = true;
    } catch {
      /* stays false */
    }
    checks.ok(dialogOpened, "create-folder button opens the dialog");

    // ── 2. Location input is typeable (controlled input retains typed text) ────
    if (dialogOpened) {
      await locationInput.click();
      await locationInput.fill("");
      await page.keyboard.type("/Users/you/Games/Retro");
      const typed = await locationInput.inputValue();
      checks.ok(
        typed === "/Users/you/Games/Retro",
        `Location input retains typed text (got "${typed}")`,
      );

      // ── 3. Create folder → success confirmation ─────────────────────────────
      await realClick(page, 'aura-button:has-text("Create folder")');
      let success = false;
      try {
        await page.locator("text=Games folder ready").waitFor({ state: "visible", timeout: 6000 });
        success = true;
      } catch {
        /* stays false */
      }
      checks.ok(success, 'create flow reaches the "Games folder ready" state');
      await page.screenshot({ path: join(OUT_DIR, "interactions-create.png") });
    }

    // ── 4. Search query box is typeable ───────────────────────────────────────
    await page.goto(`${base}/#/search`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(500);
    const searchInput = page.locator('input[name="search-query"]');
    let searchTypeable = false;
    try {
      await searchInput.waitFor({ state: "visible", timeout: 6000 });
      await searchInput.click();
      await page.keyboard.type("super mario");
      const sval = await searchInput.inputValue();
      searchTypeable = sval === "super mario";
      checks.ok(searchTypeable, `Search box retains typed text (got "${sval}")`);
    } catch (e) {
      checks.ok(false, `Search box is typeable (error: ${String(e).slice(0, 80)})`);
    }
    await page.screenshot({ path: join(OUT_DIR, "interactions-search.png") });
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }

  if (checks.failures.length > 0) {
    console.error(`[interactions] ${checks.failures.length} check(s) FAILED:`);
    for (const f of checks.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("[interactions] all real-gesture checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[interactions] fatal:", err);
  process.exit(1);
});
