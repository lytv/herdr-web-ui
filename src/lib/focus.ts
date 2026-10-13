/**
 * Where focus goes when the control that had it is gone: Add PC closed Settings behind it, a
 * closed row left the roster. Focus returns to a visible workspace-list control: the drawer
 * toggle or mobile menu button on a phone, the sidebar toggle on a desktop.
 * Runs a frame later, once React has taken the vanished control out of the document.
 */
export function focusWorkspaceListToggle(): void {
  window.requestAnimationFrame(() => {
    const toggles = document.querySelectorAll<HTMLElement>(".app-header .drawer-toggle, .app-header .sidebar-toggle, .mobile-topbar .mobile-menu-button");
    [...toggles].find((toggle) => toggle.getClientRects().length > 0)?.focus();
  });
}
