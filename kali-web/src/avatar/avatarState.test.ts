import { describe, expect, it } from "vitest";
import { AvatarStateTracker, viewToFrame } from "./avatarState";

describe("AvatarStateTracker (fallback for cores without the avatar brain)", () => {
  it("starts disconnected and at rest", () => {
    expect(new AvatarStateTracker().view(0)).toMatchObject({ activity: "reposo", emotion: "neutral", connected: false });
  });

  it("thinks while a turn streams, then speaks for the audio duration", () => {
    const t = new AvatarStateTracker();
    t.apply({ event: "ready" }, 0);
    expect(t.apply({ event: "turn_start" }, 1).activity).toBe("pensando");
    expect(t.apply({ event: "delta", text: "Hola" }, 2).text).toBe("Hola");
    expect(t.apply({ event: "tts_audio", duration: 2 }, 1000).activity).toBe("hablando");
    expect(t.apply({ event: "turn_end" }, 1500).activity).toBe("hablando");
    expect(t.view(3001).activity).toBe("reposo");
    expect(t.nextDeadline(1500)).toBe(3000);
  });

  it("listens after a wake word until the final transcript", () => {
    const t = new AvatarStateTracker();
    expect(t.apply({ event: "wake_word" }, 0).activity).toBe("escuchando");
    expect(t.apply({ event: "stt_final" }, 100).activity).toBe("reposo");
  });

  it("working on a tool is 'trabajando' with a neutral face, never angry", () => {
    const t = new AvatarStateTracker();
    expect(t.apply({ event: "tool_event", status: "running", call_id: "a" }, 0)).toMatchObject({ activity: "trabajando", emotion: "neutral" });
    expect(t.apply({ event: "tool_event", status: "ok", call_id: "a" }, 10)).toMatchObject({ activity: "reposo", emotion: "neutral" });
  });

  it("a failed tool worries briefly and a pending consent waits", () => {
    const t = new AvatarStateTracker();
    t.apply({ event: "tool_event", status: "running", call_id: "a" }, 0);
    expect(t.apply({ event: "tool_event", status: "error", call_id: "a" }, 10).emotion).toBe("preocupado");
    expect(t.view(5000).emotion).toBe("neutral");
    expect(t.apply({ event: "consent_request" }, 6000).activity).toBe("esperando");
  });

  it("takes the model's emotion tag", () => {
    const t = new AvatarStateTracker();
    expect(t.apply({ event: "emotion_event", id: "orgulloso" }, 0).emotion).toBe("orgulloso");
  });

  it("resets on disconnect", () => {
    const t = new AvatarStateTracker();
    t.apply({ event: "ready" }, 0);
    t.apply({ event: "turn_start" }, 1);
    expect(t.apply({ event: "disconnected" }, 2)).toMatchObject({ activity: "reposo", connected: false });
  });

  it("keeps speaking for a default time when the segment duration is unknown", () => {
    const t = new AvatarStateTracker();
    expect(t.apply({ event: "tts_audio", duration: 0 }, 1000).activity).toBe("hablando");
    expect(t.view(2000).activity).toBe("hablando");
    expect(t.view(3000).activity).toBe("reposo");
  });

  it("converts a view into a frame", () => {
    const f = viewToFrame({ activity: "trabajando", emotion: "neutral", text: "", connected: true }, 5);
    expect(f).toMatchObject({ v: 2, connected: true, attention: "work", activity: { id: "trabajando" } });
  });
});
