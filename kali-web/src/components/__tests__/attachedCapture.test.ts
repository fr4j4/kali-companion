import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import { AttachedCapture } from "../AttachedCapture";
import type { CaptureAttachedEvent } from "../../lib/protocol";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CAPTURE: CaptureAttachedEvent = { event: "capture_attached", id: "cap_1", session_id: "s", mode: "region", thumb: "data:image/png;base64,iVBORw0KGgo=" };

describe("attached capture", () => {
  let host: HTMLDivElement;
  const mount = (capture: CaptureAttachedEvent | null, onDiscard = vi.fn()) => {
    act(() => { createRoot(host).render(createElement(AttachedCapture, { capture, onDiscard })); });
    return onDiscard;
  };
  beforeEach(() => { host = document.createElement("div"); });

  it("renders nothing without a capture", () => {
    mount(null);
    expect(host.innerHTML).toBe("");
  });

  it("shows the thumbnail and can only remove the capture", () => {
    const onDiscard = mount(CAPTURE);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(CAPTURE.thumb);
    expect(host.querySelectorAll("button").length).toBe(1);
    act(() => { host.querySelector("button")!.click(); });
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("ignores a thumbnail that is not an image data URL", () => {
    mount({ ...CAPTURE, thumb: "https://evil.example/x.png" });
    expect(host.querySelector("img")).toBeNull();
  });
});
