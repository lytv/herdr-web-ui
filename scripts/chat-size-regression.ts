import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { Machine } from "../shared/machines.ts";
import { openSettingsPage } from "./settings-page.ts";
import { herdrRpc, paneRead, paneSendKeys, paneSendText, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

/** how long a resize that should not happen gets to show up */
const NO_RESIZE_WAIT_MS = 400;

type Frame = { dir: "in" | "out"; type: string; keep_size?: boolean };
const framesOf = (page: Page) => page.evaluate(() => (window as unknown as { frames_: Frame[] }).frames_);

/** The size the pane's own shell reports (`stty size`), not what a browser thinks. */
function shellSize(paneId: string): () => Promise<string> {
  let asked = 0;
  return async () => {
    const marker = `size-${++asked}`;
    await paneSendText(paneId, `echo ${marker} $(stty size)`);
    await paneSendKeys(paneId, ["Enter"]);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const text = (await paneRead({ paneId, source: "recent", lines: 80, stripAnsi: true })).text;
      const found = [...text.matchAll(new RegExp(`^${marker} (\\d+ \\d+)\\s*$`, "gm"))].at(-1);
      if (found) return found[1]!;
      await Bun.sleep(100);
    }
    throw new Error(`no ${marker} answer from the pane`);
  };
}

/** A page on `paneId` that records every frame its socket sends and receives (`frames_`). */
async function openRecording(browser: Browser, contexts: BrowserContext[], origin: string, paneId: string, options: Parameters<Browser["newContext"]>[0], settings: object): Promise<Page> {
  const context = await browser.newContext({ locale: "en-US", ...options });
  contexts.push(context);
  await context.addInitScript((stored) => {
    localStorage.setItem("herdr-web-ui:settings", JSON.stringify(stored));
    // every frame this page's socket sends and receives, to wait on the server's answers
    const frames: { dir: "in" | "out"; type: string; keep_size?: boolean }[] = [];
    (window as unknown as { frames_: typeof frames }).frames_ = frames;
    const Native = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, { sockets_: sockets });
    const viewport = window.visualViewport!;
    let height: number | null = null;
    Object.defineProperty(viewport, "height", { get: () => height ?? window.innerHeight });
    Object.assign(window, { keyboardQA: (value: number | null) => { height = value; viewport.dispatchEvent(new Event("resize")); } });
    class Recording extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
        this.addEventListener("message", (event) => { try { frames.push({ dir: "in", type: JSON.parse(String(event.data)).type }); } catch {} });
      }
      override send(data: string): void { try { const frame = JSON.parse(data); frames.push({ dir: "out", type: frame.type, keep_size: frame.keep_size }); } catch {} super.send(data); }
    }
    Object.assign(window, { WebSocket: Recording });
  }, settings);
  const page = await context.newPage();
  await page.goto(`${origin}/?pane=${encodeURIComponent(paneId)}`);
  await page.locator(".conn-live").waitFor();
  return page;
}

/**
 * The roster pages are handed names the pane's agent. A page opened before that takes the pane for
 * a shell: with chat as its lens for every pane it still opens the terminal there, and attaching in
 * the terminal lens fits the shared grid to that page, which is what these checks say does not happen.
 */
async function agentListed(origin: string, paneId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const roster = await (await fetch(`${origin}/api/machines`)).json() as { machines: Machine[] };
    if (roster.machines.some((machine) => machine.snapshot?.panes.some((pane) => pane.pane_id === paneId && pane.agent === "claude"))) return;
    await Bun.sleep(50);
  }
  throw new Error(`the roster never named the agent in ${paneId}`);
}

// the server answers an attach with input-ready, and resizes in the same step: once the
// `nth` one is in, that attach has done whatever it does to the grid
const attached = (page: Page, nth = 1) => page.waitForFunction((count) => (window as unknown as { frames_: { dir: string; type: string }[] }).frames_.filter((f) => f.dir === "in" && f.type === "input-ready").length >= count, nth, { timeout: 15_000 });

export async function checkChatKeepsTerminalSize(browser: Browser, origin: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-chat-size-"));
  const cwd = join(root, "pane");
  mkdirSync(cwd);
  const created = await workspaceCreate({ cwd, label: "herdr-web-ui-test-chat-size" });
  const paneId = created.root_pane.pane_id;
  const contexts: BrowserContext[] = [];
  try {
    // an agent pane opens in the chat lens on a phone; the shell under it answers `stty size`
    await herdrRpc("pane.report_agent", { pane_id: paneId, source: "manual", agent: "claude", state: "idle" });
    await agentListed(origin, paneId);
    const size = shellSize(paneId);
    const open = (options: Parameters<Browser["newContext"]>[0], settings: object) => openRecording(browser, contexts, origin, paneId, options, settings);

    const desktop = await open({ viewport: { width: 1280, height: 800 } }, { language: "en", defaultView: "terminal" });
    await attached(desktop);
    const desktopSize = await size();

    const phone = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { language: "en", defaultView: "chat" });
    await phone.locator(".terminal-stack.is-split").waitFor({ state: "attached" });
    await attached(phone);
    const unchanged = async () => {
      await Bun.sleep(NO_RESIZE_WAIT_MS);
      const sent = (await framesOf(phone)).filter((f) => f.dir === "out" && (f.type === "attach" || f.type === "resize"));
      assert.ok(sent.length > 0 && sent.every((f) => f.type === "attach" && f.keep_size === true), "the phone only attaches with keep_size and never sends resize");
      assert.equal(await size(), desktopSize, "the phone leaves the desktop's shared grid unchanged");
      assert.equal(await phone.locator(".pane-terminal .xterm-rows > div").count(), Number(desktopSize.split(" ")[0]), "the phone draws the adopted grid");
    };
    await unchanged();
    const pan = await phone.locator(".pane-terminal").evaluate((host) => {
      host.scrollTop = 0;
      host.scrollLeft = 0;
      const touch = (x: number, y: number) => new Touch({ identifier: 1, target: host, clientX: x, clientY: y });
      host.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(150, 150)], bubbles: true }));
      host.dispatchEvent(new TouchEvent("touchmove", { touches: [touch(50, 50)], bubbles: true, cancelable: true }));
      host.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true }));
      return { x: host.scrollLeft, y: host.scrollTop };
    });
    assert.ok(pan.x > 0 && pan.y > 0, "a touch drag pans the adopted grid on both axes");
    for (const name of ["Terminal", "Chat"]) {
      await phone.getByRole("button", { name: `Expand ${name}`, exact: true }).tap();
      await unchanged();
      await phone.getByRole("button", { name: `Collapse ${name}`, exact: true }).tap();
    }
    await phone.getByRole("textbox", { name: "Message", exact: true }).tap();
    await phone.evaluate(() => (window as unknown as { keyboardQA: (height: number | null) => void }).keyboardQA(480));
    await phone.waitForFunction(() => Math.round(document.querySelector(".app")!.getBoundingClientRect().height) === 480);
    await unchanged();
    await phone.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      (window as unknown as { keyboardQA: (height: number | null) => void }).keyboardQA(null);
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await phone.locator(".mobile-topbar .header-more-button").tap();
    await phone.locator(".row-sheet").getByRole("button", { name: "Settings", exact: true }).tap();
    await openSettingsPage(phone, "Terminal");
    await phone.getByRole("button", { name: "Increase terminal font size", exact: true }).tap();
    await phone.getByRole("button", { name: "Close settings", exact: true }).tap();
    await unchanged();
    for (const mode of ["observe", "interact"]) {
      const before = (await framesOf(phone)).filter((f) => f.dir === "in" && f.type === "role-ack").length;
      await phone.evaluate((mode) => (window as unknown as { sockets_: WebSocket[] }).sockets_.at(-1)!.send(JSON.stringify({ type: "role", mode })), mode);
      await phone.waitForFunction((count) => (window as unknown as { frames_: Frame[] }).frames_.filter((f) => f.dir === "in" && f.type === "role-ack").length > count, before);
      await unchanged();
    }
    const before = (await framesOf(phone)).filter((f) => f.dir === "in" && f.type === "input-ready").length;
    await phone.evaluate(() => (window as unknown as { sockets_: WebSocket[] }).sockets_.at(-1)!.close());
    await attached(phone, before + 1);
    await unchanged();
    if (process.env.UI_EVIDENCE_DIR) await desktop.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "chat-size-desktop.png") });
    console.log(`PASS the phone preserves and pans the shared ${desktopSize} grid through expansion, keyboard, focus, fonts, roles and reconnect`);

    const other = await open({ viewport: { width: 900, height: 600 } }, { language: "en", defaultView: "terminal" });
    await attached(other);
    await other.locator(".terminal-stack:not(.is-chat)").waitFor();
    await other.waitForFunction(() => (window as unknown as { frames_: Frame[] }).frames_.some((f) => f.dir === "out" && f.type === "resize"));
    const deadline = Date.now() + 10_000;
    let otherSize = await size();
    while (otherSize === desktopSize && Date.now() < deadline) {
      await Bun.sleep(50);
      otherSize = await size();
    }
    assert.notEqual(otherSize, desktopSize, "a desktop terminal lens still drives the shared grid");
    const hiddenRows = () => desktop.locator(".pane-terminal .xterm-rows > div").count();
    const otherRows = Number(otherSize.split(" ")[0]);
    assert.notEqual(await hiddenRows(), otherRows, "the desktop's terminal lens kept its own grid");
    await desktop.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
    await desktop.locator(".terminal-stack.is-chat").waitFor({ state: "attached" });
    await desktop.waitForFunction((rows) => document.querySelectorAll(".pane-terminal .xterm-rows > div").length === rows, otherRows);
    assert.equal(await size(), otherSize, "entering the chat lens resizes nothing");
    await phone.waitForFunction((rows) => document.querySelectorAll(".pane-terminal .xterm-rows > div").length === rows, otherRows);
    console.log(`PASS the desktop's chat lens and phone adopt the shared grid of ${otherSize}`);
  } finally {
    for (const context of contexts) await context.close();
    await workspaceClose(created.workspace.workspace_id).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Picking a pane whose lens is chat, from a pane whose lens is the terminal, leaves the shared
 * terminal's size alone too: the lens is the picked pane's by the time its terminal attaches.
 * A desktop drives an agent pane's grid; a smaller window sits on a shell pane (terminal lens)
 * and picks the agent pane (chat lens there) from the sidebar.
 */
export async function checkPaneSwitchKeepsTerminalSize(browser: Browser, origin: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-chat-switch-"));
  const contexts: BrowserContext[] = [];
  const workspaces: string[] = [];
  try {
    const panes: string[] = [];
    for (const name of ["agent", "shell"]) {
      const cwd = join(root, name);
      mkdirSync(cwd);
      const created = await workspaceCreate({ cwd, label: `herdr-web-ui-test-chat-switch-${name}` });
      workspaces.push(created.workspace.workspace_id);
      panes.push(created.root_pane.pane_id);
    }
    const [agentPane, shellPane] = panes as [string, string];
    await herdrRpc("pane.report_agent", { pane_id: agentPane, source: "manual", agent: "claude", state: "idle" });
    await agentListed(origin, agentPane);
    const size = shellSize(agentPane);

    const desktop = await openRecording(browser, contexts, origin, agentPane, { viewport: { width: 1280, height: 800 } }, { language: "en", defaultView: "terminal" });
    await attached(desktop);
    const desktopSize = await size();

    // with chat as the lens for every pane, a shell still opens in the terminal: it has no conversation
    const other = await openRecording(browser, contexts, origin, shellPane, { viewport: { width: 900, height: 600 } }, { language: "en", defaultView: "chat" });
    await other.locator(".terminal-stack:not(.is-chat)").waitFor({ state: "attached" });
    await attached(other);
    const shell = shellSize(shellPane);
    const shellGrid = await shell();
    const phone = await openRecording(browser, contexts, origin, shellPane, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { language: "en", defaultView: "terminal" });
    await attached(phone);
    await Bun.sleep(NO_RESIZE_WAIT_MS);
    assert.equal(await shell(), shellGrid, "opening a shell on a phone preserves its shared grid");
    let attaches = 1;
    for (const name of ["agent", "shell", "agent"]) {
      await phone.locator(".slide-bar").getByRole("tab", { name: `herdr-web-ui-test-chat-switch-${name}`, exact: true }).tap();
      await attached(phone, ++attaches);
      await Bun.sleep(NO_RESIZE_WAIT_MS);
      const sent = (await framesOf(phone)).filter((f) => f.dir === "out" && (f.type === "attach" || f.type === "resize"));
      assert.ok(sent.length > 0 && sent.every((f) => f.type === "attach" && f.keep_size === true), "each slide-bar pane switch preserves the shared grid");
      assert.equal(await size(), desktopSize);
      assert.equal(await shell(), shellGrid);
    }
    console.log("PASS a terminal-lens phone preserves shell and agent grids on slide-bar pane switches");
    const before = (await framesOf(other)).length;
    await other.locator(`.pane-select[title^="${agentPane} — "]`).click();
    await other.locator(".terminal-stack.is-chat").waitFor({ state: "attached" });
    await attached(other, 2);
    // a resize that should not happen gets this long to show up: the grid's ResizeObserver waits 120 ms
    await Bun.sleep(NO_RESIZE_WAIT_MS);
    const sent = (await framesOf(other)).slice(before).filter((f) => f.dir === "out" && (f.type === "attach" || f.type === "resize"));
    assert.deepEqual(sent, [{ dir: "out", type: "attach", keep_size: true }], "the picked pane attaches in its own lens");
    assert.equal(await size(), desktopSize, "picking a chat-lens pane leaves the desktop's grid");
    console.log(`PASS picking a chat-lens pane from a terminal-lens pane leaves the shared grid at ${desktopSize}`);
    const wideStart = (await framesOf(phone)).length;
    await phone.setViewportSize({ width: 900, height: 600 });
    await phone.waitForFunction((start) => (window as unknown as { frames_: Frame[] }).frames_.slice(start).some((f) => f.dir === "out" && f.type === "resize"), wideStart);
    const deadline = Date.now() + 10_000;
    let wideGrid = await size();
    while (wideGrid === desktopSize && Date.now() < deadline) {
      await Bun.sleep(50);
      wideGrid = await size();
    }
    assert.notEqual(wideGrid, desktopSize, "crossing to desktop width restores terminal-size ownership");
    const narrowStart = (await framesOf(phone)).length;
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.locator(".terminal-stack.is-split").waitFor();
    await Bun.sleep(NO_RESIZE_WAIT_MS);
    assert.equal((await framesOf(phone)).slice(narrowStart).filter((f) => f.dir === "out" && f.type === "resize").length, 0, "crossing back to phone width sends no resize");
    assert.equal(await size(), wideGrid, "the phone adopts the desktop grid after the breakpoint change");
    console.log("PASS crossing the breakpoint restores desktop size ownership and then phone adoption");
  } finally {
    for (const context of contexts) await context.close();
    for (const id of workspaces) await workspaceClose(id).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}
