import assert from "node:assert/strict";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import type { Machine } from "../shared/machines.ts";
import type { InstalledNotes, UpdateStatus } from "../shared/update.ts";

/**
 * The notices in the phone's ⋯ sheet: a release installs from its line with one button
 * and shows its steps, and the line for a PC that needs a bridge update can be closed
 * for good. The update status and the waiting PC are answered here; nothing is installed.
 */
export async function checkUpdateNotice(browser: Browser, origin: string, shots?: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  try {
    await context.addInitScript(() => {
      if (localStorage.getItem("herdr-web-ui:settings") === null) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }); };

    const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
    let status: UpdateStatus = {
      managed: true, auto_update: false, phase: "checking", current_revision: null, latest_revision: null,
      current_version: "0.0.1", latest_version: null, available: false, checked_at: new Date().toISOString(), blocked_reason: null, error: null, step: null,
    };
    const installed: InstalledNotes = { revision, version: "9.9.8", previous_version: "9.9.7", installed_at: new Date().toISOString(), omitted: 0,
      releases: [{ version: "9.9.8", date: null, notes: "Fictional installed-release fixture." }] };
    let installs = 0;
    let checks = 0;
    await page.route("**/api/updates", (route) => route.fulfill({ json: status }));
    await page.route("**/api/updates/installed", (route) => route.fulfill({ json: installed }));
    await page.route("**/api/updates/install", async (route) => {
      installs += 1;
      // as the updater does: an install starts with a check, which reports nothing available yet
      status = { ...status, phase: "checking", available: false };
      await route.fulfill({ status: 202, json: { accepted: true } });
    });
    await page.route("**/api/updates/check", async (route) => {
      checks += 1;
      status = { ...status, phase: "idle", available: true, error: null };
      await route.fulfill({ status: 202, json: { accepted: true } });
    });
    const pc: Machine = { id: "qa-pc", name: "QA PC", kind: "ssh", target: { destination: "qa@example.invalid" }, enabled: true, state: "error", error: null, action_required: "update_bridge", snapshot: null };
    let remote: Machine | null = null;
    // The real SSE roster would remove the synthetic PC between these polled snapshots.
    await context.route("**/api/machines/events", (route) => route.abort());
    await page.route("**/api/machines", async (route) => {
      const body = await (await route.fetch()).json() as { machines: Machine[] };
      await route.fulfill({ json: { ...body, machines: remote ? [...body.machines, remote] : body.machines } });
    });

    const firstStatus = page.waitForResponse((response) => response.url().endsWith("/api/updates"));
    await page.goto(origin);
    await firstStatus;
    const notice = page.locator(".update-notice").filter({ hasText: /herdr web ui|update|Step|Starting/i }).first();
    const fits = async (label: string) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${label}: nothing overflows sideways`);
    // on a phone the notices hold no rows: an update on offer dots the ⋯ menu, and its
    // line lives at the top of the sheet it opens
    const sheet = page.locator(".row-sheet");
    const openSheet = async (): Promise<void> => {
      if ((await sheet.count()) === 0) await page.locator(".mobile-topbar .header-more-button").click();
      await sheet.waitFor();
    };
    await page.locator(".conn-live").waitFor();
    await openSheet();
    assert.equal(await page.locator(".mobile-notices .update-notice").count(), 0, "background checking renders no notice");
    assert.equal(await page.locator(".mobile-menu-dot").count(), 0, "background checking shows no notice dot");
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    status = { ...status, phase: "idle", current_revision: revision, latest_revision: revision, current_version: "9.9.8", latest_version: "9.9.8" };
    await page.locator(".mobile-menu-dot").waitFor();
    await openSheet();
    await page.getByText("herdr web ui was updated to v9.9.8.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "What's new", exact: true }).click();
    await page.getByRole("dialog", { name: "Settings", exact: true }).getByText("Fictional installed-release fixture.").waitFor();
    assert.equal(await page.locator(".mobile-menu-dot").count(), 0, "opening installed notes dismisses their dot");
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    status = { ...status, current_revision: null, latest_revision: "b".repeat(40), current_version: "0.0.1", latest_version: "9.9.9", available: true };
    await page.reload();
    await page.locator(".conn-live").waitFor();
    await page.locator(".mobile-menu-dot").waitFor();
    assert.equal(await page.locator(".pane-column > .update-notice").count(), 0, "no notice holds a row on a phone");
    assert.equal(await page.locator(".mobile-menu-dot").count(), 1, "an update on offer dots the menu");

    // one button, and no detour through Settings
    await openSheet();
    await page.getByText("herdr web ui v9.9.9 is available.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "View update", exact: true }).count(), 0, "the line has no View update button");
    await fits("available");
    await shot("1-available");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await page.getByText("Starting the update…", { exact: true }).waitFor();
    assert.equal(installs, 1, "one tap asks for the install");
    assert.equal(await page.getByRole("dialog", { name: "Settings" }).count(), 0, "Settings stays closed");

    status = { ...status, phase: "building", step: "build" };
    await page.getByText("Building the app", { exact: true }).waitFor();
    await page.getByText("Step 4 of 5", { exact: true }).waitFor();
    assert.equal(await notice.getByRole("progressbar").getAttribute("aria-valuenow"), "70");
    await fits("installing");
    await shot("2-installing");
    status = { ...status, phase: "restarting", step: "restart" };
    await page.getByText("Step 5 of 5", { exact: true }).waitFor();

    // a failed install says so on the line, and the whole error is one tap away
    status = { ...status, phase: "error", step: null, available: true, error: "bun run build failed: fixture" };
    await page.getByText("The update could not be installed.", { exact: true }).waitFor();
    await fits("failed");
    await shot("3-failed");
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await page.getByRole("dialog", { name: "Settings" }).getByText("bun run build failed: fixture").waitFor();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    // Details opened Settings over the sheet: the sheet went with it
    await openSheet();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText("Starting the update…", { exact: true }).waitFor();
    assert.equal(installs, 2, "Try again asks for the install again");
    // the check an install starts with fails: nothing is available any more, and the line still says so
    status = { ...status, phase: "error", available: false, error: "git fetch failed: fixture" };
    await page.getByText("The update could not be installed.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Details", exact: true }).waitFor();
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await sheet.waitFor({ state: "detached" });
    assert.equal(await page.locator(".mobile-menu-dot").count(), 1, "a failed install with no available release still dots the closed menu");
    await openSheet();
    await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
    // the server refuses an install with nothing available: Try again looks for the release again
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText("herdr web ui v9.9.9 is available.", { exact: true }).waitFor();
    assert.deepEqual([checks, installs], [1, 2], "Try again after a failed check asks for a check, not an install");
    status = { ...status, phase: "idle", available: false, error: null };
    await page.getByText("herdr web ui v9.9.9 is available.", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.locator(".mobile-menu-dot").count(), 0, "an installed update leaves no dot");
    console.log("PASS a release installs from its sheet line with one button and shows its steps");

    // a PC whose bridge cannot be updated: its line closes, and stays closed
    const line = page.getByText("QA PC needs a bridge update to reconnect.", { exact: true });
    const dismissed = () => page.evaluate(() => localStorage.getItem("herdr-web-ui:pc-notice-dismissed"));
    remote = pc;
    await openSheet();
    await line.waitFor();
    await fits("bridge update needed");
    await shot("4-bridge-update-needed");
    await page.locator(".update-notice").getByRole("button", { name: "Dismiss", exact: true }).click();
    await line.waitFor({ state: "hidden" });
    assert.equal(await dismissed(), JSON.stringify(["qa-pc:update_bridge"]));
    assert.equal(await page.locator(".mobile-menu-dot").count(), 0, "dismissing the PC line removes the dot without a roster change");
    // a retry that fails brings the PC back to the same state: still closed, also after a reload
    remote = { ...pc, state: "reconnecting", action_required: null };
    await page.reload();
    await page.locator(".conn-live").waitFor();
    remote = pc;
    await page.reload();
    await page.locator(".conn-live").waitFor();
    await openSheet();
    assert.equal(await line.count(), 0, "the closed line stays closed through a failed retry and a reload");
    assert.equal(await dismissed(), JSON.stringify(["qa-pc:update_bridge"]));
    await shot("5-bridge-line-closed");
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    // once the PC has connected, the next time it waits is news again
    remote = { ...pc, state: "connected", action_required: null };
    await page.waitForFunction(() => localStorage.getItem("herdr-web-ui:pc-notice-dismissed") === null);
    remote = pc;
    await openSheet();
    await line.waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS the line for a PC that needs a bridge update closes and stays closed until the PC connects");
  } finally {
    await context.close();
  }
}
