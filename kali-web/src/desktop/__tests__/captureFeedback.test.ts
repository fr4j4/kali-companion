import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THUMB_MS, useCaptureFeedback, type CaptureFeedbackOptions } from "../CaptureThumb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";
const created: number[] = [];

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  resume() { return Promise.resolve(); }
  createBuffer(_c: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { return { buffer: null, connect: (n: unknown) => n, start: () => { created.push(1); } }; }
  createBiquadFilter() { return { type: "", frequency: { value: 0 }, connect: (n: unknown) => n }; }
  createGain() { return { gain: { value: 0 }, connect: (n: unknown) => n }; }
}

describe("capture feedback", () => {
  let api: ReturnType<typeof useCaptureFeedback>;
  const mount = (options: CaptureFeedbackOptions) => {
    function Probe() { api = useCaptureFeedback(options); return null; }
    act(() => { createRoot(document.createElement("div")).render(createElement(Probe)); });
  };
  beforeEach(() => { vi.useFakeTimers(); created.length = 0; (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext; });
  afterEach(() => { vi.useRealTimers(); delete (window as unknown as { AudioContext?: unknown }).AudioContext; });

  it("shows the thumbnail, plays the shutter and hides it after a few seconds", () => {
    mount({ thumbnail: true, sound: true });
    act(() => api.captured(IMAGE));
    expect(api.thumb).toBe(IMAGE);
    expect(created.length).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(THUMB_MS + 10); });
    expect(api.thumb).toBeNull();
  });

  it("respects the settings: no thumbnail and no sound when turned off", () => {
    mount({ thumbnail: false, sound: false });
    act(() => api.captured(IMAGE));
    expect(api.thumb).toBeNull();
    expect(created.length).toBe(0);
  });

  it("can keep the sound while the thumbnail is off, and the other way round", () => {
    mount({ thumbnail: false, sound: true });
    act(() => api.captured(IMAGE));
    expect(api.thumb).toBeNull();
    expect(created.length).toBeGreaterThan(0);
    mount({ thumbnail: true, sound: false });
    created.length = 0;
    act(() => api.captured(IMAGE));
    expect(api.thumb).toBe(IMAGE);
    expect(created.length).toBe(0);
  });

  it("only accepts image data URLs and survives a missing audio device", () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    mount({ thumbnail: true, sound: true });
    act(() => api.captured("https://evil.example/x.png"));
    expect(api.thumb).toBeNull();
    act(() => api.captured(null));
    expect(api.thumb).toBeNull();
    act(() => api.captured(IMAGE));
    expect(api.thumb).toBe(IMAGE);
  });
});
