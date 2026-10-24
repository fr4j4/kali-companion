import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeDesktop } from "../../lib/desktop";
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

  it("exposes the artifact as native while it is outside, for the canvas's ghost", () => {
    act(() => api.syncArtifact(html));
    expect(api.nativeIds.has("a1")).toBe(false);
    act(() => emit({ sessionId: "s1", id: "a1", open: true, returned: false }));
    expect(api.nativeIds.has("a1")).toBe(true);
    act(() => emit({ sessionId: "s1", id: "a1", open: false, returned: false }));
    expect(api.nativeIds.has("a1")).toBe(false);
  });

  it("flashes the ghost when Kali updates the artifact outside, but not on a hollow replay", () => {
    act(() => api.syncArtifact(html));
    act(() => emit({ sessionId: "s1", id: "a1", open: true, returned: false }));
    act(() => api.syncArtifact({ ...html, content: null }));
    expect(api.nativeFlash.a1).toBeUndefined();
    act(() => api.syncArtifact({ ...html, update: "update", content: "<p>2</p>" }));
    expect(typeof api.nativeFlash.a1).toBe("number");
  });

  it("restores it in the canvas when the native window returns it", () => {
    act(() => api.syncArtifact(html));
    act(() => emit({ sessionId: "s1", id: "a1", open: true, returned: false }));
    act(() => emit({ sessionId: "s1", id: "a1", open: false, returned: true }));
    expect(api.windows.find((w) => w.artifactId === "a1")?.closed).toBe(false);
  });
});

describe("silent captures with native windows enabled", () => {
  let api: WorkspaceAPI;
  const openArtifact = vi.fn(() => Promise.resolve());

  beforeEach(async () => {
    openArtifact.mockClear();
    window.localStorage.setItem("kali.sessionId", "s1");
    (window as unknown as { kaliDesktop: unknown }).kaliDesktop = {
      getConfig: () => Promise.resolve({ artifactsNative: true }),
      getNativeArtifacts: () => Promise.resolve({ open: [], returned: [] }),
      onArtifactNative: () => () => undefined,
      openArtifact,
    };
    await initializeDesktop();
    const container = document.createElement("div");
    function Probe() { api = useWorkspace({ sessionId: "s1" }); return null; }
    act(() => { createRoot(container).render(createElement(Probe)); });
  });
  afterEach(() => { delete (window as unknown as { kaliDesktop?: unknown }).kaliDesktop; });

  it("opens an ordinary artifact in a native window", () => {
    act(() => api.syncArtifact({ ...html, id: "a2" }));
    expect(openArtifact).toHaveBeenCalledWith("s1", "a2", "html");
    expect(api.nativeIds.has("a2")).toBe(true);
  });

  it("files a capture in the library without opening a native window or a canvas window", () => {
    const capture = { event: "artifact", id: "shot1", type: "widget", windowType: "image", title: "Screenshot", content: "{}", update: "create", silent: true } as ArtifactEvent;
    act(() => api.syncArtifact(capture));
    expect(openArtifact).not.toHaveBeenCalled();
    expect(api.windows.find((w) => w.artifactId === "shot1")?.closed).toBe(true);
    // Still reachable from the library.
    act(() => api.reopenArtifact("shot1"));
    expect(api.windows.find((w) => w.artifactId === "shot1")?.closed).toBe(false);
  });
});
