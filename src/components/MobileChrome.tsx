import { useState } from "react";
import { Ellipsis } from "lucide-react";

import "./MobileChrome.css";

import type { SessionSnapshot } from "../../shared/protocol.ts";
import type { Machine } from "../../shared/machines.ts";
import type { HeaderCrumb } from "../lib/headerCrumb.ts";
import type { UpdatesModel } from "../lib/updates.ts";
import { useT } from "../lib/i18n.ts";
import { AgentMark } from "./AgentMark.tsx";
import { SlideBar } from "./SlideBar.tsx";
import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import { useMachineActionBanner } from "./MachineSidebar.tsx";
import { useUpdateNotice } from "./UpdateControls.tsx";

export interface MobileChromeProps {
  machines: Machine[];
  snapshot: SessionSnapshot | null;
  selectedPaneId: string | null;
  /** the header's connection word ("live", "reconnecting", …), read by assistive tech */
  connText: string;
  connTitle?: string;
  connected: boolean;
  herdrOnline: boolean;
  title: string;
  crumb: HeaderCrumb | null;
  agent: string | null;
  updates: UpdatesModel;
  onOpenUpdates: () => void;
  onSetupMachine: (machine: Machine, update?: boolean) => void;
  /** the ⋯ sheet: palette first, then workspace list, settings and App's own items */
  menuItems: RowMenuItem[];
  /** the menu's button carries a dot while alerts are off here (App's own pattern) */
  alertsDot: boolean;
  onSelectPane: (paneId: string) => void;
  onNewSession: () => void;
}

/**
 * The phone's chrome: one slim top bar (connection dot, session title plus one-line
 * crumb, menu button) over one slide bar of session pills. The split pane mounts below
 * it in the shared host, which never unmounts across the breakpoint. Update and machine
 * notices hold no rows here: they live at the top of the ⋯ sheet, with a dot on its
 * button while any is present. The drawer tree, the palette, files and settings stay
 * reachable from that sheet as full overlays. Desktop layout is untouched.
 */
export function MobileChrome(props: MobileChromeProps) {
  const t = useT();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const updateNotice = useUpdateNotice({ updates: props.updates, onOpen: () => { setMenu(null); props.onOpenUpdates(); } });
  const machineNotice = useMachineActionBanner({ machines: props.machines, onSetup: (machine, update) => { setMenu(null); props.onSetupMachine(machine, update); } });
  const notices = <div className="mobile-notices">{updateNotice}{machineNotice}</div>;
  const hasNotices = updateNotice !== null || machineNotice !== null;
  const dot = hasNotices || props.alertsDot;
  const menuLabel = hasNotices
    ? props.alertsDot ? t("More · notices · alerts are off") : t("More · notices")
    : props.alertsDot ? t("More · alerts are off") : t("More");
  return (
    <div className="mobile-chrome">
      <header className="mobile-topbar">
        {/* the header's own chip: below 900px it keeps only its dot, and live it stays in the
            document clipped (never display: none), which is what the browser scripts wait on */}
        <span className={`conn${props.connected && props.herdrOnline ? " conn-live" : " conn-reconnecting"}`} role="status" title={props.herdrOnline ? props.connTitle : t("herdr offline")}>
          <span className="conn-dot" aria-hidden="true" />
          <span className="conn-text">{props.herdrOnline ? props.connText : t("herdr offline")}</span>
        </span>
        <div className="mobile-title" title={props.crumb?.tooltip}>
          {props.agent && <AgentMark agent={props.agent} size={16} />}
          <span className="mobile-title-text">{props.title}</span>
          {props.crumb && <span className="mobile-crumb">{props.crumb.folder !== null ? `${props.crumb.place} › ${props.crumb.folder}` : props.crumb.place}</span>}
        </div>
        <button
          type="button"
          className="icon-button mobile-menu-button header-more-button"
          aria-label={menuLabel}
          title={menuLabel}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(event) => {
            const anchor = event.currentTarget;
            setMenu((open) => (open ? null : anchor));
          }}
        >
          <Ellipsis />
        </button>
        {dot && <span className="mobile-menu-dot" aria-hidden="true" />}
      </header>
      <SlideBar snapshot={props.snapshot} selectedPaneId={props.selectedPaneId} onSelectPane={props.onSelectPane} onNew={props.onNewSession} />
      {menu && (
        <RowMenu
          anchor={menu}
          title={t("More")}
          header={props.crumb ? (
            <div className="mobile-menu-head">
              <span>{props.crumb.place}</span>
              {props.crumb.path !== null && <span className="mobile-menu-path">{props.crumb.path}</span>}
              {notices}
            </div>
          ) : notices}
          items={props.menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
