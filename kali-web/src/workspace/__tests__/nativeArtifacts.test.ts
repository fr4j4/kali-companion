import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../useWorkspace";
import type { WorkspaceAPI } from "../types";
import type { ArtifactEvent } from "../../lib/protocol";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = { event: "artifact", id: "a1", type: "html", windowType: "html", title: "Página", content: "<p>hi</p>", update: "create" } as ArtifactEvent;

describe("artifact in a single place (desktop)", () => {
  let api: WorkspaceAPI;
  let emit: (s: { sessionId: string; id: string; open: boolean; returned: boolean }) => void;
  let container: HTMLElement;
  const openArtifact = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    openArtifact.mockClear();
    (window as unknown as { kaliDesktop: unknown }).kaliDesktop = {
      getNativeArtifacts: () => Promise.resolve({ open: [], returned: [] }),
      onArtifactNative: (cb: typeof emit) => { emit = cb; return () => undefined; },
      openArtifact,
    };
    container = document.createElement("div");
    function Probe() { api = useWorkspace({ sessionId: "s1" }); return null; }
    act(() => { createRoot(container).render(createElement(Probe)); });
  });
  afterEach(() => { delete (window as unknown as { kaliDesktop?: unknown }).kaliDesktop; });

  it("hides a canvas window while it is native and ignores replays", async () => {
    act(() => api.syncArtifact(html));
    expect(api.windows.find((w) => w.artifactId === "a1")?.closed).toBe(false);
    act(() => emit({ sessionId: "s1", id: "a1", open: true, returned: false }));
    expect(api.windows.find((w) => w.artifactId === "a1")?.closed).toBe(true);
    act(() => api.syncArtifact({ ...html, content: null }));
    act(() => api.syncArtifact(html));
    expect(api.windows.filter((w) => w.artifactId === "a1" && !w.closed)).toHaveLength(0);
  });

  it("keeps it closed when the native window is closed with X", () => {
    act(() => api.syncArtifact(html));
    act(() => emit({ sessionId: "s1", id: "a1", open: true, returned: false }));
    act(() => emit({ sessionId: "s1", id: "a1", open: false, returned: false }));
    expect(api.windows.find((w) => w.artifactId === "a1")?.closed).toBe(true);
  });

  it("restores it in the canvas when the native window returns it", () => {
    act(() => api.syncArtifact(html));
    act(() => emit({ sessionId: "s1", id: "a1", open: true, returned: false }));
    act(() => emit({ sessionId: "s1", id: "a1", open: false, returned: true }));
    expect(api.windows.find((w) => w.artifactId === "a1")?.closed).toBe(false);
  });
});
