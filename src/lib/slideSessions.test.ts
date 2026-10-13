import { describe, expect, test } from "bun:test";
import type { PaneInfo, SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
import { slideSessions } from "./slideSessions.ts";

const pane = (over: Partial<PaneInfo> & { pane_id: string; workspace_id: string }): PaneInfo => ({
  agent_status: "idle",
  focused: false,
  revision: 1,
  tab_id: "tab",
  terminal_id: "term",
  ...over,
} as PaneInfo);

const workspace = (over: Partial<WorkspaceInfo> & { workspace_id: string }): WorkspaceInfo => ({
  active_tab_id: "tab",
  agent_status: "idle",
  focused: false,
  label: over.workspace_id,
  number: 1,
  pane_count: 1,
  tab_count: 1,
  ...over,
} as WorkspaceInfo);

const snapshot = (workspaces: WorkspaceInfo[], panes: PaneInfo[]): SessionSnapshot => ({
  agents: [],
  layouts: [{ focused_pane_id: panes[0]?.pane_id ?? "", panes: [], splits: [], tab_id: "tab", workspace_id: workspaces[0]?.workspace_id ?? "", zoomed: false, area: { x: 0, y: 0, width: 1, height: 1 } }],
  panes,
  protocol: 1,
  tabs: [],
  version: "test",
  workspaces,
} as SessionSnapshot);

describe("slideSessions", () => {
  test("without a snapshot there are no pills", () => {
    expect(slideSessions(null, null)).toEqual([]);
  });

  test("the selected pane overrides focus and preserves workspace order", () => {
    const first = workspace({ workspace_id: "a" });
    const second = workspace({ workspace_id: "b" });
    const panes = [pane({ pane_id: "p1", workspace_id: "a", agent_status: "working" }), pane({ pane_id: "p2", workspace_id: "a", focused: true }), pane({ pane_id: "p3", workspace_id: "b", agent_status: "done" })];
    const state = snapshot([first, second], panes);
    state.layouts[0]!.focused_pane_id = "p2";
    const pills = slideSessions(state, "p1");
    expect(pills.map((pill) => [pill.workspace.workspace_id, pill.paneId, pill.status, pill.selected])).toEqual([
      ["a", "p1", "working", true],
      ["b", "p3", "done", false],
    ]);
  });

  test("active-tab layout focus overrides pane focus and the first pane", () => {
    const state = snapshot([workspace({ workspace_id: "a" })], [
      pane({ pane_id: "p1", workspace_id: "a", focused: true }),
      pane({ pane_id: "p2", workspace_id: "a" }),
    ]);
    state.layouts[0]!.focused_pane_id = "p2";
    expect(slideSessions(state, "elsewhere")[0]?.paneId).toBe("p2");
  });

  test("pane focus selects a non-first pane when no layout applies", () => {
    const state = snapshot([workspace({ workspace_id: "a" })], [
      pane({ pane_id: "p1", workspace_id: "a" }),
      pane({ pane_id: "p2", workspace_id: "a", focused: true }),
    ]);
    state.layouts = [];
    expect(slideSessions(state, "elsewhere")[0]?.paneId).toBe("p2");
  });

  test("without selection or focus the first pane decides", () => {
    const state = snapshot([workspace({ workspace_id: "a" })], [
      pane({ pane_id: "p1", workspace_id: "a" }),
      pane({ pane_id: "p2", workspace_id: "a" }),
    ]);
    state.layouts = [];
    expect(slideSessions(state, "elsewhere")[0]?.paneId).toBe("p1");
  });

  test("an empty workspace has no pane to open", () => {
    const [pill] = slideSessions(snapshot([workspace({ workspace_id: "a" })], []), "elsewhere");
    expect(pill?.paneId).toBeNull();
    expect(pill?.selected).toBe(false);
  });

  test("a workspace's pill rolls its panes up as the sidebar does", () => {
    const blocked = workspace({ workspace_id: "a" });
    const [pill] = slideSessions(snapshot([blocked], [pane({ pane_id: "p1", workspace_id: "a", agent_status: "idle" }), pane({ pane_id: "p2", workspace_id: "a", agent_status: "blocked" })]), null);
    expect(pill?.status).toBe("blocked");
  });
});
