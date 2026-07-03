import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OutgoingEvent } from "../protocol";
import { WSClient } from "../wsClient";

describe("WSClient.sendAndWait", () => {
  let client: WSClient;

  beforeEach(() => {
    client = new WSClient("ws://localhost:9999");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("supports a global timeout longer than the attempt timeout with progress resets", async () => {
    vi.useFakeTimers();
    const promise = client.sendAndWait<{ event: string; value: number }>(
      { event: "test" },
      "test_response",
      100,
      undefined,
      { onProgress: () => {}, globalTimeoutMs: 250 },
    );

    // Keep resetting the 100ms attempt timer via progress events.
    for (let t = 80; t < 220; t += 80) {
      await vi.advanceTimersByTimeAsync(80);
      promise.__notifyProgress?.();
    }
    // Response arrives at ~240ms, within the 250ms global cap.
    await vi.advanceTimersByTimeAsync(40);
    client.simulate({ event: "test_response", value: 42 } as OutgoingEvent);

    await expect(promise).resolves.toEqual({ event: "test_response", value: 42 });
  });

  it("resolves when response arrives before timeout", async () => {
    vi.useFakeTimers();
    const promise = client.sendAndWait<{ event: string; value: number }>(
      { event: "test" },
      "test_response",
      1000,
    );

    client.simulate({ event: "test_response", value: 42 } as OutgoingEvent);

    await expect(promise).resolves.toEqual({ event: "test_response", value: 42 });
  });

  it("times out if no response arrives", async () => {
    vi.useFakeTimers();
    const promise = client.sendAndWait<{ event: string }>(
      { event: "test" },
      "test_response",
      100,
    );

    vi.advanceTimersByTime(101);

    await expect(promise).rejects.toThrow("sendAndWait timed out after 100ms");
  });

  it("resets the attempt timer when onProgress is called", async () => {
    vi.useFakeTimers();
    const promise = client.sendAndWait<{ event: string; value: number }>(
      { event: "test" },
      "test_response",
      100,
      undefined,
      {
        onProgress: () => {},
        globalTimeoutMs: 300,
      },
    );

    // Without progress, it would time out at 100ms. Notifying progress resets
    // the attempt timer, extending the deadline.
    await vi.advanceTimersByTimeAsync(80);
    promise.__notifyProgress?.();

    await vi.advanceTimersByTimeAsync(80); // now 160ms, still within global 300ms
    client.simulate({ event: "test_response", value: 42 } as OutgoingEvent);

    await expect(promise).resolves.toEqual({ event: "test_response", value: 42 });
  });

  it("still fails when global timeout is exceeded even with progress", async () => {
    vi.useFakeTimers();
    let progressCalls = 0;
    const promise = client.sendAndWait<{ event: string }>(
      { event: "test" },
      "test_response",
      100,
      undefined,
      {
        onProgress: () => {
          progressCalls += 1;
        },
        globalTimeoutMs: 200,
      },
    );

    // Notifying progress resets the attempt timer and invokes the callback.
    promise.__notifyProgress?.();
    await vi.advanceTimersByTimeAsync(80);
    expect(progressCalls).toBe(1);

    promise.__notifyProgress?.();
    await vi.advanceTimersByTimeAsync(80);

    // By now ~160ms elapsed; remaining global is ~40ms, next attempt tick is 40ms.
    // No further progress, so it expires at ~200ms with the global message.
    await vi.advanceTimersByTimeAsync(50);

    await expect(promise).rejects.toThrow("global");
  });

  it("rejects immediately when abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.sendAndWait({ event: "test" }, "test_response", 1000, controller.signal),
    ).rejects.toThrow("aborted before send");
  });

  it("rejects when abort signal fires", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = client.sendAndWait<{ event: string }>(
      { event: "test" },
      "test_response",
      1000,
      controller.signal,
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(promise).rejects.toThrow("sendAndWait aborted");
  });
});
