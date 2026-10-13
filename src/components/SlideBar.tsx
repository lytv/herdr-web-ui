import { useLayoutEffect, useRef } from "react";
import { Plus } from "lucide-react";

import "./SlideBar.css";
// the pill's dot is the tab strip's own (TabStrip.css), so one rule colours both
import "./TabStrip.css";

import type { SessionSnapshot } from "../../shared/protocol.ts";
import { slideSessions } from "../lib/slideSessions.ts";
import { STATUS_WORD } from "../lib/status.ts";
import { useT } from "../lib/i18n.ts";

export interface SlideBarProps {
  snapshot: SessionSnapshot | null;
  selectedPaneId: string | null;
  onSelectPane: (paneId: string) => void;
  onNew: () => void;
}

/**
 * The phone's session switch: one pill per workspace of the selected PC, sideways
 * scrollable, with the sidebar's rollup status dot. A tap opens the workspace where
 * it was left; "+” starts a workspace. The drawer tree stays for multi-PC picks;
 * tab power use stays on the desktop.
 */
export function SlideBar({ snapshot, selectedPaneId, onSelectPane, onNew }: SlideBarProps) {
  const t = useT();
  const pills = slideSessions(snapshot, selectedPaneId);
  const selected = pills.find((pill) => pill.selected)?.workspace.workspace_id ?? null;
  const barRef = useRef<HTMLDivElement | null>(null);
  // the open pill stays in view across a session switch and a resize, with the smallest
  // scroll that shows it; a bar the user scrolled themselves is otherwise left alone
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || selected === null) return;
    const show = () => bar.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    show();
    window.addEventListener("resize", show);
    return () => window.removeEventListener("resize", show);
  }, [selected]);
  return (
    <div ref={barRef} className="slide-bar" role="tablist" aria-label={t("Herdr workspaces")}>
      {pills.map((pill) => (
        <button
          key={pill.workspace.workspace_id}
          type="button"
          role="tab"
          className={`slide-pill${pill.selected ? " is-active" : ""}`}
          aria-selected={pill.selected}
          title={`${pill.workspace.label} · ${t(STATUS_WORD[pill.status])}`}
          onClick={() => { if (pill.paneId !== null && !pill.selected) onSelectPane(pill.paneId); }}
        >
          {(pill.status === "working" || pill.status === "blocked" || pill.status === "done") && (
            <span className="tab-strip-dot" data-status={pill.status} aria-hidden="true" />
          )}
          <span className="slide-pill-label">{pill.workspace.label}</span>
        </button>
      ))}
      <button type="button" className="slide-pill slide-new" aria-label={t("New workspace")} title={t("New workspace")} onClick={onNew}>
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
