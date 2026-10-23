import { describe, expect, it } from "vitest";
import { AvatarStateTracker } from "./avatarState";

describe("AvatarStateTracker", () => {
  it("starts disconnected and idle", () => {
    const t = new AvatarStateTracker();
    expect(t.view(0)).toMatchObject({ mood: "idle", emotion: "normal", connected: false });
  });

  it("thinks while a turn streams, then speaks for the audio duration", () => {
    const t = new AvatarStateTracker();
    t.apply({ event: "ready" }, 0);
    expect(t.apply({ event: "turn_start" }, 1).mood).toBe("pensando");
    expect(t.apply({ event: "delta", text: "Hola" }, 2).text).toBe("Hola");
    expect(t.apply({ event: "tts_audio", duration: 2 }, 1000).mood).toBe("hablando");
    expect(t.apply({ event: "turn_end" }, 1500).mood).toBe("hablando");
    expect(t.view(3001).mood).toBe("idle");
    expect(t.nextDeadline(1500)).toBe(3000);
  });

  it("listens after a wake word until the final transcript", () => {
    const t = new AvatarStateTracker();
    expect(t.apply({ event: "wake_word" }, 0).mood).toBe("escuchando");
    expect(t.apply({ event: "stt_final" }, 100).mood).toBe("idle");
  });

  it("judges while a tool runs and is happy briefly after it succeeds", () => {
    const t = new AvatarStateTracker();
    expect(t.apply({ event: "tool_event", status: "running", call_id: "a" }, 0).emotion).toBe("enojado");
    expect(t.apply({ event: "tool_event", status: "ok", call_id: "a" }, 10).emotion).toBe("feliz");
    expect(t.view(5000).emotion).toBe("normal");
  });

  it("reacts to the assistant text at the end of a turn", () => {
    const t = new AvatarStateTracker();
    t.apply({ event: "turn_start" }, 0);
    t.apply({ event: "delta", text: "Listo, todo completado" }, 1);
    expect(t.apply({ event: "turn_end" }, 2).emotion).toBe("feliz");
  });

  it("resets on disconnect", () => {
    const t = new AvatarStateTracker();
    t.apply({ event: "ready" }, 0);
    t.apply({ event: "turn_start" }, 1);
    expect(t.apply({ event: "disconnected" }, 2)).toMatchObject({ mood: "idle", connected: false });
  });
});
