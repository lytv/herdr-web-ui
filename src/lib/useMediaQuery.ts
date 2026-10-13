import { useEffect, useState } from "react";

/** Follows a media query: the layout rules that CSS alone cannot apply. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => watchMedia(window.matchMedia?.(query), () => setMatches(window.matchMedia(query).matches)), [query]);
  return matches;
}

interface MediaWatcher {
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}

/** Runs the listener once now and on every change; the pure half of useMediaQuery. */
export function watchMedia(media: MediaWatcher | undefined, onChange: () => void): () => void {
  if (!media) return () => undefined;
  onChange();
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Below this width the shell is the mobile layout: one top bar, one slide bar, two boxes. */
export const MOBILE_QUERY = "(max-width: 768px)";
