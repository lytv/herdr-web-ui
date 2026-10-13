import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { herdrRpc, sessionSnapshot, tabCreate, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

/**
 * The slide bar is the phone's session switch: one pill per workspace with herdr's
 * status dot, the open one selected, and the new-session entry at the end. A second
 * tab in a workspace adds no pill; the drawer tree stays for tab power use.
 */
export async function checkMobileSlide(browser: Browser, origin: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-mobile-slide-"));
  const workspaces: string[] = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
  try {
    await context.addInitScript(() => {
      if (localStorage.getItem("herdr-web-ui:settings") === null) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
    });
    const one = join(root, "one");
    const two = join(root, "two");
    mkdirSync(one);
    mkdirSync(two);
    const focused = (await sessionSnapshot()).focused_pane_id;
    const first = await workspaceCreate({ cwd: one, label: "herdr-web-ui-test-slide-one", focus: false });
    workspaces.push(first.workspace.workspace_id);
    assert.equal((await sessionSnapshot()).focused_pane_id, focused);
    // a second tab in the workspace: still one pill for it
    await tabCreate({ workspaceId: first.workspace.workspace_id, cwd: one, label: "second-tab" });
    const tabFocus = (await sessionSnapshot()).focused_pane_id;
    const second = await workspaceCreate({ cwd: two, label: "herdr-web-ui-test-slide-two", focus: false });
    workspaces.push(second.workspace.workspace_id);
    assert.equal((await sessionSnapshot()).focused_pane_id, tabFocus);
    await herdrRpc("pane.report_agent", { pane_id: second.root_pane.pane_id, source: "manual", agent: "claude", state: "working" });

    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const evidence = process.env.UI_EVIDENCE_DIR;
    if (evidence) mkdirSync(evidence, { recursive: true });

    await page.goto(`${origin}/?pane=${encodeURIComponent(first.root_pane.pane_id)}`);
    await page.locator(".conn-live").waitFor();
    const bar = page.locator(".slide-bar");
    await bar.getByRole("tab", { name: "herdr-web-ui-test-slide-one" }).waitFor();
    // the lane shares its herdr session with other checks' workspaces: count only this check's
    assert.equal(await bar.getByRole("tab", { name: /herdr-web-ui-test-slide-(one|two)/ }).count(), 2, "one pill per workspace, not per tab");
    assert.equal(await bar.getByRole("tab", { name: "herdr-web-ui-test-slide-one" }).getAttribute("aria-selected"), "true", "the open session's pill is selected");
    assert.equal(await bar.getByRole("tab", { name: "herdr-web-ui-test-slide-two" }).getAttribute("aria-selected"), "false", "the other pill is not");
    const dot = bar.getByRole("tab", { name: "herdr-web-ui-test-slide-two" }).locator('.tab-strip-dot[data-status="working"]');
    await dot.waitFor({ timeout: 15_000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "nothing overflows sideways");
    if (evidence) await page.screenshot({ path: join(evidence, "mobile-slide-bar.png"), animations: "disabled" });

    await bar.getByRole("tab", { name: "herdr-web-ui-test-slide-two" }).tap();
    await page.waitForFunction(() => document.querySelector('.slide-bar [role="tab"][aria-selected="true"]')?.textContent?.includes("herdr-web-ui-test-slide-two") === true);
    assert.ok((await page.locator(".mobile-title-text").innerText()).length > 0, "the top bar follows the switched session");

    await bar.getByRole("button", { name: "New workspace", exact: true }).tap();
    await page.getByRole("dialog", { name: /^New workspace/ }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: /^New workspace/ }).waitFor({ state: "hidden" });

    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForFunction(() => {
      const bar = document.querySelector(".slide-bar")!.getBoundingClientRect();
      const pill = document.querySelector('.slide-bar [role="tab"][aria-selected="true"]')!.getBoundingClientRect();
      return pill.left >= bar.left - 1 && pill.right <= bar.right + 1;
    });
    assert.deepEqual(errors, []);
    console.log("PASS a phone switches sessions from the slide bar, with status dots and a new-session entry");
  } finally {
    await context.close();
    for (const id of workspaces) await workspaceClose(id).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await import("./test-herdr.ts");
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("../server/index.ts");
  const { UsageService } = await import("../server/usage.ts");
  const state = mkdtempSync(join(tmpdir(), "herdr-web-ui-mobile-slide-state-"));
  const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: state, usage: new UsageService(undefined, []) });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  try {
    await checkMobileSlide(browser, `http://127.0.0.1:${server.port}`);
  } finally {
    await browser.close();
    server.stop();
    rmSync(state, { recursive: true, force: true });
  }
}
