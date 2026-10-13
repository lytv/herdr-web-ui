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

  test("a tap opens the selected pane, else herdr's focused one, else the first", () => {
    const first = workspace({ workspace_id: "a" });
    const second = workspace({ workspace_id: "b" });
    const panes = [pane({ pane_id: "p1", workspace_id: "a", agent_status: "working" }), pane({ pane_id: "p2", workspace_id: "a", focused: true }), pane({ pane_id: "p3", workspace_id: "b", agent_status: "done" })];
    const pills = slideSessions(snapshot([first, second], panes), "p1");
    expect(pills.map((pill) => [pill.workspace.workspace_id, pill.paneId, pill.status, pill.selected])).toEqual([
      ["a", "p1", "working", true],
      ["b", "p3", "done", false],
    ]);
    const unfocused = slideSessions(snapshot([first], [pane({ pane_id: "p1", workspace_id: "a" }), pane({ pane_id: "p2", workspace_id: "a" })]), "elsewhere");
    expect(unfocused[0]?.paneId).toBe("p1");
  });

  test("a workspace's pill rolls its panes up as the sidebar does", () => {
    const blocked = workspace({ workspace_id: "a" });
    const [pill] = slideSessions(snapshot([blocked], [pane({ pane_id: "p1", workspace_id: "a", agent_status: "idle" }), pane({ pane_id: "p2", workspace_id: "a", agent_status: "blocked" })]), null);
    expect(pill?.status).toBe("blocked");
  });
});
