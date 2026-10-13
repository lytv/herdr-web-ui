import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { sessionSnapshot, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";
import type { UpdateStatus } from "../shared/update.ts";

/**
 * The phone's shell: one slim top bar, one slide bar, two boxes. Both boxes show at
 * once (transcript plus composer over live grid plus key row); each expands over the
 * split and collapses back, one at a time. Notices hold no rows: an available update
 * is a dot on the menu and a line in its sheet. The desktop shell is unchanged.
 */
export async function checkMobileShell(browser: Browser, origin: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-mobile-shell-"));
  const workspaces: string[] = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });  try {
    await context.addInitScript(() => {
      if (localStorage.getItem("herdr-web-ui:settings") === null) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
      // a soft keyboard the script can raise: lib/viewport.ts reads visualViewport's height
      const viewport = window.visualViewport!;
      let height: number | null = null;
      Object.defineProperty(viewport, "height", { get: () => height ?? window.innerHeight });
      (window as unknown as { keyboardQA: (value: number | null) => void }).keyboardQA = (value) => { height = value; viewport.dispatchEvent(new Event("resize")); };
    });
    // an update on offer: the menu carries its dot and its sheet carries its line
    const status: UpdateStatus = {
      managed: true, auto_update: false, phase: "idle", current_revision: null, latest_revision: "b".repeat(40),
      current_version: "0.0.1", latest_version: "9.9.9", available: true, checked_at: new Date().toISOString(), blocked_reason: null, error: null, step: null,
    };
    await context.route("**/api/updates", (route) => route.fulfill({ json: status }));
    const one = join(root, "one");
    const two = join(root, "two");
    mkdirSync(one);
    mkdirSync(two);
    const focused = (await sessionSnapshot()).focused_pane_id;
    const first = await workspaceCreate({ cwd: one, label: "herdr-web-ui-test-mobile-shell-one", focus: false });
    workspaces.push(first.workspace.workspace_id);
    const second = await workspaceCreate({ cwd: two, label: "herdr-web-ui-test-mobile-shell-two", focus: false });
    workspaces.push(second.workspace.workspace_id);
    assert.equal((await sessionSnapshot()).focused_pane_id, focused, "fixture workspaces leave herdr focus unchanged");
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const safeArea = { top: 47, left: 12, right: 20 };
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: safeArea });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const evidence = process.env.UI_EVIDENCE_DIR;
    if (evidence) mkdirSync(evidence, { recursive: true });
    const screenshot = async (name: string): Promise<void> => {
      if (evidence) await page.screenshot({ path: join(evidence, `mobile-shell-${name}.png`), animations: "disabled" });
    };

    await page.goto(`${origin}/?pane=${encodeURIComponent(first.root_pane.pane_id)}`);
    await page.locator(".conn-live").waitFor();
    await page.locator(".mobile-chrome").waitFor();
    assert.equal(await page.locator(".app-header").count(), 0, "a phone has no desktop header");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "nothing overflows sideways");

    // one slim top bar: connection dot, session title plus one-line crumb, menu button
    assert.equal(await page.locator(".mobile-topbar .conn-dot").count(), 1, "the top bar has the connection dot");
    assert.ok((await page.locator(".mobile-title-text").innerText()).length > 0, "the top bar names the session");
    assert.ok((await page.locator(".mobile-crumb").innerText()).includes("›"), "the crumb says where the session is");
    assert.equal(await page.locator(".mobile-topbar .header-more-button").isVisible(), true, "the top bar has the menu button");
    const header = await page.locator(".mobile-topbar").evaluate((bar) => {
      const style = getComputedStyle(bar);
      return { height: bar.getBoundingClientRect().height, base: Number.parseFloat(style.getPropertyValue("--header-h")),
        gap: Number.parseFloat(style.getPropertyValue("--space-3")), left: Number.parseFloat(style.paddingLeft), right: Number.parseFloat(style.paddingRight) };
    });
    assert.equal(header.height, header.base + safeArea.top, "the mobile header reserves the same top safe area as the desktop header");
    assert.equal(header.left, header.gap + safeArea.left, "header controls clear the left safe area");
    assert.equal(header.right, header.gap + safeArea.right, "header controls clear the right safe area");

    // one slide bar: a pill per session with its status, the open one selected, + new at the end
    const bar = page.locator(".slide-bar");
    await bar.getByRole("tab", { name: "herdr-web-ui-test-mobile-shell-one" }).waitFor();
    assert.equal(await bar.getByRole("tab", { name: "herdr-web-ui-test-mobile-shell-one" }).getAttribute("aria-selected"), "true", "the open session's pill is selected");
    assert.equal(await bar.getByRole("button", { name: "New workspace", exact: true }).count(), 1, "a new session starts at the bar's end");
    await bar.getByRole("tab", { name: "herdr-web-ui-test-mobile-shell-two" }).tap();
    await bar.getByRole("tab", { name: "herdr-web-ui-test-mobile-shell-two" }).waitFor();
    assert.equal(await bar.getByRole("tab", { name: "herdr-web-ui-test-mobile-shell-two" }).getAttribute("aria-selected"), "true", "tapping a pill switches the session");
    assert.equal(await bar.getByRole("tab", { name: "herdr-web-ui-test-mobile-shell-one" }).getAttribute("aria-selected"), "false", "the old pill deselects");
    await screenshot("slide-switch");

    // two boxes: messages over terminal, each alive at once
    const msg = page.locator(".split-msg");
    const term = page.locator(".terminal-surface");
    const keys = page.locator(".key-bar");
    assert.equal(await msg.isVisible(), true, "the message box shows");
    assert.equal(await term.isVisible(), true, "the terminal box shows");
    assert.equal(await msg.locator(".composer").count(), 1, "the composer is in the message box");
    assert.equal(await term.locator(".pane-terminal").count(), 1, "the grid is in the terminal box");
    assert.equal(await keys.count(), 1, "the terminal has its key row");
    assert.equal(await msg.locator(".key-bar").count(), 0, "the key row never renders under the messages");
    await page.locator(".xterm-rows > div").first().waitFor({ timeout: 15_000 });

    // one tap expands a box over the split and back; only one expands at a time
    await term.getByRole("button", { name: "Expand Terminal", exact: true }).tap();
    assert.equal(await msg.isVisible(), false, "the expanded terminal covers the messages");
    assert.equal(await term.isVisible(), true, "the expanded terminal fills the split");
    assert.equal(await msg.getByRole("button", { name: "Expand Chat", exact: true }).count(), 0, "the covered box offers no expand");
    await screenshot("terminal-expanded");
    await term.getByRole("button", { name: "Collapse Terminal", exact: true }).tap();
    assert.equal(await msg.isVisible(), true, "Back restores the messages");
    await msg.getByRole("button", { name: "Expand Chat", exact: true }).tap();
    assert.equal(await term.isVisible(), false, "the expanded messages cover the terminal");
    assert.equal(await msg.locator(".composer").isVisible(), true, "the composer stays in the expanded messages");
    await screenshot("messages-expanded");
    await msg.getByRole("button", { name: "Collapse Chat", exact: true }).tap();
    assert.equal(await term.isVisible(), true, "Back restores the terminal");

    // the ⋯ sheet: palette first, notices above the items, the update's line among them
    assert.equal(await page.locator(".mobile-menu-dot").count(), 1, "an update on offer dots the menu");
    await page.locator(".mobile-topbar .header-more-button").tap();
    const sheet = page.locator(".row-sheet");
    await sheet.waitFor();
    assert.equal(await sheet.locator(".row-sheet-item").first().innerText().then((text) => text.trim()), "Command palette", "the palette is the sheet's first item");
    await sheet.getByText("herdr web ui v9.9.9 is available.", { exact: true }).waitFor();
    await screenshot("menu-sheet");
    await sheet.getByRole("button", { name: "Cancel", exact: true }).tap();
    await sheet.waitFor({ state: "hidden" });
    await page.locator(".mobile-topbar .header-more-button").tap();
    await sheet.getByRole("button", { name: "Open workspace list", exact: true }).tap();
    await page.locator(".sidebar.is-open").waitFor();
    const headerBottom = (await page.locator(".mobile-topbar").boundingBox())!.y + header.height;
    assert.equal((await page.locator(".sidebar").boundingBox())!.y, headerBottom, "the drawer starts at the safe-area header edge");
    assert.equal((await page.locator(".scrim").boundingBox())!.y, headerBottom, "the scrim covers the slide bar from the header edge");
    await screenshot("safe-area-drawer");
    await page.locator(".scrim").tap({ position: { x: 366, y: 40 } });
    await page.locator(".sidebar.is-open").waitFor({ state: "detached" });
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, right: 0 } });
    await page.waitForFunction((height) => document.querySelector(".mobile-topbar")!.getBoundingClientRect().height === height, header.base);

    // a keyboard-height shell shrinks the boxes instead of sliding them under it: the
    // composer's focus plus a halved visual viewport is the real keyboard path
    await msg.getByRole("textbox", { name: "Message", exact: true }).tap();
    await page.evaluate(() => (window as unknown as { keyboardQA: (value: number | null) => void }).keyboardQA(480));
    // the shell must settle at keyboard height, not pass through it: a focus fight would flip it back
    await page.waitForFunction(async () => {
      for (let i = 0; i < 5; i += 1) {
        if (!document.documentElement.hasAttribute("data-keyboard")) return false;
        if (Math.round(document.querySelector(".app")!.getBoundingClientRect().height) !== 480) return false;
        await new Promise((done) => setTimeout(done, 100));
      }
      return true;
    }, undefined, { timeout: 15_000 }).catch(async () => {
      throw new Error(`the shell never settled at keyboard height: ${
        await page.evaluate(() => JSON.stringify({ keyboard: document.documentElement.hasAttribute("data-keyboard"),
          appHeight: document.documentElement.style.getPropertyValue("--app-height"),
          shell: Math.round(document.querySelector(".app")!.getBoundingClientRect().height),
          active: document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}` : "none" }))}`);
    });
    assert.equal(await msg.isVisible(), true, "the message box survives keyboard height");
    assert.equal(await term.isVisible(), true, "the terminal box survives keyboard height");
    const box = await keys.boundingBox();
    assert.ok(box !== null && box.y + box.height <= 481, "the key row stays above the keyboard");
    await screenshot("keyboard");
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); (window as unknown as { keyboardQA: (value: number | null) => void }).keyboardQA(null); });
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-keyboard"));

    await page.locator(".mobile-menu-button").tap();
    await page.getByRole("button", { name: "Open workspace list", exact: true }).tap();
    const closedRow = page.locator(`.workspace[data-workspace="${first.workspace.workspace_id}"]`);
    await closedRow.locator(".row-menu-toggle").tap();
    await page.getByRole("button", { name: "Close workspace", exact: true }).tap();
    await page.getByRole("alertdialog").getByRole("button", { name: "Close", exact: true }).tap();
    await closedRow.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.matches(".mobile-topbar .mobile-menu-button"));

    const gone = await workspaceCreate({ cwd: one, label: "herdr-web-ui-test-mobile-shell-row-gone", focus: false });
    workspaces.push(gone.workspace.workspace_id);
    const goneRow = page.locator(`.workspace[data-workspace="${gone.workspace.workspace_id}"]`);
    await goneRow.locator(".row-menu-toggle").tap();
    await page.getByRole("button", { name: "Rename workspace", exact: true }).waitFor();
    await workspaceClose(gone.workspace.workspace_id);
    await goneRow.waitFor({ state: "detached" });
    await sheet.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.matches(".mobile-topbar .mobile-menu-button"));

    await page.locator(".mobile-menu-button").tap();
    await sheet.getByRole("button", { name: "Command palette", exact: true }).tap();
    const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
    await palette.getByRole("searchbox", { name: "Search panes and actions", exact: true }).fill("Add PC");
    await palette.getByRole("option", { name: "Add PC", exact: true }).tap();
    await page.getByRole("dialog", { name: "Add PC", exact: true }).getByRole("button", { name: "Close PC setup", exact: true }).tap();
    await page.waitForFunction(() => document.activeElement?.matches(".mobile-topbar .mobile-menu-button"));

    await page.route("**/api/health*", async (route) => {
      const body = await (await route.fetch()).json();
      await route.fulfill({ json: { ...body, herdr: null } });
    });
    await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
      const upstream = socket.connectToServer();
      upstream.onMessage((raw) => {
        socket.send(raw);
        const frame = JSON.parse(String(raw));
        if (frame.type === "input-ready") socket.send(JSON.stringify({ type: "error", code: "attach_held", pane_id: second.root_pane.pane_id, message: "held fixture" }));
      });
    });
    await page.goto(`${origin}/?pane=${encodeURIComponent(second.root_pane.pane_id)}`);
    await page.getByText("herdr offline", { exact: true }).waitFor();
    assert.equal(await page.locator(".mobile-topbar .conn").getAttribute("title"), "herdr offline");
    assert.equal(await page.locator(".conn-live").count(), 0, "a live bridge never claims an offline herdr is live");
    const held = page.getByText("Another app has this pane open. It connects here as soon as that app lets go.", { exact: true });
    await held.waitFor();
    const bannerBox = (await page.locator(".terminal-banners").boundingBox())!;
    const headBox = (await page.locator(".terminal-surface > .split-head").boundingBox())!;
    assert.ok(bannerBox.y >= headBox.y + headBox.height, "the held banner sits below the terminal box controls");
    await page.getByRole("button", { name: "Expand Chat", exact: true }).tap();
    assert.equal(await held.isVisible(), true, "expanding chat keeps the held-state explanation visible");
    assert.equal(await page.getByRole("button", { name: "Open here", exact: true }).isVisible(), true, "the held-pane action stays reachable in expanded chat");
    await screenshot("held-expanded-chat");
    await page.getByRole("button", { name: "Collapse Chat", exact: true }).tap();
    assert.equal(await held.isVisible(), true);
    assert.deepEqual(errors, []);
    console.log("PASS a phone shows top bar, slide bar and two live boxes with expand, sheet and keyboard resize");
  } finally {
    await context.close();
    for (const id of workspaces) await workspaceClose(id).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

/** The desktop shell is unchanged: header, lens switch and pane column, no mobile shell. */
export async function checkMobileShellDesktop(browser: Browser, origin: string, paneId: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?pane=${encodeURIComponent(paneId)}`);
    await page.locator(".conn-live").waitFor();
    assert.equal(await page.locator(".app-header").isVisible(), true, "the desktop keeps its header");
    assert.equal(await page.locator(".view-switch").isVisible(), true, "the desktop keeps its lens switch");
    assert.equal(await page.locator(".mobile-chrome").count(), 0, "no mobile chrome on the desktop");
    await page.locator(".app-header .palette-button").click();
    const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
    await palette.getByRole("searchbox", { name: "Search panes and actions", exact: true }).fill("Add PC");
    await palette.getByRole("option", { name: "Add PC", exact: true }).click();
    await page.getByRole("dialog", { name: "Add PC", exact: true }).getByRole("button", { name: "Close PC setup", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.matches(".app-header .sidebar-toggle"));
    assert.deepEqual(errors, []);
    console.log("PASS the desktop shell is unchanged");
  } finally {
    await context.close();
  }
}

if (import.meta.main) {
  await import("./test-herdr.ts");
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("../server/index.ts");
  const { UsageService } = await import("../server/usage.ts");
  const { workspaceCreate: create, workspaceClose: close } = await import("../server/herdr/client.ts");
  const state = mkdtempSync(join(tmpdir(), "herdr-web-ui-mobile-shell-state-"));
  const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: state, usage: new UsageService(undefined, []) });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  let standalone: string | null = null;
  try {
    const created = await create({ cwd: mkdtempSync(join(tmpdir(), "herdr-web-ui-mobile-shell-ws-")), label: "herdr-web-ui-test-mobile-shell-standalone", focus: false });
    standalone = created.workspace.workspace_id;
    await checkMobileShell(browser, `http://127.0.0.1:${server.port}`);
    await checkMobileShellDesktop(browser, `http://127.0.0.1:${server.port}`, created.root_pane.pane_id);
  } finally {
    if (standalone) await close(standalone).catch(() => undefined);
    await browser.close();
    server.stop();
    rmSync(state, { recursive: true, force: true });
  }
}
