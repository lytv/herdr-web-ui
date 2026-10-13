import type { SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
import { rollupStatus, type KnownStatus } from "./status.ts";

export interface SlideSession {
  workspace: WorkspaceInfo;
  /** the pane a tap opens: the selected one, else herdr's focused one, else the first */
  paneId: string | null;
  /** the workspace's panes rolled up as the sidebar rolls them: blocked, done, working, ready */
  status: KnownStatus;
  selected: boolean;
}

/**
 * One pill per workspace of the selected PC, in herdr's order: the slide bar's fast
 * session switch. A tap opens the workspace's selected pane, else the one herdr has
 * in front on its active tab, else its first. Multi-PC picks and tab power use stay
 * in the drawer and on the desktop.
 */
export function slideSessions(snapshot: SessionSnapshot | null, selectedPaneId: string | null): SlideSession[] {
  if (!snapshot) return [];
  return snapshot.workspaces.map((workspace) => {
    const panes = snapshot.panes.filter((pane) => pane.workspace_id === workspace.workspace_id);
    const pick = (id: string | null | undefined) => (id ? panes.find((pane) => pane.pane_id === id) : undefined);
    const pane = pick(selectedPaneId)
      ?? pick(snapshot.layouts?.find((layout) => layout.tab_id === workspace.active_tab_id)?.focused_pane_id)
      ?? panes.find((pane) => pane.focused)
      ?? panes[0]
      ?? null;
    return {
      workspace,
      paneId: pane?.pane_id ?? null,
      status: rollupStatus(panes.map((candidate) => candidate.agent_status)),
      selected: pane !== null && pane.pane_id === selectedPaneId,
    };
  });
}
