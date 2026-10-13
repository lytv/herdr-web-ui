import { describe, expect, test } from "bun:test";
import { watchMedia } from "./useMediaQuery.ts";

describe("watchMedia", () => {
  test("runs the listener once now, again on change, never after release", () => {
    const handlers = new Set<() => void>();
    const media = {
      addEventListener: (_type: string, handler: () => void) => handlers.add(handler),
      removeEventListener: (_type: string, handler: () => void) => handlers.delete(handler),
    };
    let calls = 0;
    const stop = watchMedia(media, () => { calls += 1; });
    expect(calls).toBe(1);
    for (const fire of handlers) fire();
    expect(calls).toBe(2);
    stop();
    for (const fire of handlers) fire();
    expect(calls).toBe(2);
  });

  test("without a query object there is nothing to watch", () => {
    let calls = 0;
    const stop = watchMedia(undefined, () => { calls += 1; });
    stop();
    expect(calls).toBe(0);
  });
});
